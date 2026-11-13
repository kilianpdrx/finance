"""Reading prices out of `yfinance.download()` frames.

yfinance 1.4.1 returns (Price, Ticker) MultiIndex columns even for ONE ticker,
so `data["Close"].iloc[-1]` is a Series there, not a number. A refresh that
asked for a single ticker raised on it, logged « yfinance price extraction
failed » and never priced the position. `yfinance.download` is replaced by a
frame built the way yfinance builds it; none of these tests touch the network.
"""
import logging
import math
from types import SimpleNamespace

import pandas as pd
import pytest
from httpx import AsyncClient
from sqlalchemy import text

from models import Holding
from services import market_data as md


@pytest.fixture(autouse=True)
def _reset_guards(monkeypatch):
    """Module-level guards are process-wide; reset around every test. No
    spacing between calls: these tests make several and none reach Yahoo."""
    monkeypatch.setitem(md._PROVIDER_MIN_INTERVAL, "yahoo", 0)
    md.reset_provider_state()
    yield
    md.reset_provider_state()


def _yf_frame(closes: dict[str, dict[str, float]]):
    """A frame shaped like yfinance 1.4.1's `download(..., group_by="column",
    multi_level_index=True)`: one OHLCV frame per ticker, concatenated under
    (Ticker, Price) keys, then swapped to (Price, Ticker) and sorted — the
    steps of `yfinance.multi.download`."""
    dfs = {}
    for ticker, by_date in closes.items():
        values = list(by_date.values())
        dfs[ticker] = pd.DataFrame(
            {"Open": values, "High": values, "Low": values, "Close": values,
             "Volume": [1000.0] * len(values)},
            index=pd.DatetimeIndex(pd.to_datetime(list(by_date)), name="Date"),
        )
    data = pd.concat(dfs.values(), axis=1, sort=True, keys=dfs.keys(), names=["Ticker", "Price"])
    data.columns = data.columns.swaplevel(0, 1)
    return data.sort_index(level=0, axis=1)


def _fake_yf(monkeypatch, quotes: dict[str, dict[str, float]]):
    """Serve the requested tickers' `quotes` from yfinance.download (a ticker
    Yahoo doesn't know is left out of the frame). A ticker without an exchange
    suffix gets its currency from yfinance.Ticker(...).fast_info, faked as USD.
    Returns the calls made, to check what was asked."""
    calls = {"download": [], "ticker": []}

    def _download(tickers, **kwargs):
        calls["download"].append((list(tickers), kwargs))
        known = {t: quotes[t] for t in tickers if t in quotes}
        return _yf_frame(known) if known else pd.DataFrame()

    def _ticker(t):
        calls["ticker"].append(t)
        return SimpleNamespace(fast_info=SimpleNamespace(currency="USD"))

    monkeypatch.setattr("yfinance.download", _download)
    monkeypatch.setattr("yfinance.Ticker", _ticker)
    return calls


# ── Extraction ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_single_ticker_is_priced(monkeypatch, caplog):
    frame = _yf_frame({"AAPL": {"2026-11-10": 189.5}})
    # The shape that broke it: MultiIndex even for one ticker.
    assert isinstance(frame.columns, pd.MultiIndex)
    assert isinstance(frame["Close"].iloc[-1], pd.Series)
    calls = _fake_yf(monkeypatch, {"AAPL": {"2026-11-10": 189.5}})

    with caplog.at_level(logging.WARNING, logger="services.market_data"):
        prices = await md._fetch_stock_prices(["AAPL"])

    assert prices == {"AAPL": (189.5, "USD")}
    assert "price extraction failed" not in caplog.text
    # An empty answer counts as a Yahoo failure; a priced one must not.
    assert not md._backoff.blocked("yahoo")
    # The shape is asked for, not left to yfinance's default.
    [(asked, kwargs)] = calls["download"]
    assert asked == ["AAPL"]
    assert kwargs["multi_level_index"] is True
    assert kwargs["group_by"] == "column"


