from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy import select, and_, delete, text
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Account, AccountType, AccountBalanceSnapshot, Holding, PriceCache, BankProfile
from schemas import (
    HoldingCreate, HoldingUpdate, HoldingOut,
    HoldingsImportPreviewResponse, ParsedHoldingPreview,
    HoldingsImportConfirmRequest, HoldingsImportConfirmResponse,
)
from services.market_data import (
    refresh_all_prices, get_cached_price, get_cached_dividend, fetch_historical_prices, resolve_yahoo_symbol,
    store_isin_ticker, reverse_lookup_isin, fetch_isin_for_ticker, _fetch_stock_prices,
)
from services.holdings_csv_parser import (
    detect_holdings_format, parse_ibkr_holdings, parse_bourso_holdings,
    detect_custom_holdings_profile, parse_custom_holdings
)
from services.fx import get_rate
from datetime import date, datetime

router = APIRouter()


async def _enrich_holding(db: AsyncSession, h: Holding, account_currency: str = "EUR") -> dict:
    """Build HoldingOut dict with live price data from cache."""
    # ISIN: stored on the holding, or reverse-resolved from the persistent map
    # (so manually-mapped IBKR positions, e.g. ASML→NL…, prefill in the editor).
    eff_isin = h.isin or await reverse_lookup_isin(db, h.ticker)
    out = {
        "id": h.id,
        "account_id": h.account_id,
        "ticker": h.ticker,
        "isin": eff_isin,
        "name": h.name,
        "quantity": h.quantity,
        "cost_basis_cents": h.cost_basis_cents,
        "currency": h.currency,
        "asset_type": h.asset_type,
        "added_date": str(h.added_date) if h.added_date else None,
        "notes": h.notes,
        "current_price_cents": None,
        "current_value_cents": None,
        "gain_cents": None,
        "gain_pct": None,
        "price_currency": h.currency,
        "price_fetched_at": None,
        "value_in_account_ccy_cents": None,
        "price_status": "missing",
        # Dividend fields
        "dividend_yield": None,
        "yield_on_cost": None,
        "est_annual_income_cents": None,
        "ex_dividend_date": None,
        "payout_ratio": None,
        "dividend_growth_rate": None,
        "frequency": None,
        "sector": None,
        "industry": None,
        "dividend_date": None,
    }
    lookup_ticker = h.ticker.lower() if h.asset_type == "crypto" else h.ticker.upper()
    cached = await get_cached_price(db, lookup_ticker)
    if not cached:
        # No live quote — fall back to the broker reference price if we have one.
        if h.ref_price_cents:
            out["price_status"] = "fallback"
            price_cents = h.ref_price_cents
            out["current_price_cents"] = price_cents
            out["price_currency"] = h.currency
            value = round(h.quantity * price_cents)
            out["current_value_cents"] = value
            out["gain_cents"] = value - h.cost_basis_cents
            if h.cost_basis_cents != 0:
                out["gain_pct"] = round((value - h.cost_basis_cents) / abs(h.cost_basis_cents) * 100, 2)
            if h.currency == account_currency:
                out["value_in_account_ccy_cents"] = value
            else:
                rate = await get_rate(db, h.currency, account_currency, date.today())
                out["value_in_account_ccy_cents"] = round(value * rate) if rate else value
        return out

    out["price_fetched_at"] = str(cached.fetched_at)
    cache_source = getattr(cached, "source", "live") or "live"

    if cache_source == "ref":
        # The cached value is the broker fallback, not a live yfinance quote → the
        # ticker isn't priced by yf (badge the position so the user can fix it).
        out["price_status"] = "fallback"
        price_cents = cached.price_cents
    elif cached.currency == h.currency:
        price_cents = cached.price_cents
        out["price_status"] = "ok"
    else:
        # Live quote in a different currency than the holding → likely a wrong
        # instrument (e.g. a EUR ETF priced from its USD listing).
        out["price_status"] = "mismatch"
        rate = await get_rate(db, cached.currency, h.currency, date.today())
        if rate:
            price_cents = round(cached.price_cents * rate)
        else:
            price_cents = cached.price_cents

    out["current_price_cents"] = price_cents
    out["price_currency"] = h.currency

    value = round(h.quantity * price_cents)
    out["current_value_cents"] = value
    out["gain_cents"] = value - h.cost_basis_cents
    if h.cost_basis_cents != 0:
        out["gain_pct"] = round((value - h.cost_basis_cents) / abs(h.cost_basis_cents) * 100, 2)

    if h.currency == account_currency:
        out["value_in_account_ccy_cents"] = value
    else:
        rate = await get_rate(db, h.currency, account_currency, date.today())
        out["value_in_account_ccy_cents"] = round(value * rate) if rate else value

    # ── Dividend enrichment ─────────────────────────────────────────────
    lookup_div = h.ticker.upper() if h.asset_type != "crypto" else None
    if lookup_div:
        div = await get_cached_dividend(db, lookup_div)
        if div:
            out["dividend_yield"] = div.yield_pct
            out["payout_ratio"] = round(div.payout_ratio * 100, 1) if div.payout_ratio else None
            out["dividend_growth_rate"] = div.growth_rate_5y
            out["frequency"] = div.frequency
            out["sector"] = div.sector
            out["industry"] = div.industry
            if div.ex_date:
                out["ex_dividend_date"] = str(div.ex_date)
            if div.dividend_date:
                out["dividend_date"] = str(div.dividend_date)

            if div.annual_rate and div.annual_rate > 0:
                est_income = div.annual_rate * h.quantity
                out["est_annual_income_cents"] = round(est_income * 100)

                if h.cost_basis_cents and h.cost_basis_cents > 0:
                    yoc = (est_income / (h.cost_basis_cents / 100)) * 100
                    out["yield_on_cost"] = round(yoc, 2)

    return out


