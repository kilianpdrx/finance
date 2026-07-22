"""Categorize a transaction description using rules then ML fallback."""
import re
from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import CategoryRule


def evaluate_conditions(txn_data: dict, conditions: List[dict], logic_operator: str = "AND") -> bool:
    """Evaluate a list of conditions against a transaction dict.
    logic_operator='AND': all must match. logic_operator='OR': at least one must match."""
    description = str(txn_data.get('description', '')).lower()
    t_amount_cents = int(txn_data.get('amount_cents', 0))
    t_amount = t_amount_cents / 100.0
    date_val = str(txn_data.get('date', ''))
    is_debit = bool(txn_data.get('is_debit', False))
    currency = str(txn_data.get('currency', '')).lower()
    account_id = str(txn_data.get('account_id', ''))

    results = []
    for condition in conditions:
        field_name = condition.get('field', '')
        operator = condition.get('operator', '')
        val = condition.get('value', '')

        target = None
        if field_name == 'description':
            target = description
            val = str(val).lower()
        elif field_name == 'amount':
            target = t_amount
            try:
                val = float(val)
            except ValueError:
                val = 0.0
        elif field_name == 'date':
            target = date_val
            val = str(val)
        elif field_name == 'is_debit':
            target = is_debit
            val = str(val).lower() == 'true'
        elif field_name == 'currency':
            target = currency
            val = str(val).lower()
        elif field_name == 'account_id':
            target = account_id
            val = str(val)
        else:
            results.append(False)
            continue

        matched = False
        if type(target) is str:
            if operator == 'contains':
                matched = val in target
            elif operator == 'startswith':
                matched = target.startswith(val)
            elif operator == 'equals':
                matched = target == val
            elif operator == 'regex':
                try:
                    matched = bool(re.search(val, target, re.IGNORECASE))
                except re.error:
                    matched = False
        elif type(target) is float or type(target) is int:
            if operator == '>':
                matched = target > val
            elif operator == '>=':
                matched = target >= val
            elif operator == '<':
                matched = target < val
            elif operator == '<=':
                matched = target <= val
            elif operator == 'equals':
                matched = target == val
        elif type(target) is bool:
            if operator == 'equals':
                matched = target == val

        results.append(matched)

    if not results:
        return False
    return all(results) if logic_operator != "OR" else any(results)


async def categorize_batch(
    txns_data: List[dict],
    db: AsyncSession,
    profile_id: Optional[int] = None,
) -> List[tuple[Optional[int], Optional[str]]]:
    """Categorize a list of transactions efficiently by querying active rules once."""
    if not txns_data:
        return []

    conds = [CategoryRule.is_active == True]
    if profile_id is not None:
        conds.append(CategoryRule.profile_id == profile_id)
    result = await db.execute(
        select(CategoryRule)
        .where(*conds)
        .order_by(CategoryRule.priority, CategoryRule.id)
    )
    rules = result.scalars().all()

    out = []
    for txn_data in txns_data:
        matched_category = None
        matched_source = None
        for rule in rules:
            if not rule.conditions:
                continue
            if rule.account_id is not None and str(rule.account_id) != str(txn_data.get('account_id', '')):
                continue

            logic_op = getattr(rule, 'logic_operator', 'AND') or 'AND'
            if evaluate_conditions(txn_data, rule.conditions, logic_op):
                matched_category = rule.category_id
                matched_source = "rule"
                break

        if matched_category is None:
            try:
                from services.ml_trainer import predict
                cat_id = predict(str(txn_data.get('description', '')), profile_id)
                if cat_id is not None:
                    matched_category = cat_id
                    matched_source = "ml"
            except Exception:
                pass

        out.append((matched_category, matched_source))

    return out


async def categorize(txn_data: dict, db: AsyncSession, profile_id: Optional[int] = None) -> tuple[Optional[int], Optional[str]]:
    """Return (category_id, source) for the given transaction dictionary."""
    results = await categorize_batch([txn_data], db, profile_id)
    return results[0] if results else (None, None)

