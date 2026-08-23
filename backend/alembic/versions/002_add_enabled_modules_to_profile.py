"""Add enabled_modules to Profile model

Revision ID: 002_add_enabled_modules
Revises: 001_initial_schema
Create Date: 2026-07-23

"""
import json
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002_add_enabled_modules'
down_revision = '001_initial_schema'
branch_labels = None
depends_on = None

DEFAULT_MODULES_JSON = json.dumps(["banking", "budgeting", "investments"])


def upgrade() -> None:
    # Idempotent: init_db()'s create_all may already have added this column.
    bind = op.get_bind()
    existing_cols = {c["name"] for c in sa.inspect(bind).get_columns("profiles")}
    if "enabled_modules" in existing_cols:
        return
    with op.batch_alter_table('profiles', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('enabled_modules', sa.JSON(), nullable=True, server_default=DEFAULT_MODULES_JSON)
        )


def downgrade() -> None:
    with op.batch_alter_table('profiles', schema=None) as batch_op:
        batch_op.drop_column('enabled_modules')
