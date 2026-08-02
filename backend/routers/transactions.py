import csv
import io
import unicodedata
from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Transaction, Account, Category, ImportBatch
from schemas import TransactionOut, TransactionUpdate, TransactionMeta, TransactionCreateManual
from utils import generate_import_hash, csv_safe_cell


def strip_accents(text: str) -> str:
    """Remove accents/diacritics from a string."""
    nfkd = unicodedata.normalize('NFKD', text)
    return ''.join(c for c in nfkd if not unicodedata.combining(c))

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
    uncategorized: Optional[bool] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    is_debit: Optional[bool] = None,
    is_internal_transfer: Optional[bool] = None,
    bank_name: Optional[str] = None,
    month: Optional[str] = None,
    import_batch_id: Optional[int] = None,
    limit: int = Query(default=500, le=10000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    filters = [Transaction.profile_id == pid]
    if account_id is not None:
        filters.append(Transaction.account_id == account_id)
    if uncategorized:
        filters.append(Transaction.category_id == None)
    elif category_id is not None:
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
            select(Account.id).where(Account.bank_name == bank_name, Account.profile_id == pid)
        )
        account_ids = [r[0] for r in account_ids_q]
        filters.append(Transaction.account_id.in_(account_ids))
    if import_batch_id is not None:
        filters.append(Transaction.import_batch_id == import_batch_id)

    stmt = (
        select(Transaction)
        .options(selectinload(Transaction.account))
        .where(and_(*filters))
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
async def transaction_meta(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Return available filter options for the transactions page."""
    months_q = await db.execute(
        select(func.strftime("%Y-%m", Transaction.date).label("month"))
        .where(Transaction.profile_id == pid)
        .distinct()
        .order_by(func.strftime("%Y-%m", Transaction.date).desc())
    )
    available_months = [r[0] for r in months_q if r[0]]

    banks_q = await db.execute(
        select(Account.bank_name).where(Account.profile_id == pid).distinct().order_by(Account.bank_name)
    )
    available_banks = [r[0] for r in banks_q if r[0]]

    return TransactionMeta(
        available_months=available_months,
        available_banks=available_banks,
    )


@router.get("/batches")
async def list_batches(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(
        select(ImportBatch)
        .options(selectinload(ImportBatch.account))
        .where(ImportBatch.profile_id == pid)
        .order_by(ImportBatch.created_at.desc())
    )
    batches = result.scalars().all()
    return [
        {
            "id": b.id,
            "account_id": b.account_id,
            "account_name": b.account.name if b.account else None,
            "filename": b.filename,
            "transaction_count": b.transaction_count,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in batches
    ]


@router.post("/detect-transfers", status_code=200)
async def detect_transfers_endpoint(
    max_days: int = Query(default=3, le=7),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Detect pairs of transactions that are likely internal transfers.

    Delegates to the shared transfer-detection service (the same one the import
    flow runs) so both paths use one, description-aware algorithm."""
    from services.transfer_detector import detect_internal_transfers
    detected_pairs = await detect_internal_transfers(db, pid, max_days)
    return {"detected_pairs": detected_pairs}

@router.post("", response_model=TransactionOut, status_code=201)
async def create_transaction(
    payload: TransactionCreateManual,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Create a manual transaction."""
    # Generate a unique hash since this is manual
    import_hash = generate_import_hash(
        payload.date,
        payload.description + " (manuel)",
        payload.amount_cents,
        payload.account_id,
        payload.is_debit,
    )

    # Check if this hash already exists (unlikely but possible if exactly the same manual entry is made twice)
    existing = await db.execute(select(Transaction).where(Transaction.import_hash == import_hash))
    if existing.scalar_one_or_none():
        # Append a timestamp or random suffix to hash to avoid unique constraint violation on identical manual entries
        import time
        import_hash = f"{import_hash}_{int(time.time()*1000)}"

    txn_data = payload.model_dump()
    txn = Transaction(**txn_data, import_hash=import_hash, is_manually_reviewed=True, profile_id=pid)
    
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
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Delete multiple transactions at once."""
    if not payload.ids:
        return

    await db.execute(
        Transaction.__table__.delete().where(Transaction.id.in_(payload.ids), Transaction.profile_id == pid)
    )
    await db.commit()


class BulkTransferUpdate(BaseModel):
    ids: List[int]
    is_internal_transfer: bool = True


@router.post("/bulk-update-transfer", status_code=200)
async def bulk_update_transfer(
    payload: BulkTransferUpdate,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Mark/unmark multiple transactions as internal transfers."""
    if not payload.ids:
        return {"updated": 0}
    from sqlalchemy import update
    await db.execute(
        update(Transaction)
        .where(Transaction.id.in_(payload.ids), Transaction.profile_id == pid)
        .values(is_internal_transfer=payload.is_internal_transfer)
    )
    await db.commit()
    return {"updated": len(payload.ids)}


class BulkReviewUpdate(BaseModel):
    ids: List[int]
    is_manually_reviewed: bool = True


@router.post("/bulk-update-reviewed", status_code=200)
async def bulk_update_reviewed(
    payload: BulkReviewUpdate,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Mark multiple transactions as reviewed (or unreviewed) at once."""
    if not payload.ids:
        return {"updated": 0}
    from sqlalchemy import update
    await db.execute(
        update(Transaction)
        .where(Transaction.id.in_(payload.ids), Transaction.profile_id == pid)
        .values(is_manually_reviewed=payload.is_manually_reviewed)
    )
    await db.commit()
    return {"updated": len(payload.ids)}


@router.post("/bulk-update-category", status_code=200)
async def bulk_update_category(
    payload: BulkCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Update category for multiple transactions at once."""
    if not payload.ids:
        return {"updated": 0}
    from sqlalchemy import update
    await db.execute(
        update(Transaction)
        .where(Transaction.id.in_(payload.ids), Transaction.profile_id == pid)
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
    pid: int = Depends(current_profile_id),
):
    filters = [Transaction.profile_id == pid]
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
        .options(selectinload(Transaction.account), selectinload(Transaction.category))
        .where(and_(*filters))
        .order_by(Transaction.date.desc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Date", "Compte", "Description", "Montant", "Devise", "Categorie"])
    for t in rows:
        amount = t.amount_cents / 100
        if t.is_debit:
            amount = -amount
        writer.writerow([
            t.date,
            csv_safe_cell(strip_accents(t.account.name)) if t.account else "",
            csv_safe_cell(strip_accents(t.description)),
            f"{amount:.2f}",
            strip_accents(t.currency or "EUR"),
            csv_safe_cell(strip_accents(t.category.name)) if t.category else "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions.csv"},
    )


@router.get("/{transaction_id}", response_model=TransactionOut)
async def get_transaction(transaction_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id, Transaction.profile_id == pid))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return TransactionOut.from_orm_with_display(txn)


@router.put("/{transaction_id}", response_model=TransactionOut)
async def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id, Transaction.profile_id == pid))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    # Editing one of these core fields (vs. just recategorizing) marks the row edited.
    CORE_FIELDS = {"account_id", "date", "description", "amount_cents", "currency", "is_debit"}
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if field in CORE_FIELDS and getattr(txn, field) != value:
            txn.is_manually_edited = True
        setattr(txn, field, value)
    await db.commit()
    await db.refresh(txn)
    return TransactionOut.from_orm_with_display(txn)


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(transaction_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id, Transaction.profile_id == pid))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(txn)
    await db.commit()


