"""Uninvested cash in an investment account is part of net worth.

A holdings account's value supersedes its balance (to avoid double-counting), so
loose cash used to vanish entirely. Cash is modelled as a holding priced at one
unit of its own currency — which means it must never be sent to a price provider,
and must carry into every total.
"""
from datetime import date

from sqlalchemy import select

from models import ExchangeRate, Holding
from routers.investments import (
    CASH_ASSET_TYPE, CASH_UNIT_PRICE_CENTS, _normalize_cash_holding, cash_ticker,
)


async def _add_cash(client, account_id: int, profile_id: int, amount: float,
                    currency: str = "EUR"):
    return await client.post(
        f"/api/investments/accounts/{account_id}/holdings",
        headers={"X-Profile-Id": str(profile_id)},
        json={
            "ticker": "ignored", "name": "", "quantity": amount,
            "cost_basis_cents": 0, "currency": currency,
            "asset_type": CASH_ASSET_TYPE,
        },
    )


async def test_cash_is_worth_its_amount(client, seed_data):
    profile, acc = seed_data["profile"], seed_data["account_inv"]

    res = await _add_cash(client, acc.id, profile.id, 1234.56)
    assert res.status_code == 200
    body = res.json()

    assert body["current_value_cents"] == 123456
    assert body["current_price_cents"] == CASH_UNIT_PRICE_CENTS
    assert body["price_status"] == "cash"
    # Cost basis tracks the amount, so cash never shows a phantom gain.
    assert body["gain_cents"] == 0


async def test_cash_ticker_and_name_are_derived_not_accepted(client, seed_data):
    """A cash row must not be editable into something the refresh would quote."""
    profile, acc = seed_data["profile"], seed_data["account_inv"]

    body = (await _add_cash(client, acc.id, profile.id, 100.0, "USD")).json()
    assert body["ticker"] == cash_ticker("USD") == "CASH.USD"
    assert body["name"] == "Liquidités"
    assert body["price_locked"] is True
    assert body["isin"] is None


async def test_one_cash_line_per_currency(client, seed_data):
    """The (account_id, ticker) unique constraint gives a multi-currency broker
    account one cash line per currency rather than one in total."""
    profile, acc = seed_data["profile"], seed_data["account_inv"]

    assert (await _add_cash(client, acc.id, profile.id, 500.0, "EUR")).status_code == 200
    assert (await _add_cash(client, acc.id, profile.id, 300.0, "USD")).status_code == 200

    res = await client.get(f"/api/investments/accounts/{acc.id}/holdings",
                           headers={"X-Profile-Id": str(profile.id)})
    tickers = sorted(h["ticker"] for h in res.json())
    assert tickers == ["CASH.EUR", "CASH.USD"]


async def test_foreign_cash_converts_into_the_account_currency(
    client, db_session, seed_data
):
    profile, acc = seed_data["profile"], seed_data["account_inv"]
    acc_ccy = acc.currency or "EUR"
    # Pre-seed the rate so the conversion never touches the network.
    db_session.add(ExchangeRate(base_currency="USD", target_currency=acc_ccy,
                                date=date.today(), rate=0.5))
    await db_session.commit()

    body = (await _add_cash(client, acc.id, profile.id, 200.0, "USD")).json()

    assert body["current_value_cents"] == 20000        # native USD
    assert body["value_in_account_ccy_cents"] == 10000  # halved by the rate


