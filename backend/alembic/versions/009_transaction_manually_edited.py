"""Add is_manually_edited flag to transactions

Marks transactions whose core fields (date/description/amount/type) were
hand-corrected after import, so the UI can badge them.

Revision ID: 009_txn_manually_edited
Revises: 008_fix_budget_unique
Create Date: 2026-08-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "009_txn_manually_edited"
down_revision: Union[str, None] = "008_fix_budget_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all may already have added the column.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("transactions")}
    if "is_manually_edited" in cols:
        return
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_manually_edited", sa.Boolean(), nullable=True, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_column("is_manually_edited")
