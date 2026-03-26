"""Categorize a transaction description using rules then ML fallback."""
import re
from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import CategoryRule


def evaluate_conditions(txn_data: dict, conditions: List[dict]) -> bool:
    """Evaluate a list of conditions against a transaction dict. All must match."""
    description = str(txn_data.get('description', '')).lower()
    t_amount_cents = int(txn_data.get('amount_cents', 0))
    t_amount = t_amount_cents / 100.0
    date_val = str(txn_data.get('date', ''))
    is_debit = bool(txn_data.get('is_debit', False))
    currency = str(txn_data.get('currency', '')).lower()
    account_id = str(txn_data.get('account_id', ''))

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
            return False

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

        if not matched:
            return False

    return True


async def categorize(txn_data: dict, db: AsyncSession) -> Optional[int]:
    """Return category_id for the given transaction dictionary, or None."""
    result = await db.execute(
        select(CategoryRule)
        .where(CategoryRule.is_active == True)
        .order_by(CategoryRule.priority, CategoryRule.id)
    )
    rules = result.scalars().all()

    for rule in rules:
        if not rule.conditions:
            continue

        # Skip rules scoped to a different account
        if rule.account_id is not None and str(rule.account_id) != str(txn_data.get('account_id', '')):
            continue

        if evaluate_conditions(txn_data, rule.conditions):
            return rule.category_id

    # ML fallback
    try:
        from services.ml_trainer import predict
        cat_id = predict(str(txn_data.get('description', '')))
        if cat_id is not None:
            return cat_id
    except Exception:
        pass

    return None
