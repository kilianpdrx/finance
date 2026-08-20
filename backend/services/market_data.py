import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
from cachetools import TTLCache
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Holding, PriceCache, DividendCache

_history_cache: TTLCache = TTLCache(maxsize=200, ttl=3600)

# ── Politeness towards the data providers ────────────────────────────────────
# yfinance and CoinGecko are free, unauthenticated and rate-limited. Every
# install polls them on a timer, so with several users sharing an IP range (or
# one user leaving the app open) it is easy to get throttled or blocked. Three
# guards, cheapest first:
#   1. PRICE_TTL     — don't refetch prices that are still fresh at all.
#   2. _throttle()   — minimum spacing between calls to the same provider.
#   3. _Backoff      — after repeated failures, stop trying for a while
#                      (exponential, capped), like fx.py's _fail_cache.
PRICE_TTL = timedelta(minutes=20)

_PROVIDER_MIN_INTERVAL = {"yahoo": 0.35, "coingecko": 1.2, "openfigi": 0.5}
_last_call: dict[str, float] = {}
_throttle_lock = asyncio.Lock()


async def _throttle(provider: str) -> None:
    """Space out calls to `provider` by at least its minimum interval."""
    gap = _PROVIDER_MIN_INTERVAL.get(provider, 0.3)
    async with _throttle_lock:
        now = time.monotonic()
        wait = gap - (now - _last_call.get(provider, 0.0))
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call[provider] = time.monotonic()


class _Backoff:
    """Exponential backoff per provider, so a blocked API isn't hammered.

    After a failure the provider is skipped for an increasing delay (30s, 60s,
    120s … capped at 30 min). Any success resets it immediately.
    """

    _BASE = 30.0
    _CAP = 1800.0

    def __init__(self) -> None:
        self._fails: dict[str, int] = {}
        self._until: dict[str, float] = {}

    def blocked(self, provider: str) -> bool:
        return time.monotonic() < self._until.get(provider, 0.0)

    def record_failure(self, provider: str) -> None:
        n = self._fails.get(provider, 0) + 1
        self._fails[provider] = n
        delay = min(self._BASE * (2 ** (n - 1)), self._CAP)
        self._until[provider] = time.monotonic() + delay
        logger.warning("%s failing (%d in a row) — pausing calls for %.0fs", provider, n, delay)

    def record_success(self, provider: str) -> None:
        if self._fails.pop(provider, None):
            self._until.pop(provider, None)
            logger.info("%s recovered", provider)


_backoff = _Backoff()

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

    if _backoff.blocked("yahoo"):
        logger.info("Skipping yahoo call — backing off after repeated failures")
        return {}
    await _throttle("yahoo")
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
                    t_upper = ticker.upper()
                    if t_upper.endswith((".PA", ".DE", ".AS", ".MI", ".MC", ".BR", ".F", ".LS")):
                        currency = "EUR"
                    elif t_upper.endswith((".SW", ".VX")):
                        currency = "CHF"
                    elif t_upper.endswith(".L"):
                        currency = "GBP"
                    else:
                        currency = "USD"
                        try:
                            info = yf.Ticker(ticker).fast_info
                            currency = getattr(info, "currency", "USD") or "USD"
                        except Exception:
                            pass
                    result[ticker] = (float(close), currency.upper())
            except Exception as e:
                logger.warning("yfinance price extraction failed for %s: %s", ticker, e)

        return result

    try:
        out = await asyncio.get_event_loop().run_in_executor(None, _sync_fetch)
        # An empty result for a non-empty request means the provider gave us
        # nothing — treat it as a failure so repeated blocks trigger backoff.
        _backoff.record_success("yahoo") if out else _backoff.record_failure("yahoo")
        return out
    except Exception as e:
        logger.warning("yfinance batch fetch failed: %s", e)
        _backoff.record_failure("yahoo")
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

    if _backoff.blocked("yahoo"):
        logger.info("Skipping yahoo call — backing off after repeated failures")
        return {}
    await _throttle("yahoo")
    if not tickers:
        return {}

    def _sync_fetch():
        import yfinance as yf
        result = {}
        blocked = 0
        for ticker in tickers:
            try:
                t = yf.Ticker(ticker)
                info = t.info or {}
                div_yield = info.get("dividendYield")   # scale varies by yfinance version
                div_rate = info.get("dividendRate")     # annual per-share dividend
                price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
                ex_date_ts = info.get("exDividendDate")  # unix timestamp or None
                currency = (info.get("currency") or "USD").upper()

                # Skip if no dividend data at all
                if div_yield is None and div_rate is None:
                    continue

                # Yield %: prefer annual_rate / price (exact, version-proof). yfinance's
                # dividendYield has flip-flopped between a fraction (0.0197) and a
                # percentage (1.97) across versions, so normalise it only as a fallback.
                if div_rate and price:
                    yield_pct = round(div_rate / price * 100, 4)
                elif div_yield is not None:
                    yield_pct = round(div_yield if div_yield >= 1 else div_yield * 100, 4)
                else:
                    yield_pct = None

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
                    "yield_pct": yield_pct,
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
                # Yahoo throttling shows up as "Invalid Crumb" / "unable to access" /
                # a NoneType error from inside `.info`. Collapse those into one summary
                # line instead of a noisy per-ticker stack of warnings.
                msg = str(e)
                if "Crumb" in msg or "unable to access" in msg or "NoneType" in msg:
                    blocked += 1
                else:
                    logger.warning("yfinance dividend fetch failed for %s: %s", ticker, e)
        if blocked:
            logger.warning(
                "Yahoo blocked dividend lookups for %d/%d ticker(s) (rate limit / auth) — keeping cached values.",
                blocked, len(tickers),
            )
        return result

    try:
        return await asyncio.get_event_loop().run_in_executor(None, _sync_fetch)
    except Exception as e:
        logger.warning("Dividend details batch fetch failed: %s", e)
        return {}


