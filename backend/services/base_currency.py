"""The profile's reporting ("base") currency.

It is chosen by the user's data, not by a hardcoded default: the first account a
profile creates sets it, and it stays editable in Paramètres → Général. A fresh
install used to be stamped "CHF" at startup, so someone whose only account was
in EUR saw every total converted to CHF with no hint why.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Account, Setting

# Only reachable while a profile has neither a stored setting nor any account —
# i.e. when there is nothing to display in it yet.
DEFAULT_BASE_CURRENCY = "EUR"

# Currencies the FX provider (Frankfurter) quotes, plus the ones accounts can be
# held in. A typo here silently breaks every conversion in the app, so it's
# validated rather than stored blindly.
ALLOWED_CURRENCIES = {
    "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
    "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD",
    "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
}


async def stored_base_currency(db: AsyncSession, pid: int) -> Optional[str]:
    """The base currency explicitly stored for this profile, if any."""
    return (await db.execute(
        select(Setting.value).where(Setting.key == "base_currency", Setting.profile_id == pid)
    )).scalar_one_or_none()


async def get_base_currency(db: AsyncSession, pid: int) -> str:
    """The currency this profile reports in: the stored setting, else the
    currency of its oldest account (a profile created before the setting was
    written), else the default."""
    stored = await stored_base_currency(db, pid)
    if stored:
        return stored
    first = (await db.execute(
        select(Account.currency).where(Account.profile_id == pid).order_by(Account.id).limit(1)
    )).scalar_one_or_none()
    return first if first in ALLOWED_CURRENCIES else DEFAULT_BASE_CURRENCY


async def adopt_base_currency(db: AsyncSession, pid: int, currency: Optional[str]) -> None:
    """Make `currency` the profile's base currency if it has none yet.

    Called when an account is created, so the first account decides. Never
    overwrites a stored value. The caller commits."""
    if currency not in ALLOWED_CURRENCIES:
        return
    if await stored_base_currency(db, pid) is None:
        db.add(Setting(profile_id=pid, key="base_currency", value=currency))
