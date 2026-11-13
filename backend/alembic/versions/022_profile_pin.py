"""An optional PIN per profile

`profiles.pin_hash`: a salted scrypt hash of the profile's PIN (NULL: no PIN,
the profile opens as before). `pin_failed_attempts` / `pin_locked_until` count
the wrong PINs in a row and hold the wait they earned, in the database so that
restarting the server does not hand out fresh attempts.

Revision ID: 022_profile_pin
Revises: 021_plan_start_import_account
Create Date: 2026-11-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "022_profile_pin"
down_revision: Union[str, None] = "021_plan_start_import_account"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("pin_hash", sa.String()),
    ("pin_failed_attempts", sa.Integer()),
    ("pin_locked_until", sa.DateTime()),
)


def upgrade() -> None:
    # Idempotent: init_db()'s create_all may already have added the columns.
    inspector = sa.inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns("profiles")}
    missing = [(name, type_) for name, type_ in _COLUMNS if name not in existing]
    if missing:
        with op.batch_alter_table("profiles", schema=None) as batch_op:
            for name, type_ in missing:
                batch_op.add_column(sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("profiles", schema=None) as batch_op:
        for name, _ in reversed(_COLUMNS):
            batch_op.drop_column(name)
