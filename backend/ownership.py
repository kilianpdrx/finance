"""Ownership guards for foreign keys accepted on writes.

Reads are scoped by `profile_id` everywhere, but a write that *accepts* an id
(a transaction's account, a rule's category, a goal's linked account…) must also
check that the referenced row belongs to the active profile. Without this a
stale `X-Profile-Id`, a UI bug or a hand-made request can attach a row to
another profile's data — after which reads filter it out and it looks like the
data vanished.

Every helper is a no-op on `None`, so callers can pass optional fields directly.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Account, Category


async def require_account(db: AsyncSession, pid: int, account_id: Optional[int]) -> None:
    """404 unless `account_id` belongs to the active profile (None is allowed)."""
    if account_id is None:
        return
    owned = (await db.execute(
        select(Account.id).where(Account.id == account_id, Account.profile_id == pid)
    )).scalar_one_or_none()
    if owned is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")


async def require_category(db: AsyncSession, pid: int, category_id: Optional[int]) -> None:
    """404 unless `category_id` belongs to the active profile (None is allowed)."""
    if category_id is None:
        return
    owned = (await db.execute(
        select(Category.id).where(Category.id == category_id, Category.profile_id == pid)
    )).scalar_one_or_none()
    if owned is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
