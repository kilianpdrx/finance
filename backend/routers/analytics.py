from typing import List, Optional
from datetime import date
from collections import defaultdict
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Transaction, Account, Category, BudgetEntry, AccountBalanceSnapshot, Setting
from schemas import (
    AnalyticsSummary, CashFlowMonth, CategoryBreakdown,
    RecurringTransaction, BudgetTableResponse, BudgetTableRow, BudgetTableCell,
    BudgetSectionRow, BudgetFullResponse,
    cents_to_display,
)
from services.fx import convert_cents

router = APIRouter()


def _date_filters(date_from: Optional[date], date_to: Optional[date]):
    filters = []
    if date_from:
        filters.append(Transaction.date >= date_from)
    if date_to:
        filters.append(Transaction.date <= date_to)
    return filters


def _parse_account_ids(account_ids: Optional[str]) -> Optional[List[int]]:
    if not account_ids:
        return None
    try:
        return [int(x.strip()) for x in account_ids.split(",") if x.strip()]
    except ValueError:
        return None


async def _get_base_currency(db: AsyncSession, pid: int) -> str:
    result = await db.execute(select(Setting).where(Setting.key == "base_currency", Setting.profile_id == pid))
    setting = result.scalar_one_or_none()
    return setting.value if setting else "CHF"


async def _load_account_currencies(db: AsyncSession, parsed_ids: Optional[List[int]], pid: int) -> dict[int, str]:
    q = select(Account.id, Account.currency).where(Account.profile_id == pid)
    if parsed_ids:
        q = q.where(Account.id.in_(parsed_ids))
    rows = await db.execute(q)
    return {r[0]: r[1] or "EUR" for r in rows}


async def _convert_by_currency(
    db: AsyncSession,
    totals_by_ccy: dict[str, int],
    base_ccy: str,
    on_date: date,
) -> int:
    result = 0
    for ccy, amount in totals_by_ccy.items():
        result += await convert_cents(db, amount, ccy, base_ccy, on_date)
    return result


@router.get("/summary", response_model=AnalyticsSummary)
async def summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    parsed_ids = _parse_account_ids(account_ids)
    base_ccy = await _get_base_currency(db, pid)
    acc_ccys = await _load_account_currencies(db, parsed_ids, pid)

    filters = _date_filters(date_from, date_to)
    filters.append(Transaction.is_internal_transfer == False)
    filters.append(Transaction.profile_id == pid)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))

    txn_rows = (await db.execute(
        select(
            Transaction.account_id,
            Transaction.is_debit,
            func.sum(Transaction.amount_cents).label("total"),
        )
        .where(and_(*filters))
        .group_by(Transaction.account_id, Transaction.is_debit)
    )).all()

    income_by_ccy: dict[str, int] = defaultdict(int)
    expenses_by_ccy: dict[str, int] = defaultdict(int)
    for r in txn_rows:
        ccy = acc_ccys.get(r.account_id, "EUR")
        if r.is_debit:
            expenses_by_ccy[ccy] += r.total
        else:
            income_by_ccy[ccy] += r.total

    today = date.today()
    total_income = await _convert_by_currency(db, income_by_ccy, base_ccy, today)
    total_expenses = await _convert_by_currency(db, expenses_by_ccy, base_ccy, today)
    net_cash_flow = total_income - total_expenses

    acc_filter = select(Account.id, Account.currency).where(Account.profile_id == pid)
    if parsed_ids:
        acc_filter = acc_filter.where(Account.id.in_(parsed_ids))
    all_acc = (await db.execute(acc_filter)).all()
    net_worth = 0
    for acc_id, acc_currency in all_acc:
        acc_ccy = acc_currency or "EUR"
        snap_q = await db.execute(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == acc_id)
            .order_by(AccountBalanceSnapshot.date.desc())
            .limit(1)
        )
        snap = snap_q.scalar_one_or_none()
        if snap:
            t_q = await db.execute(
                select(func.sum(Transaction.amount_cents * func.iif(Transaction.is_debit == False, 1, -1)))
                .where(and_(
                    Transaction.account_id == acc_id,
                    Transaction.date > snap.date,
                    Transaction.is_internal_transfer == False
                ))
            )
            balance = snap.amount_cents + (t_q.scalar() or 0)
        else:
            t_q = await db.execute(
                select(func.sum(Transaction.amount_cents * func.iif(Transaction.is_debit == False, 1, -1)))
                .where(and_(
                    Transaction.account_id == acc_id,
                    Transaction.is_internal_transfer == False
                ))
            )
            balance = t_q.scalar() or 0
        net_worth += await convert_cents(db, balance, acc_ccy, base_ccy, today)

        # Holdings-priced investment accounts carry their value in positions, not in
        # transactions/snapshots — add the live holdings value so net worth matches
        # the Investissements page.
        from routers.investments import account_holdings_value_cents
        hv = await account_holdings_value_cents(db, acc_id, acc_ccy)
        if hv:
            net_worth += await convert_cents(db, hv, acc_ccy, base_ccy, today)

    last_date_q = await db.execute(select(func.max(Transaction.date)).where(Transaction.profile_id == pid))
    last_date = last_date_q.scalar()
    last_transaction_date = str(last_date) if last_date else None

    return AnalyticsSummary(
        total_income_cents=total_income,
        total_expenses_cents=total_expenses,
        net_cash_flow_cents=net_cash_flow,
        net_worth_cents=net_worth,
        total_income_display=cents_to_display(total_income, base_ccy),
        total_expenses_display=cents_to_display(total_expenses, base_ccy),
        net_cash_flow_display=cents_to_display(net_cash_flow, base_ccy),
        net_worth_display=cents_to_display(net_worth, base_ccy),
        last_transaction_date=last_transaction_date,
    )


