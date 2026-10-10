import csv
import io
from typing import List, Literal, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Transaction, Account, Category, ImportBatch
from schemas import (
    TransactionOut, TransactionUpdate, TransactionMeta, TransactionCreateManual,
    UncategorizedGroup, SimilarUncategorized,
)
from ownership import require_account, require_category
from utils import generate_import_hash, csv_safe_cell, parse_amount_query
from services.label_groups import group_by_label, label_key, rule_pattern
from services.category_source import MANUAL, RULE, disagreeing_category, manual_source
from services.categorizer import evaluate_rules_batch, rule_input

router = APIRouter()

class BulkDeleteQuery(BaseModel):
    ids: List[int]

class BulkCategoryUpdate(BaseModel):
    ids: List[int]
    category_id: Optional[int] = None
    # Only fill rows that have no category yet. For "classify the others with this
    # label": the list the user saw may be stale, and a category that was set in
    # the meantime must not be overwritten.
    only_uncategorized: bool = False


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
    category_source=None,
):
    """Shared filter list for the transactions list and count endpoints."""
    filters = [Transaction.profile_id == pid]
    if account_id is not None:
        filters.append(Transaction.account_id == account_id)
    if uncategorized:
        # "Sans catégorie" = still to classify. An internal transfer has no
        # category ON PURPOSE (it must not weigh on budgets), so it is not one.
        filters.append(Transaction.category_id == None)  # noqa: E711
        filters.append(Transaction.is_internal_transfer == False)  # noqa: E712
    elif categorized:
        filters.append(Transaction.category_id != None)  # noqa: E711
    elif category_id is not None:
        # Selecting a namespace (parent) matches all of its sub-categories too.
        child_ids = [r[0] for r in (await db.execute(
            select(Category.id).where(Category.parent_id == category_id)
        )).all()]
        if child_ids:
            filters.append(Transaction.category_id.in_([category_id, *child_ids]))
        else:
            filters.append(Transaction.category_id == category_id)
    if date_from is not None:
        filters.append(Transaction.date >= date_from)
    if date_to is not None:
        filters.append(Transaction.date <= date_to)
    if month is not None:
        filters.append(func.strftime("%Y-%m", Transaction.date) == month)  # YYYY-MM
    if search:
        # The search box finds a label OR an amount ("23,40", "-1 850", "23").
        label = Transaction.description.ilike(f"%{search}%")
        amount = parse_amount_query(search)
        if amount is None:
            filters.append(label)
        else:
            # The amount charged abroad is searched too: it is what a card slip shows.
            in_range = or_(
                Transaction.amount_cents.between(amount.lo_cents, amount.hi_cents),
                Transaction.original_amount_cents.between(amount.lo_cents, amount.hi_cents),
            )
            if amount.is_debit is not None:
                in_range = and_(in_range, Transaction.is_debit == amount.is_debit)
            filters.append(in_range if amount.amount_only else or_(label, in_range))
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
    if category_source is not None:
        # "rule" = classified automatically, "manual" = chosen by the user.
        filters.append(Transaction.category_source == category_source)
    return filters


# « ≠ règle »: a category chosen by hand that the rules would have set
# differently. Only hand-labelled rows can be in that case.
_BY_HAND = (Transaction.category_source == MANUAL, Transaction.category_id != None)  # noqa: E711
_RULE_COLS = (
    Transaction.id, Transaction.description, Transaction.amount_cents, Transaction.date, Transaction.is_debit,
    Transaction.currency, Transaction.account_id, Transaction.category_id, Transaction.category_source,
)


async def _keep_contradicted(db: AsyncSession, pid: int, rows: list) -> list:
    """Of `rows`, in order, those whose rules all agree on a category other than
    the one the user chose. Evaluated against the current rules, like « conflit »."""
    evals = await evaluate_rules_batch([rule_input(r) for r in rows], db, pid)
    return [r for r, ev in zip(rows, evals) if disagreeing_category(r.category_id, r.category_source, ev) is not None]


