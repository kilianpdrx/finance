"""Adopt orphaned rows that have no profile_id

Older builds seeded default categories and rules before the default profile
existed, writing them with ``profile_id = NULL``. Every read filters on
``profile_id``, so those rows are invisible to the whole app: an affected
install shows no categories and never auto-categorises an import.

The seeding order is fixed going forward; this repairs databases already in
that state by adopting orphaned rows into the default profile. A database that
was never affected has nothing to update.

Revision ID: 012_adopt_orphan_profile_rows
Revises: 011_txn_profile_index
Create Date: 2026-08-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "012_adopt_orphan_profile_rows"
down_revision: Union[str, None] = "011_txn_profile_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Only the tables the seeder writes. Other profile-scoped tables are always
# created through the API, which sets profile_id from the request.
_TABLES = ("categories", "category_rules")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "profiles" not in tables:
        return

    # Prefer the default profile; fall back to the lowest id if none is flagged.
    pid = bind.execute(
        sa.text("SELECT id FROM profiles WHERE is_default = 1 ORDER BY id LIMIT 1")
    ).scalar()
    if pid is None:
        pid = bind.execute(sa.text("SELECT id FROM profiles ORDER BY id LIMIT 1")).scalar()
    if pid is None:
        return  # no profiles at all — a fresh DB; the seeder will do the right thing

    for table in _TABLES:
        if table not in tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if "profile_id" not in cols:
            continue
        bind.execute(
            sa.text(f"UPDATE {table} SET profile_id = :pid WHERE profile_id IS NULL"),
            {"pid": pid},
        )


def downgrade() -> None:
    # Not reversible: which rows were orphaned is not recorded, and re-orphaning
    # them would hide the user's categories again.
    pass
