"""Drop the priority of categorisation rules

Rules no longer have an order: they are all evaluated, and a transaction that
matches rules pointing to different categories is left uncategorised with the
conflict shown, instead of being settled by a number the UI never exposed.

Revision ID: 014_drop_rule_priority
Revises: 013_txn_original_currency
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "014_drop_rule_priority"
down_revision: Union[str, None] = "013_txn_original_currency"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: a database built by init_db()'s create_all never had the column.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("category_rules")}
    if "priority" not in cols:
        return
    with op.batch_alter_table("category_rules", schema=None) as batch_op:
        batch_op.drop_column("priority")


def downgrade() -> None:
    with op.batch_alter_table("category_rules", schema=None) as batch_op:
        batch_op.add_column(sa.Column("priority", sa.Integer(), nullable=True, server_default="100"))
