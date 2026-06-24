import asyncio
import logging
from datetime import datetime
from typing import Optional

import httpx
from cachetools import TTLCache
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Holding, PriceCache

_history_cache: TTLCache = TTLCache(maxsize=200, ttl=3600)

# isin -> resolved Yahoo symbol (validated against broker price). Persists for the
# process lifetime so repeated imports/refreshes don't re-hit the search API.
_symbol_cache: dict[str, str] = {}

logger = logging.getLogger(__name__)

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
HTTP_TIMEOUT = 10.0
# How close a candidate's live price must be to the broker's same-day price to be
# accepted as the correct listing.
_PRICE_MATCH_TOL = 0.08
# Beyond this gap from the broker reference, a same-currency live quote is treated
# as a wrong instrument (bad ticker) and the broker price is used instead. ETFs/
# stocks rarely move this much between imports; mapping errors are far larger.
_REF_DEVIATION_TOL = 0.35


async def _fetch_stock_prices(tickers: list[str]) -> dict[str, tuple[float, str]]:
    """Fetch current prices for stocks/ETFs via yfinance (runs in executor)."""
    if not tickers:
        return {}

    def _sync_fetch():
        import yfinance as yf
        result = {}
        data = yf.download(tickers, period="1d", progress=False, threads=True)
        if data.empty:
            return result
        for ticker in tickers:
            try:
                if len(tickers) == 1:
                    close = data["Close"].iloc[-1]
                else:
                    close = data["Close"][ticker].iloc[-1]
                if close and close == close:  # NaN check
                    info = yf.Ticker(ticker).fast_info
                    currency = getattr(info, "currency", "USD") or "USD"
                    result[ticker] = (float(close), currency.upper())
            except Exception as e:
                logger.warning("yfinance price extraction failed for %s: %s", ticker, e)
        return result

    try:
        return await asyncio.get_event_loop().run_in_executor(None, _sync_fetch)
    except Exception as e:
        logger.warning("yfinance batch fetch failed: %s", e)
        return {}


async def _fetch_crypto_prices(ids: list[str]) -> dict[str, tuple[float, str]]:
    """Fetch current prices for crypto via CoinGecko free API."""
    if not ids:
        return {}
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{COINGECKO_BASE}/simple/price",
                params={"ids": ",".join(ids), "vs_currencies": "usd"},
            )
            resp.raise_for_status()
            data = resp.json()
        result = {}
        for coin_id, prices in data.items():
            usd_price = prices.get("usd")
            if usd_price is not None:
                result[coin_id] = (float(usd_price), "USD")
        return result
    except Exception as e:
        logger.warning("CoinGecko fetch failed: %s", e)
        return {}


async def fetch_isin_for_ticker(ticker: str) -> Optional[str]:
    """Look up a ticker's ISIN via yfinance (e.g. to backfill IBKR positions)."""
    if not ticker:
        return None

    def _sync():
        import yfinance as yf
        try:
            val = yf.Ticker(ticker).isin
        except Exception:
            return None
        if val and isinstance(val, str) and val not in ("-", "") and len(val) >= 10:
            return val.strip()
        return None

    try:
        return await asyncio.get_event_loop().run_in_executor(None, _sync)
    except Exception:
        return None


