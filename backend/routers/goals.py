import math
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import current_profile_id
from models import Goal, GoalContribution, Account
from schemas import (
    GoalCreate, GoalUpdate, GoalOut,
    GoalContributionCreate, GoalContributionOut,
)
from services.balances import account_computed_balance_cents

router = APIRouter()


async def _current_cents(db: AsyncSession, goal: Goal) -> int:
    """A goal's current amount: the linked account's balance, or the signed sum
    of its contributions for a manually-tracked goal."""
    if goal.linked_account_id:
        return await account_computed_balance_cents(db, goal.linked_account_id)
    return (await db.execute(
        select(func.coalesce(func.sum(GoalContribution.amount_cents), 0))
        .where(GoalContribution.goal_id == goal.id)
    )).scalar() or 0


def _months_until(deadline: date) -> int:
    today = date.today()
    return (deadline.year - today.year) * 12 + (deadline.month - today.month)


def _to_out(goal: Goal, current: int, linked_name: str | None) -> GoalOut:
    target = goal.target_amount_cents or 0
    progress = round(current / target * 100, 1) if target > 0 else 0.0
    monthly_needed = None
    if goal.deadline and current < target and goal.deadline > date.today():
        months = max(1, _months_until(goal.deadline))
        monthly_needed = math.ceil((target - current) / months)
    return GoalOut(
        id=goal.id,
        name=goal.name,
        target_amount_cents=target,
        deadline=goal.deadline,
        color=goal.color,
        icon=goal.icon,
        linked_account_id=goal.linked_account_id,
        current_amount_cents=current,
        progress_pct=progress,
        is_linked=goal.linked_account_id is not None,
        linked_account_name=linked_name,
        monthly_needed_cents=monthly_needed,
    )


@router.get("", response_model=List[GoalOut])
async def list_goals(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    goals = (await db.execute(select(Goal).where(Goal.profile_id == pid))).scalars().all()

    linked_ids = {g.linked_account_id for g in goals if g.linked_account_id}
    names: dict[int, str] = {}
    if linked_ids:
        rows = (await db.execute(select(Account.id, Account.name).where(Account.id.in_(linked_ids)))).all()
        names = {r[0]: r[1] for r in rows}

    out = []
    for g in goals:
        current = await _current_cents(db, g)
        out.append(_to_out(g, current, names.get(g.linked_account_id) if g.linked_account_id else None))
    return out


@router.post("", response_model=GoalOut, status_code=201)
async def create_goal(payload: GoalCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    if payload.linked_account_id is not None:
        acc = await db.execute(select(Account).where(Account.id == payload.linked_account_id, Account.profile_id == pid))
        if not acc.scalar_one_or_none():
            raise HTTPException(404, "Compte lié introuvable")

    goal = Goal(
        profile_id=pid,
        name=payload.name,
        target_amount_cents=payload.target_amount_cents,
        deadline=payload.deadline,
        color=payload.color,
        icon=payload.icon,
        linked_account_id=payload.linked_account_id,
    )
    db.add(goal)
    await db.flush()

    # A manual goal can be seeded with what's already saved (recorded as a contribution).
    if payload.linked_account_id is None and payload.initial_amount_cents:
        db.add(GoalContribution(
            goal_id=goal.id, profile_id=pid, date=date.today(),
            amount_cents=payload.initial_amount_cents, note="Montant initial",
        ))
    await db.commit()
    await db.refresh(goal)

    current = await _current_cents(db, goal)
    linked_name = None
    if goal.linked_account_id:
        linked_name = (await db.execute(select(Account.name).where(Account.id == goal.linked_account_id))).scalar()
    return _to_out(goal, current, linked_name)


@router.put("/{goal_id}", response_model=GoalOut)
async def update_goal(goal_id: int, payload: GoalUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    goal = (await db.execute(select(Goal).where(Goal.id == goal_id, Goal.profile_id == pid))).scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    # exclude_unset (not exclude_none) so the client CAN clear deadline / linked account by sending null.
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    await db.commit()
    await db.refresh(goal)

    current = await _current_cents(db, goal)
    linked_name = None
    if goal.linked_account_id:
        linked_name = (await db.execute(select(Account.name).where(Account.id == goal.linked_account_id))).scalar()
    return _to_out(goal, current, linked_name)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    goal = (await db.execute(select(Goal).where(Goal.id == goal_id, Goal.profile_id == pid))).scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    await db.execute(GoalContribution.__table__.delete().where(GoalContribution.goal_id == goal_id))
    await db.delete(goal)
    await db.commit()


# ── Contributions ─────────────────────────────────────────────────────────────

@router.get("/{goal_id}/contributions", response_model=List[GoalContributionOut])
async def list_contributions(goal_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    goal = (await db.execute(select(Goal).where(Goal.id == goal_id, Goal.profile_id == pid))).scalar_one_or_none()
    if not goal:
        raise HTTPException(404, "Goal not found")
    rows = (await db.execute(
        select(GoalContribution)
        .where(GoalContribution.goal_id == goal_id)
        .order_by(GoalContribution.date.desc(), GoalContribution.id.desc())
    )).scalars().all()
    return rows


@router.post("/{goal_id}/contributions", response_model=GoalContributionOut, status_code=201)
async def add_contribution(
    goal_id: int, payload: GoalContributionCreate,
    db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id),
):
    goal = (await db.execute(select(Goal).where(Goal.id == goal_id, Goal.profile_id == pid))).scalar_one_or_none()
    if not goal:
        raise HTTPException(404, "Goal not found")
    if goal.linked_account_id is not None:
        raise HTTPException(400, "Cet objectif est lié à un compte ; sa progression suit le solde du compte.")
    contrib = GoalContribution(goal_id=goal_id, profile_id=pid, **payload.model_dump())
    db.add(contrib)
    await db.commit()
    await db.refresh(contrib)
    return contrib


@router.delete("/{goal_id}/contributions/{contribution_id}", status_code=204)
async def delete_contribution(
    goal_id: int, contribution_id: int,
    db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id),
):
    contrib = (await db.execute(
        select(GoalContribution).where(
            GoalContribution.id == contribution_id,
            GoalContribution.goal_id == goal_id,
            GoalContribution.profile_id == pid,
        )
    )).scalar_one_or_none()
    if not contrib:
        raise HTTPException(404, "Contribution not found")
    await db.delete(contrib)
    await db.commit()
