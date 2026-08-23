"""Keep the original amount/currency of a foreign transaction

A purchase made abroad on a domestic card is stored converted to the account's
currency, and the amount the bank actually charged was lost. These two nullable
columns preserve it for display; every total keeps using `amount_cents`.

Revision ID: 013_txn_original_currency
Revises: 012_adopt_orphan_profile_rows
Create Date: 2026-08-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "013_txn_original_currency"
down_revision: Union[str, None] = "012_adopt_orphan_profile_rows"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all already adds these on a fresh database.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("transactions")}
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        if "original_amount_cents" not in cols:
            batch_op.add_column(sa.Column("original_amount_cents", sa.Integer(), nullable=True))
        if "original_currency" not in cols:
            batch_op.add_column(sa.Column("original_currency", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_column("original_currency")
        batch_op.drop_column("original_amount_cents")
