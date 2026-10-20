"""Holdings synced from Binance; a cost can be unknown

`holdings.sync_source` marks the positions the Binance sync keeps up to date
(and prices from Binance). `holdings.cost_basis_cents` becomes nullable: Binance
gives no purchase price, and storing 0 instead showed the whole value as gain.

Revision ID: 018_holding_binance
Revises: 017_envelope_category_amount
Create Date: 2026-10-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "018_holding_binance"
down_revision: Union[str, None] = "017_envelope_category_amount"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: init_db()'s create_all already builds both on a fresh database.
    cols = {c["name"]: c for c in sa.inspect(op.get_bind()).get_columns("holdings")}
    add_source = "sync_source" not in cols
    relax_cost = not cols["cost_basis_cents"]["nullable"]
    if not (add_source or relax_cost):
        return
    # SQLite cannot change a column's nullability in place: batch mode rebuilds
    # the table, keeping its rows and its (account_id, ticker) constraint.
    with op.batch_alter_table("holdings", schema=None) as batch_op:
        if add_source:
            batch_op.add_column(sa.Column("sync_source", sa.String(), nullable=True))
        if relax_cost:
            batch_op.alter_column("cost_basis_cents", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("holdings", schema=None) as batch_op:
        batch_op.drop_column("sync_source")
