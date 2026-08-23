"""Goals contributions ledger + loan amortization fields & extra payments

Revision ID: 005_goals_loans
Revises: 4fe6cd19e27f
Create Date: 2026-07-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "005_goals_loans"
down_revision: Union[str, None] = "4fe6cd19e27f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # All idempotent: init_db()'s create_all may already have built these.
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    loan_cols = {c["name"] for c in insp.get_columns("loan_details")} if "loan_details" in tables else set()
    if "loan_details" in tables:
        with op.batch_alter_table("loan_details") as batch:
            if "principal_cents" not in loan_cols:
                batch.add_column(sa.Column("principal_cents", sa.Integer(), nullable=True))
            if "start_date" not in loan_cols:
                batch.add_column(sa.Column("start_date", sa.Date(), nullable=True))

    if "goal_contributions" not in tables:
        op.create_table(
            "goal_contributions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("goal_id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("amount_cents", sa.Integer(), nullable=False),
            sa.Column("note", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["goal_id"], ["goals.id"]),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "loan_extra_payments" not in tables:
        op.create_table(
            "loan_extra_payments",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("amount_cents", sa.Integer(), nullable=False),
            sa.Column("note", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    op.drop_table("loan_extra_payments")
    op.drop_table("goal_contributions")
    with op.batch_alter_table("loan_details") as batch:
        batch.drop_column("start_date")
        batch.drop_column("principal_cents")
