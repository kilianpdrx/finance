"""Fix budget_entries unique constraint to include account_id

Older databases created the uq_budget_entry constraint on (category_id, month)
only, which (a) blocks per-account budgets and (b) makes the budget upsert 500
when an entry already exists for a different account. Correct it to
(category_id, month, account_id) to match the model.

Revision ID: 008_fix_budget_unique
Revises: 007_planned_expenses
Create Date: 2026-07-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "008_fix_budget_unique"
down_revision: Union[str, None] = "007_planned_expenses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TARGET = {"category_id", "month", "account_id"}


def upgrade() -> None:
    bind = op.get_bind()
    ucs = sa.inspect(bind).get_unique_constraints("budget_entries")
    # Idempotent: skip if the constraint is already correct (e.g. a fresh DB).
    if any(set(uc["column_names"]) == _TARGET for uc in ucs):
        return
    with op.batch_alter_table("budget_entries", schema=None) as batch_op:
        batch_op.drop_constraint("uq_budget_entry", type_="unique")
        batch_op.create_unique_constraint("uq_budget_entry", ["category_id", "month", "account_id"])


def downgrade() -> None:
    with op.batch_alter_table("budget_entries", schema=None) as batch_op:
        batch_op.drop_constraint("uq_budget_entry", type_="unique")
        batch_op.create_unique_constraint("uq_budget_entry", ["category_id", "month"])
