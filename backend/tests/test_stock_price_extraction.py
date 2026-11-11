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


def _yf_frame(closes: dict[str, dict[str, float]], *, multi_level_index: bool = True):
    """A frame shaped like yfinance 1.4.1's `download()`: one OHLCV frame per
    ticker, concatenated under (Ticker, Price) keys, then swapped to
    (Price, Ticker) and sorted — the steps of `yfinance.multi.download`."""
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
    data = data.sort_index(level=0, axis=1)
    if not multi_level_index and len(closes) == 1:
        data = data.droplevel(1, axis=1).rename_axis(None, axis=1)
    return data


def _fake_yf(monkeypatch, frame):
    """Serve `frame` from yfinance.download; a ticker without an exchange suffix
    gets its currency from yfinance.Ticker(...).fast_info, faked as USD."""
    calls: list = []

    def _download(tickers, **kwargs):
        calls.append(list(tickers))
        return frame

    monkeypatch.setattr("yfinance.download", _download)
    monkeypatch.setattr("yfinance.Ticker",
                        lambda t: SimpleNamespace(fast_info=SimpleNamespace(currency="USD")))
    return calls


@pytest.mark.asyncio
async def test_a_single_ticker_is_priced(monkeypatch, caplog):
    frame = _yf_frame({"AAPL": {"2026-11-10": 189.5}})
    # The shape that broke it: MultiIndex even for one ticker.
    assert isinstance(frame.columns, pd.MultiIndex)
    assert isinstance(frame["Close"].iloc[-1], pd.Series)
    calls = _fake_yf(monkeypatch, frame)

    with caplog.at_level(logging.WARNING, logger="services.market_data"):
        prices = await md._fetch_stock_prices(["AAPL"])

    assert calls == [["AAPL"]]
    assert prices == {"AAPL": (189.5, "USD")}
    assert "price extraction failed" not in caplog.text
    # An empty answer counts as a Yahoo failure; a priced one must not.
    assert not md._backoff.blocked("yahoo")


@pytest.mark.asyncio
async def test_several_tickers_are_priced(monkeypatch):
    frame = _yf_frame({
        "AAPL": {"2026-11-10": 189.5},
        "CW8.PA": {"2026-11-10": 512.3},
        "NESN.SW": {"2026-11-10": 81.2},
    })
    _fake_yf(monkeypatch, frame)

    prices = await md._fetch_stock_prices(["AAPL", "CW8.PA", "NESN.SW"])

    assert prices == {
        "AAPL": (189.5, "USD"),
        "CW8.PA": (512.3, "EUR"),
        "NESN.SW": (81.2, "CHF"),
    }


@pytest.mark.asyncio
async def test_a_flat_single_ticker_frame_is_priced(monkeypatch):
    """Older yfinance, or multi_level_index=False: flat columns for one ticker."""
    frame = _yf_frame({"CW8.PA": {"2026-11-10": 512.3}}, multi_level_index=False)
    assert not isinstance(frame.columns, pd.MultiIndex)
    _fake_yf(monkeypatch, frame)

    assert await md._fetch_stock_prices(["CW8.PA"]) == {"CW8.PA": (512.3, "EUR")}


@pytest.mark.asyncio
async def test_markets_on_different_dates_each_get_their_latest_close(monkeypatch):
    """A Monday morning in Europe: Paris has printed Monday, New York still
    shows Friday. They share one index, so AAPL's last row is NaN."""
    frame = _yf_frame({
        "AAPL": {"2026-11-06": 189.5},
        "CW8.PA": {"2026-11-09": 512.3},
    })
    assert math.isnan(frame["Close"]["AAPL"].iloc[-1])
    _fake_yf(monkeypatch, frame)

    prices = await md._fetch_stock_prices(["AAPL", "CW8.PA"])

    assert prices == {"AAPL": (189.5, "USD"), "CW8.PA": (512.3, "EUR")}


@pytest.mark.asyncio
async def test_a_ticker_without_any_close_is_left_out(monkeypatch, caplog):
    """A failed download comes back as an all-NaN column (yfinance's empty_df);
    a ticker yfinance didn't return at all has no column. Neither gets a price,
    and neither stops the others."""
    frame = _yf_frame({
        "AAPL": {"2026-11-10": 189.5},
        "GONE.PA": {"2026-11-10": float("nan")},
    })
    _fake_yf(monkeypatch, frame)

    with caplog.at_level(logging.WARNING, logger="services.market_data"):
        prices = await md._fetch_stock_prices(["AAPL", "GONE.PA", "MISSING.PA"])

    assert prices == {"AAPL": (189.5, "USD")}
    assert "price extraction failed" not in caplog.text


@pytest.mark.asyncio
async def test_a_single_ticker_without_a_close_is_not_priced(monkeypatch):
    frame = _yf_frame({"GONE.PA": {"2026-11-10": float("nan")}})
    _fake_yf(monkeypatch, frame)

    assert await md._fetch_stock_prices(["GONE.PA"]) == {}
