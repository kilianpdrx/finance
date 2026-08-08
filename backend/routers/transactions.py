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
from dependencies import current_profile_id
from models import Transaction, Account, Category, ImportBatch
from schemas import TransactionOut, TransactionUpdate, TransactionMeta, TransactionCreateManual
from utils import generate_import_hash, csv_safe_cell

router = APIRouter()

class BulkDeleteQuery(BaseModel):
    ids: List[int]

class BulkCategoryUpdate(BaseModel):
    ids: List[int]
    category_id: Optional[int] = None


# SQLite caps the number of host parameters per statement (historically 999);
# chunk large id lists so bulk operations on a full selection don't overflow it.
_ID_CHUNK = 900


def _chunks(seq: List[int], size: int = _ID_CHUNK):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


async def _reject_grouping_category(db: AsyncSession, category_id: Optional[int]):
    """A category that has children is grouping-only and cannot hold transactions
    directly — the user must pick a sub-category (e.g. "Autre …")."""
    if category_id is None:
        return
    has_children = (await db.execute(
        select(Category.id).where(Category.parent_id == category_id).limit(1)
    )).scalar_one_or_none()
    if has_children:
        raise HTTPException(
            status_code=400,
            detail="Cette catégorie sert de regroupement ; choisissez une sous-catégorie.",
        )


async def _build_txn_filters(
    db: AsyncSession, pid: int, *, account_id=None, category_id=None, uncategorized=None,
    categorized=None, date_from=None, date_to=None, search=None, is_debit=None,
    is_internal_transfer=None, bank_name=None, month=None, import_batch_id=None,
):
    """Shared filter list for the transactions list and count endpoints."""
    filters = [Transaction.profile_id == pid]
    if account_id is not None:
        filters.append(Transaction.account_id == account_id)
    if uncategorized:
        filters.append(Transaction.category_id == None)  # noqa: E711
    elif categorized:
        filters.append(Transaction.category_id != None)  # noqa: E711
    elif category_id is not None:
        filters.append(Transaction.category_id == category_id)
    if date_from is not None:
        filters.append(Transaction.date >= date_from)
    if date_to is not None:
        filters.append(Transaction.date <= date_to)
    if month is not None:
        filters.append(func.strftime("%Y-%m", Transaction.date) == month)  # YYYY-MM
    if search:
        filters.append(Transaction.description.ilike(f"%{search}%"))
    if is_debit is not None:
        filters.append(Transaction.is_debit == is_debit)
    if is_internal_transfer is not None:
        filters.append(Transaction.is_internal_transfer == is_internal_transfer)
    if bank_name is not None:
        account_ids_q = await db.execute(
            select(Account.id).where(Account.bank_name == bank_name, Account.profile_id == pid)
        )
        filters.append(Transaction.account_id.in_([r[0] for r in account_ids_q]))
    if import_batch_id is not None:
        filters.append(Transaction.import_batch_id == import_batch_id)
    return filters


