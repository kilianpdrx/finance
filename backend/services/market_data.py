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

logger = logging.getLogger(__name__)

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
HTTP_TIMEOUT = 10.0


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
            "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at) "
            "VALUES (:ticker, :price_cents, :currency, :fetched_at)"
        ), {"ticker": ticker, "price_cents": price_cents, "currency": currency, "fetched_at": now})
        count += 1

    for coin_id, (price, currency) in crypto_prices.items():
        price_cents = round(price * 100)
        await db.execute(text(
            "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at) "
            "VALUES (:ticker, :price_cents, :currency, :fetched_at)"
        ), {"ticker": coin_id, "price_cents": price_cents, "currency": currency, "fetched_at": now})
        count += 1

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
