"""Binance: crypto balances read with a READ-ONLY API key, prices and history
from Binance's public market data.

The sync reads what the account holds, coin by coin, and keeps one position per
coin in the investment account the user chose (`binance_account_id`). Binance
is the authority on quantities; it gives no purchase price, so a new coin's cost
is unknown until the user types a PRU — and that PRU is kept from then on.

- **Read-only, enforced.** The secret is stored in the database, and so in
  every backup. A key that can trade, transfer or withdraw is refused before
  anything is read: a leaked read-only key cannot move money.
- **All or nothing.** Every wallet is read before anything is written. A coin
  missing because ONE read failed would otherwise be removed from the account.
- **Nothing dropped silently.** Wallets the sync does not read (margin,
  futures, bots…) are reported with their value; coins worth under 1 € or with
  no price on Binance are counted and named.
- **Secrets stay out of messages.** The key travels in a header, the signature
  in the URL: errors are re-raised `from None` with a French message and no
  URL (same rule as `ibkr_flex.FlexError`).

Prices are in EUR, through Binance's own pairs (`eur_route`). A coin can be worth
less than a cent, so a Binance price is stored in the price cache as FRACTIONAL
cents per unit; every amount computed from it is rounded to whole cents.
"""

import hashlib
import hmac
import logging
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Awaitable, Callable, Optional
from urllib.parse import urlencode

import httpx
from cachetools import TTLCache
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Account, AccountType, Holding
from services.base_currency import ALLOWED_CURRENCIES
from services.ibkr_flex import get_setting, set_setting

logger = logging.getLogger(__name__)

BINANCE = "binance"                     # Holding.sync_source of a synced position
BASE_URL = os.environ.get("BINANCE_BASE_URL", "https://api.binance.com").rstrip("/")
HTTP_TIMEOUT = 20.0
RECV_WINDOW_MS = 10_000
QUOTE = "EUR"                           # every Binance price is stated in euros
SMALL_CENTS = 100                       # a coin worth less than 1 € is not a position
COST_REVIEW_GROWTH = 0.01               # Earn rewards grow a quantity by far less between syncs

KEY = "binance_api_key"
SECRET = "binance_api_secret"
ACCOUNT = "binance_account_id"
AUTO_SYNC = "binance_auto_sync"
LAST_SYNC = "binance_last_sync"
LAST_STATUS = "binance_last_sync_status"

# Permissions a read-only key must NOT have, with what they would let a thief do.
_FORBIDDEN = {
    "enableWithdrawals": "retirer des fonds",
    "enableInternalTransfer": "transférer des fonds",
    "permitsUniversalTransfer": "transférer des fonds",
    "enableSpotAndMarginTrading": "trader",
    "enableMargin": "trader",
    "enableFutures": "trader",
    "enableVanillaOptions": "trader",
    "enablePortfolioMarginTrading": "trader",
    "enableFixApiTrade": "trader",
}
# Wallets the sync reads; `/sapi/v1/asset/wallet/balance` names them like this.
_READ_WALLETS = ("spot", "funding", "earn")


class BinanceError(Exception):
    """A Binance failure, with a French message fit for the user.

    `kind`: 'config' (the user must fix the key, the secret or the account: 400),
    'rate_limit' (429), 'transient' (Binance down or unreachable: 502)."""

    def __init__(self, message: str, kind: str = "transient", code: Optional[int] = None):
        super().__init__(message)
        self.kind = kind
        self.code = code            # Binance's own error code, when it gave one


def _client() -> httpx.AsyncClient:
    # One indirection so the tests can hand in a MockTransport.
    return httpx.AsyncClient(base_url=BASE_URL, timeout=HTTP_TIMEOUT)


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _join_fr(words: list[str]) -> str:
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " et " + words[-1]


# ── Requests ─────────────────────────────────────────────────────────────────

def sign(query: str, secret: str) -> str:
    """HMAC-SHA256 of the query string, hex — Binance's HMAC signature."""
    return hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()


def _error(status: int, code: Optional[int]) -> BinanceError:
    if code in (-2015, -2014) or status == 401:
        message, kind = ("Binance refuse la clé : vérifiez la clé API, que la lecture est autorisée et, si vous "
                         "avez restreint les adresses IP, que celle de cet ordinateur en fait partie.", "config")
    elif code == -1022:
        message, kind = "Binance refuse la signature : vérifiez la clé secrète.", "config"
    elif code == -1021:
        message, kind = "L'horloge de cet ordinateur est trop décalée pour Binance : remettez-la à l'heure.", "config"
    elif status in (418, 429):
        message, kind = "Binance limite les requêtes : réessayez dans quelques minutes.", "rate_limit"
    elif status == 451:
        message, kind = "Binance n'est pas accessible depuis ce pays.", "config"
    else:
        message, kind = f"Binance a répondu {status}.", "transient"
    return BinanceError(message, kind, code)