@pytest.mark.asyncio
async def test_several_tickers_are_priced(monkeypatch):
    _fake_yf(monkeypatch, {
        "AAPL": {"2026-11-10": 189.5},
        "CW8.PA": {"2026-11-10": 512.3},
        "NESN.SW": {"2026-11-10": 81.2},
    })

    prices = await md._fetch_stock_prices(["AAPL", "CW8.PA", "NESN.SW"])

    assert prices == {
        "AAPL": (189.5, "USD"),
        "CW8.PA": (512.3, "EUR"),
        "NESN.SW": (81.2, "CHF"),
    }


@pytest.mark.asyncio
async def test_markets_on_different_dates_each_get_their_latest_close(monkeypatch):
    """A Monday morning in Europe: Paris has printed Monday, New York still
    shows Friday. They share one index, so AAPL's last row is NaN."""
    quotes = {"AAPL": {"2026-11-06": 189.5}, "CW8.PA": {"2026-11-09": 512.3}}
    assert math.isnan(_yf_frame(quotes)["Close"]["AAPL"].iloc[-1])
    _fake_yf(monkeypatch, quotes)

    prices = await md._fetch_stock_prices(["AAPL", "CW8.PA"])

    assert prices == {"AAPL": (189.5, "USD"), "CW8.PA": (512.3, "EUR")}


@pytest.mark.asyncio
async def test_tickers_without_a_close_are_left_out_and_named(monkeypatch, caplog):
    """A failed download comes back as an all-NaN column (yfinance's empty_df);
    a ticker Yahoo didn't return at all has no column. Neither gets a price,
    neither stops the others, and the log names them (tickers only)."""
    _fake_yf(monkeypatch, {
        "AAPL": {"2026-11-10": 189.5},
        "GONE.PA": {"2026-11-10": float("nan")},
    })

    with caplog.at_level(logging.WARNING, logger="services.market_data"):
        prices = await md._fetch_stock_prices(["AAPL", "GONE.PA", "MISSING.PA"])

    assert prices == {"AAPL": (189.5, "USD")}
    assert "Yahoo returned no price for GONE.PA, MISSING.PA" in caplog.text
    assert "189.5" not in caplog.text
    assert "price extraction failed" not in caplog.text


@pytest.mark.asyncio
async def test_a_single_ticker_without_a_close_is_not_priced(monkeypatch, caplog):
    _fake_yf(monkeypatch, {"GONE.PA": {"2026-11-10": float("nan")}})

    with caplog.at_level(logging.WARNING, logger="services.market_data"):
        assert await md._fetch_stock_prices(["GONE.PA"]) == {}
    assert "Yahoo returned no price for GONE.PA" in caplog.text


@pytest.mark.asyncio
async def test_a_quote_currency_is_asked_once(monkeypatch):
    """A suffix-less ticker's currency costs a Yahoo call; it is remembered."""
    calls = _fake_yf(monkeypatch, {"AAPL": {"2026-11-10": 189.5}, "CW8.PA": {"2026-11-10": 512.3}})

    for _ in range(3):
        assert await md._fetch_stock_prices(["AAPL", "CW8.PA"]) == {
            "AAPL": (189.5, "USD"), "CW8.PA": (512.3, "EUR")}

    assert calls["ticker"] == ["AAPL"], "CW8.PA's currency comes from its suffix"


@pytest.mark.asyncio
async def test_an_unanswered_currency_is_asked_again(monkeypatch):
    calls = _fake_yf(monkeypatch, {"AAPL": {"2026-11-10": 189.5}})

    def _no_answer(t):
        calls["ticker"].append(t)
        return SimpleNamespace(fast_info=SimpleNamespace(currency=None))
    monkeypatch.setattr("yfinance.Ticker", _no_answer)

    for _ in range(2):
        assert await md._fetch_stock_prices(["AAPL"]) == {"AAPL": (189.5, "USD")}
    assert calls["ticker"] == ["AAPL", "AAPL"], "a guessed USD must not be remembered"


# ── The single-ticker callers ────────────────────────────────────────────────
# Both ask Yahoo for one ticker, so neither ever got a price before the fix.

