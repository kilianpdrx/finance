"""Enable the goals & loans modules for existing profiles

Revision ID: 006_goals_loans_modules
Revises: 005_goals_loans
Create Date: 2026-07-26

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006_goals_loans_modules"
down_revision: Union[str, None] = "005_goals_loans"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_MODULES = ("goals", "loans")


def upgrade() -> None:
    # Idempotent: append the new modules to each profile that doesn't have them,
    # so profiles that predate these features keep seeing the tabs.
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, enabled_modules FROM profiles")).fetchall()
    for pid, mods in rows:
        try:
            arr = json.loads(mods) if mods else []
        except (TypeError, ValueError):
            arr = []
        if not isinstance(arr, list):
            arr = []
        changed = False
        for m in _NEW_MODULES:
            if m not in arr:
                arr.append(m)
                changed = True
        if changed:
            bind.execute(
                sa.text("UPDATE profiles SET enabled_modules = :m WHERE id = :id"),
                {"m": json.dumps(arr), "id": pid},
            )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, enabled_modules FROM profiles")).fetchall()
    for pid, mods in rows:
        try:
            arr = json.loads(mods) if mods else []
        except (TypeError, ValueError):
            arr = []
        arr = [m for m in arr if m not in _NEW_MODULES]
        bind.execute(
            sa.text("UPDATE profiles SET enabled_modules = :m WHERE id = :id"),
            {"m": json.dumps(arr), "id": pid},
        )
