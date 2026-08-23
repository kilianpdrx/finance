"""Report building blocks and the shared balance helper.

`report.py` produces the XLSX/PDF exports and `balances.py` backs every account
balance shown in the app; neither had tests. These cover the pure logic (money
arithmetic, the planned-vs-actual rule) and the snapshot semantics.
"""
from dataclasses import dataclass
from datetime import date

import pytest

from services.report import _eur, _cell_value, _total_value, _period_label, _summary_rows
from services.balances import account_computed_balance_cents


# ── Money conversion ────────────────────────────────────────────────────────
@pytest.mark.parametrize("cents, expected", [
    (0, 0.0), (None, 0.0), (1, 0.01), (123456, 1234.56), (-500, -5.0),
])
def test_eur_converts_cents(cents, expected):
    assert _eur(cents) == expected


# ── Budget cell arithmetic ──────────────────────────────────────────────────
@dataclass
class _Cell:
    actual_cents: int = 0
    expected_cents: int = 0
    planned_cents: int = 0
    planned_matched: bool = False


def test_cell_value_counts_planned_only_while_it_is_still_a_forecast():
    """A planned amount is shown until a real transaction lands for that month;
    once actuals exist (or the plan is matched) it must stop being added, or the
    month is double-counted."""
    assert _cell_value(_Cell(planned_cents=5000)) == 5000            # forecast stands
    assert _cell_value(_Cell(actual_cents=4800, planned_cents=5000)) == 4800  # superseded
    assert _cell_value(_Cell(planned_cents=5000, planned_matched=True)) == 0  # matched
    assert _cell_value(_Cell(actual_cents=100, expected_cents=50)) == 150


def test_total_value_ignores_planned():
    assert _total_value(_Cell(actual_cents=100, expected_cents=50, planned_cents=999)) == 150


# ── Labels ──────────────────────────────────────────────────────────────────
def test_period_label_variants():
    assert _period_label({"date_from": date(2026, 1, 1), "date_to": date(2026, 3, 31)}) \
        == "01/01/2026 — 31/03/2026"
    assert _period_label({"date_to": date(2026, 3, 31)}) == "jusqu'au 31/03/2026"
    assert _period_label({}) == "toutes périodes"


def test_summary_rows_are_labelled_and_ordered():
    @dataclass
    class _S:
        net_worth_cents: int = 100
        net_worth_excl_loans_cents: int = 200
        total_loans_cents: int = 300
        total_income_cents: int = 400
        total_expenses_cents: int = 500
        net_cash_flow_cents: int = -100

    rows = _summary_rows(_S())
    assert [label for label, _ in rows][0] == "Patrimoine net"
    assert dict(rows)["Flux net (période)"] == -100
    assert len(rows) == 6


# ── Balances ────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_balance_sums_transactions_when_no_snapshot(db_session, seed_data):
    from models import Transaction

    acc = seed_data["account_courant"]
    db_session.add_all([
        Transaction(profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 1, 5),
                    description="in", amount_cents=10000, is_debit=False, import_hash="b1"),
        Transaction(profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 1, 6),
                    description="out", amount_cents=2500, is_debit=True, import_hash="b2"),
    ])
    await db_session.commit()

    assert await account_computed_balance_cents(db_session, acc.id) == 7500


@pytest.mark.asyncio
async def test_snapshot_becomes_the_baseline(db_session, seed_data):
    """A manual snapshot replaces everything before it; only later transactions
    are added. Otherwise importing older history would move today's balance."""
    from models import Transaction, AccountBalanceSnapshot

    acc = seed_data["account_courant"]
    db_session.add_all([
        Transaction(profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 1, 1),
                    description="ancient", amount_cents=999999, is_debit=False, import_hash="b3"),
        AccountBalanceSnapshot(profile_id=seed_data["profile"].id, account_id=acc.id,
                               date=date(2026, 2, 1), amount_cents=50000, currency="EUR"),
        Transaction(profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 2, 10),
                    description="after", amount_cents=1000, is_debit=True, import_hash="b4"),
    ])
    await db_session.commit()

    assert await account_computed_balance_cents(db_session, acc.id) == 49000


@pytest.mark.asyncio
async def test_internal_transfers_do_not_move_the_balance(db_session, seed_data):
    """A transfer between your own accounts is not income or spending."""
    from models import Transaction

    acc = seed_data["account_courant"]
    db_session.add(Transaction(
        profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 3, 1),
        description="virement", amount_cents=30000, is_debit=True,
        is_internal_transfer=True, import_hash="b5"))
    await db_session.commit()

    assert await account_computed_balance_cents(db_session, acc.id) == 0