async def _contradicting_rules(db: AsyncSession, pid: int, filters: list) -> list:
    """The rows passing `filters` that the rules contradict (light rows: ids and
    what a rule reads). The rule engine decides, so this cannot be a SQL filter;
    it only ever scans hand-labelled rows."""
    rows = (await db.execute(select(*_RULE_COLS).where(and_(*filters), *_BY_HAND))).all()
    return await _keep_contradicted(db, pid, rows)


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
    category_source: Optional[Literal["rule", "manual"]] = None,
    contradicts_rule: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Total number of transactions matching the given filters (for the header count)."""
    filters = await _build_txn_filters(
        db, pid, account_id=account_id, category_id=category_id, uncategorized=uncategorized,
        categorized=categorized, date_from=date_from, date_to=date_to, search=search,
        is_debit=is_debit, is_internal_transfer=is_internal_transfer, bank_name=bank_name,
        month=month, import_batch_id=import_batch_id, category_source=category_source,
    )
    if contradicts_rule:
        return {"total": len(await _contradicting_rules(db, pid, filters))}
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
            # Still to classify: no category, and not an internal transfer (which
            # has none on purpose) — the same definition as the "Sans catégorie"
            # filter and the "classer par libellé" panel.
            func.sum(case((and_(Transaction.category_id == None,  # noqa: E711
                                Transaction.is_internal_transfer == False), 1), else_=0)),  # noqa: E712
        ).where(and_(*filters))
    )).one()
    return {
        "total": row[0] or 0,
        "categorized": row[1] or 0,
        "uncategorized": row[3] or 0,
        "transfers": row[2] or 0,
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
    category_source: Optional[Literal["rule", "manual"]] = None,
    contradicts_rule: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """All transaction ids matching the given filters — for "select all matching"
    across pages. Same filter surface as the list endpoint."""
    filters = await _build_txn_filters(
        db, pid, account_id=account_id, category_id=category_id, uncategorized=uncategorized,
        categorized=categorized, date_from=date_from, date_to=date_to, search=search,
        is_debit=is_debit, is_internal_transfer=is_internal_transfer, bank_name=bank_name,
        month=month, import_batch_id=import_batch_id, category_source=category_source,
    )
    if contradicts_rule:
        return {"ids": [r.id for r in await _contradicting_rules(db, pid, filters)]}
    rows = (await db.execute(select(Transaction.id).where(and_(*filters)))).all()
    return {"ids": [r[0] for r in rows]}


def _txn_order(sort_by: str, sort_dir: str) -> list:
    """ORDER BY of the transactions list. Whatever the column, ties fall back to
    the default "most recent first" so paging stays stable.

    `amount` sorts on the stored (unsigned) amount — the biggest movements first,
    expense or income — and on raw cents: accounts in different currencies are
    not converted for a sort. `category` sorts by name with uncategorised rows
    last in both directions (it needs the Category outer join). `account` sorts
    by account name (it needs the Account join)."""
    def directed(col):
        return col.desc() if sort_dir == "desc" else col.asc()

    newest_first = [Transaction.date.desc(), Transaction.id.desc()]
    if sort_by == "amount":
        return [directed(Transaction.amount_cents), *newest_first]
    if sort_by == "description":
        return [directed(func.lower(Transaction.description)), *newest_first]
    if sort_by == "category":
        return [Category.name.is_(None), directed(func.lower(Category.name)), *newest_first]
    if sort_by == "account":
        return [directed(func.lower(Account.name)), *newest_first]
    return [directed(Transaction.date), directed(Transaction.id)]


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
    category_source: Optional[Literal["rule", "manual"]] = None,
    contradicts_rule: Optional[bool] = None,
    sort_by: Literal["date", "amount", "description", "category", "account"] = "date",
    sort_dir: Literal["asc", "desc"] = "desc",
    limit: int = Query(default=500, le=10000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    filters = await _build_txn_filters(
        db, pid, account_id=account_id, category_id=category_id, uncategorized=uncategorized,
        categorized=categorized, date_from=date_from, date_to=date_to, search=search,
        is_debit=is_debit, is_internal_transfer=is_internal_transfer, bank_name=bank_name,
        month=month, import_batch_id=import_batch_id, category_source=category_source,
    )

    stmt = select(Transaction).options(selectinload(Transaction.account)).where(and_(*filters))
    if sort_by == "category":
        stmt = stmt.outerjoin(Category, Category.id == Transaction.category_id)
    elif sort_by == "account":
        stmt = stmt.join(Account, Account.id == Transaction.account_id)
    stmt = stmt.order_by(*_txn_order(sort_by, sort_dir))
    if contradicts_rule:
        # Decided by the rule engine, not by SQL: read the hand-labelled rows in
        # order, keep the ones the rules contradict, then take the page.
        candidates = (await db.execute(stmt.where(*_BY_HAND))).scalars().all()
        rows = (await _keep_contradicted(db, pid, candidates))[offset:offset + limit]
    else:
        rows = (await db.execute(stmt.limit(limit).offset(offset))).scalars().all()
    outs = []
    for r in rows:
        out = TransactionOut.from_orm_with_display(r)
        if r.account:
            out.account_name = r.account.name
        outs.append(out)

    # Flag rows where several distinct categories match via rules (against the
    # current ruleset, so newly-added conflicting rules show immediately) and
    # surface WHICH categories conflict.
    evals = await evaluate_rules_batch([rule_input(r) for r in rows], db, pid)
    conflict_ids = {cid for ev in evals if ev.conflict for cid in ev.category_ids}
    names: dict[int, str] = {}
    if conflict_ids:
        cat_rows = await db.execute(select(Category.id, Category.name).where(Category.id.in_(conflict_ids)))
        names = {cid: name for cid, name in cat_rows}
    for out, r, ev in zip(outs, rows, evals):
        if ev.conflict:
            out.category_conflict = True
            out.conflict_categories = sorted(names.get(cid, str(cid)) for cid in ev.category_ids)
            out.conflict_rule_ids = ev.rule_ids
        # A hand label the rules would classify otherwise: flagged, never changed.
        other = disagreeing_category(r.category_id, r.category_source, ev)
        if other is not None:
            out.rule_category_id = other
            out.disagreeing_rule_ids = ev.rule_ids
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


# What grouping by label needs from a transaction.
_LABEL_COLS = (
    Transaction.id, Transaction.description, Transaction.amount_cents, Transaction.date,
    Transaction.category_id, Transaction.account_id, Transaction.is_debit, Transaction.currency,
)


def _to_classify_filters(pid: int) -> list:
    """Transactions still waiting for a category. Internal transfers have none on
    purpose (they must not weigh on budgets), so they are not "to classify"."""
    return [
        Transaction.profile_id == pid,
        Transaction.category_id == None,  # noqa: E711
        Transaction.is_internal_transfer == False,  # noqa: E712
    ]


@router.get("/uncategorized-groups", response_model=List[UncategorizedGroup])
async def uncategorized_groups(
    account_id: Optional[int] = None,
    limit: int = Query(default=100, le=500),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Uncategorised transactions grouped by label, most frequent first — so the
    user classifies a label once instead of each of its rows."""
    filters = _to_classify_filters(pid)
    if account_id is not None:
        filters.append(Transaction.account_id == account_id)
    rows = (await db.execute(select(*_LABEL_COLS).where(and_(*filters)))).all()
    return [
        UncategorizedGroup(
            description=g.keyword, rule_pattern=g.pattern, occurrences=g.count,
            total_cents=g.total_cents, currency=g.currency, is_debit=g.is_debit,
            last_date=g.last_date, transaction_ids=[m.id for m in g.members],
            account_ids=sorted({m.account_id for m in g.members}),
        )
        for g in group_by_label(rows)[:limit]
    ]