@pytest.fixture
def _no_isin_search(monkeypatch):
    """OpenFIGI and Yahoo search, faked; returns the ISINs they were asked."""
    searched: list = []

    def _candidates(found):
        async def _search(isin):
            searched.append(isin)
            return found
        return _search

    def _with(openfigi=(), yahoo=()):
        monkeypatch.setattr(md, "_openfigi_candidates", _candidates(list(openfigi)))
        monkeypatch.setattr(md, "_yahoo_search_symbols", _candidates(list(yahoo)))
        return searched
    return _with


@pytest.mark.asyncio
async def test_resolution_trusts_a_ticker_whose_price_matches(db_session, monkeypatch, _no_isin_search):
    """Step 1 of resolve_yahoo_symbol: the current ticker is kept, and remembered
    for its ISIN, when its live price is the broker's within _PRICE_MATCH_TOL."""
    _fake_yf(monkeypatch, {"CW8.PA": {"2026-11-10": 512.3}})
    searched = _no_isin_search(openfigi=["OTHER.PA"])

    symbol, resolved = await md.resolve_yahoo_symbol(
        db_session, "XX0000000001", "CW8.PA", ref_price=510.0, ref_currency="EUR")

    assert (symbol, resolved) == ("CW8.PA", True)
    assert searched == [], "a validated ticker must not trigger an ISIN search"
    row = (await db_session.execute(text(
        "SELECT ticker, source FROM isin_ticker WHERE isin = 'XX0000000001'"))).one()
    assert tuple(row) == ("CW8.PA", "resolved")


@pytest.mark.asyncio
async def test_resolution_replaces_a_ticker_whose_price_is_off(db_session, monkeypatch, _no_isin_search):
    """A mis-mapped ticker (149 € live for an 85 € fund) fails step 1 and the
    ISIN's candidate whose price matches is taken instead."""
    _fake_yf(monkeypatch, {"C40.PA": {"2026-11-10": 149.0}, "CAC.PA": {"2026-11-10": 85.2}})
    searched = _no_isin_search(openfigi=["CAC.PA"])

    symbol, resolved = await md.resolve_yahoo_symbol(
        db_session, "XX0000000002", "C40.PA", ref_price=85.0, ref_currency="EUR")

    assert (symbol, resolved) == ("CAC.PA", True)
    assert searched == ["XX0000000002"]
    row = (await db_session.execute(text(
        "SELECT ticker, source FROM isin_ticker WHERE isin = 'XX0000000002'"))).one()
    assert tuple(row) == ("CAC.PA", "openfigi")


@pytest.mark.asyncio
async def test_resolution_does_not_trust_a_ticker_in_another_currency(
        db_session, monkeypatch, _no_isin_search):
    _fake_yf(monkeypatch, {"AAPL": {"2026-11-10": 85.1}})
    _no_isin_search()

    assert await md.resolve_yahoo_symbol(
        db_session, "XX0000000003", "AAPL", ref_price=85.0, ref_currency="EUR") == ("AAPL", False)


@pytest.mark.asyncio
async def test_a_ticker_edit_fetches_the_new_symbols_live_price(
        client: AsyncClient, db_session, seed_data, monkeypatch):
    profile, account = seed_data["profile"], seed_data["account_inv"]
    h = Holding(profile_id=profile.id, account_id=account.id, ticker="CW8.PA",
                name="Fonds inventé", quantity=2, cost_basis_cents=80000,
                currency="EUR", asset_type="etf")
    db_session.add(h)
    await db_session.commit()
    await db_session.refresh(h)
    _fake_yf(monkeypatch, {"MWRD.PA": {"2026-11-10": 41.25}})

    res = await client.put(f"/api/investments/holdings/{h.id}",
                           headers={"X-Profile-Id": str(profile.id)},
                           json={"ticker": "MWRD.PA"})

    assert res.status_code == 200
    row = (await db_session.execute(text(
        "SELECT price_cents, currency, source FROM price_cache WHERE ticker = 'MWRD.PA'"))).one()
    assert tuple(row) == (4125, "EUR", "live")
