"""Shared balance computation: latest snapshot + transactions since, else the
sum of all transactions. Used by the accounts endpoint, goals (linked account),
and analytics."""
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models import AccountBalanceSnapshot, Transaction

_SIGNED = Transaction.amount_cents * func.iif(Transaction.is_debit == False, 1, -1)  # noqa: E712


async def account_computed_balance_cents(db: AsyncSession, account_id: int) -> int:
    """Current balance of an account in its own currency (integer cents)."""
    snap = (await db.execute(
        select(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .order_by(AccountBalanceSnapshot.date.desc())
        .limit(1)
    )).scalar_one_or_none()

    filters = [Transaction.account_id == account_id, Transaction.is_internal_transfer == False]  # noqa: E712
    if snap:
        filters.append(Transaction.date > snap.date)
        delta = (await db.execute(select(func.sum(_SIGNED)).where(and_(*filters)))).scalar() or 0
        return snap.amount_cents + delta
    return (await db.execute(select(func.sum(_SIGNED)).where(and_(*filters)))).scalar() or 0
