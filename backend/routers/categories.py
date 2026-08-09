from datetime import datetime
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


@router.get("/archive-suggestions")
async def archive_suggestions(
    months: int = 12,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Categories worth retiring: no activity for `months` (default 12), not already
    archived nor dismissed, not referenced by an active rule or a current/future
    planned expense, and — for a namespace — only when its whole subtree is idle."""
    from datetime import date, timedelta
    from sqlalchemy import func
    from models import PlannedExpense

    cats = (await db.execute(select(Category).where(Category.profile_id == pid))).scalars().all()
    by_id = {c.id: c for c in cats}
    children_of: dict[int, list[int]] = {}
    for c in cats:
        if c.parent_id is not None:
            children_of.setdefault(c.parent_id, []).append(c.id)

    # Last transaction date per category.
    rows = (await db.execute(
        select(Transaction.category_id, func.max(Transaction.date))
        .where(Transaction.profile_id == pid)
        .group_by(Transaction.category_id)
    )).all()
    last_by_cat: dict[int, date] = {cid: d for cid, d in rows if cid is not None and d is not None}

    def subtree_last(cid: int):
        dates = [last_by_cat[cid]] if cid in last_by_cat else []
        for kid in children_of.get(cid, []):
            if kid in last_by_cat:
                dates.append(last_by_cat[kid])
        return max(dates) if dates else None

    # Exclusions: categories referenced by an active rule or a current/future plan.
    ruled = {r for (r,) in (await db.execute(
        select(CategoryRule.category_id).where(CategoryRule.profile_id == pid, CategoryRule.is_active == True)  # noqa: E712
    )).all()}
    this_month = date.today().strftime("%Y-%m")
    planned = {r for (r,) in (await db.execute(
        select(PlannedExpense.category_id).where(PlannedExpense.profile_id == pid, PlannedExpense.month >= this_month)
    )).all()}

    today = date.today()
    cutoff = today - timedelta(days=months * 30)
    out = []
    for c in cats:
        if c.archived or c.archive_dismissed or c.id in ruled or c.id in planned:
            continue
        last = subtree_last(c.id)
        if last is not None and last > cutoff:
            continue
        out.append({
            "category_id": c.id,
            "name": c.name,
            "last_activity": last.isoformat() if last else None,
            "months_inactive": (today - last).days // 30 if last else None,
        })
    return out


@router.get("/{category_id}", response_model=CategoryOut)
async def get_category(category_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Category).where(Category.id == category_id, Category.profile_id == pid))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat


async def _ensure_parent_group(db: AsyncSession, pid: int, parent: Category) -> Category:
    """A category with children becomes *grouping-only*: it can no longer hold
    transactions directly. Ensure an ``Autre {parent}`` leaf exists (inheriting the
    parent's type/colour) and move the parent's directly-assigned transactions into
    it. Idempotent — safe to call on every child add / at startup."""
    autre_name = f"Autre {parent.name}"
    autre = (await db.execute(
        select(Category).where(
            Category.parent_id == parent.id,
            Category.name == autre_name,
            Category.profile_id == pid,
        )
    )).scalar_one_or_none()
    if autre is None:
        autre = Category(
            name=autre_name,
            parent_id=parent.id,
            color=parent.color,
            icon=parent.icon,
            is_income=parent.is_income,
            expense_type=parent.expense_type,
            is_investment=parent.is_investment,
            account_id=parent.account_id,
            profile_id=pid,
        )
        db.add(autre)
        await db.flush()  # assign autre.id
    # Move any transactions still pinned to the parent into the "Autre" leaf.
    await db.execute(
        update(Transaction)
        .where(Transaction.category_id == parent.id, Transaction.profile_id == pid)
        .values(category_id=autre.id)
    )
    # Re-point rules that classified into the (now grouping-only) parent so they
    # keep working, classifying into the "Autre" leaf instead of a grouping node.
    await db.execute(
        update(CategoryRule)
        .where(CategoryRule.category_id == parent.id, CategoryRule.profile_id == pid)
        .values(category_id=autre.id)
    )
    return autre


async def normalize_parent_groups(db: AsyncSession, pid: Optional[int] = None) -> int:
    """Backfill: for every category that has children, ensure its ``Autre {parent}``
    group and reassign directly-held transactions. Returns the number of parents
    processed. Used at startup and after imports so existing parents comply."""
    parent_ids_stmt = select(Category.parent_id).where(Category.parent_id != None).distinct()  # noqa: E711
    parent_ids = [r[0] for r in (await db.execute(parent_ids_stmt)).all()]
    if not parent_ids:
        return 0
    parents_stmt = select(Category).where(Category.id.in_(parent_ids))
    if pid is not None:
        parents_stmt = parents_stmt.where(Category.profile_id == pid)
    parents = (await db.execute(parents_stmt)).scalars().all()
    for parent in parents:
        await _ensure_parent_group(db, pid if pid is not None else parent.profile_id, parent)
    await db.commit()
    return len(parents)


async def _apply_archive(db: AsyncSession, pid: int, cat: Category, archived: bool):
    """Archive (retire) or un-archive a category. Archiving cascades to children
    (a namespace retires its leaves) and deactivates rules that target the subtree,
    so no rule keeps producing an archived category. Un-archiving a child is blocked
    while its parent is still archived."""
    if archived:
        child_ids = [r[0] for r in (await db.execute(
            select(Category.id).where(Category.parent_id == cat.id, Category.profile_id == pid)
        )).all()]
        ids = [cat.id, *child_ids]
        await db.execute(
            update(Category).where(Category.id.in_(ids), Category.profile_id == pid)
            .values(archived=True, archived_at=datetime.utcnow())
        )
        await db.execute(
            update(CategoryRule).where(CategoryRule.category_id.in_(ids), CategoryRule.profile_id == pid)
            .values(is_active=False)
        )
    else:
        if cat.parent_id is not None:
            parent = (await db.execute(
                select(Category).where(Category.id == cat.parent_id, Category.profile_id == pid)
            )).scalar_one_or_none()
            if parent is not None and parent.archived:
                raise HTTPException(400, "Désarchivez d'abord la catégorie parente.")
        await db.execute(
            update(Category).where(Category.id == cat.id, Category.profile_id == pid)
            .values(archived=False, archived_at=None)
        )


async def _validate_parent(db: AsyncSession, pid: int, parent_id: Optional[int], self_id: Optional[int] = None):
    """Enforce a single level of nesting: the parent must exist in the profile,
    be top-level itself, and not be the category being edited."""
    if parent_id is None:
        return
    if parent_id == self_id:
        raise HTTPException(400, "Une catégorie ne peut pas être son propre parent.")
    parent = (await db.execute(
        select(Category).where(Category.id == parent_id, Category.profile_id == pid)
    )).scalar_one_or_none()
    if not parent:
        raise HTTPException(400, "Catégorie parente introuvable.")
    if parent.parent_id is not None:
        raise HTTPException(400, "Un seul niveau de sous-catégorie est autorisé.")
    if self_id is not None:
        has_children = (await db.execute(
            select(Category.id).where(Category.parent_id == self_id).limit(1)
        )).scalar_one_or_none()
        if has_children:
            raise HTTPException(400, "Cette catégorie a des sous-catégories ; elle ne peut pas devenir une sous-catégorie.")


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    await _validate_parent(db, pid, payload.parent_id)
    cat = Category(**payload.model_dump(), profile_id=pid)
    db.add(cat)
    await db.flush()
    # Adding a child turns the parent into a grouping-only category.
    if payload.parent_id is not None:
        parent = (await db.execute(
            select(Category).where(Category.id == payload.parent_id, Category.profile_id == pid)
        )).scalar_one_or_none()
        if parent is not None:
            await _ensure_parent_group(db, pid, parent)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.post("/seed-defaults", status_code=201)
async def seed_default_categories(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Create the standard categories for the active profile, skipping names that
    already exist. Returns how many were created."""
    from seed import DEFAULT_CATEGORIES
    existing = {name for (name,) in (await db.execute(
        select(Category.name).where(Category.profile_id == pid)
    )).all()}
    created = 0
    for cat_data in DEFAULT_CATEGORIES:
        if cat_data["name"] in existing:
            continue
        db.add(Category(**cat_data, profile_id=pid))
        created += 1
    await db.commit()
    return {"created": created}


@router.put("/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, payload: CategoryUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Category).where(Category.id == category_id, Category.profile_id == pid))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    updates = payload.model_dump(exclude_unset=True)
    # Archiving/un-archiving cascades + touches rules — handled separately.
    archived = updates.pop("archived", None)
    if "parent_id" in updates:
        await _validate_parent(db, pid, updates["parent_id"], self_id=category_id)
    for field, value in updates.items():
        setattr(cat, field, value)
    # Re-parenting a category under a new parent turns that parent grouping-only.
    if updates.get("parent_id") is not None:
        await db.flush()
        parent = (await db.execute(
            select(Category).where(Category.id == updates["parent_id"], Category.profile_id == pid)
        )).scalar_one_or_none()
        if parent is not None:
            await _ensure_parent_group(db, pid, parent)
    if archived is not None:
        await _apply_archive(db, pid, cat, archived)
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

    # Re-parent any children to top-level so they aren't orphaned.
    await db.execute(update(Category).where(Category.parent_id == category_id).values(parent_id=None))

    # Delete associated rules first
    rules = await db.execute(select(CategoryRule).where(CategoryRule.category_id == category_id))
    for rule in rules.scalars().all():
        await db.delete(rule)

    await db.delete(cat)
    await db.commit()


@router.post("/rescan", status_code=200)
async def rescan_categories(
    scope: str = "uncategorized",
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Re-apply active rules. `scope="uncategorized"` (default) only fills in
    transactions that have no category yet — it never rewrites already-categorised
    history (the ledger stays intact). `scope="all"` re-applies to every
    non-manually-reviewed transaction and may change past categorisations."""
    filters = [Transaction.is_manually_reviewed == False, Transaction.profile_id == pid]  # noqa: E712
    if scope != "all":
        filters.append(Transaction.category_id == None)  # noqa: E711
    result = await db.execute(select(Transaction).where(*filters))
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


async def _reject_archived_target(db: AsyncSession, pid: int, category_id: Optional[int]):
    """A rule must not classify into an archived (retired) category."""
    if category_id is None:
        return
    archived = (await db.execute(
        select(Category.archived).where(Category.id == category_id, Category.profile_id == pid)
    )).scalar_one_or_none()
    if archived:
        raise HTTPException(400, "Cette catégorie est archivée ; choisissez une catégorie active.")


@router.post("/{category_id}/rules", response_model=CategoryRuleOut, status_code=201)
async def create_rule(category_id: int, payload: CategoryRuleCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    await _reject_archived_target(db, pid, category_id)
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
    updates = payload.model_dump(exclude_none=True)
    if "category_id" in updates:
        await _reject_archived_target(db, pid, updates["category_id"])
    for field, value in updates.items():
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
