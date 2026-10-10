"""Monthly budget plan: envelopes per account, and unplanned expenses

Three tables hold an account's plan (envelopes, the categories in each, and the
monthly amount from a given month on), and `transactions.is_unplanned` records
the user's answer to "was this expense unplanned?" — NULL until asked.

Revision ID: 016_budget_plan
Revises: 015_txn_category_source
Create Date: 2026-10-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "016_budget_plan"
down_revision: Union[str, None] = "015_txn_category_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent throughout: init_db()'s create_all already builds all of this
    # on a fresh database.
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "budget_envelopes" not in tables:
        op.create_table(
            "budget_envelopes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("account_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if "budget_envelope_categories" not in tables:
        op.create_table(
            "budget_envelope_categories",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("envelope_id", sa.Integer(), nullable=False),
            sa.Column("category_id", sa.Integer(), nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["envelope_id"], ["budget_envelopes.id"]),
            sa.ForeignKeyConstraint(["category_id"], ["categories.id"]),
            sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("account_id", "category_id", name="uq_envelope_category_per_account"),
        )
    if "budget_envelope_amounts" not in tables:
        op.create_table(
            "budget_envelope_amounts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("envelope_id", sa.Integer(), nullable=False),
            sa.Column("effective_from", sa.String(), nullable=False),
            sa.Column("amount_cents", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["envelope_id"], ["budget_envelopes.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("envelope_id", "effective_from", name="uq_envelope_amount_month"),
        )

    cols = {c["name"] for c in inspector.get_columns("transactions")}
    if "is_unplanned" not in cols:
        with op.batch_alter_table("transactions", schema=None) as batch_op:
            batch_op.add_column(sa.Column("is_unplanned", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_column("is_unplanned")
    op.drop_table("budget_envelope_amounts")
    op.drop_table("budget_envelope_categories")
    op.drop_table("budget_envelopes")
