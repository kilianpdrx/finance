"""IBKR Flex Web Service integration.

Fetches *open positions* directly from Interactive Brokers via the Flex Web
Service (a token + saved-query handshake) and feeds them through the exact same
import pipeline as a CSV upload. IBKR is treated as the source of position
*structure* (quantity, cost basis, ISIN) — live prices keep coming from yfinance.

The Flex flow is a 2-step handshake:
  1. SendRequest(token, query_id) -> ReferenceCode + a per-request statement URL.
  2. GetStatement(url, ref, token) -> the full statement XML. The statement is
     compiled asynchronously server-side, so the first download may return a
     "still generating" response and we poll with backoff.
"""

import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import date, datetime

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import Setting, Holding
from services.holdings_csv_parser import ParsedHolding

logger = logging.getLogger(__name__)

FLEX_VERSION = "3"
SEND_REQUEST_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest"
HTTP_TIMEOUT = 30.0          # statements can be large/slow; market_data uses 10s
POLL_MAX_ATTEMPTS = 5
POLL_BACKOFF_SECONDS = 4.0
INITIAL_WAIT_SECONDS = 4.0   # give the server a head start before the first download

# Minimum seconds between manual syncs (Flex Web Service throttles repeated runs).
MIN_SYNC_INTERVAL_SECONDS = 300

ASSET_CATEGORY_MAP = {
    "STK": "stock",
    "ETF": "etf",
    "FUND": "fund",
    "MF": "fund",
    "CRYPTO": "crypto",
    "BOND": "bond",
    "BILL": "bond",
}


class FlexError(Exception):
    """A Flex Web Service failure.

    `kind` lets callers decide how to react: 'config' (user must fix creds, surface
    as 400), 'rate_limit' (throttled, surface as 429), 'transient'/'parse' (502 /
    silent no-op in background jobs).
    """

    def __init__(self, message: str, kind: str = "transient"):
        super().__init__(message)
        self.kind = kind


# ── Settings helpers (shared with the router) ────────────────────────────────

async def get_setting(db: AsyncSession, pid: int, key: str) -> str | None:
    row = await db.execute(select(Setting).where(Setting.key == key, Setting.profile_id == pid))
    s = row.scalar_one_or_none()
    return s.value if s else None


async def set_setting(db: AsyncSession, pid: int, key: str, value: str) -> None:
    row = await db.execute(select(Setting).where(Setting.key == key, Setting.profile_id == pid))
    s = row.scalar_one_or_none()
    if s:
        s.value = value
    else:
        db.add(Setting(key=key, value=value, profile_id=pid))


async def record_sync(db: AsyncSession, pid: int, ok: bool, detail: str) -> None:
    """Persist the last-sync status, and (only on success) the rate-limit clock.

    The `ibkr_last_sync` timestamp drives the min-interval guard, so a *failed*
    attempt must NOT update it — otherwise a config error would lock the user out
    of retrying for the whole interval. Failures only update the status string."""
    if ok:
        await set_setting(db, pid, "ibkr_last_sync", datetime.utcnow().isoformat(timespec="seconds"))
    await set_setting(db, pid, "ibkr_last_sync_status", f"{'ok' if ok else 'erreur'}: {detail}")
    await db.commit()


# ── Flex Web Service handshake ───────────────────────────────────────────────

async def _send_request(client: httpx.AsyncClient, token: str, query_id: str) -> tuple[str, str]:
    """Step 1: returns (reference_code, statement_url). Raises FlexError on Fail."""
    resp = await client.get(SEND_REQUEST_URL, params={"t": token, "q": query_id, "v": FLEX_VERSION})
    resp.raise_for_status()
    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as e:
        raise FlexError(f"Réponse SendRequest illisible: {e}", kind="parse")

    status = (root.findtext("Status") or "").strip()
    if status != "Success":
        msg = (root.findtext("ErrorMessage") or "Erreur Flex inconnue").strip()
        code = (root.findtext("ErrorCode") or "").strip()
        # 1018/1019: too many requests / throttled.
        kind = "rate_limit" if code in {"1018", "1019"} else "config"
        raise FlexError(f"IBKR a refusé la requête ({code}): {msg}", kind=kind)

    ref = (root.findtext("ReferenceCode") or "").strip()
    url = (root.findtext("Url") or "").strip()
    if not ref or not url:
        raise FlexError("Réponse SendRequest incomplète (ReferenceCode/Url manquants)", kind="parse")
    return ref, url


