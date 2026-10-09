"""Record how a transaction got its category

`category_source` says whether a rule classified the transaction ("rule") or the
user chose the category ("manual"), so the list can badge and filter the
automatic ones. Existing rows are filled in at startup, from the current rules
(services/category_source.py) — a migration cannot run the rule engine.

Revision ID: 015_txn_category_source
Revises: 014_drop_rule_priority
Create Date: 2026-10-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "015_txn_category_source"
down_revision: Union[str, None] = "014_drop_rule_priority"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all already adds it on a fresh database.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("transactions")}
    if "category_source" in cols:
        return
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("category_source", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_column("category_source")
