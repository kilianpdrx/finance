"""Index transactions on (profile_id, date)

Every user-data query filters by profile_id, but the existing indexes lead with
`date`, `account_id` or `category_id`, so none of them can serve that predicate.
A composite (profile_id, date) index matches the dominant access pattern —
"this profile's transactions, optionally within a date range".

Revision ID: 011_txn_profile_index
Revises: 010_category_archived
Create Date: 2026-08-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "011_txn_profile_index"
down_revision: Union[str, None] = "010_category_archived"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX_NAME = "ix_transactions_profile_date"


def upgrade() -> None:
    # Idempotent: init_db()'s create_all builds this index from the model on a
    # fresh database, so only create it when it isn't already there.
    existing = {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes("transactions")}
    if INDEX_NAME not in existing:
        op.create_index(INDEX_NAME, "transactions", ["profile_id", "date"])


def downgrade() -> None:
    existing = {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes("transactions")}
    if INDEX_NAME in existing:
        op.drop_index(INDEX_NAME, table_name="transactions")
