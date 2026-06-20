from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy import select, and_, delete, text
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Account, AccountType, AccountBalanceSnapshot, Holding, PriceCache
from schemas import (
    HoldingCreate, HoldingUpdate, HoldingOut,
    HoldingsImportPreviewResponse, ParsedHoldingPreview,
    HoldingsImportConfirmRequest, HoldingsImportConfirmResponse,
)
from services.market_data import refresh_all_prices, get_cached_price, fetch_historical_prices
from services.holdings_csv_parser import detect_holdings_format, parse_ibkr_holdings, parse_bourso_holdings
from services.fx import get_rate
from datetime import date, datetime

router = APIRouter()


async def _enrich_holding(db: AsyncSession, h: Holding, account_currency: str = "EUR") -> dict:
    """Build HoldingOut dict with live price data from cache."""
    out = {
        "id": h.id,
        "account_id": h.account_id,
        "ticker": h.ticker,
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
    }
    lookup_ticker = h.ticker.lower() if h.asset_type == "crypto" else h.ticker.upper()
    cached = await get_cached_price(db, lookup_ticker)
    if not cached:
        return out

    out["price_fetched_at"] = str(cached.fetched_at)

    if cached.currency == h.currency:
        price_cents = cached.price_cents
    else:
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

    return out


# ── Holdings CRUD ─────────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/holdings")
async def list_holdings(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    acc_ccy = acc.currency if acc else "EUR"
    result = await db.execute(
        select(Holding).where(Holding.account_id == account_id)
    )
    holdings = result.scalars().all()
    return [await _enrich_holding(db, h, acc_ccy) for h in holdings]


@router.post("/accounts/{account_id}/holdings")
async def create_holding(account_id: int, body: HoldingCreate, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    h = Holding(
        account_id=account_id,
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
async def update_holding(holding_id: int, body: HoldingUpdate, db: AsyncSession = Depends(get_db)):
    h = await db.get(Holding, holding_id)
    if not h:
        raise HTTPException(404, "Holding not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(h, field, val)
    await db.commit()
    await db.refresh(h)
    acc = await db.get(Account, h.account_id)
    return await _enrich_holding(db, h, acc.currency if acc else "EUR")


@router.delete("/holdings/{holding_id}")
async def delete_holding(holding_id: int, db: AsyncSession = Depends(get_db)):
    h = await db.get(Holding, holding_id)
    if not h:
        raise HTTPException(404, "Holding not found")
    await db.delete(h)
    await db.commit()
    return {"ok": True}


@router.post("/refresh-prices")
async def trigger_price_refresh(db: AsyncSession = Depends(get_db)):
    count = await refresh_all_prices(db)
    return {"refreshed": count}


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


@router.get("/benchmark/{key}")
async def benchmark_history(
    key: str,
    period: str = Query("1y"),
):
    info = BENCHMARKS.get(key)
    if not info:
        raise HTTPException(404, f"Unknown benchmark: {key}")
    data = await fetch_historical_prices(info["ticker"], period)
    if not data:
        return {"key": key, "name": info["name"], "data": []}

    base_price = data[0]["close"]
    normalized = []
    for pt in data:
        pct = round((pt["close"] - base_price) / base_price * 100, 2)
        normalized.append({"date": pt["date"], "pct": pct})

    return {"key": key, "name": info["name"], "data": normalized}


# ── Holdings CSV Import ──────────────────────────────────────────────────────

@router.post("/import/preview", response_model=HoldingsImportPreviewResponse)
async def import_preview(
    account_id: int = Query(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    raw = await file.read()
    fmt = detect_holdings_format(raw)
    if not fmt:
        raise HTTPException(400, "Format CSV non reconnu. Formats supportés : IBKR, Boursorama.")

    if fmt == "ibkr":
        parsed = parse_ibkr_holdings(raw)
    else:
        parsed = parse_bourso_holdings(raw)

    existing = await db.execute(
        select(Holding).where(Holding.account_id == account_id)
    )
    existing_map = {h.ticker: h for h in existing.scalars().all()}

    previews: list[ParsedHoldingPreview] = []
    dups = 0
    for p in parsed:
        ex = existing_map.get(p.ticker)
        is_dup = ex is not None
        if is_dup:
            dups += 1
        previews.append(ParsedHoldingPreview(
            ticker=p.ticker,
            name=p.name,
            quantity=p.quantity,
            cost_basis_cents=p.cost_basis_cents,
            currency=p.currency,
            asset_type=p.asset_type,
            last_price_cents=p.last_price_cents,
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
):
    acc = await db.get(Account, body.account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    existing = await db.execute(
        select(Holding).where(Holding.account_id == body.account_id)
    )
    existing_map = {h.ticker: h for h in existing.scalars().all()}

    created = 0
    updated = 0
    skipped = 0
    now = datetime.utcnow()

    for item in body.holdings:
        ex = existing_map.get(item.ticker)

        if ex is not None:
            action = item.duplicate_action
            if action == "skip":
                skipped += 1
                continue
            elif action == "replace":
                ex.quantity = item.quantity
                ex.cost_basis_cents = item.cost_basis_cents
                ex.name = item.name
                ex.currency = item.currency
                ex.asset_type = item.asset_type
                updated += 1
            elif action == "merge":
                ex.quantity += item.quantity
                ex.cost_basis_cents += item.cost_basis_cents
                updated += 1
        else:
            h = Holding(
                account_id=body.account_id,
                ticker=item.ticker,
                name=item.name,
                quantity=item.quantity,
                cost_basis_cents=item.cost_basis_cents,
                currency=item.currency,
                asset_type=item.asset_type,
            )
            db.add(h)
            created += 1

        if item.last_price_cents is not None:
            await db.execute(text(
                "INSERT OR REPLACE INTO price_cache (ticker, price_cents, currency, fetched_at) "
                "VALUES (:ticker, :price_cents, :currency, :fetched_at)"
            ), {"ticker": item.ticker, "price_cents": item.last_price_cents, "currency": item.currency, "fetched_at": now})

    await db.commit()

    try:
        await refresh_all_prices(db)
    except Exception:
        pass

    return HoldingsImportConfirmResponse(created=created, updated=updated, skipped=skipped)


# ── Investment accounts (enhanced with holdings) ──────────────────────────────

@router.get("/accounts")
async def investment_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Account).where(
            and_(Account.is_active == True, Account.account_type == AccountType.investissement)
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
            select(Holding).where(Holding.account_id == acc.id)
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
        })

    return accounts_out


@router.get("/total-series")
async def investment_total_series(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Account).where(
            and_(Account.is_active == True, Account.account_type == AccountType.investissement)
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
