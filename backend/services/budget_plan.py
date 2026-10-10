"""An account's monthly budget plan: a handful of envelopes read against what
the budget table already adds up.

An envelope is a named group of categories with a monthly amount. Its `kind`
says how the amount reads: a ceiling ("expense"), or a minimum to reach
("income", and "goal" for investments). "unplanned" is the provision for the
expenses the user marked as unplanned: it has no categories.

The plan is PER ACCOUNT and in the account's currency — nothing here converts
anything, and nothing adds two accounts together.

What an envelope realised in a month is, by construction, what the budget table
shows for its categories (transactions of the account, internal transfers out,
manual adjustments in). Expenses marked unplanned are the one difference: they
leave their envelope and are counted apart. Whatever no envelope covers —
unassigned categories, uncategorised rows — is reported as "outside", so the
plan never loses money the table shows (`tests/test_budget_plan.py` pins it).
"""
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from statistics import mean, median
from typing import Optional

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    BudgetEntry, BudgetEnvelope, BudgetEnvelopeAmount, BudgetEnvelopeCategory, Category, PlannedExpense,
    Transaction,
)
from services.label_groups import label_key

INCOME, EXPENSE, GOAL, UNPLANNED = "income", "expense", "goal", "unplanned"

# How far back "a typical month" looks, in full months before the one shown.
HISTORY_MONTHS = 12
# An expense is worth asking about ("imprévu ?") when its label does not come
# back — from this many occurrences it is a habit (rent, a quarterly bill), not a
# surprise…
RECURRING_FROM = 3
# …when it is at least this much…
SUGGESTION_FLOOR_CENTS = 100_00
# …and at least this share of what its category usually sees in such one-offs
# in a month: 120 € in a new restaurant is nothing unusual for someone who
# tries a new one every week.
SUGGESTION_SHARE = 0.5

PROPOSAL_NAMES = {
    INCOME: "Revenus", "fixed": "Dépenses fixes", "variable": "Dépenses variables",
    GOAL: "Investissements", UNPLANNED: "Imprévus",
}


# ── Months ("YYYY-MM") ──────────────────────────────────────────────────────

def current_month() -> str:
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}"


def month_add(ym: str, n: int) -> str:
    index = int(ym[:4]) * 12 + (int(ym[5:7]) - 1) + n
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def months_until(last: str, count: int) -> list[str]:
    """`count` consecutive months ending with `last`."""
    return [month_add(last, i - (count - 1)) for i in range(count)]


def _month_bounds(first: str, last: str) -> tuple[str, str]:
    """ISO dates covering [first, last]; the upper bound is exclusive."""
    return f"{first}-01", f"{month_add(last, 1)}-01"


# ── Small pure pieces ───────────────────────────────────────────────────────

def amount_in_force(amounts: list[tuple[str, int]], month: str) -> Optional[int]:
    """The amount planned for `month`: the latest one set in or before it.
    None when the envelope did not have an amount yet."""
    found = None
    for effective_from, cents in sorted(amounts):
        if effective_from <= month:
            found = cents
    return found


def typical(values: list[int]) -> Optional[int]:
    """A typical month: the median. One exceptional month moves an average a
    lot and a median not at all — and irregular months are the norm."""
    return round(median(values)) if values else None


def round_amount(cents: Optional[int]) -> int:
    """A suggested amount as a person would type it: to the nearest 10 from 100
    up, to the nearest 5 below."""
    if not cents or cents <= 0:
        return 0
    step = 1000 if cents >= 100_00 else 500
    return max(step, int(cents / step + 0.5) * step)


# ── What the account did, month by month ────────────────────────────────────

@dataclass
class AccountSums:
    """Per (category, month): what the budget table shows, unplanned expenses
    taken out. Category None is the uncategorised rows, kept by direction since
    they have no category to say whether they are income."""
    by_category: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    uncategorised_spent: dict = field(default_factory=lambda: defaultdict(int))
    uncategorised_received: dict = field(default_factory=lambda: defaultdict(int))
    unplanned: dict = field(default_factory=lambda: defaultdict(int))
    planned_extra: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))