def _rewrite_host(url: str) -> str:
    # Working-script DNS workaround: the statement URL sometimes comes back on
    # `gdcdyn` which fails to resolve; `ndcdyn` serves the same content. Isolated
    # here so it's a one-line removal if IBKR ever fixes it (harmless either way).
    return url.replace("gdcdyn.interactivebrokers.com", "ndcdyn.interactivebrokers.com")


async def _get_statement(client: httpx.AsyncClient, statement_url: str, ref: str, token: str) -> str:
    """Step 3: download the statement, polling while it's still generating."""
    url = _rewrite_host(statement_url)
    last_err = "no attempt made"
    for attempt in range(1, POLL_MAX_ATTEMPTS + 1):
        resp = await client.get(url, params={"q": ref, "t": token, "v": FLEX_VERSION})
        resp.raise_for_status()
        body = resp.text
        # A ready statement is a <FlexQueryResponse>; the not-ready / error reply
        # is a <FlexStatementResponse> (same shape as the handshake).
        if "<FlexQueryResponse" in body:
            return body
        try:
            root = ET.fromstring(body)
            last_err = (root.findtext("ErrorMessage") or root.findtext("Status") or "en génération").strip()
        except ET.ParseError:
            last_err = "réponse illisible"
        logger.info("IBKR statement not ready (attempt %d/%d): %s", attempt, POLL_MAX_ATTEMPTS, last_err)
        if attempt < POLL_MAX_ATTEMPTS:
            await asyncio.sleep(POLL_BACKOFF_SECONDS)
    raise FlexError(f"Relevé IBKR non prêt après {POLL_MAX_ATTEMPTS} tentatives: {last_err}", kind="transient")


async def fetch_flex_statement(token: str, query_id: str) -> str:
    """Full handshake + poll. Returns the raw statement XML. Raises FlexError."""
    if not token or not query_id:
        raise FlexError("Token ou identifiant de requête IBKR non configuré", kind="config")
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        ref, url = await _send_request(client, token, query_id)
        await asyncio.sleep(INITIAL_WAIT_SECONDS)
        return await _get_statement(client, url, ref, token)


# ── Statement parsing ────────────────────────────────────────────────────────

