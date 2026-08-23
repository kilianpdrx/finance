"""Add Goals and LoanDetails

Revision ID: 4fe6cd19e27f
Revises: 002_add_enabled_modules
Create Date: 2026-07-23 21:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4fe6cd19e27f'
down_revision: Union[str, None] = '002_add_enabled_modules'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all may already have created these tables.
    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'goals' not in existing_tables:
        _create_goals()
    if 'loan_details' not in existing_tables:
        _create_loan_details()


def _create_goals() -> None:
    op.create_table('goals',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('profile_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('target_amount_cents', sa.Integer(), nullable=False),
    sa.Column('current_amount_cents', sa.Integer(), nullable=True),
    sa.Column('deadline', sa.Date(), nullable=True),
    sa.Column('color', sa.String(), nullable=True),
    sa.Column('icon', sa.String(), nullable=True),
    sa.Column('linked_account_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['linked_account_id'], ['accounts.id'], ),
    sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], ),
    sa.PrimaryKeyConstraint('id')
    )


def _create_loan_details() -> None:
    op.create_table('loan_details',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('account_id', sa.Integer(), nullable=False),
    sa.Column('interest_rate_pct', sa.Float(), nullable=True),
    sa.Column('monthly_payment_cents', sa.Integer(), nullable=True),
    sa.Column('term_months', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id')
    )

def downgrade() -> None:
    op.drop_table('loan_details')
    op.drop_table('goals')
