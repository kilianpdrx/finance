"""Budget plan: an amount per category inside an envelope

`budget_envelope_categories.amount_cents` is what the user plans for that
category alone. NULL (every existing row) means the envelope is planned as one
amount, as before; as soon as one category of an envelope has an amount, the
envelope's own amount is the sum of them.

Revision ID: 017_envelope_category_amount
Revises: 016_budget_plan
Create Date: 2026-10-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "017_envelope_category_amount"
down_revision: Union[str, None] = "016_budget_plan"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all already adds the column on a fresh database.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("budget_envelope_categories")}
    if "amount_cents" not in cols:
        with op.batch_alter_table("budget_envelope_categories", schema=None) as batch_op:
            batch_op.add_column(sa.Column("amount_cents", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("budget_envelope_categories", schema=None) as batch_op:
        batch_op.drop_column("amount_cents")
