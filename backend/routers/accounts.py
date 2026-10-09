from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, and_, delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import (
    Account, AccountBalanceSnapshot, Transaction, LoanDetails, LoanExtraPayment, Holding, ImportBatch,
    CategoryRule, Category, BudgetEntry, PlannedExpense, Goal, Setting,
)
from schemas import (
    AccountCreate, AccountUpdate, AccountOut,
    AccountBalanceSnapshotCreate, AccountBalanceSnapshotOut,
)
from services.base_currency import adopt_base_currency
from sqlalchemy.orm import selectinload

router = APIRouter()


@router.get("", response_model=List[AccountOut])
async def list_accounts(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Active accounts by default. `include_inactive=true` also returns closed
    ones, so their historical transactions stay attributable and filterable
    (a closed account keeps its history; only its balance leaves net worth)."""
    filters = [Account.profile_id == pid]
    if not include_inactive:
        filters.append(Account.is_active == True)  # noqa: E712
    result = await db.execute(
        select(Account)
        .options(selectinload(Account.loan_details))
        .where(*filters)
    )
    return result.scalars().all()


@router.get("/{account_id}", response_model=AccountOut)
async def get_account(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(
        select(Account)
        .options(selectinload(Account.loan_details))
        .where(Account.id == account_id, Account.profile_id == pid)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(payload: AccountCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    account_data = payload.model_dump(exclude={"loan_details"})
    account = Account(**account_data, profile_id=pid)
    db.add(account)
    await db.flush()
    if payload.loan_details:
        loan = LoanDetails(**payload.loan_details.model_dump(exclude_none=True), account_id=account.id)
        db.add(loan)
    # The first account decides the currency the profile reports in (it stays
    # editable in Paramètres). No-op once a base currency is stored.
    await adopt_base_currency(db, pid, account.currency)
    await db.commit()
    result = await db.execute(
        select(Account)
        .options(selectinload(Account.loan_details))
        .where(Account.id == account.id)
    )
    return result.scalar_one()


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(account_id: int, payload: AccountUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(
        select(Account)
        .options(selectinload(Account.loan_details))
        .where(Account.id == account_id, Account.profile_id == pid)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    update_data = payload.model_dump(exclude_none=True, exclude={"loan_details"})
    for field, value in update_data.items():
        setattr(account, field, value)
    
    if payload.loan_details is not None:
        if account.loan_details:
            for f, v in payload.loan_details.model_dump(exclude_none=True).items():
                setattr(account.loan_details, f, v)
        else:
            loan = LoanDetails(**payload.loan_details.model_dump(exclude_none=True), account_id=account.id)
            db.add(loan)

    await db.commit()
    result = await db.execute(
        select(Account)
        .options(selectinload(Account.loan_details))
        .where(Account.id == account.id)
    )
    return result.scalar_one()


async def _owned_account(db: AsyncSession, pid: int, account_id: int) -> Account:
    account = (await db.execute(
        select(Account).where(Account.id == account_id, Account.profile_id == pid)
    )).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


async def _count(db: AsyncSession, model, account_id: int) -> int:
    return (await db.execute(select(func.count(model.id)).where(model.account_id == account_id))).scalar() or 0


@router.get("/{account_id}/deletion-summary")
async def account_deletion_summary(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """What permanently deleting this account would remove — shown in the
    confirmation, so the user knows what "definitively" covers."""
    account = await _owned_account(db, pid, account_id)
    return {
        "name": account.name,
        "is_active": bool(account.is_active),
        "transactions": await _count(db, Transaction, account_id),
        "snapshots": await _count(db, AccountBalanceSnapshot, account_id),
        "holdings": await _count(db, Holding, account_id),
        "imports": await _count(db, ImportBatch, account_id),
        "rules": await _count(db, CategoryRule, account_id),
        "budget_entries": await _count(db, BudgetEntry, account_id) + await _count(db, PlannedExpense, account_id),
    }


@router.delete("/{account_id}", status_code=204)
async def delete_account(
    account_id: int,
    permanent: bool = False,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Close the account (default): it keeps its history and only its balance
    leaves net worth. With `permanent=true`, DELETE a closed account and
    everything in it — two steps on purpose, so history is never lost by a
    single click on an account still in use."""
    account = await _owned_account(db, pid, account_id)
    if not permanent:
        account.is_active = False
        await db.commit()
        return
    if account.is_active:
        raise HTTPException(status_code=400, detail="Clôturez d'abord ce compte : seul un compte clôturé peut être supprimé définitivement.")
    await _purge_account(db, pid, account)
    await db.commit()


async def _purge_account(db: AsyncSession, pid: int, account: Account) -> None:
    """Remove the account and everything that belongs to it, in an order the
    foreign keys accept. What merely POINTS at the account is detached instead:
    a goal linked to it, and the other half of an internal transfer."""
    aid = account.id
    own_txns = select(Transaction.id).where(Transaction.account_id == aid)

    # The other half of an internal transfer stays a transfer, without its pair.
    await db.execute(update(Transaction).where(Transaction.transfer_pair_id.in_(own_txns)).values(transfer_pair_id=None))
    await db.execute(update(Goal).where(Goal.linked_account_id == aid).values(linked_account_id=None))

    for model in (LoanExtraPayment, LoanDetails, Holding, AccountBalanceSnapshot, PlannedExpense, BudgetEntry):
        await db.execute(delete(model).where(model.account_id == aid))
    await db.execute(delete(Transaction).where(Transaction.account_id == aid))   # before the imports they came from
    await db.execute(delete(ImportBatch).where(ImportBatch.account_id == aid))
    await db.execute(delete(CategoryRule).where(CategoryRule.account_id == aid))

    # Categories that existed only for this account: gone if nothing uses them
    # any more, otherwise kept and made global (they still describe transactions
    # or rules elsewhere).
    bound = (await db.execute(
        select(Category).where(Category.account_id == aid, Category.profile_id == pid)
    )).scalars().all()
    for cat in bound:
        cat.account_id = None
    await db.flush()
    # Children first, so a parent left without any can go too.
    for cat in sorted(bound, key=lambda c: c.parent_id is None):
        used = False
        for model, column in ((Transaction, Transaction.category_id), (CategoryRule, CategoryRule.category_id),
                              (BudgetEntry, BudgetEntry.category_id), (PlannedExpense, PlannedExpense.category_id),
                              (Category, Category.parent_id)):
            if (await db.execute(select(func.count(model.id)).where(column == cat.id))).scalar():
                used = True
                break
        if not used:
            await db.delete(cat)
            await db.flush()

    # The IBKR sync must not keep targeting an account that no longer exists.
    await db.execute(delete(Setting).where(
        Setting.profile_id == pid, Setting.key == "ibkr_account_id", Setting.value == str(aid)))
    await db.delete(account)


# ── Balance Snapshots ─────────────────────────────────────────────────────────

@router.get("/{account_id}/snapshots", response_model=List[AccountBalanceSnapshotOut])
async def list_snapshots(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(
        select(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account_id, AccountBalanceSnapshot.profile_id == pid)
        .order_by(AccountBalanceSnapshot.date.desc())
    )
    return result.scalars().all()


@router.post("/{account_id}/snapshots", response_model=AccountBalanceSnapshotOut, status_code=201)
async def create_snapshot(
    account_id: int,
    payload: AccountBalanceSnapshotCreate,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    acc = await db.execute(select(Account).where(Account.id == account_id, Account.profile_id == pid))
    if not acc.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")
    snap = AccountBalanceSnapshot(account_id=account_id, profile_id=pid, **payload.model_dump())
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return snap


@router.delete("/{account_id}/snapshots/{snapshot_id}", status_code=204)
async def delete_snapshot(
    account_id: int,
    snapshot_id: int,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    result = await db.execute(
        select(AccountBalanceSnapshot).where(
            and_(
                AccountBalanceSnapshot.id == snapshot_id,
                AccountBalanceSnapshot.account_id == account_id,
                AccountBalanceSnapshot.profile_id == pid,
            )
        )
    )
    snap = result.scalar_one_or_none()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    await db.delete(snap)
    await db.commit()


@router.get("/{account_id}/computed-balance")
async def computed_balance(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Return the current balance using: latest snapshot + transactions after snapshot date."""
    owned = (await db.execute(
        select(Account.id).where(Account.id == account_id, Account.profile_id == pid)
    )).scalar_one_or_none()
    if not owned:
        raise HTTPException(status_code=404, detail="Account not found")
    snap_result = await db.execute(
        select(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account_id, AccountBalanceSnapshot.profile_id == pid)
        .order_by(AccountBalanceSnapshot.date.desc())
        .limit(1)
    )
    snap = snap_result.scalar_one_or_none()

    if snap:
        txn_result = await db.execute(
            select(
                func.sum(
                    Transaction.amount_cents * func.iif(Transaction.is_debit == False, 1, -1)
                )
            ).where(
                and_(
                    Transaction.account_id == account_id,
                    Transaction.profile_id == pid,
                    Transaction.date > snap.date,
                    Transaction.is_internal_transfer == False,
                )
            )
        )
        txn_sum = txn_result.scalar() or 0
        balance = snap.amount_cents + txn_sum
        return {
            "account_id": account_id,
            "balance_cents": balance,
            "snapshot_date": str(snap.date),
            "snapshot_amount_cents": snap.amount_cents,
            "transactions_since_snapshot_cents": txn_sum,
        }
    else:
        txn_result = await db.execute(
            select(
                func.sum(
                    Transaction.amount_cents * func.iif(Transaction.is_debit == False, 1, -1)
                )
            ).where(
                and_(
                    Transaction.account_id == account_id,
                    Transaction.profile_id == pid,
                    Transaction.is_internal_transfer == False,
                )
            )
        )
        balance = txn_result.scalar() or 0
        return {
            "account_id": account_id,
            "balance_cents": balance,
            "snapshot_date": None,
            "snapshot_amount_cents": None,
            "transactions_since_snapshot_cents": None,
        }
