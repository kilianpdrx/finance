"""Locked holdings must not be sent to the price provider, and the app's logging
must survive startup.

Both bugs were found from a real diagnostics export: a retired Yahoo fund symbol
(`0P0001NJ59.F`) was queried on every chart load even though the holding was
price-locked, and the log file stopped recording ~100 ms into every run.
"""
import logging
from datetime import date
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Holding

# asyncio_mode=auto — the module mixes async and sync tests, so no module-level mark.


@pytest_asyncio.fixture
async def locked_and_live(db_session: AsyncSession, seed_data: dict) -> dict:
    """One auto-priced holding and one price-locked fund, in the same account."""
    profile, acc = seed_data["profile"], seed_data["account_inv"]
    live = Holding(
        profile_id=profile.id, account_id=acc.id, ticker="AI.PA", name="Air Liquide",
        quantity=5, cost_basis_cents=80000, currency="EUR", asset_type="stock",
    )
    locked = Holding(
        profile_id=profile.id, account_id=acc.id, ticker="0P0001NJ59.F",
        name="PEA Profile Offensif", quantity=9.98, cost_basis_cents=140000,
        currency="EUR", asset_type="fund", price_locked=True, ref_price_cents=14709,
        ref_price_date=date(2026, 6, 25),
    )
    db_session.add_all([live, locked])
    await db_session.commit()
    return {"profile": profile, "account": acc, "live": live, "locked": locked}


async def test_account_performance_never_quotes_a_locked_holding(
    client: AsyncClient, locked_and_live: dict, monkeypatch
):
    """A locked holding is manual-priced, so asking the provider for its history
    is pure cost: the symbol may not exist any more (404 on every chart load) and
    the empty result is discarded regardless."""
    import routers.investments as inv

    asked: list[str] = []

    async def fake_history(ticker: str, period: str = "1y"):
        asked.append(ticker)
        return [{"date": "2026-08-17", "close": 100.0}, {"date": "2026-08-18", "close": 110.0}]

    monkeypatch.setattr(inv, "fetch_historical_prices", fake_history)

    acc, profile = locked_and_live["account"], locked_and_live["profile"]
    res = await client.get(
        f"/api/investments/accounts/{acc.id}/performance?period=1mo",
        headers={"X-Profile-Id": str(profile.id)},
    )
    assert res.status_code == 200
    assert asked == ["AI.PA"], f"locked holding was quoted: {asked}"


async def test_warm_history_cache_skips_locked_but_keeps_null(
    db_session: AsyncSession, seed_data: dict, monkeypatch
):
    """`price_locked` defaults are applied by the ORM, not the database, so a row
    written outside it can hold NULL. Filtering with SQL `!= True` would drop
    those rows — a real holding silently losing its history."""
    import services.market_data as md

    profile, acc = seed_data["profile"], seed_data["account_inv"]
    db_session.add(Holding(
        profile_id=profile.id, account_id=acc.id, ticker="LOCKED.F", name="Fund",
        quantity=1, cost_basis_cents=1000, currency="EUR", asset_type="fund",
        price_locked=True,
    ))
    await db_session.commit()
    # A pre-ORM-default row: price_locked left NULL.
    await db_session.execute(text(
        "INSERT INTO holdings (profile_id, account_id, ticker, name, quantity,"
        " cost_basis_cents, currency, asset_type, price_locked)"
        " VALUES (:p, :a, 'NULLLOCK.PA', 'Legacy', 1, 1000, 'EUR', 'stock', NULL)"
    ), {"p": profile.id, "a": acc.id})
    await db_session.commit()

    warmed: list[str] = []

    async def fake_history(ticker: str, period: str = "1y"):
        warmed.append(ticker)
        return []

    monkeypatch.setattr(md, "fetch_historical_prices", fake_history)
    await md.warm_history_cache(db_session)

    assert "LOCKED.F" not in warmed
    assert "NULLLOCK.PA" in warmed, "a NULL price_locked row must still be warmed"


def test_tests_never_touch_the_real_data_directory():
    """conftest points FINANCE_DATA_DIR at a temp dir before importing the app.
    Without it every pytest run appends to the real data/logs/finance.log, which
    is the file the diagnostics export ships to explain a user's problem."""
    import database

    real = (Path(__file__).resolve().parent.parent / "data").resolve()
    assert database.DATA_DIR.resolve() != real


def test_embedded_alembic_leaves_the_app_logging_alone(tmp_path):
    """alembic.ini pins the root logger to WARN with a console-only handler, and
    `fileConfig` wipes what is already there. Running migrations in-process at
    startup therefore used to delete the app's file handler a few milliseconds
    into every run — the log went dead for the rest of the session."""
    import database

    root = logging.getLogger()
    probe = RotatingFileHandler(tmp_path / "probe.log", encoding="utf-8")
    root.addHandler(probe)
    previous_level = root.level
    root.setLevel(logging.INFO)
    try:
        database._sync_schema_blocking()
        assert probe in root.handlers, "alembic tore out the app's log handler"
        assert root.level == logging.INFO, "alembic reset the root log level"
    finally:
        root.removeHandler(probe)
        probe.close()
        root.setLevel(previous_level)

    # And it really did run Alembic, so the assertions above are not vacuous.
    import sqlite3

    con = sqlite3.connect(database.DB_PATH)
    try:
        names = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")]
    finally:
        con.close()
    assert "alembic_version" in names


def test_uvicorn_logs_reach_the_file_and_httpx_is_quiet():
    """uvicorn ships handlers with propagate=False, so its startup, shutdown and
    access lines never reached the file — exactly what is missing when someone
    reports "it will not open". httpx at INFO would otherwise flood the tail."""
    import main  # noqa: F401 — imported for its import-time _configure_logging()

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        assert lg.propagate is True, f"{name} still swallows its records"
        assert not lg.handlers, f"{name} kept a private handler"
    assert logging.getLogger("httpx").level == logging.WARNING