@router.get("/by-category", response_model=List[CategoryBreakdown])
async def by_category(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    parsed_ids = _parse_account_ids(account_ids)
    base_ccy = await _get_base_currency(db, pid)
    acc_ccys = await _load_account_currencies(db, parsed_ids, pid)

    filters = _date_filters(date_from, date_to)
    filters.append(Transaction.is_debit == True)
    filters.append(Transaction.is_internal_transfer == False)
    filters.append(Transaction.profile_id == pid)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))

    txn_rows = (await db.execute(
        select(
            Transaction.category_id,
            Transaction.account_id,
            func.sum(Transaction.amount_cents).label("total"),
            func.count(Transaction.id).label("cnt"),
        )
        .where(and_(*filters))
        .group_by(Transaction.category_id, Transaction.account_id)
    )).all()

    today = date.today()
    cat_totals: dict[int | None, int] = defaultdict(int)
    cat_counts: dict[int | None, int] = defaultdict(int)
    for r in txn_rows:
        ccy = acc_ccys.get(r.account_id, "EUR")
        converted = await convert_cents(db, r.total, ccy, base_ccy, today)
        cat_totals[r.category_id] += converted
        cat_counts[r.category_id] += r.cnt

    grand_total = sum(cat_totals.values()) or 1

    cat_ids = [cid for cid in cat_totals if cid is not None]
    cat_map: dict = {}
    if cat_ids:
        cats = await db.execute(select(Category).where(Category.id.in_(cat_ids)))
        for c in cats.scalars():
            cat_map[c.id] = c.name

    result = []
    for cat_id in sorted(cat_totals, key=lambda x: cat_totals[x], reverse=True):
        result.append(CategoryBreakdown(
            category_id=cat_id,
            category_name=cat_map.get(cat_id, "Non catégorisé") if cat_id else "Non catégorisé",
            total_cents=cat_totals[cat_id],
            count=cat_counts[cat_id],
            percentage=round(cat_totals[cat_id] / grand_total * 100, 1),
        ))
    return result