def _float(s: str | None) -> float:
    try:
        return float(s) if s not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def parse_open_positions(xml_text: str, target_account: str | None = None) -> list[ParsedHolding]:
    """Map <OpenPosition> elements to ParsedHolding (the CSV import dataclass).

    When no `target_account` filter is given and the same symbol appears under
    several IBKR accounts, positions are summed (guards Holding's unique
    (account_id, ticker) constraint, since one Flex query → one internal account).
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise FlexError(f"Relevé IBKR illisible: {e}", kind="parse")

    merged: dict[str, dict] = {}
    for op in root.iter("OpenPosition"):
        a = op.attrib
        if target_account and a.get("accountId") and a["accountId"] != target_account:
            continue
        symbol = (a.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        qty = _float(a.get("position"))
        if qty == 0:
            continue

        cat = (a.get("assetCategory") or "").strip().upper()
        asset_type = ASSET_CATEGORY_MAP.get(cat, "stock")
        if cat == "STK" and "ETF" in (a.get("subCategory") or "").upper():
            asset_type = "etf"

        key = symbol
        if key not in merged:
            merged[key] = {
                "ticker": symbol,
                "name": (a.get("description") or symbol).strip(),
                "quantity": 0.0,
                "cost_money": 0.0,
                "currency": (a.get("currency") or "USD").strip(),
                "asset_type": asset_type,
                "isin": (a.get("isin") or "").strip() or None,
                "mark": _float(a.get("markPrice")),
            }
        m = merged[key]
        m["quantity"] += qty
        m["cost_money"] += _float(a.get("costBasisMoney"))
        # Keep first non-empty isin / latest mark price.
        if not m["isin"] and a.get("isin"):
            m["isin"] = a["isin"].strip()
        mark = _float(a.get("markPrice"))
        if mark > 0:
            m["mark"] = mark

    out: list[ParsedHolding] = []
    for m in merged.values():
        mark = m["mark"]
        out.append(ParsedHolding(
            ticker=m["ticker"],
            name=m["name"],
            quantity=m["quantity"],
            cost_basis_cents=round(m["cost_money"] * 100),
            currency=m["currency"],
            asset_type=m["asset_type"],
            isin=m["isin"],
            last_price_cents=round(mark * 100) if mark > 0 else None,
        ))
    return out


# ── Dividend parsing (PROTOTYPE — assessment only, no production use) ─────────

def _attr_date(a: dict, *keys: str) -> str | None:
    """Return the first present date attribute, normalised to ISO `yyyy-MM-dd`.

    The Flex queries are configured for `yyyy-MM-dd` dates + `HH:mm:ss` time, so a
    dateTime looks like `2026-04-27 14:30:00` (or `;`/`T`-separated). We also accept
    the compact `yyyyMMdd` and legacy `dd/MM/yyyy` shapes for resilience."""
    for k in keys:
        v = (a.get(k) or "").strip()
        if not v:
            continue
        token = v.replace("T", " ").replace(";", " ").split(" ")[0]  # drop the time part
        # ISO already (yyyy-MM-dd…)
        if len(token) >= 10 and token[4] == "-" and token[7] == "-":
            return token[:10]
        # Compact yyyyMMdd
        if len(token) == 8 and token.isdigit():
            return f"{token[:4]}-{token[4:6]}-{token[6:8]}"
        # Legacy dd/MM/yyyy
        if "/" in token:
            d, m, y = (token.split("/") + ["", "", ""])[:3]
            if len(y) == 4:
                return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        return token[:10]
    return None


def parse_dividends(xml_text: str) -> dict:
    """Parse the dividend-related sections an IBKR Flex statement may carry.

    Handles three shapes (a query can include any subset):
      • CashTransaction (type contains "Dividend" or "Withholding Tax") → realised cash.
      • OpenDividendAccrual / ChangeInDividendAccrual → upcoming / accrued amounts.
    Returns {events, accruals, sections} — purely for assessment, no DB writes.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise FlexError(f"Relevé dividendes IBKR illisible: {e}", kind="parse")

    sections: dict[str, int] = {}
    for el in root.iter():
        if el.tag in (
            "CashTransaction", "OpenDividendAccrual", "ChangeInDividendAccrual",
            "OpenPosition", "Trade",
        ):
            sections[el.tag] = sections.get(el.tag, 0) + 1

    events: list[dict] = []
    for ct in root.iter("CashTransaction"):
        a = ct.attrib
        ttype = (a.get("type") or "").strip()
        if "Dividend" not in ttype and "Withholding" not in ttype:
            continue
        events.append({
            "symbol": (a.get("symbol") or "").strip().upper() or None,
            "isin": (a.get("isin") or "").strip() or None,
            "description": (a.get("description") or "").strip(),
            "type": ttype,
            "date": _attr_date(a, "dateTime", "settleDate", "reportDate"),
            "amount": _float(a.get("amount")),
            "currency": (a.get("currency") or "").strip() or None,
        })

    accruals: list[dict] = []
    for tag in ("OpenDividendAccrual", "ChangeInDividendAccrual"):
        for ac in root.iter(tag):
            a = ac.attrib
            accruals.append({
                "kind": tag,
                "symbol": (a.get("symbol") or "").strip().upper() or None,
                "isin": (a.get("isin") or "").strip() or None,
                "ex_date": _attr_date(a, "exDate"),
                "pay_date": _attr_date(a, "payDate"),
                "quantity": _float(a.get("quantity")),
                "gross_rate": _float(a.get("grossRate")),
                "gross_amount": _float(a.get("grossAmount")),
                "tax": _float(a.get("tax")),
                "net_amount": _float(a.get("netAmount")),
                "currency": (a.get("currency") or "").strip() or None,
            })

    return {"events": events, "accruals": accruals, "sections": sections}


# ── High-level sync (silent / auto mode) ─────────────────────────────────────

