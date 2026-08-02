from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Category, CategoryRule, Transaction
from schemas import (
    CategoryCreate, CategoryUpdate, CategoryOut,
    CategoryRuleCreate, CategoryRuleUpdate, CategoryRuleOut,
    RuleCondition, TransactionOut,
)
from services.categorizer import categorize, evaluate_conditions

router = APIRouter()


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Category).where(Category.profile_id == pid).order_by(Category.name))
    return result.scalars().all()


@router.get("/{category_id}", response_model=CategoryOut)
async def get_category(category_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Category).where(Category.id == category_id, Category.profile_id == pid))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    cat = Category(**payload.model_dump(), profile_id=pid)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.put("/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, payload: CategoryUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Category).where(Category.id == category_id, Category.profile_id == pid))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: int, replace_with_id: Optional[int] = None, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Category).where(Category.id == category_id, Category.profile_id == pid))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    # Find fallback category "Divers"
    fallback_id = replace_with_id
    if not fallback_id:
        divers = await db.execute(select(Category).where(Category.name == "Divers", Category.profile_id == pid))
        divers_cat = divers.scalar_one_or_none()
        fallback_id = divers_cat.id if divers_cat else None

    # Reassign transactions
    if fallback_id:
        await db.execute(
            update(Transaction)
            .where(Transaction.category_id == category_id)
            .values(category_id=fallback_id)
        )
    else:
        await db.execute(
            update(Transaction)
            .where(Transaction.category_id == category_id)
            .values(category_id=None)
        )

    # Delete associated rules first
    rules = await db.execute(select(CategoryRule).where(CategoryRule.category_id == category_id))
    for rule in rules.scalars().all():
        await db.delete(rule)

    await db.delete(cat)
    await db.commit()


@router.post("/rescan", status_code=200)
async def rescan_categories(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Re-apply all category rules to all non-manually-reviewed transactions."""
    result = await db.execute(
        select(Transaction).where(Transaction.is_manually_reviewed == False, Transaction.profile_id == pid)
    )
    transactions = result.scalars().all()

    updated = 0
    for txn in transactions:
        txn_dict = {
            "description": txn.description,
            "amount_cents": txn.amount_cents,
            "date": txn.date,
            "is_debit": txn.is_debit,
            "currency": txn.currency,
            "account_id": txn.account_id
        }
        new_cat_id, _ = await categorize(txn_dict, db, pid)
        if new_cat_id != txn.category_id:
            txn.category_id = new_cat_id
            updated += 1

    await db.commit()
    return {"updated": updated, "total": len(transactions)}


# ── Rule Preview ─────────────────────────────────────────────────────────────

class RulePreviewRequest(BaseModel):
    conditions: List[RuleCondition]
    account_id: Optional[int] = None
    logic_operator: str = "AND"


@router.post("/rules/preview", response_model=List[TransactionOut])
async def preview_rule(
    payload: RulePreviewRequest,
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Return transactions matching the given conditions (for rule preview)."""
    from sqlalchemy.orm import selectinload

    conditions_dicts = [c.model_dump() for c in payload.conditions]
    if not conditions_dicts:
        return []

    # Load recent transactions (limit to last 2000 for performance)
    filters = [Transaction.profile_id == pid]
    if payload.account_id is not None:
        filters.append(Transaction.account_id == payload.account_id)
    stmt = (
        select(Transaction)
        .options(selectinload(Transaction.account))
        .where(and_(*filters))
        .order_by(Transaction.date.desc())
        .limit(2000)
    )
    result = await db.execute(stmt)
    txns = result.scalars().all()

    matched = []
    matched_txns = []
    for txn in txns:
        txn_data = {
            "description": txn.description,
            "amount_cents": txn.amount_cents,
            "date": str(txn.date),
            "is_debit": txn.is_debit,
            "currency": txn.currency,
            "account_id": txn.account_id,
        }
        if evaluate_conditions(txn_data, conditions_dicts, payload.logic_operator):
            out = TransactionOut.from_orm_with_display(txn)
            if txn.account:
                out.account_name = txn.account.name
            matched.append(out)
            matched_txns.append(txn)
            if len(matched) >= limit:
                break

    # Flag matched rows where several distinct categories apply via the full ruleset.
    from services.categorizer import conflict_flags_batch
    flags = await conflict_flags_batch(
        [{"description": t.description, "amount_cents": t.amount_cents, "date": str(t.date),
          "is_debit": t.is_debit, "currency": t.currency, "account_id": t.account_id} for t in matched_txns],
        db, pid,
    )
    for out, flag in zip(matched, flags):
        out.category_conflict = flag

    return matched


# ── Rules ─────────────────────────────────────────────────────────────────────

@router.get("/rules/all", response_model=List[CategoryRuleOut])
async def list_all_rules(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(CategoryRule).where(CategoryRule.profile_id == pid).order_by(CategoryRule.priority, CategoryRule.id))
    return result.scalars().all()


@router.get("/{category_id}/rules", response_model=List[CategoryRuleOut])
async def list_rules(category_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(
        select(CategoryRule)
        .where(CategoryRule.category_id == category_id, CategoryRule.profile_id == pid)
        .order_by(CategoryRule.priority)
    )
    return result.scalars().all()


@router.post("/{category_id}/rules", response_model=CategoryRuleOut, status_code=201)
async def create_rule(category_id: int, payload: CategoryRuleCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    rule = CategoryRule(**payload.model_dump(), profile_id=pid)
    rule.category_id = category_id
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/rules/{rule_id}", response_model=CategoryRuleOut)
async def update_rule(rule_id: int, payload: CategoryRuleUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(CategoryRule).where(CategoryRule.id == rule_id, CategoryRule.profile_id == pid))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return rule


class MergeRulesRequest(BaseModel):
    rule_ids: List[int]
    logic_operator: str = "OR"


@router.post("/rules/merge", response_model=CategoryRuleOut)
async def merge_rules(payload: MergeRulesRequest, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Merge multiple rules into one. All conditions are combined. Uses the first rule's category/priority/account."""
    if len(payload.rule_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 rules required to merge")

    result = await db.execute(
        select(CategoryRule).where(CategoryRule.id.in_(payload.rule_ids), CategoryRule.profile_id == pid)
    )
    rules = result.scalars().all()
    if len(rules) != len(payload.rule_ids):
        raise HTTPException(status_code=404, detail="One or more rules not found")

    # Use the first rule as base
    first = sorted(rules, key=lambda r: (r.priority, r.id))[0]

    # Combine all conditions
    all_conditions = []
    for rule in rules:
        if rule.conditions:
            all_conditions.extend(rule.conditions)

    # Deduplicate conditions
    seen = set()
    unique_conditions = []
    for cond in all_conditions:
        key = (cond.get("field", ""), cond.get("operator", ""), cond.get("value", ""))
        if key not in seen:
            seen.add(key)
            unique_conditions.append(cond)

    # Create new merged rule
    merged = CategoryRule(
        conditions=unique_conditions,
        category_id=first.category_id,
        priority=first.priority,
        is_active=True,
        account_id=first.account_id,
        logic_operator=payload.logic_operator,
        profile_id=pid,
    )
    db.add(merged)

    # Delete old rules
    for rule in rules:
        await db.delete(rule)

    await db.commit()
    await db.refresh(merged)
    return merged


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(CategoryRule).where(CategoryRule.id == rule_id, CategoryRule.profile_id == pid))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()