@router.get("/spending-trends")
async def spending_trends(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    parsed_ids = _parse_account_ids(account_ids)
    base_ccy = await _get_base_currency(db, pid)
    acc_ccys = await _load_account_currencies(db, parsed_ids, pid)

    filters = _date_filters(date_from, date_to)
    filters.append(Transaction.is_debit == True)
    filters.append(Transaction.is_internal_transfer == False)
    filters.append(Transaction.profile_id == pid)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))

    txn_rows = (await db.execute(
        select(
            Transaction.category_id,
            Transaction.account_id,
            func.strftime("%Y-%m", Transaction.date).label("month"),
            func.sum(Transaction.amount_cents).label("total"),
        )
        .where(and_(*filters))
        .group_by(Transaction.category_id, Transaction.account_id, "month")
    )).all()

    today = date.today()
    data: dict = defaultdict(lambda: defaultdict(int))
    all_months: set = set()
    cat_ids_set: set = set()
    for r in txn_rows:
        ccy = acc_ccys.get(r.account_id, "EUR")
        converted = await convert_cents(db, r.total, ccy, base_ccy, today)
        data[r.category_id][r.month] += converted
        all_months.add(r.month)
        if r.category_id is not None:
            cat_ids_set.add(r.category_id)

    cat_map: dict = {}
    cat_colors: dict = {}
    cat_account: dict = {}
    if cat_ids_set:
        cats = await db.execute(select(Category).where(Category.id.in_(list(cat_ids_set))))
        for c in cats.scalars():
            cat_map[c.id] = c.name
            cat_colors[c.id] = c.color
            cat_account[c.id] = c.account_id

    sorted_months = sorted(all_months)

    result = []
    for cat_id in sorted(cat_ids_set, key=lambda x: cat_map.get(x, "")):
        monthly = data[cat_id]
        series = [{"month": m, "amount_cents": monthly.get(m, 0)} for m in sorted_months]
        result.append({
            "category_id": cat_id,
            "category_name": cat_map.get(cat_id, "Non catégorisé"),
            "category_color": cat_colors.get(cat_id, "#94a3b8"),
            "category_account_id": cat_account.get(cat_id),
            "series": series,
        })

    if None in data:
        monthly = data[None]
        series = [{"month": m, "amount_cents": monthly.get(m, 0)} for m in sorted_months]
        result.append({
            "category_id": None,
            "category_name": "Non catégorisé",
            "category_color": "#94a3b8",
            "category_account_id": None,
            "series": series,
        })

    return result


@router.get("/cash-flow", response_model=List[CashFlowMonth])
async def cash_flow(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    parsed_ids = _parse_account_ids(account_ids)
    base_ccy = await _get_base_currency(db, pid)
    acc_ccys = await _load_account_currencies(db, parsed_ids, pid)

    filters = _date_filters(date_from, date_to)
    filters.append(Transaction.is_internal_transfer == False)
    filters.append(Transaction.profile_id == pid)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))
    base = and_(*filters)

    txn_rows = (await db.execute(
        select(
            func.strftime("%Y-%m", Transaction.date).label("month"),
            Transaction.account_id,
            Transaction.is_debit,
            func.sum(Transaction.amount_cents).label("total"),
        )
        .where(base)
        .group_by("month", Transaction.account_id, Transaction.is_debit)
    )).all()

    today = date.today()
    monthly: dict = defaultdict(lambda: {"income": 0, "expenses": 0})
    for r in txn_rows:
        ccy = acc_ccys.get(r.account_id, "EUR")
        converted = await convert_cents(db, r.total, ccy, base_ccy, today)
        if r.is_debit:
            monthly[r.month]["expenses"] += converted
        else:
            monthly[r.month]["income"] += converted

    return [
        CashFlowMonth(
            month=m,
            income_cents=v["income"],
            expenses_cents=v["expenses"],
            net_cents=v["income"] - v["expenses"],
        )
        for m, v in sorted(monthly.items())
    ]