async def load_sums(db: AsyncSession, pid: int, account_id: int, first: str, last: str) -> AccountSums:
    date_from, date_before = _month_bounds(first, last)
    marked = case((and_(Transaction.is_unplanned.is_(True), Transaction.is_debit.is_(True)), 1), else_=0)
    month = func.strftime("%Y-%m", Transaction.date)
    rows = (await db.execute(
        select(month, Transaction.category_id, Transaction.is_debit, marked, func.sum(Transaction.amount_cents))
        .where(
            Transaction.profile_id == pid, Transaction.account_id == account_id,
            Transaction.date >= date_from, Transaction.date < date_before,
            Transaction.is_internal_transfer == False,  # noqa: E712 — same filter as the budget table
        )
        .group_by(month, Transaction.category_id, Transaction.is_debit, marked)
    )).all()

    sums = AccountSums()
    for ym, category_id, is_debit, is_marked, total in rows:
        if is_marked:
            sums.unplanned[ym] += total
        elif category_id is None:
            (sums.uncategorised_spent if is_debit else sums.uncategorised_received)[ym] += total
        else:
            # Both directions added, as the table does: a category's cell is one sum.
            sums.by_category[category_id][ym] += total

    months = months_until(last, _month_distance(first, last) + 1)
    for entry in (await db.execute(select(BudgetEntry).where(
        BudgetEntry.profile_id == pid, BudgetEntry.account_id == account_id, BudgetEntry.month.in_(months),
    ))).scalars():
        sums.by_category[entry.category_id][entry.month] += entry.expected_amount_cents
    for plan in (await db.execute(select(PlannedExpense).where(
        PlannedExpense.profile_id == pid, PlannedExpense.account_id == account_id, PlannedExpense.month.in_(months),
    ))).scalars():
        sums.planned_extra[plan.category_id][plan.month] += plan.amount_cents
    return sums


def _month_distance(first: str, last: str) -> int:
    return (int(last[:4]) * 12 + int(last[5:7])) - (int(first[:4]) * 12 + int(first[5:7]))


async def first_month_of(db: AsyncSession, pid: int, account_id: int) -> Optional[str]:
    """The month of the account's first transaction — a typical month is not
    diluted by the months before the account existed."""
    earliest = (await db.execute(
        select(func.min(Transaction.date)).where(Transaction.profile_id == pid, Transaction.account_id == account_id)
    )).scalar()
    return str(earliest)[:7] if earliest else None


def history_months(month: str, first_month: Optional[str]) -> list[str]:
    """The full months "a typical month" is read from: up to 12 before `month`,
    never before the account's first transaction."""
    if first_month is None:
        return []
    return [m for m in months_until(month_add(month, -1), HISTORY_MONTHS) if m >= first_month]


# ── The saved plan ──────────────────────────────────────────────────────────

@dataclass
class Envelope:
    id: Optional[int]
    name: str
    kind: str
    category_ids: list[int]
    amounts: list[tuple[str, int]]      # (effective_from, cents)

    def realised(self, sums: AccountSums, month: str) -> int:
        if self.kind == UNPLANNED:
            return sums.unplanned.get(month, 0)
        return sum(sums.by_category[c].get(month, 0) for c in self.category_ids)

    def planned_extra(self, sums: AccountSums, month: str) -> int:
        """« Planifier » entries of that month: a known one-off raises the
        month's target instead of reading as an overrun."""
        return sum(sums.planned_extra[c].get(month, 0) for c in self.category_ids)

    def target(self, sums: AccountSums, month: str) -> Optional[int]:
        amount = amount_in_force(self.amounts, month)
        return None if amount is None else amount + self.planned_extra(sums, month)


async def load_envelopes(db: AsyncSession, pid: int, account_id: int) -> list[Envelope]:
    rows = (await db.execute(
        select(BudgetEnvelope)
        .where(BudgetEnvelope.profile_id == pid, BudgetEnvelope.account_id == account_id)
        .order_by(BudgetEnvelope.position, BudgetEnvelope.id)
    )).scalars().all()
    if not rows:
        return []
    ids = [r.id for r in rows]
    categories = defaultdict(list)
    for link in (await db.execute(select(BudgetEnvelopeCategory).where(
        BudgetEnvelopeCategory.profile_id == pid, BudgetEnvelopeCategory.envelope_id.in_(ids),
    ))).scalars():
        categories[link.envelope_id].append(link.category_id)
    amounts = defaultdict(list)
    for amount in (await db.execute(select(BudgetEnvelopeAmount).where(
        BudgetEnvelopeAmount.profile_id == pid, BudgetEnvelopeAmount.envelope_id.in_(ids),
    ))).scalars():
        amounts[amount.envelope_id].append((amount.effective_from, amount.amount_cents))
    return [Envelope(r.id, r.name, r.kind, sorted(categories[r.id]), sorted(amounts[r.id])) for r in rows]


