"""A budget plan's start month, and the account a bank profile last imported into

`budget_plans.start_month`: the plan is in force from that month (NULL: from
its first amount). `bank_profiles.last_account_id`: the import preview opens on
the account this bank's files went to last time, so account-bound rules and the
duplicate check run against the right account from the start.

Revision ID: 021_plan_start_import_account
Revises: 020_payroll
Create Date: 2026-11-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "021_plan_start_import_account"
down_revision: Union[str, None] = "020_payroll"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all may already have added the columns.
    inspector = sa.inspect(op.get_bind())
    if "start_month" not in {c["name"] for c in inspector.get_columns("budget_plans")}:
        with op.batch_alter_table("budget_plans", schema=None) as batch_op:
            batch_op.add_column(sa.Column("start_month", sa.String(), nullable=True))
    if "last_account_id" not in {c["name"] for c in inspector.get_columns("bank_profiles")}:
        with op.batch_alter_table("bank_profiles", schema=None) as batch_op:
            batch_op.add_column(sa.Column("last_account_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bank_profiles", schema=None) as batch_op:
        batch_op.drop_column("last_account_id")
    with op.batch_alter_table("budget_plans", schema=None) as batch_op:
        batch_op.drop_column("start_month")