async def _send(client: httpx.AsyncClient, method: str, url: str, headers: Optional[dict] = None):
    """One request; any failure becomes a BinanceError without the URL."""
    try:
        resp = await client.request(method, url, headers=headers)
    except httpx.HTTPError:
        raise BinanceError("Binance ne répond pas : réessayez plus tard.") from None
    if resp.status_code == 200:
        try:
            return resp.json()
        except ValueError:
            raise BinanceError("Réponse de Binance illisible.") from None
    try:
        code = resp.json().get("code")
    except (ValueError, AttributeError):
        code = None
    raise _error(resp.status_code, code)


class Signed:
    """Signed USER_DATA requests with one key. Corrects for a clock that is off
    (-1021) once, from Binance's server time."""

    def __init__(self, client: httpx.AsyncClient, key: str, secret: str):
        self.client, self.key, self.secret = client, key, secret
        self.offset_ms = 0

    async def __call__(self, method: str, path: str, **params):
        for attempt in (1, 2):
            query = urlencode({**params, "recvWindow": RECV_WINDOW_MS,
                               "timestamp": int(time.time() * 1000) + self.offset_ms})
            try:
                return await _send(self.client, method, f"{path}?{query}&signature={sign(query, self.secret)}",
                                   headers={"X-MBX-APIKEY": self.key})
            except BinanceError as e:
                if attempt == 2 or e.code != -1021:
                    raise
                server = await _send(self.client, "GET", "/api/v3/time")
                self.offset_ms = int(server["serverTime"]) - int(time.time() * 1000)


Call = Callable[..., Awaitable]


async def check_read_only(call: Call) -> None:
    """Refuse a key that can do more than read (see the module docstring)."""
    perms = await call("GET", "/sapi/v1/account/apiRestrictions")
    if not perms.get("enableReading"):
        raise BinanceError("Cette clé ne peut pas lire le compte : cochez « Enable Reading » dans Binance.", "config")
    extra = list(dict.fromkeys(label for flag, label in _FORBIDDEN.items() if perms.get(flag)))
    if extra:
        raise BinanceError(
            f"Cette clé peut aussi {_join_fr(extra)}. Créez une clé en lecture seule (« Enable Reading » "
            "uniquement) : elle est enregistrée dans la base et dans chaque sauvegarde.", "config")


# ── Balances ─────────────────────────────────────────────────────────────────

@dataclass
class Balances:
    quantities: dict[str, float]                        # coin → total over the wallets read
    unread_wallets: list[tuple[str, float]] = field(default_factory=list)  # (wallet, value in BTC)


async def _paged(call: Call, path: str) -> list[dict]:
    rows: list[dict] = []
    for page in range(1, 51):
        res = await call("GET", path, current=page, size=100)
        batch = res.get("rows") or []
        rows += batch
        if not batch or len(rows) >= int(res.get("total") or 0):
            break
    return rows


async def read_balances(call: Call) -> Balances:
    """What the account holds, per coin. Raises if ANY wallet cannot be read."""
    spot = await call("POST", "/sapi/v3/asset/getUserAsset")
    funding = await call("POST", "/sapi/v1/asset/get-funding-asset")
    flexible = await _paged(call, "/sapi/v1/simple-earn/flexible/position")
    locked = await _paged(call, "/sapi/v1/simple-earn/locked/position")
    wallets = await call("GET", "/sapi/v1/asset/wallet/balance")

    qty: dict[str, float] = defaultdict(float)
    for row in spot + funding:
        qty[row["asset"].upper()] += _num(row.get("free")) + _num(row.get("locked")) + _num(row.get("freeze"))
    earning = set()
    for row in flexible:
        qty[row["asset"].upper()] += _num(row.get("totalAmount"))
        earning.add(row["asset"].upper())
    for row in locked:
        qty[row["asset"].upper()] += _num(row.get("amount"))
    # Binance can show a flexible Earn position in Spot as an `LD{coin}` receipt:
    # the position itself is already counted. Only a receipt OF a coin in Earn
    # goes — LDO (Lido) is a coin of its own.
    for asset in [a for a in qty if a.startswith("LD") and a[2:] in earning]:
        del qty[asset]

    unread = [(w.get("walletName") or "?", _num(w.get("balance"))) for w in wallets
              if _num(w.get("balance")) > 0
              and not any(name in (w.get("walletName") or "").lower() for name in _READ_WALLETS)]
    return Balances({a: q for a, q in qty.items() if q > 0}, unread)


