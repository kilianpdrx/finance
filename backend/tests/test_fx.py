import pytest
import pytest_asyncio
from datetime import date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from services.fx import get_rate, convert_cents, backfill_range, refresh_latest
from models import ExchangeRate

pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture
async def fx_data(db_session: AsyncSession):
    # Insert a cached rate
    r = ExchangeRate(
        base_currency="USD",
        target_currency="EUR",
        date=date(2026, 7, 20),
        rate=0.90,
    )
    db_session.add(r)
    await db_session.commit()

async def test_get_rate_same_currency(db_session: AsyncSession):
    rate = await get_rate(db_session, "EUR", "EUR", date.today())
    assert rate == 1.0

async def test_get_rate_cached(db_session: AsyncSession, fx_data):
    # It should find the cached rate 0.90 for date 2026-07-20 or later
    rate = await get_rate(db_session, "USD", "EUR", date(2026, 7, 21))
    assert rate == 0.90

async def test_convert_cents_same_currency(db_session: AsyncSession):
    res = await convert_cents(db_session, 1000, "EUR", "EUR", date.today())
    assert res == 1000

async def test_convert_cents_cached(db_session: AsyncSession, fx_data):
    res = await convert_cents(db_session, 1000, "USD", "EUR", date(2026, 7, 20))
    # 1000 * 0.90 = 900
    assert res == 900

async def test_backfill_same_currency(db_session: AsyncSession):
    res = await backfill_range(db_session, "EUR", "EUR", date(2026, 7, 1), date(2026, 7, 10))
    assert res == 0

async def test_refresh_same_currency(db_session: AsyncSession):
    # This shouldn't crash or insert anything
    await refresh_latest(db_session, ["EUR"], "EUR")