# ── Holdings CRUD ─────────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/holdings")
async def list_holdings(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    acc = await db.get(Account, account_id)
    acc_ccy = acc.currency if acc else "EUR"
    result = await db.execute(
        select(Holding).where(Holding.account_id == account_id, Holding.profile_id == pid)
    )
    holdings = result.scalars().all()
    return [await _enrich_holding(db, h, acc_ccy) for h in holdings]


@router.post("/accounts/{account_id}/holdings")
async def create_holding(account_id: int, body: HoldingCreate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    acc = await db.execute(select(Account).where(Account.id == account_id, Account.profile_id == pid))
    acc = acc.scalar_one_or_none()
    if not acc:
        raise HTTPException(404, "Account not found")
    h = Holding(
        account_id=account_id,
        profile_id=pid,
        ticker=body.ticker,
        name=body.name,
        quantity=body.quantity,
        cost_basis_cents=body.cost_basis_cents,
        currency=body.currency,
        asset_type=body.asset_type,
        added_date=body.added_date,
        notes=body.notes,
    )
    db.add(h)
    await db.commit()
    await db.refresh(h)
    return await _enrich_holding(db, h, acc.currency)


@router.put("/holdings/{holding_id}")
async def update_holding(holding_id: int, body: HoldingUpdate, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    h = await db.get(Holding, holding_id)
    if not h or h.profile_id != pid:
        raise HTTPException(404, "Holding not found")

    old_ticker = h.ticker
    updates = body.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(h, field, val)

    ticker_changed = "ticker" in updates and h.ticker and h.ticker != old_ticker

    # A manual ticker edit overwrites the persistent ISIN→ticker lookup so future
    # imports keep the correction, and refreshes the price for the new symbol.
    if (("ticker" in updates) or ("isin" in updates)) and h.isin and h.ticker:
        await store_isin_ticker(db, h.isin, h.ticker, h.name, h.currency, source="manual")

    await db.commit()

    if ticker_changed and h.asset_type != "crypto":
        try:
            # Drop the stale cache row for the old symbol, then fetch the new one.
            await db.execute(text("DELETE FROM price_cache WHERE UPPER(ticker) = :t"), {"t": old_ticker.upper()})
            prices = await _fetch_stock_prices([h.ticker.upper()])
            pc = prices.get(h.ticker.upper())
            if pc:
                await db.execute(text(
                    "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
                    "VALUES (:t, :p, :c, :f, 'live')"
                ), {"t": h.ticker.upper(), "p": round(pc[0] * 100), "c": pc[1], "f": datetime.utcnow()})
            await db.commit()
        except Exception:
            pass

    await db.refresh(h)
    acc = await db.get(Account, h.account_id)
    return await _enrich_holding(db, h, acc.currency if acc else "EUR")


@router.delete("/holdings/{holding_id}")
async def delete_holding(holding_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    h = await db.get(Holding, holding_id)
    if not h or h.profile_id != pid:
        raise HTTPException(404, "Holding not found")
    await db.delete(h)
    await db.commit()
    return {"ok": True}


@router.post("/refresh-prices")
async def trigger_price_refresh(db: AsyncSession = Depends(get_db)):
    count = await refresh_all_prices(db)
    return {"refreshed": count}


@router.post("/resolve-tickers")
async def resolve_tickers(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Re-resolve the Yahoo symbol (via OpenFIGI, then Yahoo search) for the profile's
    holdings that aren't priced live, and backfill any missing ISIN from yfinance."""
    holdings = (await db.execute(select(Holding).where(Holding.profile_id == pid))).scalars().all()
    resolved = 0
    for h in holdings:
        if h.asset_type == "crypto":
            continue
        # Backfill a missing ISIN (e.g. IBKR positions) so the editor can prefill it.
        if not h.isin:
            found = h.isin or await reverse_lookup_isin(db, h.ticker)
            if not found:
                found = await fetch_isin_for_ticker(h.ticker)
            if found:
                h.isin = found
                await store_isin_ticker(db, found, h.ticker, h.name, h.currency, source="yfinance")
        if not h.ref_price_cents:
            continue
        acc = await db.get(Account, h.account_id)
        eh = await _enrich_holding(db, h, acc.currency if acc else "EUR")
        if eh.get("price_status") == "ok":
            continue
        isin = h.isin or await reverse_lookup_isin(db, h.ticker)
        if not isin:
            continue
        new_ticker, ok = await resolve_yahoo_symbol(
            db, isin, h.ticker, h.ref_price_cents / 100, h.currency, h.name, force=True,
        )
        if ok and new_ticker.upper() != h.ticker.upper():
            await db.execute(text("DELETE FROM price_cache WHERE UPPER(ticker) = :t"), {"t": h.ticker.upper()})
            h.ticker = new_ticker
            resolved += 1
    await db.commit()
    try:
        await refresh_all_prices(db)
    except Exception:
        pass
    return {"resolved": resolved}


@router.get("/history/{ticker}")
async def holding_history(
    ticker: str,
    period: str = Query("1y"),
    asset_type: str = Query("stock"),
):
    data = await fetch_historical_prices(ticker, period)
    return {"ticker": ticker, "period": period, "data": data}


# ── Benchmark comparison ─────────────────────────────────────────────────────

BENCHMARKS = {
    "sp500": {"ticker": "^GSPC", "name": "S&P 500"},
    "msci_world": {"ticker": "URTH", "name": "MSCI World"},
    "cac40": {"ticker": "^FCHI", "name": "CAC 40"},
    "stoxx600": {"ticker": "^STOXX", "name": "STOXX Europe 600"},
    "nasdaq": {"ticker": "^IXIC", "name": "NASDAQ"},
}


@router.get("/benchmarks")
async def benchmark_list():
    return [{"key": k, **v} for k, v in BENCHMARKS.items()]


def _normalize_pct(series: list[dict]) -> list[dict]:
    """Normalise a [{date, close}] series to percent change from the first point."""
    if not series:
        return []
    base = series[0]["close"]
    if not base:
        return []
    return [{"date": pt["date"], "pct": round((pt["close"] - base) / base * 100, 2)} for pt in series]


@router.get("/benchmark/{key}")
async def benchmark_history(
    key: str,
    period: str = Query("1y"),
):
    info = BENCHMARKS.get(key)
    if not info:
        raise HTTPException(404, f"Unknown benchmark: {key}")
    data = await fetch_historical_prices(info["ticker"], period)
    return {"key": key, "name": info["name"], "data": _normalize_pct(data)}


@router.get("/accounts/{account_id}/performance")
async def account_performance(
    account_id: int,
    period: str = Query("1y"),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Normalised % performance of an account's current holdings over `period`,
    reconstructed from each holding's historical closes (so it can be plotted
    against the index benchmarks)."""
    acc = await db.execute(select(Account).where(Account.id == account_id, Account.profile_id == pid))
    acc = acc.scalar_one_or_none()
    if not acc:
        raise HTTPException(404, "Account not found")
    acc_ccy = acc.currency or "EUR"

    holdings = (await db.execute(
        select(Holding).where(Holding.account_id == account_id, Holding.profile_id == pid)
    )).scalars().all()
    if not holdings:
        return {"account_id": account_id, "name": acc.name, "data": []}

    # Per-holding date→close (scaled to the account currency at today's FX rate so
    # mixed-currency accounts weight each position correctly).
    histories: list[tuple[float, dict[str, float]]] = []  # (quantity, {date: close})
    for h in holdings:
        raw = await fetch_historical_prices(h.ticker, period)
        if not raw:
            continue
        rate = 1.0
        if h.currency and h.currency != acc_ccy:
            r = await get_rate(db, h.currency, acc_ccy, date.today())
            rate = r if r else 1.0
        closes = {pt["date"]: pt["close"] * rate for pt in raw}
        histories.append((h.quantity, closes))

    if not histories:
        return {"account_id": account_id, "name": acc.name, "data": []}

    # Common baseline: start once every holding has data, so the sum is complete.
    start = max(min(closes) for _, closes in histories)
    all_dates = sorted({d for _, closes in histories for d in closes if d >= start})

    series: list[dict] = []
    last = [None] * len(histories)
    for d in all_dates:
        total = 0.0
        ok = True
        for i, (qty, closes) in enumerate(histories):
            if d in closes:
                last[i] = closes[d]
            if last[i] is None:
                ok = False
                break
            total += qty * last[i]
        if ok:
            series.append({"date": d, "close": total})

    return {"account_id": account_id, "name": acc.name, "data": _normalize_pct(series)}


# ── Holdings CSV Import ──────────────────────────────────────────────────────

def normalize_string(s: Optional[str]) -> str:
    if not s:
        return ""
    return s.strip().strip('"').strip("'").strip().upper()


def find_matching_holding(p, existing_list: list[Holding]) -> Optional[Holding]:
    # 1. Match by ISIN
    p_isin = normalize_string(getattr(p, "isin", None))
    if p_isin:
        for ex in existing_list:
            if normalize_string(ex.isin) == p_isin:
                return ex

    # 2. Match by ticker
    p_ticker = normalize_string(p.ticker)
    if p_ticker:
        for ex in existing_list:
            if normalize_string(ex.ticker) == p_ticker:
                return ex

    # 3. Match by name
    p_name = normalize_string(p.name)
    if p_name:
        for ex in existing_list:
            if normalize_string(ex.name) == p_name:
                return ex

    return None


@router.post("/import/preview", response_model=HoldingsImportPreviewResponse)
async def import_preview(
    account_id: int = Query(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    raw = await file.read()

    # Try custom profiles from the database first
    db_profiles = (await db.execute(
        select(BankProfile).where(BankProfile.profile_id == pid)
    )).scalars().all()

    invest_profiles = [
        p for p in db_profiles
        if p.column_mapping and any(k in p.column_mapping for k in ["quantity", "buyingPrice", "ticker", "isin"])
    ]

    matched_profile = detect_custom_holdings_profile(raw, invest_profiles)

    if matched_profile:
        fmt = matched_profile.name
        parsed = parse_custom_holdings(raw, matched_profile)
    else:
        fmt = detect_holdings_format(raw)
        if not fmt:
            raise HTTPException(400, "Format CSV non reconnu. Formats supportés : IBKR, Boursorama ou profil d'investissement personnalisé.")

        if fmt == "ibkr":
            parsed = parse_ibkr_holdings(raw)
        else:
            parsed = parse_bourso_holdings(raw)

    existing = await db.execute(
        select(Holding).where(Holding.account_id == account_id, Holding.profile_id == pid)
    )
    existing_list = existing.scalars().all()

    previews: list[ParsedHoldingPreview] = []
    dups = 0
    for p in parsed:
        ex = find_matching_holding(p, existing_list)
        is_dup = ex is not None
        if is_dup:
            dups += 1
            # Align parsed values to DB corrections (like CAC.PA vs C40.PA)
            p.ticker = ex.ticker
            if ex.name:
                p.name = ex.name
            if ex.isin and not p.isin:
                p.isin = ex.isin
            if ex.asset_type:
                p.asset_type = ex.asset_type

        previews.append(ParsedHoldingPreview(
            ticker=p.ticker,
            name=p.name,
            quantity=p.quantity,
            cost_basis_cents=p.cost_basis_cents,
            currency=p.currency,
            asset_type=p.asset_type,
            last_price_cents=p.last_price_cents,
            isin=p.isin,
            is_duplicate=is_dup,
            existing_holding_id=ex.id if ex else None,
            existing_quantity=ex.quantity if ex else None,
            existing_cost_basis_cents=ex.cost_basis_cents if ex else None,
        ))

    return HoldingsImportPreviewResponse(
        format=fmt, holdings=previews, total=len(previews), duplicates=dups,
    )


@router.post("/import/confirm", response_model=HoldingsImportConfirmResponse)
async def import_confirm(
    body: HoldingsImportConfirmRequest,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    acc = await db.execute(select(Account).where(Account.id == body.account_id, Account.profile_id == pid))
    acc = acc.scalar_one_or_none()
    if not acc:
        raise HTTPException(404, "Account not found")

    existing = await db.execute(
        select(Holding).where(Holding.account_id == body.account_id, Holding.profile_id == pid)
    )
    existing_list = existing.scalars().all()

    created = 0
    updated = 0
    skipped = 0
    now = datetime.utcnow()

    today = date.today()

    for item in body.holdings:
        ex = find_matching_holding(item, existing_list)

        # When the broker gave us a same-day price, resolve & validate the live
        # Yahoo symbol so ongoing refreshes price the correct instrument.
        resolved_ticker = item.ticker
        ref_price_cents = item.last_price_cents
        if item.last_price_cents:
            resolved_ticker, _ok = await resolve_yahoo_symbol(
                db, item.isin, item.ticker, item.last_price_cents / 100, item.currency, item.name,
            )

        if ex is not None:
            action = item.duplicate_action
            if action == "skip":
                skipped += 1
                continue
            elif action == "replace":
                ex.ticker = resolved_ticker
                ex.quantity = item.quantity
                ex.cost_basis_cents = item.cost_basis_cents
                ex.name = item.name
                ex.currency = item.currency
                ex.asset_type = item.asset_type
                ex.isin = item.isin
                ex.ref_price_cents = ref_price_cents
                ex.ref_price_date = today if ref_price_cents else None
                updated += 1
            elif action == "merge":
                ex.quantity += item.quantity
                ex.cost_basis_cents += item.cost_basis_cents
                if ref_price_cents:
                    ex.ticker = resolved_ticker
                    ex.isin = item.isin
                    ex.ref_price_cents = ref_price_cents
                    ex.ref_price_date = today
                updated += 1
        else:
            h = Holding(
                account_id=body.account_id,
                profile_id=pid,
                ticker=resolved_ticker,
                name=item.name,
                quantity=item.quantity,
                cost_basis_cents=item.cost_basis_cents,
                currency=item.currency,
                asset_type=item.asset_type,
                isin=item.isin,
                ref_price_cents=ref_price_cents,
                ref_price_date=today if ref_price_cents else None,
            )
            db.add(h)
            created += 1

        if ref_price_cents is not None:
            await db.execute(text(
                "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at, source) "
                "VALUES (:ticker, :price_cents, :currency, :fetched_at, 'ref')"
            ), {"ticker": resolved_ticker.upper(), "price_cents": ref_price_cents, "currency": item.currency, "fetched_at": now})

    await db.commit()

    try:
        await refresh_all_prices(db)
    except Exception:
        pass

    return HoldingsImportConfirmResponse(created=created, updated=updated, skipped=skipped)


# ── Investment accounts (enhanced with holdings) ──────────────────────────────

@router.get("/accounts")
async def investment_accounts(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(
        select(Account).where(
            and_(Account.is_active == True, Account.account_type == AccountType.investissement, Account.profile_id == pid)
        )
    )
    inv_accounts = result.scalars().all()

    accounts_out = []
    for acc in inv_accounts:
        acc_ccy = acc.currency or "EUR"

        snap_result = await db.execute(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == acc.id)
            .order_by(AccountBalanceSnapshot.date.asc())
        )
        snaps = snap_result.scalars().all()

        total_contributions = 0
        monthly: list[dict] = []
        for s in snaps:
            contrib = s.contribution_cents or 0
            total_contributions += contrib
            monthly.append({
                "id": s.id,
                "date": str(s.date),
                "month": str(s.date)[:7],
                "amount_cents": s.amount_cents,
                "contribution_cents": contrib,
                "currency": s.currency,
                "notes": s.notes,
            })

        current_value = snaps[-1].amount_cents if snaps else None
        first_value = snaps[0].amount_cents if snaps else None

        holdings_result = await db.execute(
            select(Holding).where(Holding.account_id == acc.id, Holding.profile_id == pid)
        )
        holdings = holdings_result.scalars().all()
        enriched_holdings = [await _enrich_holding(db, h, acc_ccy) for h in holdings]
        has_holdings = len(holdings) > 0

        holdings_value_cents = 0
        holdings_cost_basis_cents = 0
        allocation_by_type: dict[str, int] = {}
        for eh in enriched_holdings:
            v = eh.get("value_in_account_ccy_cents") or 0
            holdings_value_cents += v
            cost_in_acc = eh["cost_basis_cents"]
            if eh["currency"] != acc_ccy:
                rate = await get_rate(db, eh["currency"], acc_ccy, date.today())
                cost_in_acc = round(cost_in_acc * rate) if rate else cost_in_acc
            holdings_cost_basis_cents += cost_in_acc
            atype = eh.get("asset_type", "other")
            allocation_by_type[atype] = allocation_by_type.get(atype, 0) + v

        holdings_gain_cents = holdings_value_cents - holdings_cost_basis_cents if has_holdings else None
        holdings_gain_pct = round(holdings_gain_cents / abs(holdings_cost_basis_cents) * 100, 2) if has_holdings and holdings_cost_basis_cents != 0 else None

        # ── Dividend KPIs ────────────────────────────────────────────
        est_annual_div_cents = 0
        div_weighted_yield_num = 0
        div_weighted_yield_den = 0
        for eh in enriched_holdings:
            inc = eh.get("est_annual_income_cents") or 0
            v = eh.get("value_in_account_ccy_cents") or 0
            if inc > 0:
                # Convert income to account currency if needed
                if eh["currency"] != acc_ccy:
                    rate = await get_rate(db, eh["currency"], acc_ccy, date.today())
                    inc = round(inc * rate) if rate else inc
                est_annual_div_cents += inc
            dy = eh.get("dividend_yield")
            if dy and v > 0:
                div_weighted_yield_num += dy * v
                div_weighted_yield_den += v

        avg_yield = round(div_weighted_yield_num / div_weighted_yield_den, 2) if div_weighted_yield_den > 0 else None

        if has_holdings and holdings_value_cents > 0:
            current_value = holdings_value_cents

        # Total money the user has put into this account: for holdings accounts it's
        # the sum of acquisition costs; for snapshot accounts it's the sum of contributions.
        money_added_cents = holdings_cost_basis_cents if has_holdings else total_contributions

        change_from_start_cents = None
        pct_from_start = None
        if first_value is not None and current_value is not None and first_value != 0:
            change_from_start_cents = current_value - first_value
            pct_from_start = round(change_from_start_cents / abs(first_value) * 100, 2)

        change_from_last_month_cents = None
        pct_from_last_month = None
        if len(snaps) >= 2:
            prev = snaps[-2].amount_cents
            if prev != 0:
                change_from_last_month_cents = current_value - prev
                pct_from_last_month = round(change_from_last_month_cents / abs(prev) * 100, 2)

        contributions_after_first = total_contributions - (snaps[0].contribution_cents or 0) if snaps else 0
        perf_from_start_cents = None
        perf_pct_from_start = None
        if first_value is not None and current_value is not None and first_value != 0:
            perf_from_start_cents = current_value - first_value - contributions_after_first
            perf_pct_from_start = round(perf_from_start_cents / abs(first_value) * 100, 2)

        perf_from_last_month_cents = None
        perf_pct_from_last_month = None
        if len(snaps) >= 2:
            prev = snaps[-2].amount_cents
            last_contrib = snaps[-1].contribution_cents or 0
            if prev != 0:
                perf_from_last_month_cents = current_value - prev - last_contrib
                perf_pct_from_last_month = round(perf_from_last_month_cents / abs(prev) * 100, 2)

        accounts_out.append({
            "id": acc.id,
            "name": acc.name,
            "bank_name": acc.bank_name,
            "currency": acc_ccy,
            "color": acc.color,
            "current_value_cents": current_value,
            "first_value_cents": first_value,
            "total_contributions_cents": total_contributions,
            "money_added_cents": money_added_cents,
            "pct_from_start": pct_from_start,
            "pct_from_last_month": pct_from_last_month,
            "change_from_start_cents": change_from_start_cents,
            "change_from_last_month_cents": change_from_last_month_cents,
            "perf_pct_from_start": perf_pct_from_start,
            "perf_pct_from_last_month": perf_pct_from_last_month,
            "perf_from_start_cents": perf_from_start_cents,
            "perf_from_last_month_cents": perf_from_last_month_cents,
            "monthly": monthly,
            "has_holdings": has_holdings,
            "holdings": enriched_holdings,
            "holdings_value_cents": holdings_value_cents if has_holdings else None,
            "holdings_cost_basis_cents": holdings_cost_basis_cents if has_holdings else None,
            "holdings_gain_cents": holdings_gain_cents,
            "holdings_gain_pct": holdings_gain_pct,
            "allocation_by_type": allocation_by_type if has_holdings else None,
            "est_annual_div_cents": est_annual_div_cents if has_holdings else None,
            "avg_dividend_yield": avg_yield,
        })

    return accounts_out


async def _holdings_monthly_values(db: AsyncSession, account_id: int, acc_ccy: str) -> list[dict]:
    """Reconstruct a holdings account's month-end value from historical closes,
    so it can be charted alongside snapshot accounts. Returns [{month, amount_cents}]."""
    holdings = (await db.execute(
        select(Holding).where(Holding.account_id == account_id)
    )).scalars().all()
    if not holdings:
        return []

    # Per-holding {date: close} scaled to the account currency.
    histories: list[tuple[float, dict[str, float]]] = []
    for h in holdings:
        raw = await fetch_historical_prices(h.ticker, "2y")
        if not raw:
            continue
        rate = 1.0
        if h.currency and h.currency != acc_ccy:
            r = await get_rate(db, h.currency, acc_ccy, date.today())
            rate = r if r else 1.0
        histories.append((h.quantity, {pt["date"]: pt["close"] * rate for pt in raw}))
    if not histories:
        return []

    all_dates = sorted({d for _, closes in histories for d in closes})
    # Month-end value = sum of each holding's last close on/before the month's end.
    by_month: dict[str, float] = {}
    last = [None] * len(histories)
    cursor = 0
    for d in all_dates:
        for i, (qty, closes) in enumerate(histories):
            if d in closes:
                last[i] = closes[d]
        total = sum(qty * last[i] for i, (qty, _) in enumerate(histories) if last[i] is not None)
        by_month[d[:7]] = total  # later date in the month overwrites → month-end value
    return [{"month": m, "amount_cents": round(v * 100)} for m, v in by_month.items()]


@router.get("/total-series")
async def investment_total_series(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(
        select(Account).where(
            and_(Account.is_active == True, Account.account_type == AccountType.investissement, Account.profile_id == pid)
        )
    )
    inv_accounts = result.scalars().all()

    account_series: dict[int, list[dict]] = {}
    all_months: set[str] = set()

    for acc in inv_accounts:
        snap_result = await db.execute(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == acc.id)
            .order_by(AccountBalanceSnapshot.date.asc())
        )
        snaps = snap_result.scalars().all()
        series = []
        for s in snaps:
            month = str(s.date)[:7]
            series.append({"month": month, "amount_cents": s.amount_cents})
            all_months.add(month)
        # Holdings accounts have no snapshots — reconstruct their monthly value.
        if not series:
            series = await _holdings_monthly_values(db, acc.id, acc.currency or "EUR")
            for entry in series:
                all_months.add(entry["month"])
        account_series[acc.id] = series

    if not all_months:
        return []

    sorted_months = sorted(all_months)

    result_series = []
    for month in sorted_months:
        total = 0
        per_account: dict[str, int] = {}
        for acc in inv_accounts:
            series = account_series.get(acc.id, [])
            last_known = None
            for entry in series:
                if entry["month"] <= month:
                    last_known = entry["amount_cents"]
            if last_known is not None:
                total += last_known
                per_account[acc.name] = last_known
        result_series.append({
            "month": month,
            "total_cents": total,
            **per_account,
        })

    return result_series


@router.get("/dividend-calendar")
async def dividend_calendar(
    months: int = Query(12, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Project future dividend income by month, based on frequency + last payment."""
    from dateutil.relativedelta import relativedelta

    accs = (await db.execute(
        select(Account).where(
            and_(Account.is_active == True, Account.account_type == AccountType.investissement, Account.profile_id == pid)
        )
    )).scalars().all()

    today = date.today()
    start_month = today.replace(day=1)
    month_keys = []
    for i in range(months):
        m = start_month + relativedelta(months=i)
        month_keys.append(m.strftime("%Y-%m"))

    freq_months = {"monthly": 1, "quarterly": 3, "semi-annual": 6, "annual": 12}
    monthly_items: dict[str, list[dict]] = {mk: [] for mk in month_keys}
    by_sector: dict[str, int] = {}

    for acc in accs:
        acc_ccy = acc.currency or "EUR"
        holdings = (await db.execute(
            select(Holding).where(Holding.account_id == acc.id, Holding.profile_id == pid)
        )).scalars().all()

        for h in holdings:
            if h.asset_type == "crypto":
                continue
            div = await get_cached_dividend(db, h.ticker.upper())
            if not div or not div.annual_rate or div.annual_rate <= 0 or not div.frequency:
                continue

            interval = freq_months.get(div.frequency, 12)
            per_payment = div.annual_rate / (12 / interval) if interval else div.annual_rate
            per_payment_cents = round(per_payment * h.quantity * 100)

            # Convert to base currency if needed
            rate_to_acc = 1.0
            div_ccy = div.currency or h.currency
            if div_ccy != acc_ccy:
                r = await get_rate(db, div_ccy, acc_ccy, today)
                rate_to_acc = r if r else 1.0

            converted_cents = round(per_payment_cents * rate_to_acc)

            # Anchor from last dividend date or ex_date
            anchor = div.last_dividend_date or div.ex_date
            if anchor:
                # Find next payment after today
                next_pay = anchor
                while next_pay < today:
                    next_pay = next_pay + relativedelta(months=interval)
                # Project forward
                pay = next_pay
                for _ in range(months):
                    mk = pay.strftime("%Y-%m")
                    if mk in monthly_items:
                        monthly_items[mk].append({
                            "ticker": h.ticker,
                            "name": h.name,
                            "amount_cents": converted_cents,
                            "currency": acc_ccy,
                            "sector": div.sector,
                        })
                    pay = pay + relativedelta(months=interval)
            else:
                # No anchor — spread evenly across the year
                for mk in month_keys:
                    monthly_items[mk].append({
                        "ticker": h.ticker,
                        "name": h.name,
                        "amount_cents": round(div.annual_rate * h.quantity * 100 * rate_to_acc / 12),
                        "currency": acc_ccy,
                        "sector": div.sector,
                    })

            # Sector aggregation (annual)
            sector = div.sector or "Autre"
            annual_cents = round(div.annual_rate * h.quantity * 100 * rate_to_acc)
            by_sector[sector] = by_sector.get(sector, 0) + annual_cents

    monthly_out = []
    for mk in month_keys:
        items = monthly_items[mk]
        total = sum(it["amount_cents"] for it in items)
        monthly_out.append({"month": mk, "total_cents": total, "items": items})

    sector_out = [{"sector": s, "est_annual_cents": v} for s, v in sorted(by_sector.items(), key=lambda x: -x[1])]

    return {"monthly": monthly_out, "by_sector": sector_out}