async def test_performance_chart_never_quotes_cash(client, seed_data, monkeypatch):
    """The whole point of pinning the price: a `CASH.*` symbol does not exist, so
    any provider call is both wasted and a guaranteed 404."""
    import routers.investments as inv

    asked: list[str] = []

    async def fake_history(ticker: str, period: str = "1y"):
        asked.append(ticker)
        return []

    monkeypatch.setattr(inv, "fetch_historical_prices", fake_history)

    profile, acc = seed_data["profile"], seed_data["account_inv"]
    await _add_cash(client, acc.id, profile.id, 750.0)

    res = await client.get(f"/api/investments/accounts/{acc.id}/performance",
                           headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert asked == [], f"cash was sent to the provider: {asked}"


async def test_cash_is_excluded_from_the_history_warm_up(db_session, seed_data, monkeypatch):
    """`warm_history_cache` builds its ticker list from unlocked holdings."""
    import services.market_data as md

    profile, acc = seed_data["profile"], seed_data["account_inv"]
    h = Holding(profile_id=profile.id, account_id=acc.id, ticker="x", name="",
                quantity=100.0, cost_basis_cents=0, currency="EUR",
                asset_type=CASH_ASSET_TYPE)
    _normalize_cash_holding(h)
    db_session.add(h)
    await db_session.commit()

    warmed: list[str] = []

    async def fake_history(ticker: str, period: str = "1y"):
        warmed.append(ticker)
        return []

    monkeypatch.setattr(md, "fetch_historical_prices", fake_history)
    await md.warm_history_cache(db_session)

    assert "CASH.EUR" not in warmed


async def test_cash_appears_in_the_account_total_and_allocation(client, seed_data):
    profile, acc = seed_data["profile"], seed_data["account_inv"]
    await _add_cash(client, acc.id, profile.id, 1000.0)

    res = await client.get("/api/investments/accounts",
                           headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    row = next(a for a in res.json() if a["id"] == acc.id)

    assert row["holdings_value_cents"] == 100000
    assert row["allocation_by_type"][CASH_ASSET_TYPE] == 100000


async def test_monthly_values_carry_the_cash_constant(db_session, seed_data, monkeypatch):
    """Without this the net-worth-over-time chart understates the account by
    exactly its cash balance."""
    import routers.investments as inv

    profile, acc = seed_data["profile"], seed_data["account_inv"]
    acc_ccy = acc.currency or "EUR"

    stock = Holding(profile_id=profile.id, account_id=acc.id, ticker="AI.PA",
                    name="Air Liquide", quantity=2, cost_basis_cents=30000,
                    currency=acc_ccy, asset_type="stock")
    cash = Holding(profile_id=profile.id, account_id=acc.id, ticker="x", name="",
                   quantity=400.0, cost_basis_cents=0, currency=acc_ccy,
                   asset_type=CASH_ASSET_TYPE)
    _normalize_cash_holding(cash)
    db_session.add_all([stock, cash])
    await db_session.commit()

    async def fake_history(ticker: str, period: str = "1y"):
        return [{"date": "2026-07-31", "close": 100.0},
                {"date": "2026-08-18", "close": 150.0}]

    monkeypatch.setattr(inv, "fetch_historical_prices", fake_history)
    series = await inv._holdings_monthly_values(db_session, acc.id, acc_ccy)

    by_month = {s["month"]: s["amount_cents"] for s in series}
    # 2 shares × 100.00 = 200.00, plus 400.00 of cash.
    assert by_month["2026-07"] == 20000 + 40000
    assert by_month["2026-08"] == 30000 + 40000


async def test_cash_only_account_still_charts(db_session, seed_data):
    """No price history exists to build months from, but the account is not worth
    nothing — it starts at the current month."""
    import routers.investments as inv

    profile, acc = seed_data["profile"], seed_data["account_inv"]
    h = Holding(profile_id=profile.id, account_id=acc.id, ticker="x", name="",
                quantity=250.0, cost_basis_cents=0, currency=acc.currency or "EUR",
                asset_type=CASH_ASSET_TYPE)
    _normalize_cash_holding(h)
    db_session.add(h)
    await db_session.commit()

    series = await inv._holdings_monthly_values(db_session, acc.id, acc.currency or "EUR")

    assert series == [{"month": date.today().strftime("%Y-%m"), "amount_cents": 25000}]


async def test_editing_the_amount_keeps_cost_basis_in_step(client, db_session, seed_data):
    profile, acc = seed_data["profile"], seed_data["account_inv"]
    hid = (await _add_cash(client, acc.id, profile.id, 100.0)).json()["id"]

    res = await client.put(f"/api/investments/holdings/{hid}",
                           headers={"X-Profile-Id": str(profile.id)},
                           json={"quantity": 250.0})
    assert res.status_code == 200
    assert res.json()["current_value_cents"] == 25000
    assert res.json()["gain_cents"] == 0

    row = (await db_session.execute(select(Holding).where(Holding.id == hid))).scalar_one()
    await db_session.refresh(row)
    assert row.cost_basis_cents == 25000
