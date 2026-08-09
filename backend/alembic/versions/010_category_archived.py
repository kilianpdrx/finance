"""Add archive lifecycle flags to categories

Adds `archived`, `archived_at` and `archive_dismissed` so a category can be
retired (hidden from pickers) while its history is preserved.

Revision ID: 010_category_archived
Revises: 009_txn_manually_edited
Create Date: 2026-08-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "010_category_archived"
down_revision: Union[str, None] = "009_txn_manually_edited"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all may already have added the columns.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("categories")}
    with op.batch_alter_table("categories", schema=None) as batch_op:
        if "archived" not in cols:
            batch_op.add_column(sa.Column("archived", sa.Boolean(), nullable=True, server_default=sa.false()))
        if "archived_at" not in cols:
            batch_op.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        if "archive_dismissed" not in cols:
            batch_op.add_column(sa.Column("archive_dismissed", sa.Boolean(), nullable=True, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("categories", schema=None) as batch_op:
        batch_op.drop_column("archive_dismissed")
        batch_op.drop_column("archived_at")
        batch_op.drop_column("archived")
