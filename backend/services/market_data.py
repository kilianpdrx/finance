import asyncio
import logging
from datetime import datetime
from typing import Optional

import httpx
from cachetools import TTLCache
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Holding, PriceCache, DividendCache

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


def _detect_frequency(dividends_series) -> str | None:
    """Detect dividend frequency from actual payment history (last 2 years)."""
    if dividends_series is None or len(dividends_series) == 0:
        return None
    from datetime import datetime as _dt, timedelta, timezone
    cutoff = _dt.now(timezone.utc) - timedelta(days=730)
    recent = []
    for d in dividends_series.index:
        dt = d.to_pydatetime()
        if dt.tzinfo is None:
            from datetime import timezone as _tz
            dt = dt.replace(tzinfo=_tz.utc)
        if dt >= cutoff:
            recent.append(d)
    n = len(recent)
    if n >= 20:
        return "monthly"
    if n >= 7:
        return "quarterly"
    if n >= 3:
        return "semi-annual"
    if n >= 1:
        return "annual"
    return None


def _compute_dividend_growth_rate(dividends_series) -> float | None:
    """Compute 5-year dividend CAGR from payment history."""
    if dividends_series is None or len(dividends_series) < 4:
        return None
    by_year: dict[int, float] = {}
    for dt_idx, amount in dividends_series.items():
        yr = dt_idx.year
        by_year[yr] = by_year.get(yr, 0) + float(amount)
    from datetime import datetime as _dt
    current_year = _dt.now().year
    # Exclude current year (incomplete)
    years = sorted(y for y in by_year if y < current_year and by_year[y] > 0)
    if len(years) < 2:
        return None
    # Use up to 5 full years
    if len(years) > 5:
        years = years[-5:]
    oldest = by_year[years[0]]
    latest = by_year[years[-1]]
    if oldest <= 0 or latest <= 0:
        return None
    n = years[-1] - years[0]
    if n <= 0:
        return None
    cagr = ((latest / oldest) ** (1 / n) - 1) * 100
    return round(cagr, 2)