@dataclass
class Outside:
    spent: int
    received: int
    category_ids: list[int]


def outside(sums: AccountSums, envelopes: list[Envelope], income_ids: set[int], month: str) -> Outside:
    """What no envelope covers in `month`: the categories nobody assigned, and
    the rows without a category. Shown so that nothing disappears."""
    assigned = {c for e in envelopes for c in e.category_ids}
    spent = sums.uncategorised_spent.get(month, 0)
    received = sums.uncategorised_received.get(month, 0)
    category_ids = []
    for category_id, per_month in sums.by_category.items():
        value = per_month.get(month, 0)
        if category_id in assigned or value == 0:
            continue
        category_ids.append(category_id)
        if category_id in income_ids:
            received += value
        else:
            spent += value
    return Outside(spent, received, sorted(category_ids))


def remainder(sums: AccountSums, envelopes: list[Envelope], income_ids: set[int], month: str) -> tuple[int, Optional[int]]:
    """« Reste du mois »: everything received minus everything that left —
    realised, and as planned (None while no envelope had an amount)."""
    out = outside(sums, envelopes, income_ids, month)
    realised = out.received - out.spent
    planned, any_target = 0, False
    has_provision = any(e.kind == UNPLANNED for e in envelopes)
    if not has_provision:
        realised -= sums.unplanned.get(month, 0)
    for e in envelopes:
        sign = 1 if e.kind == INCOME else -1
        realised += sign * e.realised(sums, month)
        target = e.target(sums, month)
        if target is not None:
            planned += sign * target
            any_target = True
    return realised, (planned if any_target else None)


def provision_year_to_date(envelope: Envelope, sums: AccountSums, month: str) -> tuple[int, int]:
    """Provision set aside and unplanned spending since January, over the months
    the provision existed. Unplanned expenses are irregular by nature: the
    provision is judged over the year, not month by month."""
    provision = spent = 0
    for m in months_until(month, int(month[5:7])):
        amount = amount_in_force(envelope.amounts, m)
        if amount is None:
            continue
        provision += amount
        spent += sums.unplanned.get(m, 0)
    return provision, spent


def history_stats(envelope: Envelope, sums: AccountSums, months: list[str]) -> tuple[Optional[int], Optional[int], Optional[int]]:
    """(typical, average, last month) of an envelope over `months`."""
    values = [envelope.realised(sums, m) for m in months]
    if not values:
        return None, None, None
    return typical(values), round(mean(values)), values[-1]


# ── Unusual expenses: "imprévu ?" ───────────────────────────────────────────

@dataclass
class Candidate:
    id: int
    date: date
    description: str
    amount_cents: int
    category_id: Optional[int]
    typical_cents: int


