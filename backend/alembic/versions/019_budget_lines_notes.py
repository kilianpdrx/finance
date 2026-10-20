"""Budget plan: sub-lines that are not categories, and notes

`budget_envelope_lines` holds an envelope's sub-lines (« Épargne », « Actions »):
a name and a planned amount, nothing realised. `budget_envelopes.note` and
`budget_plans.note` are what the user writes about an envelope and about the
account's plan as a whole.

Revision ID: 019_budget_lines_notes
Revises: 018_holding_binance
Create Date: 2026-10-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "019_budget_lines_notes"
down_revision: Union[str, None] = "018_holding_binance"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent throughout: init_db()'s create_all already builds all of this
    # on a fresh database.
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "budget_envelope_lines" not in tables:
        op.create_table(
            "budget_envelope_lines",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("envelope_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("amount_cents", sa.Integer(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["envelope_id"], ["budget_envelopes.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if "budget_plans" not in tables:
        op.create_table(
            "budget_plans",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("account_id", sa.Integer(), nullable=False),
            sa.Column("note", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("account_id", name="uq_budget_plan_account"),
        )

    cols = {c["name"] for c in inspector.get_columns("budget_envelopes")}
    if "note" not in cols:
        with op.batch_alter_table("budget_envelopes", schema=None) as batch_op:
            batch_op.add_column(sa.Column("note", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("budget_envelopes", schema=None) as batch_op:
        batch_op.drop_column("note")
    op.drop_table("budget_plans")
    op.drop_table("budget_envelope_lines")