async def _fetch_dividend_details(tickers: list[str]) -> dict[str, dict]:
    """Fetch dividend info (yield, rate, ex-date, frequency, payout, sector, history) via yfinance."""
    if not tickers:
        return {}

    def _sync_fetch():
        import yfinance as yf
        result = {}
        for ticker in tickers:
            try:
                t = yf.Ticker(ticker)
                info = t.info or {}
                div_yield = info.get("dividendYield")  # decimal, e.g. 0.025
                div_rate = info.get("dividendRate")     # annual $/share
                ex_date_ts = info.get("exDividendDate")  # unix timestamp or None
                currency = (info.get("currency") or "USD").upper()

                # Skip if no dividend data at all
                if div_yield is None and div_rate is None:
                    continue

                ex_date = None
                if ex_date_ts:
                    try:
                        from datetime import datetime as _dt
                        ex_date = _dt.utcfromtimestamp(ex_date_ts).date()
                    except Exception:
                        pass

                # Dividend payment date
                div_date = None
                div_date_ts = info.get("dividendDate")
                if div_date_ts:
                    try:
                        from datetime import datetime as _dt
                        div_date = _dt.utcfromtimestamp(div_date_ts).date()
                    except Exception:
                        pass

                # Last dividend
                last_div_val = info.get("lastDividendValue")
                last_div_date = None
                last_div_ts = info.get("lastDividendDate")
                if last_div_ts:
                    try:
                        from datetime import datetime as _dt
                        last_div_date = _dt.utcfromtimestamp(last_div_ts).date()
                    except Exception:
                        pass

                # Frequency from actual dividend history
                try:
                    dividends = t.dividends
                except Exception:
                    dividends = None
                frequency = _detect_frequency(dividends)
                growth_rate = _compute_dividend_growth_rate(dividends)

                # Convert dividends Series to list of (date, amount) for history storage
                history = []
                if dividends is not None and len(dividends) > 0:
                    for dt_idx, amount in dividends.items():
                        history.append((dt_idx.date(), float(amount)))

                payout_ratio = info.get("payoutRatio")  # decimal
                five_yr = info.get("fiveYearAvgDividendYield")  # already in %

                result[ticker] = {
                    "yield_pct": round(div_yield * 100, 4) if div_yield else None,
                    "annual_rate": round(div_rate, 6) if div_rate else None,
                    "currency": currency,
                    "ex_date": ex_date,
                    "frequency": frequency,
                    "payout_ratio": round(payout_ratio, 4) if payout_ratio else None,
                    "five_year_avg_yield": round(five_yr, 2) if five_yr else None,
                    "growth_rate_5y": growth_rate,
                    "last_dividend_value": round(last_div_val, 6) if last_div_val else None,
                    "last_dividend_date": last_div_date,
                    "dividend_date": div_date,
                    "sector": info.get("sector"),
                    "industry": info.get("industry"),
                    "history": history,
                }
            except Exception as e:
                logger.warning("yfinance dividend fetch failed for %s: %s", ticker, e)
        return result

    try:
        return await asyncio.get_event_loop().run_in_executor(None, _sync_fetch)
    except Exception as e:
        logger.warning("Dividend details batch fetch failed: %s", e)
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
        if h.price_locked:
            continue  # excluded from auto-refresh — keeps its manual/ref price
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
        ref = h.ref_price_cents
        # A locked holding always keeps its manual/broker price, regardless of any
        # live quote that may exist for the same ticker.
        if not h.price_locked:
            live = stock_prices.get(h.ticker.upper())
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

    # ── Dividend data ────────────────────────────────────────────────────────
    div_count = 0
    hist_count = 0
    if stock_tickers:
        div_data = await _fetch_dividend_details(stock_tickers)
        for ticker, info in div_data.items():
            ex_date_str = str(info["ex_date"]) if info.get("ex_date") else None
            last_div_date_str = str(info["last_dividend_date"]) if info.get("last_dividend_date") else None
            div_date_str = str(info["dividend_date"]) if info.get("dividend_date") else None
            await db.execute(text(
                "INSERT OR REPLACE INTO dividend_cache "
                "(ticker, yield_pct, annual_rate, currency, ex_date, frequency, fetched_at, "
                "payout_ratio, five_year_avg_yield, growth_rate_5y, last_dividend_value, "
                "last_dividend_date, dividend_date, sector, industry) "
                "VALUES (:ticker, :yld, :rate, :ccy, :ex, :freq, :ts, "
                ":payout, :five_yr, :growth, :last_val, :last_dt, :div_dt, :sector, :industry)"
            ), {
                "ticker": ticker,
                "yld": info.get("yield_pct"),
                "rate": info.get("annual_rate"),
                "ccy": info.get("currency"),
                "ex": ex_date_str,
                "freq": info.get("frequency"),
                "ts": now,
                "payout": info.get("payout_ratio"),
                "five_yr": info.get("five_year_avg_yield"),
                "growth": info.get("growth_rate_5y"),
                "last_val": info.get("last_dividend_value"),
                "last_dt": last_div_date_str,
                "div_dt": div_date_str,
                "sector": info.get("sector"),
                "industry": info.get("industry"),
            })
            div_count += 1

            # Persist dividend history
            for pay_date, amount in info.get("history", []):
                await db.execute(text(
                    "INSERT OR IGNORE INTO dividend_history (ticker, payment_date, amount) "
                    "VALUES (:t, :d, :a)"
                ), {"t": ticker, "d": str(pay_date), "a": amount})
                hist_count += 1

        logger.info("Cached dividend data for %d ticker(s), %d history entries.", div_count, hist_count)

    await db.commit()
    logger.info("Refreshed %d prices (%d stocks, %d crypto)", count, len(stock_prices), len(crypto_prices))
    return count


async def get_cached_price(db: AsyncSession, ticker: str) -> Optional[PriceCache]:
    result = await db.execute(
        select(PriceCache).where(PriceCache.ticker == ticker)
    )
    return result.scalar_one_or_none()


async def get_cached_dividend(db: AsyncSession, ticker: str) -> Optional[DividendCache]:
    """Read cached dividend data for a ticker."""
    result = await db.execute(
        select(DividendCache).where(DividendCache.ticker == ticker)
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
