import logging
import time
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy import select, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import ExchangeRate

logger = logging.getLogger(__name__)

FRANKFURTER_BASE = "https://api.frankfurter.app"
HTTP_TIMEOUT = 5.0

_fail_cache: dict[tuple[str, str], float] = {}
_FAIL_TTL = 300


def _is_pair_failed(base: str, target: str) -> bool:
    key = (base, target)
    ts = _fail_cache.get(key)
    if ts is None:
        return False
    if time.monotonic() - ts > _FAIL_TTL:
        del _fail_cache[key]
        return False
    return True


def _mark_pair_failed(base: str, target: str) -> None:
    _fail_cache[(base, target)] = time.monotonic()


async def get_rate(
    db: AsyncSession,
    base: str,
    target: str,
    on_date: date,
) -> Optional[float]:
    if base == target:
        return 1.0

    result = await db.execute(
        select(ExchangeRate.rate)
        .where(and_(
            ExchangeRate.base_currency == base,
            ExchangeRate.target_currency == target,
            ExchangeRate.date <= on_date,
        ))
        .order_by(ExchangeRate.date.desc())
        .limit(1)
    )
    cached = result.scalar_one_or_none()
    if cached is not None:
        return cached

    if _is_pair_failed(base, target):
        return None

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(
                f"{FRANKFURTER_BASE}/{on_date.isoformat()}",
                params={"from": base, "to": target},
            )
            resp.raise_for_status()
            data = resp.json()
            rate = data.get("rates", {}).get(target)
            if rate is not None:
                db.add(ExchangeRate(
                    base_currency=base,
                    target_currency=target,
                    date=on_date,
                    rate=rate,
                    fetched_at=datetime.utcnow(),
                ))
                await db.commit()
                return rate
    except Exception as e:
        logger.warning("FX fetch failed for %s→%s on %s: %s", base, target, on_date, e)
        _mark_pair_failed(base, target)

    return None


async def convert_cents_checked(
    db: AsyncSession,
    amount_cents: int,
    from_ccy: str,
    to_ccy: str,
    on_date: date,
) -> tuple[int, bool]:
    """Convert `amount_cents` from `from_ccy` to `to_ccy` at `on_date`.

    Returns ``(converted_cents, ok)``. ``ok`` is ``False`` only when a real
    conversion was needed (``from != to``) but no rate could be found — in that
    case the amount is returned unconverted (a lossy fallback) and callers can
    surface that the figures are provisional (see ``fx_incomplete``).
    """
    if from_ccy == to_ccy:
        return amount_cents, True
    rate = await get_rate(db, from_ccy, to_ccy, on_date)
    if rate is None:
        return amount_cents, False
    return round(amount_cents * rate), True


async def convert_cents(
    db: AsyncSession,
    amount_cents: int,
    from_ccy: str,
    to_ccy: str,
    on_date: date,
) -> int:
    converted, _ = await convert_cents_checked(db, amount_cents, from_ccy, to_ccy, on_date)
    return converted


async def backfill_range(
    db: AsyncSession,
    base: str,
    target: str,
    from_date: date,
    to_date: date,
) -> int:
    if base == target:
        return 0

    if _is_pair_failed(base, target):
        return 0

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                f"{FRANKFURTER_BASE}/{from_date.isoformat()}..{to_date.isoformat()}",
                params={"from": base, "to": target},
            )
            resp.raise_for_status()
            data = resp.json()

        rates = data.get("rates", {})
        count = 0
        for date_str, rate_dict in rates.items():
            rate_val = rate_dict.get(target)
            if rate_val is None:
                continue
            await db.execute(
                text(
                    "INSERT OR IGNORE INTO exchange_rates "
                    "(base_currency, target_currency, date, rate, fetched_at) "
                    "VALUES (:base, :target, :date, :rate, :now)"
                ),
                {"base": base, "target": target, "date": date_str, "rate": rate_val, "now": datetime.utcnow()},
            )
            count += 1
        await db.commit()
        logger.info("Backfilled %d rates for %s→%s (%s to %s)", count, base, target, from_date, to_date)
        return count
    except Exception as e:
        logger.warning("FX backfill failed for %s→%s: %s", base, target, e)
        _mark_pair_failed(base, target)
        return 0


async def refresh_latest(
    db: AsyncSession,
    currencies: list[str],
    base_currency: str,
) -> None:
    for ccy in currencies:
        if ccy == base_currency:
            continue
        if _is_pair_failed(ccy, base_currency):
            continue
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
                resp = await client.get(
                    f"{FRANKFURTER_BASE}/latest",
                    params={"from": ccy, "to": base_currency},
                )
                resp.raise_for_status()
                data = resp.json()
                rate = data.get("rates", {}).get(base_currency)
                if rate is not None:
                    today = date.today()
                    await db.execute(
                        text(
                            "INSERT OR REPLACE INTO exchange_rates "
                            "(base_currency, target_currency, date, rate, fetched_at) "
                            "VALUES (:base, :target, :date, :rate, :now)"
                        ),
                        {"base": ccy, "target": base_currency, "date": today.isoformat(), "rate": rate, "now": datetime.utcnow()},
                    )
            await db.commit()
            logger.info("Refreshed latest rate %s→%s: %s", ccy, base_currency, rate)
        except Exception as e:
            logger.warning("FX refresh failed for %s→%s: %s", ccy, base_currency, e)
            _mark_pair_failed(ccy, base_currency)
