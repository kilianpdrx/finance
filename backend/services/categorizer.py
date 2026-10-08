"""Categorize a transaction description using user-defined rules.

Rules have NO priority: they are all evaluated, and a transaction is classified
only when every matching rule agrees on the category. When rules pointing to
different categories match, nothing is assigned — the conflict is surfaced and
the user edits a rule (or picks a category by hand).
"""
import re
from typing import NamedTuple, Optional, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import CategoryRule


class RuleEval(NamedTuple):
    """Outcome of evaluating the whole ruleset against one transaction."""
    category_id: Optional[int]   # set only when exactly ONE distinct category matches
    source: Optional[str]        # "rule" when category_id is set, else None
    category_ids: set            # every distinct category whose rules match
    rule_ids: List[int]          # every matching rule, in id order

    @property
    def conflict(self) -> bool:
        return len(self.category_ids) >= 2


def _amount_threshold(value) -> Optional[float]:
    """A rule's amount as typed in the editor: "12,5", "12.5", "1 850"."""
    text = str(value).strip().replace("\u00a0", "").replace("\u202f", "").replace(" ", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


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
            # The amount is compared WITHOUT its sign (amounts are stored unsigned):
            # "plus de 600" holds for an expense and an income alike. Direction is
            # its own condition (`is_debit`, shown as « Sens »).
            target = t_amount
            val = _amount_threshold(val)
            if val is None:
                # Not a number: the condition cannot hold. It used to be read as
                # 0, which made "montant > abc" match every transaction.
                results.append(False)
                continue
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
            elif operator == 'not_contains':
                matched = val not in target
            elif operator == 'word':
                # Whole word: "eau" must not fire on BEAUTE, "free" on FREELANCE.
                matched = bool(val) and bool(re.search(r"(?<!\w)" + re.escape(val) + r"(?!\w)", target))
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


def rule_matches(rule: CategoryRule, txn_data: dict) -> bool:
    """True when `rule` fires on this transaction: it has conditions, it is not
    bound to another account, and its conditions hold."""
    if not rule.conditions:
        return False
    if rule.account_id is not None and str(rule.account_id) != str(txn_data.get('account_id', '')):
        return False
    return evaluate_conditions(txn_data, rule.conditions, getattr(rule, 'logic_operator', 'AND') or 'AND')


async def evaluate_rules_batch(
    txns_data: List[dict],
    db: AsyncSession,
    profile_id: Optional[int] = None,
) -> List[RuleEval]:
    """Evaluate all active rules against each transaction, querying rules once.

    Returns one `RuleEval` per transaction. Every rule is evaluated — there is no
    ordering between them — and a category is assigned only when all the matching
    rules agree. Two or more distinct categories is a conflict: `category_id`
    stays None and `rule_ids` tells the caller which rules to show."""
    if not txns_data:
        return []

    conds = [CategoryRule.is_active == True]  # noqa: E712
    if profile_id is not None:
        conds.append(CategoryRule.profile_id == profile_id)
    result = await db.execute(
        select(CategoryRule)
        .where(*conds)
        .order_by(CategoryRule.id)
    )
    rules = result.scalars().all()

    out = []
    for txn_data in txns_data:
        category_ids: set = set()
        rule_ids: List[int] = []
        for rule in rules:
            if rule_matches(rule, txn_data):
                category_ids.add(rule.category_id)
                rule_ids.append(rule.id)

        if len(category_ids) == 1:
            out.append(RuleEval(next(iter(category_ids)), "rule", category_ids, rule_ids))
        else:
            out.append(RuleEval(None, None, category_ids, rule_ids))

    return out


async def categorize_batch(
    txns_data: List[dict],
    db: AsyncSession,
    profile_id: Optional[int] = None,
) -> List[tuple[Optional[int], Optional[str]]]:
    """Categorize a list of transactions efficiently by querying active rules once.

    Returns one (category_id, source) tuple per input transaction, in order.
    `source` is "rule" on a match, else None. A transaction whose matching rules
    disagree on the category gets (None, None)."""
    return [(e.category_id, e.source) for e in await evaluate_rules_batch(txns_data, db, profile_id)]


async def conflict_flags_batch(
    txns_data: List[dict],
    db: AsyncSession,
    profile_id: Optional[int] = None,
) -> List[bool]:
    """True per transaction when >= 2 DISTINCT categories match (several apply)."""
    return [e.conflict for e in await evaluate_rules_batch(txns_data, db, profile_id)]


async def categorize(txn_data: dict, db: AsyncSession, profile_id: Optional[int] = None) -> tuple[Optional[int], Optional[str]]:
    """Return (category_id, source) for the given transaction dictionary."""
    results = await categorize_batch([txn_data], db, profile_id)
    return results[0] if results else (None, None)

