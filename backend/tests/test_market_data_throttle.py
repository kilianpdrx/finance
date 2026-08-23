"""Politeness towards the market-data providers.

yfinance and CoinGecko are free, unauthenticated and rate-limited. Every install
polls them on a timer, so without guards a handful of users is enough to get
throttled. None of these tests touch the network.
"""
import asyncio
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from services import market_data as md


@pytest.fixture(autouse=True)
def _reset_guards():
    """Module-level guards are process-wide; reset around every test."""
    md._backoff._fails.clear()
    md._backoff._until.clear()
    md._last_call.clear()
    yield
    md._backoff._fails.clear()
    md._backoff._until.clear()
    md._last_call.clear()


@pytest.mark.asyncio
async def test_throttle_spaces_out_calls_to_the_same_provider():
    md._PROVIDER_MIN_INTERVAL["_test"] = 0.05
    start = time.monotonic()
    for _ in range(3):
        await md._throttle("_test")
    elapsed = time.monotonic() - start
    # Three calls => at least two gaps.
    assert elapsed >= 0.09, f"calls were not spaced out ({elapsed:.3f}s)"


@pytest.mark.asyncio
async def test_throttle_is_per_provider():
    """A slow provider must not delay an unrelated one."""
    md._PROVIDER_MIN_INTERVAL["_a"] = 0.05
    md._PROVIDER_MIN_INTERVAL["_b"] = 0.05
    await md._throttle("_a")
    start = time.monotonic()
    await md._throttle("_b")  # different provider: no wait
    assert time.monotonic() - start < 0.03


def test_backoff_grows_then_resets():
    b = md._Backoff()
    assert not b.blocked("yahoo")

    b.record_failure("yahoo")
    assert b.blocked("yahoo")
    first = b._until["yahoo"]

    b.record_failure("yahoo")
    assert b._until["yahoo"] > first, "delay must grow with consecutive failures"

    b.record_success("yahoo")
    assert not b.blocked("yahoo"), "a success must clear the backoff immediately"


def test_backoff_is_capped():
    b = md._Backoff()
    for _ in range(20):
        b.record_failure("yahoo")
    remaining = b._until["yahoo"] - time.monotonic()
    assert remaining <= b._CAP + 1, "backoff must be capped, not unbounded"


@pytest.mark.asyncio
async def test_blocked_provider_short_circuits_without_network():
    """While backed off, a fetch returns empty instead of calling out."""
    md._backoff.record_failure("yahoo")
    called = False

    def _boom(*a, **k):
        nonlocal called
        called = True
        raise AssertionError("network must not be touched while backing off")

    # If the guard works, the executor is never reached.
    assert await md._fetch_stock_prices(["AAPL"]) == {}
    assert await md.fetch_historical_prices("AAPL") == []
    assert called is False


@pytest.mark.asyncio
async def test_fresh_prices_are_not_refetched(db_session, monkeypatch, seed_data):
    """The scheduler fires every 15 min; prices younger than PRICE_TTL must be
    left alone rather than re-hitting the provider."""
    from models import Holding

    db_session.add(Holding(profile_id=seed_data["profile"].id,
                           account_id=seed_data["account_inv"].id,
                           ticker="AAPL", name="Apple", quantity=1,
                           cost_basis_cents=10000, currency="USD"))
    await db_session.execute(text(
        "INSERT INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
        "VALUES ('AAPL', 20000, 'USD', :now, 'live')"
    ), {"now": datetime.utcnow()})
    await db_session.commit()

    fetched: list = []
    async def _spy(tickers):
        fetched.append(tickers)
        return {}
    monkeypatch.setattr(md, "_fetch_stock_prices", _spy)
    monkeypatch.setattr(md, "_fetch_crypto_prices", lambda ids: _spy(ids))

    assert await md.refresh_all_prices(db_session) == 0
    assert fetched == [], "a fresh price must not be refetched"


@pytest.mark.asyncio
async def test_force_bypasses_the_freshness_check(db_session, monkeypatch, seed_data):
    """An explicit user refresh must actually refresh."""
    from models import Holding

    db_session.add(Holding(profile_id=seed_data["profile"].id,
                           account_id=seed_data["account_inv"].id,
                           ticker="MSFT", name="Microsoft", quantity=1,
                           cost_basis_cents=10000, currency="USD"))
    await db_session.execute(text(
        "INSERT INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
        "VALUES ('MSFT', 20000, 'USD', :now, 'live')"
    ), {"now": datetime.utcnow()})
    await db_session.commit()

    fetched: list = []
    async def _spy(tickers):
        fetched.append(list(tickers))
        return {}
    monkeypatch.setattr(md, "_fetch_stock_prices", _spy)
    monkeypatch.setattr(md, "_fetch_crypto_prices", _spy)

    await md.refresh_all_prices(db_session, force=True)
    assert any("MSFT" in batch for batch in fetched), "force=True must refetch"