async def _fetch_crypto_prices(ids: list[str]) -> dict[str, tuple[float, str]]:
    """Fetch current prices for crypto via CoinGecko free API."""

    if _backoff.blocked("coingecko"):
        logger.info("Skipping coingecko call — backing off after repeated failures")
        return {}
    await _throttle("coingecko")
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
        _backoff.record_failure("coingecko")
        return {}


async def fetch_isin_for_ticker(ticker: str) -> Optional[str]:
    """Look up a ticker's ISIN via yfinance (e.g. to backfill IBKR positions)."""

    if _backoff.blocked("yahoo"):
        logger.info("Skipping yahoo call — backing off after repeated failures")
        return None
    await _throttle("yahoo")
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

    if _backoff.blocked("yahoo"):
        logger.info("Skipping yahoo call — backing off after repeated failures")
        return []
    await _throttle("yahoo")
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

    if _backoff.blocked("openfigi"):
        logger.info("Skipping openfigi call — backing off after repeated failures")
        return []
    await _throttle("openfigi")
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


async def refresh_all_prices(db: AsyncSession, force: bool = False) -> int:
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

    # Skip tickers whose cached price is still fresh. The scheduler fires every
    # 15 min and the user can also refresh by hand; without this every trigger
    # re-hits the provider for prices that have not meaningfully moved.
    if not force:
        fresh_rows = (await db.execute(text("SELECT ticker, fetched_at FROM price_cache"))).all()
        cutoff = datetime.utcnow() - PRICE_TTL
        fresh: set[str] = set()
        for tkr, ts in fresh_rows:
            try:
                last = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts))
            except (ValueError, TypeError):
                continue
            if last >= cutoff:
                fresh.add(tkr)
        skipped = len([t for t in stock_tickers if t in fresh]) + len([c for c in crypto_ids if c in fresh])
        stock_tickers = [t for t in stock_tickers if t not in fresh]
        crypto_ids = [c for c in crypto_ids if c not in fresh]
        if skipped:
            logger.info("Price refresh: %d ticker(s) still fresh, skipped", skipped)
        if not stock_tickers and not crypto_ids:
            return 0

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
    # Dividend metadata comes from yfinance's `.info` endpoint, which Yahoo throttles
    # hard (HTTP 401 "Invalid Crumb"). It also changes rarely (quarterly at most), so
    # only refresh tickers whose cached data is missing or older than the TTL — this
    # keeps the 15-min price tick from hammering `.info` every cycle.
    div_count = 0
    hist_count = 0
    DIVIDEND_TTL = timedelta(hours=20)
    if stock_tickers:
        fresh_rows = await db.execute(text(
            "SELECT ticker, fetched_at FROM dividend_cache"
        ))
        fresh_at = {r[0]: r[1] for r in fresh_rows}
        stale_tickers = []
        for t in stock_tickers:
            ts = fresh_at.get(t)
            if not ts:
                stale_tickers.append(t)
                continue
            try:
                last = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts))
                if now - last >= DIVIDEND_TTL:
                    stale_tickers.append(t)
            except (ValueError, TypeError):
                stale_tickers.append(t)

        div_data = await _fetch_dividend_details(stale_tickers) if stale_tickers else {}
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
    # Guard placed after the cache lookup: a cached series is still worth serving
    # while the provider is being given a rest.
    if _backoff.blocked("yahoo"):
        logger.info("Skipping yahoo history call — backing off after repeated failures")
        return []
    await _throttle("yahoo")

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
        _backoff.record_success("yahoo")
        return result
    except Exception as e:
        logger.warning("Historical price fetch failed for %s: %s", ticker, e)
        _backoff.record_failure("yahoo")
        return []


async def warm_history_cache(db: AsyncSession, period: str = "2y") -> int:
    """Pre-fetch price history for every auto-priced holding, concurrently.

    `_history_cache` is in-memory with a 1h TTL, so without this the first request
    that needs history (the dashboard's net-worth chart) pays the full fetch — once
    per hour and after every restart. Called from the background startup task and
    the periodic price-refresh job so user requests find the cache warm.
    """
    # `price_locked != True` in SQL would also discard rows where the column is
    # NULL (the default is ORM-side), silently skipping a real holding — so the
    # lock is tested in Python, like everywhere else.
    tickers = sorted({
        h.ticker for h in (await db.execute(select(Holding))).scalars().all()
        if h.ticker and not h.price_locked
    })
    if not tickers:
        return 0
    await asyncio.gather(*(fetch_historical_prices(t, period) for t in tickers))
    logger.info("Warmed price history for %d ticker(s)", len(tickers))
    return len(tickers)