async def coin_names(call: Call) -> dict[str, str]:
    """'BTC' → 'Bitcoin'. Cosmetic: a failure leaves the codes as names."""
    try:
        rows = await call("GET", "/sapi/v1/capital/config/getall")
    except BinanceError as e:
        logger.info("Binance coin names unavailable: %s", e)
        return {}
    return {r["coin"].upper(): (r.get("name") or r["coin"]) for r in rows if r.get("coin")}


# ── Prices and history (public market data) ──────────────────────────────────

_pairs_cache: TTLCache = TTLCache(maxsize=1, ttl=24 * 3600)
_history_cache: TTLCache = TTLCache(maxsize=200, ttl=3600)


async def _trading_pairs(client: httpx.AsyncClient) -> set[str]:
    """Symbols currently trading. `ticker/price` also lists dead pairs, with
    their last — stale — price, so a route only uses a pair from this set."""
    if "pairs" not in _pairs_cache:
        info = await _send(client, "GET", "/api/v3/exchangeInfo?symbolStatus=TRADING")
        _pairs_cache["pairs"] = {s["symbol"] for s in info.get("symbols", [])}
    return _pairs_cache["pairs"]


def eur_route(asset: str, trading: set[str]) -> Optional[list[tuple[str, int]]]:
    """How to price `asset` in euros from Binance pairs: a product of pair
    prices, each raised to ±1. [] for the euro itself, None when no route."""
    a = asset.upper()
    if a == QUOTE:
        return []
    for route in (
        [(f"{a}{QUOTE}", 1)],                              # BTCEUR
        [(f"{QUOTE}{a}", -1)],                             # EURUSDT → USDT
        [(f"{a}USDT", 1), (f"{QUOTE}USDT", -1)],           # via the dollar stablecoin
        [(f"{a}BTC", 1), (f"BTC{QUOTE}", 1)],              # via bitcoin
    ):
        if all(sym in trading for sym, _ in route):
            return route
    return None


async def eur_prices(assets) -> dict[str, float]:
    """Price of one unit of each coin, in euros. A coin with no route is absent."""
    async with _client() as client:
        trading = await _trading_pairs(client)
        last = {p["symbol"]: _num(p["price"]) for p in await _send(client, "GET", "/api/v3/ticker/price")}
    out: dict[str, float] = {}
    for asset in assets:
        route = eur_route(asset, trading)
        if route is None or any(last.get(sym, 0) <= 0 for sym, _ in route):
            continue
        price = 1.0
        for sym, power in route:
            price *= last[sym] ** power
        out[asset.upper()] = price
    return out


