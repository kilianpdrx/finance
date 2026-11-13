import pytest
import pytest_asyncio
from datetime import date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from services import fx as fxmod
from services.fx import get_rate, convert_cents, convert_cents_checked, backfill_range, refresh_latest
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

async def test_convert_cents_checked_ok(db_session: AsyncSession, fx_data):
    cents, ok = await convert_cents_checked(db_session, 1000, "USD", "EUR", date(2026, 7, 20))
    assert (cents, ok) == (900, True)


async def test_convert_cents_checked_same_currency(db_session: AsyncSession):
    cents, ok = await convert_cents_checked(db_session, 1000, "EUR", "EUR", date.today())
    assert (cents, ok) == (1000, True)


async def test_convert_cents_checked_missing_rate(db_session: AsyncSession):
    # Pre-mark the pair failed so no network call is made; a missing rate returns
    # the amount unconverted with ok=False (drives fx_incomplete).
    fxmod._mark_pair_failed("GBP", "EUR")
    cents, ok = await convert_cents_checked(db_session, 1000, "GBP", "EUR", date(2026, 7, 20))
    assert cents == 1000 and ok is False


async def test_backfill_same_currency(db_session: AsyncSession):
    res = await backfill_range(db_session, "EUR", "EUR", date(2026, 7, 1), date(2026, 7, 10))
    assert res == 0

async def test_refresh_same_currency(db_session: AsyncSession):
    # This shouldn't crash or insert anything
    await refresh_latest(db_session, ["EUR"], "EUR")


async def test_rate_cache_matches_uncached_and_queries_once(db_session: AsyncSession, fx_data, monkeypatch):
    """RateCache must return identical values to the plain path, but hit get_rate
    once per distinct (pair, date) — analytics repeats the same bucket many times."""
    from services.fx import RateCache
    import services.fx as fxmod

    calls: list[tuple] = []
    real = fxmod.get_rate

    async def counting(db, base, target, on_date):
        calls.append((base, target, on_date))
        return await real(db, base, target, on_date)

    monkeypatch.setattr(fxmod, "get_rate", counting)

    cache = RateCache()
    d = date(2026, 7, 20)
    results = [await cache.convert(db_session, 1000, "USD", "EUR", d) for _ in range(5)]

    assert results == [900] * 5                       # same as convert_cents
    assert len(calls) == 1                            # ...but one lookup
    # A different date is a different bucket.
    await cache.convert(db_session, 1000, "USD", "EUR", date(2026, 7, 21))
    assert len(calls) == 2


async def test_rate_cache_same_currency_never_queries(db_session: AsyncSession):
    from services.fx import RateCache
    cents, ok = await RateCache().convert_checked(db_session, 500, "EUR", "EUR", date.today())
    assert (cents, ok) == (500, True)


async def test_two_requests_fetching_the_same_rate_do_not_break(db_session: AsyncSession, monkeypatch):
    """Analytics fire several requests at once: both miss the cache, both fetch the
    same rate, and the second plain INSERT broke on the unique constraint — leaving
    its session rolled back, so the request answered 500. The insert ignores a row
    already there, and the session goes on."""
    day = date(2026, 11, 9)

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"rates": {"EUR": 1.0912}}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, params=None):
            # Meanwhile, the other request stored the very same rate.
            db_session.add(ExchangeRate(base_currency="GBP", target_currency="EUR", date=day, rate=1.0912))
            await db_session.commit()
            return Response()

    fxmod._fail_cache.clear()
    monkeypatch.setattr(fxmod.httpx, "AsyncClient", lambda **kw: Client())
    assert await get_rate(db_session, "GBP", "EUR", day) == 1.0912
    assert await get_rate(db_session, "GBP", "EUR", day) == 1.0912        # the session still works


# ── A rate fetched but not stored (v1.11.0) ─────────────────────────────────

class _Frankfurter:
    """Stands in for httpx.AsyncClient: answers one date, or a range, with a rate."""
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None):
        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                if ".." in url:
                    return {"rates": {"2021-10-29": {"EUR": 0.94}, "2021-11-30": {"EUR": 0.96}}}
                return {"rates": {"EUR": 0.94}}
        return Response()


class _LockedForWrites:
    """The request's session while another writer holds the database: reads work,
    writes fail with « database is locked » (the desktop app at startup)."""
    def __init__(self, session):
        self._session = session

    async def execute(self, statement, *a, **k):
        if str(statement).lstrip().upper().startswith("INSERT"):
            from sqlalchemy.exc import OperationalError
            raise OperationalError(str(statement), {}, Exception("database is locked"))
        return await self._session.execute(statement, *a, **k)

    async def commit(self):
        await self._session.commit()


async def test_a_rate_fetched_but_not_stored_is_still_used_and_blocks_nothing(db_session: AsyncSession, monkeypatch):
    """« database is locked » on the INSERT used to mark CHF→EUR unreachable for five
    minutes: every other month of the request came back without a rate."""
    monkeypatch.setattr(fxmod.httpx, "AsyncClient", _Frankfurter)
    monkeypatch.setattr(fxmod, "_fail_cache", {})
    locked = _LockedForWrites(db_session)
    assert await get_rate(locked, "CHF", "EUR", date(2021, 10, 31)) == 0.94
    assert not fxmod._is_pair_failed("CHF", "EUR")
    assert await backfill_range(locked, "CHF", "EUR", date(2021, 10, 1), date(2021, 11, 30)) == 0   # nothing stored…
    assert not fxmod._is_pair_failed("CHF", "EUR")                                                  # …nothing blocked
    # Once the database is free, the same range is stored.
    assert await backfill_range(db_session, "CHF", "EUR", date(2021, 10, 1), date(2021, 11, 30)) == 2
    assert await get_rate(db_session, "CHF", "EUR", date(2021, 11, 30)) == 0.96


async def test_a_network_failure_still_marks_the_pair(db_session: AsyncSession, monkeypatch):
    class Down(_Frankfurter):
        async def get(self, url, params=None):
            raise fxmod.httpx.ConnectError("offline")
    monkeypatch.setattr(fxmod.httpx, "AsyncClient", Down)
    monkeypatch.setattr(fxmod, "_fail_cache", {})
    assert await get_rate(db_session, "CHF", "EUR", date(2021, 10, 31)) is None
    assert fxmod._is_pair_failed("CHF", "EUR")