@router.get("/count")
async def count_transactions(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    uncategorized: Optional[bool] = None,
    categorized: Optional[bool] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    is_debit: Optional[bool] = None,
    is_internal_transfer: Optional[bool] = None,
    bank_name: Optional[str] = None,
    month: Optional[str] = None,
    import_batch_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Total number of transactions matching the given filters (for the header count)."""
    filters = await _build_txn_filters(
        db, pid, account_id=account_id, category_id=category_id, uncategorized=uncategorized,
        categorized=categorized, date_from=date_from, date_to=date_to, search=search,
        is_debit=is_debit, is_internal_transfer=is_internal_transfer, bank_name=bank_name,
        month=month, import_batch_id=import_batch_id,
    )
    total = (await db.execute(select(func.count(Transaction.id)).where(and_(*filters)))).scalar() or 0
    return {"total": total}


@router.get("/stats")
async def transaction_stats(
    account_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    is_debit: Optional[bool] = None,
    bank_name: Optional[str] = None,
    month: Optional[str] = None,
    import_batch_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Counts for the transactions toolbar: total, categorised, uncategorised and
    internal transfers — over the base filters, *ignoring* the categorized/
    uncategorized/hideTransfers toggles (those are the dimensions being counted)."""
    from sqlalchemy import case
    filters = await _build_txn_filters(
        db, pid, account_id=account_id, date_from=date_from, date_to=date_to, search=search,
        is_debit=is_debit, bank_name=bank_name, month=month, import_batch_id=import_batch_id,
    )
    row = (await db.execute(
        select(
            func.count(Transaction.id),
            func.sum(case((Transaction.category_id != None, 1), else_=0)),  # noqa: E711
            func.sum(case((Transaction.is_internal_transfer == True, 1), else_=0)),  # noqa: E712
        ).where(and_(*filters))
    )).one()
    total = row[0] or 0
    categorized = row[1] or 0
    transfers = row[2] or 0
    return {
        "total": total,
        "categorized": categorized,
        "uncategorized": total - categorized,
        "transfers": transfers,
    }


@router.get("/ids")
async def transaction_ids(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    uncategorized: Optional[bool] = None,
    categorized: Optional[bool] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    is_debit: Optional[bool] = None,
    is_internal_transfer: Optional[bool] = None,
    bank_name: Optional[str] = None,
    month: Optional[str] = None,
    import_batch_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """All transaction ids matching the given filters — for "select all matching"
    across pages. Same filter surface as the list endpoint."""
    filters = await _build_txn_filters(
        db, pid, account_id=account_id, category_id=category_id, uncategorized=uncategorized,
        categorized=categorized, date_from=date_from, date_to=date_to, search=search,
        is_debit=is_debit, is_internal_transfer=is_internal_transfer, bank_name=bank_name,
        month=month, import_batch_id=import_batch_id,
    )
    rows = (await db.execute(select(Transaction.id).where(and_(*filters)))).all()
    return {"ids": [r[0] for r in rows]}


@router.get("", response_model=List[TransactionOut])
async def list_transactions(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    uncategorized: Optional[bool] = None,
    categorized: Optional[bool] = None,
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
    filters = await _build_txn_filters(
        db, pid, account_id=account_id, category_id=category_id, uncategorized=uncategorized,
        categorized=categorized, date_from=date_from, date_to=date_to, search=search,
        is_debit=is_debit, is_internal_transfer=is_internal_transfer, bank_name=bank_name,
        month=month, import_batch_id=import_batch_id,
    )

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

    # Flag rows where several distinct categories match via rules (against the
    # current ruleset, so newly-added conflicting rules show immediately) and
    # surface WHICH categories conflict.
    from services.categorizer import evaluate_rules_batch
    evals = await evaluate_rules_batch(
        [{"description": r.description, "amount_cents": r.amount_cents, "date": str(r.date),
          "is_debit": r.is_debit, "currency": r.currency, "account_id": r.account_id} for r in rows],
        db, pid,
    )
    conflict_ids = {cid for _, _, matches in evals if len(matches) >= 2 for cid in matches}
    names: dict[int, str] = {}
    if conflict_ids:
        cat_rows = await db.execute(select(Category.id, Category.name).where(Category.id.in_(conflict_ids)))
        names = {cid: name for cid, name in cat_rows}
    for out, (_, _, matches) in zip(outs, evals):
        if len(matches) >= 2:
            out.category_conflict = True
            out.conflict_categories = sorted(names.get(cid, str(cid)) for cid in matches)
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

    for chunk in _chunks(payload.ids):
        await db.execute(
            Transaction.__table__.delete().where(Transaction.id.in_(chunk), Transaction.profile_id == pid)
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
    for chunk in _chunks(payload.ids):
        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(chunk), Transaction.profile_id == pid)
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
    for chunk in _chunks(payload.ids):
        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(chunk), Transaction.profile_id == pid)
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
    await _reject_grouping_category(db, payload.category_id)
    from sqlalchemy import update
    for chunk in _chunks(payload.ids):
        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(chunk), Transaction.profile_id == pid)
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
    output.write("﻿")  # UTF-8 BOM so Excel detects UTF-8 and renders accents (é, à…)
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Date", "Compte", "Description", "Montant", "Devise", "Catégorie"])
    for t in rows:
        amount = t.amount_cents / 100
        if t.is_debit:
            amount = -amount
        writer.writerow([
            t.date,
            csv_safe_cell(t.account.name) if t.account else "",
            csv_safe_cell(t.description),
            f"{amount:.2f}",
            t.currency or "EUR",
            csv_safe_cell(t.category.name) if t.category else "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
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
    if "category_id" in updates:
        await _reject_grouping_category(db, updates["category_id"])
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