_PERIOD_DAYS = {"1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827}


async def eur_history(asset: str, period: str = "1y") -> list[dict]:
    """Daily closes of `asset` in euros ([{date, close}]), weekly beyond 1000
    days (the most Binance returns at once). [] when there is no route."""
    key = (asset.upper(), period)
    if key in _history_cache:
        return _history_cache[key]
    days = _PERIOD_DAYS.get(period, 366)
    interval, limit = ("1d", days) if days <= 1000 else ("1w", days // 7 + 1)
    async with _client() as client:
        route = eur_route(asset, await _trading_pairs(client))
        if not route:
            return []
        legs = []
        for sym, power in route:
            candles = await _send(client, "GET", f"/api/v3/klines?{urlencode({'symbol': sym, 'interval': interval, 'limit': limit})}")
            legs.append(({datetime.fromtimestamp(c[0] / 1000, tz=timezone.utc).date().isoformat(): _num(c[4])
                          for c in candles}, power))
    dates = sorted(set.intersection(*(set(closes) for closes, _ in legs)))
    series = []
    for d in dates:
        close = 1.0
        for closes, power in legs:
            close *= closes[d] ** power
        series.append({"date": d, "close": close})
    _history_cache[key] = series
    return series


async def store_prices(db: AsyncSession, prices: dict[str, float]) -> None:
    """Write Binance prices to the price cache under their own keys (`price_key`)."""
    now = datetime.utcnow()
    for asset, price in prices.items():
        await db.execute(text(
            "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
            "VALUES (:ticker, :price_cents, :currency, :fetched_at, 'live')"
        ), {"ticker": price_key_for(asset), "price_cents": price * 100, "currency": QUOTE, "fetched_at": now})


def price_key_for(asset: str) -> str:
    """Price-cache key of a Binance coin. Never the bare code: Yahoo's "BTC" is
    a NYSE-listed ETF, and the two must not share a price."""
    return f"BINANCE:{asset.upper()}"


# ── The sync ─────────────────────────────────────────────────────────────────

@dataclass
class Line:
    asset: str
    name: str
    is_cash: bool
    quantity: float
    previous_quantity: Optional[float]
    price_cents: Optional[float]        # one unit, in euros (fractional for small coins)
    value_cents: Optional[int]          # in euros
    status: str                         # new | updated | unchanged | removed
    review_cost: bool = False           # bought more since the PRU was typed
    holding_id: Optional[int] = None


@dataclass
class Plan:
    account_id: int
    lines: list[Line]
    small_count: int
    small_cents: int
    unpriced: list[str]
    unread_wallets: list[tuple[str, int]]   # (wallet, value in euro cents)
    prices: dict[str, float]                # euros per unit, written to the price cache with the plan

    @property
    def total_cents(self) -> int:
        return sum(ln.value_cents or 0 for ln in self.lines if ln.status != "removed")


async def status(db: AsyncSession, pid: int) -> dict:
    """For the Paramètres tab and the sync button. Never the key or the secret."""
    acct = await get_setting(db, pid, ACCOUNT)
    return {
        "configured": bool(await get_setting(db, pid, KEY) and await get_setting(db, pid, SECRET)
                           and acct and acct.isdigit()),
        "has_key": bool(await get_setting(db, pid, KEY)),
        "has_secret": bool(await get_setting(db, pid, SECRET)),
        "account_id": int(acct) if acct and acct.isdigit() else None,
        "auto_sync": (await get_setting(db, pid, AUTO_SYNC)) == "true",
        "last_sync": await get_setting(db, pid, LAST_SYNC),
        "last_status": await get_setting(db, pid, LAST_STATUS),
    }


async def _credentials(db: AsyncSession, pid: int) -> tuple[str, str]:
    key, secret = await get_setting(db, pid, KEY), await get_setting(db, pid, SECRET)
    if not key or not secret:
        raise BinanceError("Binance n'est pas configuré : enregistrez la clé API et la clé secrète.", "config")
    return key, secret


async def _target_account(db: AsyncSession, pid: int) -> Account:
    raw = await get_setting(db, pid, ACCOUNT)
    acc = await db.get(Account, int(raw)) if raw and raw.isdigit() else None
    if (acc is None or acc.profile_id != pid or not acc.is_active
            or acc.account_type != AccountType.investissement):
        raise BinanceError("Choisissez le compte d'investissement qui reçoit les positions Binance.", "config")
    return acc


async def test_connection(db: AsyncSession, pid: int) -> dict:
    """The key works and can only read. Reads nothing else."""
    key, secret = await _credentials(db, pid)
    async with _client() as client:
        await check_read_only(Signed(client, key, secret))
    return {"read_only": True}


async def build_plan(db: AsyncSession, pid: int) -> Plan:
    """Read Binance and work out what a sync would change. Writes nothing."""
    from routers.investments import CASH_NAME

    acc = await _target_account(db, pid)
    key, secret = await _credentials(db, pid)
    async with _client() as client:
        call = Signed(client, key, secret)
        await check_read_only(call)
        balances = await read_balances(call)
        existing = (await db.execute(
            select(Holding).where(Holding.account_id == acc.id, Holding.profile_id == pid)
        )).scalars().all()
        synced = {h.ticker.upper(): h for h in existing if h.sync_source == BINANCE}
        new_codes = [a for a in balances.quantities if _ticker(a) not in synced]
        names = await coin_names(call) if new_codes else {}
    prices = await eur_prices(set(balances.quantities) | {_code(h) for h in synced.values()} | {"BTC"})

    # A position typed by hand with the same code is adopted rather than
    # colliding with it on the (account, ticker) constraint.
    by_ticker = {h.ticker.upper(): h for h in existing}
    lines: list[Line] = []
    small_count = small_cents = 0
    unpriced: list[str] = []
    kept: set[int] = set()
    for asset, qty in sorted(balances.quantities.items()):
        is_cash = asset in ALLOWED_CURRENCIES
        price = prices.get(asset)
        if price is None and not is_cash:
            unpriced.append(asset)
            continue
        value = round(qty * price * 100) if price is not None else None
        if (value if value is not None else round(qty * 100)) < SMALL_CENTS:
            small_count += 1
            small_cents += value or 0
            continue
        ex = synced.get(_ticker(asset)) or by_ticker.get(_ticker(asset))
        if ex is not None:
            kept.add(ex.id)
        same = ex is not None and abs(ex.quantity - qty) <= 1e-9 * max(1.0, qty)
        lines.append(Line(
            asset=asset,
            name=ex.name if ex is not None else (CASH_NAME if is_cash else names.get(asset, asset)),
            is_cash=is_cash,
            quantity=qty,
            previous_quantity=ex.quantity if ex is not None else None,
            price_cents=price * 100 if price is not None else None,
            value_cents=value,
            status="new" if ex is None else ("unchanged" if same and ex.sync_source == BINANCE else "updated"),
            review_cost=(ex is not None and not is_cash and ex.cost_basis_cents is not None
                         and qty > ex.quantity * (1 + COST_REVIEW_GROWTH)),
            holding_id=ex.id if ex is not None else None,
        ))
    for h in synced.values():
        if h.id in kept:
            continue
        price = prices.get(_code(h))
        lines.append(Line(
            asset=_code(h), name=h.name, is_cash=h.asset_type == "cash", quantity=0.0,
            previous_quantity=h.quantity, price_cents=price * 100 if price is not None else None,
            value_cents=round(h.quantity * price * 100) if price is not None else None,
            status="removed", holding_id=h.id,
        ))
    btc = prices.get("BTC")
    unread = [(name, round(value * btc * 100) if btc else 0) for name, value in balances.unread_wallets]
    return Plan(acc.id, lines, small_count, small_cents, unpriced, unread, prices)


def _ticker(asset: str) -> str:
    """Binance code → ticker of the position: the coin's code, or CASH.EUR for euros."""
    return f"CASH.{asset}" if asset in ALLOWED_CURRENCIES else asset


def _code(h: Holding) -> str:
    return h.ticker.upper().removeprefix("CASH.")


async def apply_plan(db: AsyncSession, pid: int, plan: Plan) -> dict:
    """Write a plan. Binance is the authority on quantities; a known cost keeps
    its PRU (cost per unit) as the quantity changes. Does NOT commit."""
    from routers.investments import CASH_ASSET_TYPE, _normalize_cash_holding

    created = updated = removed = 0
    today = date.today()
    for ln in plan.lines:
        h = await db.get(Holding, ln.holding_id) if ln.holding_id else None
        if ln.status == "removed":
            if h is not None:
                await db.delete(h)
                removed += 1
            continue
        if h is None:
            h = Holding(
                account_id=plan.account_id, profile_id=pid, ticker=_ticker(ln.asset), name=ln.name,
                quantity=ln.quantity, cost_basis_cents=None, currency=ln.asset if ln.is_cash else QUOTE,
                asset_type=CASH_ASSET_TYPE if ln.is_cash else "crypto", added_date=today, sync_source=BINANCE,
            )
            _normalize_cash_holding(h)
            db.add(h)
            created += 1
            continue
        if ln.status == "unchanged":
            continue
        if h.sync_source != BINANCE and not ln.is_cash and h.currency != QUOTE:
            # Adopted from a hand-made line priced in another currency: its cost
            # was in that currency, and is not converted on a guess.
            h.cost_basis_cents = None
        elif h.cost_basis_cents is not None and not ln.is_cash and h.quantity > 0:
            h.cost_basis_cents = round(h.cost_basis_cents * ln.quantity / h.quantity)
        h.quantity = ln.quantity
        h.sync_source = BINANCE
        if not ln.is_cash:
            h.currency, h.asset_type, h.price_locked = QUOTE, "crypto", False
        _normalize_cash_holding(h)
        updated += 1
    await store_prices(db, {a: p for a, p in plan.prices.items() if a not in ALLOWED_CURRENCIES})
    return {"created": created, "updated": updated, "removed": removed}


async def record(db: AsyncSession, pid: int, ok: bool, detail: str) -> None:
    await set_setting(db, pid, LAST_SYNC, datetime.utcnow().isoformat(timespec="seconds"))
    await set_setting(db, pid, LAST_STATUS, f"{'ok' if ok else 'erreur'}: {detail}")
    await db.commit()


def summary(counts: dict) -> str:
    parts = [f"{counts['created']} nouvelle(s)", f"{counts['updated']} mise(s) à jour"]
    if counts["removed"]:
        parts.append(f"{counts['removed']} retirée(s)")
    return ", ".join(parts)


async def sync(db: AsyncSession, pid: int) -> tuple[Plan, dict]:
    """Read Binance and apply it. Raises BinanceError, after recording it."""
    try:
        plan = await build_plan(db, pid)
    except BinanceError as e:
        await db.rollback()
        await record(db, pid, ok=False, detail=str(e))
        raise
    counts = await apply_plan(db, pid, plan)
    await db.commit()
    await record(db, pid, ok=True, detail=summary(counts))
    return plan, counts
