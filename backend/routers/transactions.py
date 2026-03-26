import csv
import io
from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Transaction, Account, Category
from schemas import TransactionOut, TransactionUpdate, TransactionMeta, TransactionCreateManual
from utils import generate_import_hash

router = APIRouter()

class BulkDeleteQuery(BaseModel):
    ids: List[int]

class BulkCategoryUpdate(BaseModel):
    ids: List[int]
    category_id: Optional[int] = None


@router.get("", response_model=List[TransactionOut])
async def list_transactions(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    is_debit: Optional[bool] = None,
    is_internal_transfer: Optional[bool] = None,
    bank_name: Optional[str] = None,
    month: Optional[str] = None,
    limit: int = Query(default=500, le=2000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if account_id is not None:
        filters.append(Transaction.account_id == account_id)
    if category_id is not None:
        filters.append(Transaction.category_id == category_id)
    if date_from is not None:
        filters.append(Transaction.date >= date_from)
    if date_to is not None:
        filters.append(Transaction.date <= date_to)
    if month is not None:
        # month format: YYYY-MM
        filters.append(func.strftime("%Y-%m", Transaction.date) == month)
    if search:
        filters.append(Transaction.description.ilike(f"%{search}%"))
    if is_debit is not None:
        filters.append(Transaction.is_debit == is_debit)
    if is_internal_transfer is not None:
        filters.append(Transaction.is_internal_transfer == is_internal_transfer)
    if bank_name is not None:
        # Filter via join on accounts
        account_ids_q = await db.execute(
            select(Account.id).where(Account.bank_name == bank_name)
        )
        account_ids = [r[0] for r in account_ids_q]
        filters.append(Transaction.account_id.in_(account_ids))

    stmt = (
        select(Transaction)
        .options(selectinload(Transaction.account))
        .where(and_(*filters) if filters else True)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    outs = []
    for r in rows:
        out = TransactionOut.from_orm_with_display(r)
        if r.account:
            out.account_name = r.account.name
        outs.append(out)
    return outs


@router.get("/meta", response_model=TransactionMeta)
async def transaction_meta(db: AsyncSession = Depends(get_db)):
    """Return available filter options for the transactions page."""
    months_q = await db.execute(
        select(func.strftime("%Y-%m", Transaction.date).label("month"))
        .distinct()
        .order_by(func.strftime("%Y-%m", Transaction.date).desc())
    )
    available_months = [r[0] for r in months_q if r[0]]

    banks_q = await db.execute(
        select(Account.bank_name).distinct().order_by(Account.bank_name)
    )
    available_banks = [r[0] for r in banks_q if r[0]]

    return TransactionMeta(
        available_months=available_months,
        available_banks=available_banks,
    )


@router.post("/detect-transfers", status_code=200)
async def detect_internal_transfers(
    max_days: int = Query(default=3, le=7),
    db: AsyncSession = Depends(get_db),
):
    """Detect pairs of transactions that are likely internal transfers between accounts."""
    # Get all transactions with their accounts
    result = await db.execute(
        select(Transaction).order_by(Transaction.date.desc(), Transaction.id.desc())
    )
    txns = result.scalars().all()

    # Group by absolute amount for fast lookup
    by_amount: dict = {}
    for t in txns:
        key = t.amount_cents
        if key not in by_amount:
            by_amount[key] = []
        by_amount[key].append(t)

    detected_pairs = 0
    processed = set()

    for t in txns:
        if t.id in processed:
            continue
        # Look for the opposite transaction (same amount, opposite sign, different account, within max_days)
        target_amount = t.amount_cents
        candidates = by_amount.get(target_amount, [])
        for candidate in candidates:
            if candidate.id == t.id:
                continue
            if candidate.id in processed:
                continue
            if candidate.account_id == t.account_id:
                continue
            # One must be debit, other credit
            if candidate.is_debit == t.is_debit:
                continue
            # Check date proximity
            delta = abs((t.date - candidate.date).days)
            if delta > max_days:
                continue
            # Found a pair!
            t.is_internal_transfer = True
            t.transfer_pair_id = candidate.id
            candidate.is_internal_transfer = True
            candidate.transfer_pair_id = t.id
            processed.add(t.id)
            processed.add(candidate.id)
            detected_pairs += 1
            break

    await db.commit()
    return {"detected_pairs": detected_pairs}

@router.post("", response_model=TransactionOut, status_code=201)
async def create_transaction(
    payload: TransactionCreateManual, 
    db: AsyncSession = Depends(get_db)
):
    """Create a manual transaction."""
    # Generate a unique hash since this is manual
    import_hash = generate_import_hash(
        payload.date, 
        payload.description + " (manuel)", 
        payload.amount_cents
    )
    
    # Check if this hash already exists (unlikely but possible if exactly the same manual entry is made twice)
    existing = await db.execute(select(Transaction).where(Transaction.import_hash == import_hash))
    if existing.scalar_one_or_none():
        # Append a timestamp or random suffix to hash to avoid unique constraint violation on identical manual entries
        import time
        import_hash = f"{import_hash}_{int(time.time()*1000)}"

    txn_data = payload.model_dump()
    txn = Transaction(**txn_data, import_hash=import_hash, is_manually_reviewed=True)
    
    db.add(txn)
    await db.commit()
    await db.refresh(txn)

    # Need account for response
    result = await db.execute(
        select(Transaction).options(selectinload(Transaction.account)).where(Transaction.id == txn.id)
    )
    txn_with_acc = result.scalar_one()

    out = TransactionOut.from_orm_with_display(txn_with_acc)
    out.account_name = txn_with_acc.account.name if txn_with_acc.account else None
    return out

@router.post("/bulk-delete", status_code=204)
async def bulk_delete_transactions(
    payload: BulkDeleteQuery, 
    db: AsyncSession = Depends(get_db)
):
    """Delete multiple transactions at once."""
    if not payload.ids:
        return
        
    await db.execute(
        Transaction.__table__.delete().where(Transaction.id.in_(payload.ids))
    )
    await db.commit()


@router.post("/bulk-update-category", status_code=200)
async def bulk_update_category(
    payload: BulkCategoryUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update category for multiple transactions at once."""
    if not payload.ids:
        return {"updated": 0}
    from sqlalchemy import update
    await db.execute(
        update(Transaction)
        .where(Transaction.id.in_(payload.ids))
        .values(category_id=payload.category_id)
    )
    await db.commit()
    return {"updated": len(payload.ids)}


@router.get("/export")
async def export_transactions(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if account_id is not None:
        filters.append(Transaction.account_id == account_id)
    if category_id is not None:
        filters.append(Transaction.category_id == category_id)
    if date_from is not None:
        filters.append(Transaction.date >= date_from)
    if date_to is not None:
        filters.append(Transaction.date <= date_to)

    stmt = (
        select(Transaction)
        .where(and_(*filters) if filters else True)
        .order_by(Transaction.date.desc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["id", "date", "description", "amount_cents", "is_debit", "category_id", "notes", "import_hash", "is_internal_transfer"])
    for t in rows:
        writer.writerow([t.id, t.date, t.description, t.amount_cents, t.is_debit, t.category_id, t.notes, t.import_hash, t.is_internal_transfer])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions.csv"},
    )


@router.get("/{transaction_id}", response_model=TransactionOut)
async def get_transaction(transaction_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return TransactionOut.from_orm_with_display(txn)


@router.put("/{transaction_id}", response_model=TransactionOut)
async def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(txn, field, value)
    await db.commit()
    await db.refresh(txn)
    return TransactionOut.from_orm_with_display(txn)


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(transaction_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(txn)
    await db.commit()