@router.get("/{transaction_id}/similar-uncategorized", response_model=SimilarUncategorized)
async def similar_uncategorized(
    transaction_id: int,
    category_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """The OTHER uncategorised transactions carrying the same label (and
    direction) as this one — what the user is offered to classify along with it.

    `category_id` is the category about to be applied: when it belongs to one
    account, only that account's transactions can take it."""
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == transaction_id, Transaction.profile_id == pid)
    )).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction introuvable")

    filters = _to_classify_filters(pid)
    filters += [Transaction.id != txn.id, Transaction.is_debit == txn.is_debit]
    if category_id is not None:
        await require_category(db, pid, category_id)
        scope = (await db.execute(
            select(Category.account_id).where(Category.id == category_id, Category.profile_id == pid)
        )).scalar_one_or_none()
        if scope is not None:
            filters.append(Transaction.account_id == scope)

    key = label_key(txn.description)
    rows = (await db.execute(select(*_LABEL_COLS).where(and_(*filters)))).all()
    similar = [r for r in rows if label_key(r.description) == key] if key else []
    return SimilarUncategorized(
        description=key.upper(),
        rule_pattern=rule_pattern(key, [txn.description, *(r.description for r in similar)]).upper(),
        count=len(similar),
        transaction_ids=[r.id for r in similar],
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
    await require_account(db, pid, payload.account_id)
    await require_category(db, pid, payload.category_id)
    await _reject_grouping_category(db, payload.category_id)
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
    txn = Transaction(**txn_data, import_hash=import_hash, is_manually_reviewed=True, profile_id=pid,
                      category_source=manual_source(payload.category_id))
    
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
    await require_category(db, pid, payload.category_id)
    await _reject_grouping_category(db, payload.category_id)
    from sqlalchemy import update
    updated = 0
    for chunk in _chunks(payload.ids):
        stmt = update(Transaction).where(Transaction.id.in_(chunk), Transaction.profile_id == pid)
        if payload.only_uncategorized:
            stmt = stmt.where(Transaction.category_id == None)  # noqa: E711
        updated += (await db.execute(stmt.values(
            category_id=payload.category_id, category_source=manual_source(payload.category_id),
        ))).rowcount
    await db.commit()
    return {"updated": updated}


@router.get("/export")
async def export_transactions(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    category_source: Optional[Literal["rule", "manual"]] = None,
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
    if category_source is not None:
        filters.append(Transaction.category_source == category_source)
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
    if "account_id" in updates:
        await require_account(db, pid, updates["account_id"])
    if "category_id" in updates:
        await require_category(db, pid, updates["category_id"])
        await _reject_grouping_category(db, updates["category_id"])
    if updates.get("is_unplanned") is True:
        # « Imprévu » moves an EXPENSE out of its envelope in the budget plan.
        is_expense = updates.get("is_debit", txn.is_debit) and not updates.get("is_internal_transfer", txn.is_internal_transfer)
        if not is_expense:
            raise HTTPException(status_code=400, detail="Seule une dépense peut être marquée comme imprévue.")
    for field, value in updates.items():
        if field in CORE_FIELDS and getattr(txn, field) != value:
            txn.is_manually_edited = True
        setattr(txn, field, value)
    if "category_id" in updates:
        txn.category_source = manual_source(updates["category_id"])
    await db.commit()
    await db.refresh(txn)
    return TransactionOut.from_orm_with_display(txn)


@router.post("/{transaction_id}/apply-rules", response_model=TransactionOut)
async def apply_rules(transaction_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Give this transaction the category its rules agree on, and record that a
    rule chose it. This is the user's own click on « ≠ règle » → « Suivre la
    règle »: the one place where a category set by hand gives way to a rule."""
    txn = (await db.execute(
        select(Transaction).options(selectinload(Transaction.account))
        .where(Transaction.id == transaction_id, Transaction.profile_id == pid)
    )).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction introuvable")
    ev = (await evaluate_rules_batch([rule_input(txn)], db, pid))[0]
    if ev.conflict:
        raise HTTPException(status_code=409, detail="Des règles se contredisent pour cette transaction : modifiez-en une d'abord.")
    if ev.category_id is None:
        raise HTTPException(status_code=409, detail="Aucune règle ne correspond à cette transaction.")
    txn.category_id = ev.category_id
    txn.category_source = RULE
    await db.commit()
    await db.refresh(txn)
    out = TransactionOut.from_orm_with_display(txn)
    if txn.account:
        out.account_name = txn.account.name
    return out


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(transaction_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id, Transaction.profile_id == pid))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await db.delete(txn)
    await db.commit()