@router.get("/net-worth")
async def net_worth_history(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    parsed_ids = _parse_account_ids(account_ids)
    base_ccy = await _get_base_currency(db, pid)

    filters = _date_filters(date_from, date_to)
    filters.append(Transaction.profile_id == pid)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))
    base = and_(*filters)

    rows = await db.execute(
        select(
            func.strftime("%Y-%m", Transaction.date).label("month"),
            Transaction.account_id,
            func.sum(
                Transaction.amount_cents * func.iif(Transaction.is_debit == False, 1, -1)
            ).label("net"),
        )
        .where(base)
        .group_by("month", Transaction.account_id)
        .order_by("month")
    )

    account_running: dict = defaultdict(int)
    monthly_totals: dict = defaultdict(dict)

    for r in rows:
        account_running[r.account_id] += r.net
        monthly_totals[r.month][r.account_id] = account_running[r.account_id]

    snap_result = await db.execute(
        select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.profile_id == pid).order_by(AccountBalanceSnapshot.date)
    )
    latest_snap: dict = {}
    for snap in snap_result.scalars():
        latest_snap[snap.account_id] = snap

    for acc_id, snap in latest_snap.items():
        snap_month = snap.date.strftime("%Y-%m")
        running_at_snap = 0
        for month in sorted(monthly_totals.keys()):
            if month <= snap_month and acc_id in monthly_totals[month]:
                running_at_snap = monthly_totals[month][acc_id]

        offset = snap.amount_cents - running_at_snap

        for month in monthly_totals:
            if acc_id in monthly_totals[month]:
                monthly_totals[month][acc_id] += offset

        if snap_month not in monthly_totals:
            monthly_totals[snap_month][acc_id] = snap.amount_cents
        elif acc_id not in monthly_totals[snap_month]:
            monthly_totals[snap_month][acc_id] = snap.amount_cents

    acc_q = select(Account).where(Account.profile_id == pid)
    if parsed_ids:
        acc_q = acc_q.where(Account.id.in_(parsed_ids))
    all_accounts = await db.execute(acc_q)
    acc_map = {a.id: a for a in all_accounts.scalars()}

    # Holdings-priced investment accounts have no transactions/snapshots — inject
    # their reconstructed month-end value (clamped to the requested window) so they
    # count toward net worth, matching the Investissements page.
    from routers.investments import _holdings_monthly_values, account_holdings_value_cents
    from models import AccountType
    today = date.today()
    today_month = today.strftime("%Y-%m")
    existing_months = sorted(monthly_totals.keys())
    lo = date_from.strftime("%Y-%m") if date_from else (existing_months[0] if existing_months else None)
    hi = date_to.strftime("%Y-%m") if date_to else (existing_months[-1] if existing_months else None)
    # The current month within the window gets the live holdings value (includes
    # locked / no-history positions); earlier months use historical reconstruction.
    current_month = today_month if (not hi or today_month <= hi) and (not lo or today_month >= lo) else None
    for acc in acc_map.values():
        if acc.account_type != AccountType.investissement:
            continue
        for entry in await _holdings_monthly_values(db, acc.id, acc.currency or "EUR"):
            m = entry["month"]
            if (lo and m < lo) or (hi and m > hi) or m == current_month:
                continue
            monthly_totals.setdefault(m, {})[acc.id] = entry["amount_cents"]
        if current_month:
            live = await account_holdings_value_cents(db, acc.id, acc.currency or "EUR")
            if live:
                monthly_totals.setdefault(current_month, {})[acc.id] = live

    result = []
    last_known: dict = {}
    for month in sorted(monthly_totals.keys()):
        # Carry each account's last-known balance forward so it persists in months
        # where it has no new data (otherwise a holdings/snapshot account would drop
        # out of the total on months without a transaction).
        last_known.update(monthly_totals[month])
        entry = {"month": month, "total": 0}
        for acc_id, balance in last_known.items():
            acc = acc_map.get(acc_id)
            if not acc:
                continue
            acc_ccy = acc.currency or "EUR"
            converted = await convert_cents(db, balance, acc_ccy, base_ccy, today)
            entry[acc.name] = converted
            entry[f"{acc.name}_native"] = balance
            entry["total"] += converted
        result.append(entry)
    return result


