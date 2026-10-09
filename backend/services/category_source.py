"""How a transaction got its category: by a rule, or by hand.

`Transaction.category_source` is written wherever a category is — "rule" when
the rule engine assigned it (import, applying rules), "manual" when the user
picked it (editing a row, a bulk action, the import review). It is what lets the
list badge and filter the transactions that were classified automatically — and
what re-applying rules relies on to leave alone every category the user chose
(`disagreeing_category` only FLAGS a hand label the rules would set differently).

Rows categorised before the column existed carry no source. `backfill` infers
one, once: "rule" when the CURRENT rules give the row the category it has,
"manual" otherwise. It is a best guess (a row classified by hand before the rule
was written reads as "rule"), and it only ever writes this marker — never a
category.
"""
import logging
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import Profile, Transaction
from services.categorizer import evaluate_rules_batch

logger = logging.getLogger(__name__)

RULE = "rule"
MANUAL = "manual"

_ID_CHUNK = 900   # SQLite's variable cap is 999


def manual_source(category_id: Optional[int]) -> Optional[str]:
    """The source to store when the USER sets `category_id` (None clears it)."""
    return MANUAL if category_id is not None else None


def rule_source(category_id: Optional[int]) -> Optional[str]:
    """The source to store when the RULE ENGINE sets `category_id`."""
    return RULE if category_id is not None else None


def disagreeing_category(category_id: Optional[int], source: Optional[str], ev) -> Optional[int]:
    """The category the rules agree on, when it is NOT the one the user chose.

    None whenever there is nothing to report: the row was not classified by
    hand, no rule matches it, the rules conflict among themselves, or they give
    the category it already has. A hand label is never rewritten for this — the
    row is only flagged (« ≠ règle »), and the user settles it."""
    if source != MANUAL or category_id is None:
        return None
    if ev.category_id is None or ev.category_id == category_id:
        return None
    return ev.category_id


async def backfill(db: AsyncSession) -> dict:
    """Give a source to every categorised transaction that has none yet.

    Idempotent: once a row has a source it is never looked at again, so after
    the first run this is one cheap query per start. Returns the counts."""
    marked = {RULE: 0, MANUAL: 0}
    for pid in (await db.execute(select(Profile.id))).scalars().all():
        rows = (await db.execute(
            select(Transaction).where(
                Transaction.profile_id == pid,
                Transaction.category_id != None,  # noqa: E711
                Transaction.category_source == None,  # noqa: E711
            )
        )).scalars().all()
        if not rows:
            continue
        evals = await evaluate_rules_batch(
            [{"description": t.description, "amount_cents": t.amount_cents, "date": str(t.date),
              "is_debit": t.is_debit, "currency": t.currency, "account_id": t.account_id} for t in rows],
            db, pid,
        )
        by_source: dict = {RULE: [], MANUAL: []}
        for txn, ev in zip(rows, evals):
            by_source[RULE if ev.category_id == txn.category_id else MANUAL].append(txn.id)
        for source, ids in by_source.items():
            for i in range(0, len(ids), _ID_CHUNK):
                await db.execute(
                    update(Transaction).where(Transaction.id.in_(ids[i:i + _ID_CHUNK])).values(category_source=source)
                )
            marked[source] += len(ids)
    if marked[RULE] or marked[MANUAL]:
        await db.commit()
        logger.info("Category source inferred for %d transactions (%d by rule, %d manual).",
                    marked[RULE] + marked[MANUAL], marked[RULE], marked[MANUAL])
    return marked
