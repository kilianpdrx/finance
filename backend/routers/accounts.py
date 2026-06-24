from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Account, AccountBalanceSnapshot, Transaction
from schemas import (
    AccountCreate, AccountUpdate, AccountOut,
    AccountBalanceSnapshotCreate, AccountBalanceSnapshotOut,
)

router = APIRouter()


@router.get("", response_model=List[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Account).where(Account.is_active == True, Account.profile_id == pid))
    return result.scalars().all()


@router.get("/{account_id}", response_model=AccountOut)
async def get_account(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Account).where(Account.id == account_id, Account.profile_id == pid))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(payload: AccountCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    account = Account(**payload.model_dump(), profile_id=pid)
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(account_id: int, payload: AccountUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Account).where(Account.id == account_id, Account.profile_id == pid))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Account).where(Account.id == account_id, Account.profile_id == pid))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.is_active = False
    await db.commit()


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
