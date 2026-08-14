"""Analytics FX fidelity: flows convert at each transaction's own period (month)
rate, not today's, and a missing rate is surfaced via `fx_incomplete`."""
import pytest
import pytest_asyncio
from datetime import date
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import Account, AccountType, Transaction, ExchangeRate

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def usd_flows(db_session: AsyncSession, seed_data: dict):
    """A USD account (base currency EUR) with one expense in June and one in July,
    plus USD→EUR rates that differ by month, so per-period conversion is visible.
    June rate 0.80, July rate 0.90 → a today-only conversion would use 0.90 for both."""
    profile = seed_data["profile"]
    usd = Account(profile_id=profile.id, name="USD Account", bank_name="US Bank",
                  account_type=AccountType.courant, currency="USD")
    db_session.add(usd)
    await db_session.commit()
    await db_session.refresh(usd)

    db_session.add_all([
        ExchangeRate(base_currency="USD", target_currency="EUR", date=date(2026, 6, 1), rate=0.80),
        ExchangeRate(base_currency="USD", target_currency="EUR", date=date(2026, 7, 1), rate=0.90),
    ])
    cat = seed_data["cat_courses"]
    db_session.add_all([
        Transaction(profile_id=profile.id, account_id=usd.id, date=date(2026, 6, 10),
                    description="June buy", amount_cents=1000, currency="USD", is_debit=True,
                    category_id=cat.id, import_hash="fx_jun"),
        Transaction(profile_id=profile.id, account_id=usd.id, date=date(2026, 7, 10),
                    description="July buy", amount_cents=1000, currency="USD", is_debit=True,
                    category_id=cat.id, import_hash="fx_jul"),
    ])
    await db_session.commit()
    return {"profile": profile, "usd": usd, "cat": cat}


async def test_by_category_uses_period_rate(client: AsyncClient, usd_flows: dict):
    pid = usd_flows["profile"].id
    res = await client.get("/api/analytics/by-category",
                           params={"date_from": "2026-06-01", "date_to": "2026-07-31"},
                           headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 200
    row = {r["category_id"]: r for r in res.json()}[usd_flows["cat"].id]
    # 1000*0.80 + 1000*0.90 = 1700 (a today-only rate would give 1800).
    assert row["total_cents"] == 1700
    assert row["count"] == 2


async def test_cash_flow_uses_period_rate(client: AsyncClient, usd_flows: dict):
    pid = usd_flows["profile"].id
    res = await client.get("/api/analytics/cash-flow",
                           params={"date_from": "2026-06-01", "date_to": "2026-07-31"},
                           headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 200
    by_month = {m["month"]: m for m in res.json()}
    assert by_month["2026-06"]["expenses_cents"] == 800
    assert by_month["2026-07"]["expenses_cents"] == 900


async def test_summary_period_rate_and_fx_complete(client: AsyncClient, usd_flows: dict):
    pid = usd_flows["profile"].id
    res = await client.get("/api/analytics/summary",
                           params={"date_from": "2026-06-01", "date_to": "2026-07-31"},
                           headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 200
    data = res.json()
    assert data["total_expenses_cents"] == 1700
    assert data["fx_incomplete"] is False


async def test_summary_flags_missing_fx(client: AsyncClient, db_session: AsyncSession, seed_data: dict):
    from services import fx as fxmod
    fxmod._mark_pair_failed("GBP", "EUR")  # avoid a network fetch for the missing pair
    profile = seed_data["profile"]
    gbp = Account(profile_id=profile.id, name="GBP Account", bank_name="UK Bank",
                  account_type=AccountType.courant, currency="GBP")
    db_session.add(gbp)
    await db_session.commit()
    await db_session.refresh(gbp)
    db_session.add(Transaction(profile_id=profile.id, account_id=gbp.id, date=date(2026, 7, 5),
                               description="London", amount_cents=5000, currency="GBP",
                               is_debit=True, import_hash="fx_gbp"))
    await db_session.commit()

    res = await client.get("/api/analytics/summary", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert res.json()["fx_incomplete"] is True