async def unusual_expenses(
    db: AsyncSession, pid: int, account_id: int, month: str, lookback: int, categories: dict,
) -> list[Candidate]:
    """Expenses of the last `lookback` months worth asking about: a label that
    does not come back, and an amount that stands out. Only ever a suggestion —
    the user answers, and an answered row is not asked about again.

    "Stands out" is judged per CATEGORY, not per envelope (regrouping categories
    must not change what counts as unusual), and against the category's usual
    ONE-OFFS rather than its whole month: a plumber's bill is unusual in a
    category that otherwise only holds the rent, however large the rent is.
    Fixed-expense categories are therefore not left out — the recurring bills
    in them never get this far."""
    first_month = await first_month_of(db, pid, account_id)
    past = history_months(month, first_month)
    window_first = month_add(month, -HISTORY_MONTHS)
    date_from, date_before = _month_bounds(window_first, month)
    rows = (await db.execute(
        select(Transaction.id, Transaction.date, Transaction.description, Transaction.amount_cents,
               Transaction.category_id, Transaction.is_unplanned)
        .where(
            Transaction.profile_id == pid, Transaction.account_id == account_id,
            Transaction.is_debit.is_(True), Transaction.is_internal_transfer == False,  # noqa: E712
            Transaction.date >= date_from, Transaction.date < date_before,
        )
        .order_by(Transaction.date.desc(), Transaction.id.desc())
    )).all()

    occurrences = Counter(label_key(r.description) for r in rows)
    one_off = lambda r: occurrences[label_key(r.description)] < RECURRING_FROM  # noqa: E731
    monthly = defaultdict(lambda: defaultdict(int))        # everything, for context
    one_offs = defaultdict(lambda: defaultdict(int))       # what the amount is judged against
    for r in rows:
        if r.is_unplanned is not True:
            monthly[r.category_id][str(r.date)[:7]] += r.amount_cents
            if one_off(r):
                one_offs[r.category_id][str(r.date)[:7]] += r.amount_cents
    typical_of = {cat: typical([per_month.get(m, 0) for m in past]) or 0 for cat, per_month in monthly.items()}
    usual_one_offs = {cat: typical([per_month.get(m, 0) for m in past]) or 0 for cat, per_month in one_offs.items()}

    asked_from = month_add(month, -(lookback - 1))
    found = []
    for r in rows:
        if str(r.date)[:7] < asked_from or r.is_unplanned is not None or r.amount_cents < SUGGESTION_FLOOR_CENTS:
            continue
        category = categories.get(r.category_id)
        if category is not None and (category.is_income or category.is_investment):
            continue
        if not one_off(r) or r.amount_cents < SUGGESTION_SHARE * usual_one_offs.get(r.category_id, 0):
            continue
        found.append(Candidate(r.id, r.date, r.description, r.amount_cents, r.category_id, typical_of.get(r.category_id, 0)))
    return found


# ── The first split ─────────────────────────────────────────────────────────

def eligible_categories(categories: dict, account_id: int) -> dict:
    """The categories an envelope of this account can hold: leaves (a parent
    only groups), global or bound to this very account."""
    parents = {c.parent_id for c in categories.values() if c.parent_id is not None}
    return {
        cid: c for cid, c in categories.items()
        if cid not in parents and (c.account_id is None or c.account_id == account_id)
    }


def propose(categories: dict, account_id: int, sums: AccountSums, past: list[str], month: str,
            unusual: list[Candidate]) -> list[Envelope]:
    """A plan to start from: income, fixed costs, variable costs (to divide up),
    investments, and a provision. Only categories this account actually used,
    each amount a typical month. Nothing is saved — the user edits it first."""
    active = [
        c for cid, c in eligible_categories(categories, account_id).items()
        if not c.archived and any(sums.by_category[cid].get(m, 0) for m in [*past, month])
    ]

    def group(c) -> str:
        if c.is_income:
            return INCOME
        if c.is_investment:
            return GOAL
        return "fixed" if c.expense_type == "fixed" else "variable"

    members = defaultdict(list)
    for c in active:
        members[group(c)].append(c.id)

    envelopes = []
    for key in (INCOME, "fixed", "variable", GOAL):
        if not members[key]:
            continue
        kind = key if key in (INCOME, GOAL) else EXPENSE
        envelope = Envelope(None, PROPOSAL_NAMES[key], kind, sorted(members[key]), [])
        usual, _, _ = history_stats(envelope, sums, past)
        envelope.amounts = [(month, round_amount(usual))]
        envelopes.append(envelope)

    # What the unusual expenses of the past year would have needed each month.
    provision = round_amount(sum(c.amount_cents for c in unusual if str(c.date)[:7] in past) / len(past)) if past else 0
    envelopes.append(Envelope(None, PROPOSAL_NAMES[UNPLANNED], UNPLANNED, [], [(month, provision)]))
    return envelopes


async def profile_categories(db: AsyncSession, pid: int) -> dict:
    rows = (await db.execute(select(Category).where(Category.profile_id == pid))).scalars().all()
    return {c.id: c for c in rows}