@router.get("/recurring", response_model=List[RecurringTransaction])
async def recurring(
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    parsed_ids = _parse_account_ids(account_ids)
    rec_filters = [Transaction.is_internal_transfer == False, Transaction.profile_id == pid]
    if parsed_ids:
        rec_filters.append(Transaction.account_id.in_(parsed_ids))
    rows = await db.execute(
        select(
            Transaction.description,
            func.count(Transaction.id).label("cnt"),
            func.avg(Transaction.amount_cents).label("avg_amount"),
            func.max(Transaction.date).label("last_date"),
            Transaction.category_id,
        )
        .where(and_(*rec_filters))
        .group_by(Transaction.description, Transaction.category_id)
        .having(func.count(Transaction.id) >= 2)
        .order_by(func.count(Transaction.id).desc())
        .limit(50)
    )

    return [
        RecurringTransaction(
            description=r.description,
            occurrences=r.cnt,
            avg_amount_cents=int(r.avg_amount),
            last_date=r.last_date,
            category_id=r.category_id,
        )
        for r in rows
    ]


@router.get("/budget", response_model=BudgetTableResponse)
async def budget_table(
    months: int = Query(default=13, le=24),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    from datetime import date as date_type
    import calendar

    today = date_type.today()

    month_list = []
    start_y = today.year
    start_m = today.month - 3
    if start_m <= 0:
        start_m += 12
        start_y -= 1
    for i in range(12):
        y = start_y
        m = start_m + i
        if m > 12:
            m -= 12
            y += 1
        month_list.append(f"{y:04d}-{m:02d}")

    date_from = f"{month_list[0]}-01"
    last_month = month_list[-1]
    last_day = calendar.monthrange(int(last_month[:4]), int(last_month[5:7]))[1]
    date_to = f"{last_month}-{last_day:02d}"

    rows = await db.execute(
        select(
            func.strftime("%Y-%m", Transaction.date).label("month"),
            Transaction.category_id,
            func.sum(Transaction.amount_cents).label("total"),
        )
        .where(
            and_(
                Transaction.date >= date_from,
                Transaction.date <= date_to,
                Transaction.is_debit == True,
                Transaction.is_internal_transfer == False,
                Transaction.profile_id == pid,
            )
        )
        .group_by("month", Transaction.category_id)
    )
    actuals: dict = defaultdict(lambda: defaultdict(int))
    for r in rows:
        actuals[r.category_id][r.month] = r.total

    budget_rows = await db.execute(
        select(BudgetEntry).where(BudgetEntry.month.in_(month_list), BudgetEntry.profile_id == pid)
    )
    budgets: dict = defaultdict(lambda: defaultdict(int))
    for b in budget_rows.scalars():
        budgets[b.category_id][b.month] = b.expected_amount_cents

    all_cat_ids = set()
    cat_map: dict = {}
    cats = await db.execute(select(Category).where(Category.profile_id == pid))
    for c in cats.scalars():
        all_cat_ids.add(c.id)
        cat_map[c.id] = c

    table_rows = []
    for cat_id in sorted(all_cat_ids, key=lambda x: cat_map[x].name if cat_map.get(x) else 'zzz'):
        cat = cat_map.get(cat_id)
        cells = []
        total_actual = 0
        total_expected = 0
        for month in month_list:
            actual = actuals[cat_id][month]
            expected = budgets[cat_id][month]
            cells.append(BudgetTableCell(month=month, actual_cents=actual, expected_cents=expected))
            total_actual += actual
            total_expected += expected
        table_rows.append(BudgetTableRow(
            category_id=cat_id,
            category_name=cat.name if cat else "Non catégorisé",
            category_color=cat.color if cat else "#94a3b8",
            cells=cells,
            total_actual_cents=total_actual,
            total_expected_cents=total_expected,
        ))

    none_actuals = actuals.get(None, {})
    if none_actuals:
        cells = []
        total_actual = 0
        for month in month_list:
            actual = none_actuals.get(month, 0)
            cells.append(BudgetTableCell(month=month, actual_cents=actual, expected_cents=0))
            total_actual += actual
        table_rows.append(BudgetTableRow(
            category_id=None,
            category_name="Non catégorisé",
            category_color="#94a3b8",
            cells=cells,
            total_actual_cents=total_actual,
            total_expected_cents=0,
        ))

    col_totals_actual = [sum(row.cells[i].actual_cents for row in table_rows) for i in range(len(month_list))]
    col_totals_expected = [sum(row.cells[i].expected_cents for row in table_rows) for i in range(len(month_list))]

    return BudgetTableResponse(
        months=month_list,
        rows=table_rows,
        column_totals_actual=col_totals_actual,
        column_totals_expected=col_totals_expected,
    )


@router.put("/budget")
async def upsert_budget_entry(
    category_id: int,
    month: str,
    expected_amount_cents: int,
    account_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    filters = [
        BudgetEntry.category_id == category_id,
        BudgetEntry.month == month,
        BudgetEntry.profile_id == pid,
    ]
    if account_id is not None:
        filters.append(BudgetEntry.account_id == account_id)
    else:
        filters.append(BudgetEntry.account_id == None)

    result = await db.execute(
        select(BudgetEntry).where(and_(*filters))
    )
    entry = result.scalar_one_or_none()
    if entry:
        entry.expected_amount_cents = expected_amount_cents
    else:
        entry = BudgetEntry(
            category_id=category_id,
            month=month,
            expected_amount_cents=expected_amount_cents,
            account_id=account_id,
            profile_id=pid,
        )
        db.add(entry)
    await db.commit()
    return {"ok": True}


@router.get("/budget-full", response_model=BudgetFullResponse)
async def budget_full(
    year: int = Query(default=None),
    account_id: Optional[int] = Query(default=None),
    account_ids: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    import calendar
    from datetime import date as date_type

    if year is None:
        year = date_type.today().year

    month_list = [f"{year:04d}-{m:02d}" for m in range(1, 13)]

    date_from = f"{year:04d}-01-01"
    date_to = f"{year:04d}-12-31"

    txn_filters = [
        Transaction.date >= date_from,
        Transaction.date <= date_to,
        Transaction.is_internal_transfer == False,
        Transaction.profile_id == pid,
    ]
    parsed_acc_ids = _parse_account_ids(account_ids)
    if account_id is not None:
        txn_filters.append(Transaction.account_id == account_id)
    elif parsed_acc_ids:
        txn_filters.append(Transaction.account_id.in_(parsed_acc_ids))

    rows = await db.execute(
        select(
            func.strftime("%Y-%m", Transaction.date).label("month"),
            Transaction.category_id,
            Transaction.is_debit,
            func.sum(Transaction.amount_cents).label("total"),
        )
        .where(and_(*txn_filters))
        .group_by("month", Transaction.category_id, Transaction.is_debit)
    )
    actuals: dict = defaultdict(lambda: defaultdict(int))
    for r in rows:
        actuals[r.category_id][r.month] += r.total

    budget_filters = [BudgetEntry.month.in_(month_list), BudgetEntry.profile_id == pid]
    if account_id is not None:
        budget_filters.append(BudgetEntry.account_id == account_id)
    elif parsed_acc_ids:
        budget_filters.append(BudgetEntry.account_id.in_(parsed_acc_ids) | (BudgetEntry.account_id == None))
    else:
        budget_filters.append(BudgetEntry.account_id == None)

    budget_rows = await db.execute(
        select(BudgetEntry).where(and_(*budget_filters))
    )
    budgets: dict = defaultdict(lambda: defaultdict(int))
    for b in budget_rows.scalars():
        budgets[b.category_id][b.month] = b.expected_amount_cents

    cats_result = await db.execute(select(Category).where(Category.profile_id == pid))
    all_cats = list(cats_result.scalars())

    income_cats = []
    fixed_cats = []
    variable_cats = []
    for cat in all_cats:
        if account_id is not None and cat.account_id is not None and cat.account_id != account_id:
            continue
        if cat.is_income:
            income_cats.append(cat)
        elif getattr(cat, "expense_type", None) == "fixed":
            fixed_cats.append(cat)
        else:
            variable_cats.append(cat)

    income_cats.sort(key=lambda c: c.name)
    fixed_cats.sort(key=lambda c: c.name)
    variable_cats.sort(key=lambda c: c.name)

    def build_section(cats_list, section_key, section_label):
        rows_out = []
        section_totals_actual = {m: 0 for m in month_list}
        section_totals_expected = {m: 0 for m in month_list}
        total_actual_all = 0
        total_expected_all = 0

        for cat in cats_list:
            cells = []
            row_total_actual = 0
            row_total_expected = 0
            for month in month_list:
                actual = actuals[cat.id].get(month, 0)
                expected = budgets[cat.id].get(month, 0)
                cells.append(BudgetTableCell(month=month, actual_cents=actual, expected_cents=expected))
                section_totals_actual[month] += actual
                section_totals_expected[month] += expected
                row_total_actual += actual
                row_total_expected += expected
            rows_out.append(BudgetTableRow(
                category_id=cat.id,
                category_name=cat.name,
                category_color=cat.color,
                is_investment=getattr(cat, 'is_investment', False) or False,
                cells=cells,
                total_actual_cents=row_total_actual,
                total_expected_cents=row_total_expected,
            ))
            total_actual_all += row_total_actual
            total_expected_all += row_total_expected

        totals_cells = [
            BudgetTableCell(month=m, actual_cents=section_totals_actual[m], expected_cents=section_totals_expected[m])
            for m in month_list
        ]
        totals_row = BudgetTableRow(
            category_id=None,
            category_name=f"TOTAL {section_label}",
            category_color="",
            cells=totals_cells,
            total_actual_cents=total_actual_all,
            total_expected_cents=total_expected_all,
        )

        return BudgetSectionRow(
            section=section_key,
            section_label=section_label,
            rows=rows_out,
            section_totals=totals_row,
        ), section_totals_actual, section_totals_expected, total_actual_all, total_expected_all

    sec_revenus, rev_actual, rev_expected, rev_tot_a, rev_tot_e = build_section(income_cats, "revenus", "REVENUS")
    sec_fixes, fix_actual, fix_expected, fix_tot_a, fix_tot_e = build_section(fixed_cats, "depenses_fixes", "DÉPENSES FIXES")
    sec_var, var_actual, var_expected, var_tot_a, var_tot_e = build_section(variable_cats, "depenses_variables", "DÉPENSES VARIABLES")

    reste_cells = [
        BudgetTableCell(
            month=m,
            actual_cents=rev_actual[m] - fix_actual[m],
            expected_cents=rev_expected[m] - fix_expected[m],
        )
        for m in month_list
    ]
    reste_row = BudgetTableRow(
        category_id=None,
        category_name="RESTE APRÈS DÉPENSES FIXES",
        category_color="",
        cells=reste_cells,
        total_actual_cents=rev_tot_a - fix_tot_a,
        total_expected_cents=rev_tot_e - fix_tot_e,
    )

    grand_cells = [
        BudgetTableCell(
            month=m,
            actual_cents=rev_actual[m] - fix_actual[m] - var_actual[m],
            expected_cents=rev_expected[m] - fix_expected[m] - var_expected[m],
        )
        for m in month_list
    ]
    grand_total_row = BudgetTableRow(
        category_id=None,
        category_name="SOLDE TOTAL",
        category_color="",
        cells=grand_cells,
        total_actual_cents=rev_tot_a - fix_tot_a - var_tot_a,
        total_expected_cents=rev_tot_e - fix_tot_e - var_tot_e,
    )

    return BudgetFullResponse(
        months=month_list,
        sections=[sec_revenus, sec_fixes, sec_var],
        reste_row=reste_row,
        grand_total_row=grand_total_row,
        account_id=account_id,
    )
