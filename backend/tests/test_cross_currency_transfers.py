"""Cross-currency internal transfers.

Moving money between your own EUR and CHF accounts never matches on cents: the
bank applies its own rate and spread. Without conversion the pair is missed and
the move is counted as both an expense AND income, inflating each side.
"""
from datetime import date

import pytest
from sqlalchemy import select

from models import Account, AccountType, ExchangeRate, Transaction
from services.transfer_detector import detect_internal_transfers


@pytest.fixture
async def two_currency_accounts(db_session, seed_data):
    pid = seed_data["profile"].id
    eur = seed_data["account_courant"]        # EUR
    chf = Account(profile_id=pid, name="UBS", bank_name="UBS",
                  account_type=AccountType.courant, currency="CHF")
    db_session.add(chf)
    # 1 EUR = 0.95 CHF on the transfer date.
    db_session.add(ExchangeRate(base_currency="EUR", target_currency="CHF",
                                date=date(2026, 6, 1), rate=0.95))
    await db_session.commit()
    await db_session.refresh(chf)
    return {"pid": pid, "eur": eur, "chf": chf}


async def _pair(db, acc):
    return (await db.execute(select(Transaction).where(Transaction.account_id == acc.id))).scalars().all()


@pytest.mark.asyncio
async def test_cross_currency_transfer_is_detected(db_session, two_currency_accounts):
    d = two_currency_accounts
    # 1000.00 EUR leaves; 950.00 CHF arrives. Same money, different numbers.
    db_session.add_all([
        Transaction(profile_id=d["pid"], account_id=d["eur"].id, date=date(2026, 6, 10),
                    description="VIREMENT VERS UBS", amount_cents=100000, currency="EUR",
                    is_debit=True, import_hash="xc1"),
        Transaction(profile_id=d["pid"], account_id=d["chf"].id, date=date(2026, 6, 11),
                    description="VIREMENT RECU", amount_cents=95000, currency="CHF",
                    is_debit=False, import_hash="xc2"),
    ])
    await db_session.commit()

    assert await detect_internal_transfers(db_session, d["pid"]) == 1

    for acc in (d["eur"], d["chf"]):
        for t in await _pair(db_session, acc):
            assert t.is_internal_transfer is True
            # Matched pairs lose their category so they can't pollute budgets.
            assert t.category_id is None


@pytest.mark.asyncio
async def test_small_fx_spread_is_tolerated(db_session, two_currency_accounts):
    """The bank's rate differs slightly from the reference one."""
    d = two_currency_accounts
    db_session.add_all([
        Transaction(profile_id=d["pid"], account_id=d["eur"].id, date=date(2026, 6, 10),
                    description="VIREMENT VERS UBS", amount_cents=100000, currency="EUR",
                    is_debit=True, import_hash="xc3"),
        Transaction(profile_id=d["pid"], account_id=d["chf"].id, date=date(2026, 6, 10),
                    description="VIREMENT RECU", amount_cents=94200, currency="CHF",
                    is_debit=False, import_hash="xc4"),  # ~0.8% off
    ])
    await db_session.commit()
    assert await detect_internal_transfers(db_session, d["pid"]) == 1


@pytest.mark.asyncio
async def test_amount_far_off_is_not_a_transfer(db_session, two_currency_accounts):
    d = two_currency_accounts
    db_session.add_all([
        Transaction(profile_id=d["pid"], account_id=d["eur"].id, date=date(2026, 6, 10),
                    description="VIREMENT VERS UBS", amount_cents=100000, currency="EUR",
                    is_debit=True, import_hash="xc5"),
        Transaction(profile_id=d["pid"], account_id=d["chf"].id, date=date(2026, 6, 10),
                    description="VIREMENT RECU", amount_cents=50000, currency="CHF",
                    is_debit=False, import_hash="xc6"),  # nowhere near
    ])
    await db_session.commit()
    assert await detect_internal_transfers(db_session, d["pid"]) == 0


@pytest.mark.asyncio
async def test_cross_currency_requires_a_description_signal(db_session, two_currency_accounts):
    """Same-currency pairs may be accepted when unambiguous, but a cross-currency
    amount only matches approximately — accepting it on that alone would wipe out
    real income by mislabelling it a transfer."""
    d = two_currency_accounts
    db_session.add_all([
        Transaction(profile_id=d["pid"], account_id=d["eur"].id, date=date(2026, 6, 10),
                    description="ACHAT DIVERS", amount_cents=100000, currency="EUR",
                    is_debit=True, import_hash="xc7"),
        Transaction(profile_id=d["pid"], account_id=d["chf"].id, date=date(2026, 6, 10),
                    description="PAIEMENT CLIENT", amount_cents=95000, currency="CHF",
                    is_debit=False, import_hash="xc8"),
    ])
    await db_session.commit()
    assert await detect_internal_transfers(db_session, d["pid"]) == 0


@pytest.mark.asyncio
async def test_same_currency_behaviour_is_unchanged(db_session, seed_data):
    """The existing exact-cents path must keep working."""
    pid = seed_data["profile"].id
    a = seed_data["account_courant"]
    b = Account(profile_id=pid, name="Livret", bank_name="B",
                account_type=AccountType.epargne, currency="EUR")
    db_session.add(b)
    await db_session.commit()
    await db_session.refresh(b)

    db_session.add_all([
        Transaction(profile_id=pid, account_id=a.id, date=date(2026, 5, 1),
                    description="VIREMENT EPARGNE", amount_cents=25000, currency="EUR",
                    is_debit=True, import_hash="sc1"),
        Transaction(profile_id=pid, account_id=b.id, date=date(2026, 5, 1),
                    description="VIREMENT RECU", amount_cents=25000, currency="EUR",
                    is_debit=False, import_hash="sc2"),
    ])
    await db_session.commit()
    assert await detect_internal_transfers(db_session, pid) == 1