async def _yahoo_search_symbols(isin: str) -> list[str]:
    """Resolve candidate Yahoo symbols for an ISIN via the public search endpoint."""
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(
                YAHOO_SEARCH_URL,
                params={"q": isin, "quotesCount": 10, "newsCount": 0},
                headers={"User-Agent": "Mozilla/5.0"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning("Yahoo ISIN search failed for %s: %s", isin, e)
        return []
    symbols = []
    for q in data.get("quotes", []):
        sym = q.get("symbol")
        if sym and q.get("quoteType") in (None, "EQUITY", "ETF", "MUTUALFUND"):
            symbols.append(sym)
    return symbols


def _within_tol(price: float, ref: float) -> bool:
    if ref <= 0:
        return False
    return abs(price - ref) / ref <= _PRICE_MATCH_TOL


# OpenFIGI exchange code → Yahoo Finance symbol suffix.
OPENFIGI_URL = "https://api.openfigi.com/v3/mapping"
_FIGI_SUFFIX: dict[str, str] = {
    "FP": ".PA",  # Euronext Paris
    "GR": ".DE", "GY": ".DE", "GF": ".F", "GB": ".BE",  # Germany (XETRA/Frankfurt)
    "NA": ".AS",  # Euronext Amsterdam
    "IM": ".MI",  # Borsa Italiana
    "SE": ".SW", "SW": ".SW", "VX": ".SW",  # SIX Swiss
    "LN": ".L",  # London
    "SM": ".MC", "MC": ".MC",  # Madrid
    "BB": ".BR",  # Euronext Brussels
    "PL": ".LS",  # Euronext Lisbon
    "ID": ".IR",  # Euronext Dublin
    "NO": ".OL",  # Oslo
    "SS": ".ST",  # Stockholm
    "DC": ".CO",  # Copenhagen
    "FH": ".HE",  # Helsinki
    "US": "", "UN": "", "UQ": "", "UW": "", "UR": "", "UP": "",  # US listings
}


async def _openfigi_candidates(isin: str) -> list[str]:
    """Resolve candidate Yahoo symbols for an ISIN via OpenFIGI (ISIN→ticker+exchange)."""
    import os
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("OPENFIGI_API_KEY")
    if key:
        headers["X-OPENFIGI-APIKEY"] = key
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.post(OPENFIGI_URL, headers=headers,
                                     json=[{"idType": "ID_ISIN", "idValue": isin}])
            resp.raise_for_status()
            payload = resp.json()
    except Exception as e:
        logger.warning("OpenFIGI lookup failed for %s: %s", isin, e)
        return []
    out: list[str] = []
    seen: set[str] = set()
    for job in payload:
        for d in job.get("data", []) or []:
            ticker = (d.get("ticker") or "").strip()
            exch = (d.get("exchCode") or "").strip().upper()
            if not ticker or exch not in _FIGI_SUFFIX:
                continue
            sym = f"{ticker}{_FIGI_SUFFIX[exch]}"
            if sym.upper() not in seen:
                seen.add(sym.upper())
                out.append(sym)
    return out


async def lookup_isin_ticker(db: AsyncSession, isin: str) -> Optional[str]:
    """Read a persisted ISIN→ticker mapping (the big lookup table)."""
    if not isin:
        return None
    if isin in _symbol_cache:
        return _symbol_cache[isin]
    row = (await db.execute(
        text("SELECT ticker FROM isin_ticker WHERE isin = :i"), {"i": isin}
    )).first()
    if row:
        _symbol_cache[isin] = row[0]
        return row[0]
    return None


async def reverse_lookup_isin(db: AsyncSession, ticker: str) -> Optional[str]:
    """Find an ISIN that maps to this ticker (most recently updated wins)."""
    if not ticker:
        return None
    row = (await db.execute(
        text("SELECT isin FROM isin_ticker WHERE UPPER(ticker) = :t ORDER BY updated_at DESC LIMIT 1"),
        {"t": ticker.upper()},
    )).first()
    return row[0] if row else None


async def store_isin_ticker(
    db: AsyncSession, isin: str, ticker: str,
    name: str | None = None, currency: str | None = None, source: str = "resolved",
) -> None:
    """Persist a resolved ISIN→ticker mapping so it's never searched again."""
    if not isin or not ticker:
        return
    await db.execute(text(
        "INSERT INTO isin_ticker (isin, ticker, name, currency, source, updated_at) "
        "VALUES (:i, :t, :n, :c, :s, :u) "
        "ON CONFLICT(isin) DO UPDATE SET ticker=excluded.ticker, name=excluded.name, "
        "currency=excluded.currency, source=excluded.source, updated_at=excluded.updated_at"
    ), {"i": isin, "t": ticker, "n": name, "c": currency, "s": source, "u": datetime.utcnow()})
    _symbol_cache[isin] = ticker


async def resolve_yahoo_symbol(
    db: AsyncSession, isin: str | None, fallback_ticker: str,
    ref_price: float, ref_currency: str = "EUR", name: str | None = None,
    force: bool = False,
) -> tuple[str, bool]:
    """Find the Yahoo symbol whose *same-day* live price matches the broker's price.

    Checks the persistent `isin_ticker` lookup first (unless `force`); on a miss it
    validates the fallback ticker / resolves by ISIN (OpenFIGI, then Yahoo search)
    and persists the result. Returns (symbol, resolved); when nothing validates,
    returns the fallback ticker with resolved=False so callers use the broker price.
    """
    if ref_price <= 0:
        return fallback_ticker, False

    # 0. Persistent lookup — never re-search a known ISIN (skipped on a forced re-resolve).
    if isin and not force:
        known = await lookup_isin_ticker(db, isin)
        if known:
            return known, True

    # 1. Trust the current ticker if its live price already matches the broker's.
    prices = await _fetch_stock_prices([fallback_ticker.upper()])
    pc = prices.get(fallback_ticker.upper())
    if pc and pc[1] == ref_currency and _within_tol(pc[0], ref_price):
        if isin:
            await store_isin_ticker(db, isin, fallback_ticker, name, ref_currency)
        return fallback_ticker, True

    # 2. OpenFIGI ISIN→ticker (most reliable for European listings), then Yahoo search.
    if isin:
        for source, getter in (("openfigi", _openfigi_candidates), ("yahoo", _yahoo_search_symbols)):
            candidates = await getter(isin)
            candidates = [c for c in candidates if c.upper() != fallback_ticker.upper()]
            if not candidates:
                continue
            cand_prices = await _fetch_stock_prices([c.upper() for c in candidates])
            for c in candidates:
                cp = cand_prices.get(c.upper())
                if cp and cp[1] == ref_currency and _within_tol(cp[0], ref_price):
                    await store_isin_ticker(db, isin, c, name, ref_currency, source=source)
                    logger.info("Resolved ISIN %s via %s: %s -> %s (broker %.2f, live %.2f)",
                                isin, source, fallback_ticker, c, ref_price, cp[0])
                    return c, True

    logger.warning("Could not validate a live symbol for %s (isin=%s, broker ref=%.2f); "
                   "using broker reference price.", fallback_ticker, isin, ref_price)
    return fallback_ticker, False


async def refresh_all_prices(db: AsyncSession) -> int:
    """Fetch current prices for all holdings and update price_cache."""
    holdings = (await db.execute(select(Holding))).scalars().all()
    if not holdings:
        return 0

    stock_tickers = []
    crypto_ids = []
    for h in holdings:
        if h.asset_type == "crypto":
            crypto_ids.append(h.ticker.lower())
        else:
            stock_tickers.append(h.ticker.upper())

    stock_tickers = list(set(stock_tickers))
    crypto_ids = list(set(crypto_ids))

    stock_prices = await _fetch_stock_prices(stock_tickers)
    crypto_prices = await _fetch_crypto_prices(crypto_ids)

    now = datetime.utcnow()
    count = 0

    for ticker, (price, currency) in stock_prices.items():
        price_cents = round(price * 100)
        await db.execute(text(
            "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
            "VALUES (:ticker, :price_cents, :currency, :fetched_at, 'live')"
        ), {"ticker": ticker, "price_cents": price_cents, "currency": currency, "fetched_at": now})
        count += 1

    for coin_id, (price, currency) in crypto_prices.items():
        price_cents = round(price * 100)
        await db.execute(text(
            "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
            "VALUES (:ticker, :price_cents, :currency, :fetched_at, 'live')"
        ), {"ticker": coin_id, "price_cents": price_cents, "currency": currency, "fetched_at": now})
        count += 1

    # Guard: a holding with a broker reference keeps the broker price whenever the
    # live quote is missing, in the wrong currency, or deviates so far from the
    # broker price that it is clearly a different instrument (bad ticker mapping).
    fallback = 0
    for h in holdings:
        if h.asset_type == "crypto" or not h.ref_price_cents:
            continue
        live = stock_prices.get(h.ticker.upper())
        ref = h.ref_price_cents
        trusted = (
            live is not None
            and live[1] == h.currency
            and abs(round(live[0] * 100) - ref) / ref <= _REF_DEVIATION_TOL
        )
        if trusted:
            continue
        await db.execute(text(
            "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
            "VALUES (:ticker, :price_cents, :currency, :fetched_at, 'ref')"
        ), {"ticker": h.ticker.upper(), "price_cents": ref,
            "currency": h.currency, "fetched_at": h.ref_price_date or now})
        fallback += 1
    if fallback:
        logger.info("Applied broker reference price for %d holding(s) without a trusted live quote.", fallback)

    await db.commit()
    logger.info("Refreshed %d prices (%d stocks, %d crypto)", count, len(stock_prices), len(crypto_prices))
    return count


async def get_cached_price(db: AsyncSession, ticker: str) -> Optional[PriceCache]:
    result = await db.execute(
        select(PriceCache).where(PriceCache.ticker == ticker)
    )
    return result.scalar_one_or_none()


async def fetch_historical_prices(ticker: str, period: str = "1y") -> list[dict]:
    cache_key = f"{ticker}:{period}"
    if cache_key in _history_cache:
        return _history_cache[cache_key]

    def _sync_fetch():
        import yfinance as yf
        data = yf.download(ticker, period=period, progress=False, threads=False)
        if data.empty:
            return []
        rows = []
        for idx, row in data.iterrows():
            date_str = str(idx.date()) if hasattr(idx, "date") else str(idx)[:10]
            close_val = row["Close"]
            if hasattr(close_val, "item"):
                close_val = close_val.item()
            elif hasattr(close_val, "iloc"):
                close_val = close_val.iloc[0]
            close_val = float(close_val)
            if close_val != close_val:  # NaN
                continue
            rows.append({"date": date_str, "close": round(close_val, 4)})
        return rows

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _sync_fetch)
        _history_cache[cache_key] = result
        return result
    except Exception as e:
        logger.warning("Historical price fetch failed for %s: %s", ticker, e)
        return []
