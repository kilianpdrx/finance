"""Initial database schema baseline

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-07-22

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from models import Base

revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind)