async def sync_ibkr_holdings(db: AsyncSession, profile_id: int, mode: str = "auto") -> dict:
    """Fetch IBKR positions and reconcile them into the configured account.

    mode="auto": silently upsert (used on app launch and the optional sync-now
    endpoint). Never raises — logs and returns {"ok": False, "reason": ...}.

    Returns a report dict.
    """
    token = await get_setting(db, profile_id, "ibkr_flex_token")
    query = await get_setting(db, profile_id, "ibkr_query_id")
    acct_raw = await get_setting(db, profile_id, "ibkr_account_id")
    acct = int(acct_raw) if acct_raw and acct_raw.isdigit() else None

    if not token or not query or not acct:
        return {"ok": False, "reason": "not_configured"}

    try:
        xml = await fetch_flex_statement(token, query)
        parsed = parse_open_positions(xml)
    except FlexError as e:
        logger.warning("IBKR sync failed (profile %d): %s", profile_id, e)
        await record_sync(db, profile_id, ok=False, detail=str(e))
        return {"ok": False, "reason": str(e), "kind": e.kind}

    report = await reconcile_holdings(db, profile_id, acct, parsed)
    await db.commit()

    # Price the freshly-added tickers immediately (best-effort, like the CSV path).
    try:
        from services.market_data import refresh_all_prices
        await refresh_all_prices(db)
    except Exception as e:
        logger.warning("Post-IBKR price refresh failed: %s", e)

    detail = f"{report['created']} créées, {report['updated']} maj, {len(report['vanished'])} absentes"
    await record_sync(db, profile_id, ok=True, detail=detail)
    return {"ok": True, **report}


async def reconcile_holdings(
    db: AsyncSession, profile_id: int, account_id: int, parsed: list[ParsedHolding]
) -> dict:
    """Upsert parsed positions into `account_id`. IBKR is authoritative for
    quantity & cost basis; manual ticker edits survive; vanished positions are
    flagged (in `notes`) but never deleted. Does NOT commit."""
    from routers.investments import find_matching_holding
    from services.market_data import resolve_yahoo_symbol

    existing = (await db.execute(
        select(Holding).where(Holding.account_id == account_id, Holding.profile_id == profile_id)
    )).scalars().all()

    today = date.today()
    now = datetime.utcnow()
    created = updated = 0
    matched_ids: set[int] = set()

    for p in parsed:
        ex = find_matching_holding(p, existing)

        resolved_ticker = p.ticker
        ref_cents = p.last_price_cents
        if p.last_price_cents:
            resolved_ticker, _ok = await resolve_yahoo_symbol(
                db, p.isin, p.ticker, p.last_price_cents / 100, p.currency, p.name,
            )

        if ex is None:
            db.add(Holding(
                account_id=account_id,
                profile_id=profile_id,
                ticker=resolved_ticker,
                name=p.name,
                quantity=p.quantity,
                cost_basis_cents=p.cost_basis_cents,
                currency=p.currency,
                asset_type=p.asset_type,
                isin=p.isin,
                ref_price_cents=ref_cents,
                ref_price_date=today if ref_cents else None,
            ))
            created += 1
        else:
            matched_ids.add(ex.id)
            # IBKR is authoritative for structure.
            ex.quantity = p.quantity
            ex.cost_basis_cents = p.cost_basis_cents
            if p.name:
                ex.name = p.name
            if p.isin and not ex.isin:
                ex.isin = p.isin
            if ref_cents:
                ex.ref_price_cents = ref_cents
                ex.ref_price_date = today
            # Do NOT overwrite ex.ticker with an unvalidated fallback — a manual
            # ticker correction (stored in isin_ticker as source='manual') is what
            # resolve_yahoo_symbol returns, so only adopt a *validated* match.
            if ref_cents and resolved_ticker.upper() != ex.ticker.upper():
                # resolve_yahoo_symbol already persisted the mapping; keep the
                # user's ticker on the row to respect manual edits.
                pass
            updated += 1

        if ref_cents is not None:
            await db.execute(text(
                "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
                "VALUES (:ticker, :price_cents, :currency, :fetched_at, 'ref')"
            ), {"ticker": resolved_ticker.upper(), "price_cents": ref_cents, "currency": p.currency, "fetched_at": now})

    # Vanished: present in DB, absent from the feed → keep + flag, never delete.
    vanished = []
    marker = f"[IBKR: absent {today.isoformat()}]"
    for ex in existing:
        if ex.id in matched_ids:
            continue
        note = ex.notes or ""
        if "[IBKR: absent" not in note:
            ex.notes = (note + ("  " if note else "") + marker).strip()
        vanished.append({"id": ex.id, "ticker": ex.ticker})

    return {"created": created, "updated": updated, "vanished": vanished, "total": len(parsed)}
