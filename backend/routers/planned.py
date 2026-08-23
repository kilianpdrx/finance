from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import current_profile_id
from models import PlannedExpense, Category
from schemas import (
    PlannedExpenseCreate, PlannedExpenseRecurring, PlannedExpenseUpdate, PlannedExpenseOut,
)

router = APIRouter()


def _month_add(ym: str, n: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    total = y * 12 + (m - 1) + n
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _enumerate_months(start: str, every_n: int, end_mode: str, count: Optional[int], end_month: Optional[str]) -> list[str]:
    every_n = max(1, every_n)
    months: list[str] = []
    if end_mode == "count":
        n = max(1, min(count or 1, 120))
        months = [_month_add(start, i * every_n) for i in range(n)]
    elif end_mode == "until" and end_month:
        cur = start
        for _ in range(600):
            if cur > end_month:
                break
            months.append(cur)
            cur = _month_add(cur, every_n)
    else:  # "year" — through December of the start month's year
        end = f"{start[:4]}-12"
        cur = start
        for _ in range(24):
            if cur > end:
                break
            months.append(cur)
            cur = _month_add(cur, every_n)
    return months


async def _upsert(db: AsyncSession, pid: int, category_id: int, account_id: Optional[int], month: str, amount_cents: int) -> PlannedExpense:
    q = select(PlannedExpense).where(
        PlannedExpense.profile_id == pid,
        PlannedExpense.category_id == category_id,
        PlannedExpense.month == month,
    )
    q = q.where(PlannedExpense.account_id.is_(None) if account_id is None else PlannedExpense.account_id == account_id)
    existing = (await db.execute(q)).scalar_one_or_none()
    if existing:
        existing.amount_cents = amount_cents
        existing.matched = False
        return existing
    row = PlannedExpense(profile_id=pid, category_id=category_id, account_id=account_id, month=month, amount_cents=amount_cents)
    db.add(row)
    return row


async def _require_category(db: AsyncSession, category_id: int, pid: int) -> None:
    cat = (await db.execute(select(Category).where(Category.id == category_id, Category.profile_id == pid))).scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Catégorie introuvable")


@router.get("", response_model=List[PlannedExpenseOut])
async def list_planned(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    rows = (await db.execute(select(PlannedExpense).where(PlannedExpense.profile_id == pid))).scalars().all()
    return rows


@router.post("", response_model=PlannedExpenseOut, status_code=201)
async def create_planned(payload: PlannedExpenseCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    await _require_category(db, payload.category_id, pid)
    row = await _upsert(db, pid, payload.category_id, payload.account_id, payload.month, payload.amount_cents)
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/recurring", status_code=201)
async def create_recurring(payload: PlannedExpenseRecurring, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    await _require_category(db, payload.category_id, pid)
    months = _enumerate_months(payload.start_month, payload.every_n_months, payload.end_mode, payload.count, payload.end_month)
    if not months:
        raise HTTPException(400, "Aucun mois cible pour cette récurrence.")
    for m in months:
        await _upsert(db, pid, payload.category_id, payload.account_id, m, payload.amount_cents)
    await db.commit()
    return {"created": len(months), "months": months}


@router.patch("/{planned_id}", response_model=PlannedExpenseOut)
async def update_planned(planned_id: int, payload: PlannedExpenseUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    row = (await db.execute(
        select(PlannedExpense).where(PlannedExpense.id == planned_id, PlannedExpense.profile_id == pid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Dépense planifiée introuvable")
    if payload.amount_cents is not None:
        row.amount_cents = payload.amount_cents
    if payload.matched is not None:
        row.matched = payload.matched
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{planned_id}", status_code=204)
async def delete_planned(planned_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    row = (await db.execute(
        select(PlannedExpense).where(PlannedExpense.id == planned_id, PlannedExpense.profile_id == pid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Dépense planifiée introuvable")
    await db.delete(row)
    await db.commit()
