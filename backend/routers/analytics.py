from typing import List, Optional
from datetime import date
from collections import defaultdict
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Transaction, Account, Category, BudgetEntry, AccountBalanceSnapshot, ExchangeRate
from schemas import (
    AnalyticsSummary, CashFlowMonth, CategoryBreakdown,
    RecurringTransaction, BudgetTableResponse, BudgetTableRow, BudgetTableCell,
    BudgetSectionRow, BudgetFullResponse,
    cents_to_display,
)
from services.exchange_rates import sync_exchange_rates
router = APIRouter()


def _date_filters(date_from: Optional[date], date_to: Optional[date]):
    filters = []
    if date_from:
        filters.append(Transaction.date >= date_from)
    if date_to:
        filters.append(Transaction.date <= date_to)
    return filters


def _parse_account_ids(account_ids: Optional[str]) -> Optional[List[int]]:
    """Parse comma-separated account IDs string into list of ints."""
    if not account_ids:
        return None
    try:
        return [int(x.strip()) for x in account_ids.split(",") if x.strip()]
    except ValueError:
        return None


@router.get("/summary", response_model=AnalyticsSummary)
async def summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    parsed_ids = _parse_account_ids(account_ids)
    filters = _date_filters(date_from, date_to)
    # Exclude internal transfers from income/expense calculations
    filters.append(Transaction.is_internal_transfer == False)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))
    base = and_(*filters)

    income_q = await db.execute(
        select(func.sum(Transaction.amount_cents)).where(
            and_(base, Transaction.is_debit == False)
        )
    )
    total_income = income_q.scalar() or 0

    exp_q = await db.execute(
        select(func.sum(Transaction.amount_cents)).where(
            and_(base, Transaction.is_debit == True)
        )
    )
    total_expenses = exp_q.scalar() or 0

    net_cash_flow = total_income - total_expenses

    # Net worth with snapshots
    acc_filter = select(Account.id)
    if parsed_ids:
        acc_filter = acc_filter.where(Account.id.in_(parsed_ids))
    all_acc = await db.execute(acc_filter)
    net_worth = 0
    for acc_id in all_acc.scalars().all():
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
            net_worth += snap.amount_cents + (t_q.scalar() or 0)
        else:
            t_q = await db.execute(
                select(func.sum(Transaction.amount_cents * func.iif(Transaction.is_debit == False, 1, -1)))
                .where(and_(
                    Transaction.account_id == acc_id,
                    Transaction.is_internal_transfer == False
                ))
            )
            net_worth += t_q.scalar() or 0

    # Last transaction date (across all time, not filtered)
    last_date_q = await db.execute(
        select(func.max(Transaction.date))
    )
    last_date = last_date_q.scalar()
    last_transaction_date = str(last_date) if last_date else None

    return AnalyticsSummary(
        total_income_cents=total_income,
        total_expenses_cents=total_expenses,
        net_cash_flow_cents=net_cash_flow,
        net_worth_cents=net_worth,
        total_income_display=cents_to_display(total_income),
        total_expenses_display=cents_to_display(total_expenses),
        net_cash_flow_display=cents_to_display(net_cash_flow),
        net_worth_display=cents_to_display(net_worth),
        last_transaction_date=last_transaction_date,
    )


@router.get("/by-category", response_model=List[CategoryBreakdown])
async def by_category(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    parsed_ids = _parse_account_ids(account_ids)
    filters = _date_filters(date_from, date_to)
    filters.append(Transaction.is_debit == True)
    filters.append(Transaction.is_internal_transfer == False)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))
    base = and_(*filters)

    rows = await db.execute(
        select(
            Transaction.category_id,
            func.sum(Transaction.amount_cents).label("total"),
            func.count(Transaction.id).label("cnt"),
        )
        .where(base)
        .group_by(Transaction.category_id)
    )
    data = rows.all()

    grand_total = sum(r.total for r in data) or 1

    cat_ids = [r.category_id for r in data if r.category_id]
    cat_map: dict = {}
    if cat_ids:
        cats = await db.execute(select(Category).where(Category.id.in_(cat_ids)))
        for c in cats.scalars():
            cat_map[c.id] = c.name

    result = []
    for r in sorted(data, key=lambda x: x.total, reverse=True):
        result.append(CategoryBreakdown(
            category_id=r.category_id,
            category_name=cat_map.get(r.category_id, "Non catégorisé") if r.category_id else "Non catégorisé",
            total_cents=r.total,
            count=r.cnt,
            percentage=round(r.total / grand_total * 100, 1),
        ))
    return result


@router.get("/cash-flow", response_model=List[CashFlowMonth])
async def cash_flow(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    parsed_ids = _parse_account_ids(account_ids)
    filters = _date_filters(date_from, date_to)
    filters.append(Transaction.is_internal_transfer == False)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))
    base = and_(*filters) if filters else True

    rows = await db.execute(
        select(
            func.strftime("%Y-%m", Transaction.date).label("month"),
            Transaction.is_debit,
            func.sum(Transaction.amount_cents).label("total"),
        )
        .where(base)
        .group_by("month", Transaction.is_debit)
        .order_by("month")
    )

    monthly: dict = defaultdict(lambda: {"income": 0, "expenses": 0})
    for r in rows:
        if r.is_debit:
            monthly[r.month]["expenses"] += r.total
        else:
            monthly[r.month]["income"] += r.total

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
):
    parsed_ids = _parse_account_ids(account_ids)
    filters = _date_filters(date_from, date_to)
    if parsed_ids:
        filters.append(Transaction.account_id.in_(parsed_ids))
    base = and_(*filters) if filters else True

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

    # Build cumulative running totals per month per account
    account_running: dict = defaultdict(int)
    monthly_totals: dict = defaultdict(dict)

    for r in rows:
        account_running[r.account_id] += r.net
        monthly_totals[r.month][r.account_id] = account_running[r.account_id]

    # Load latest snapshot per account for adjustment
    snap_result = await db.execute(
        select(AccountBalanceSnapshot).order_by(AccountBalanceSnapshot.date)
    )
    latest_snap: dict = {}  # acc_id -> latest snapshot
    for snap in snap_result.scalars():
        latest_snap[snap.account_id] = snap  # last wins (ordered by date asc)

    # For each account with a snapshot, compute offset and apply to all months >= snapshot month
    for acc_id, snap in latest_snap.items():
        snap_month = snap.date.strftime("%Y-%m")
        # Find the running total at the snapshot month (or the most recent month before it)
        running_at_snap = 0
        for month in sorted(monthly_totals.keys()):
            if month <= snap_month and acc_id in monthly_totals[month]:
                running_at_snap = monthly_totals[month][acc_id]

        offset = snap.amount_cents - running_at_snap

        # Apply offset to all months >= snap_month
        for month in monthly_totals:
            if month >= snap_month and acc_id in monthly_totals[month]:
                monthly_totals[month][acc_id] += offset

        # If the account has no transactions in recent months but has a snapshot,
        # inject the snapshot as a data point
        if snap_month not in monthly_totals:
            monthly_totals[snap_month][acc_id] = snap.amount_cents
        elif acc_id not in monthly_totals[snap_month]:
            monthly_totals[snap_month][acc_id] = snap.amount_cents

    acc_q = select(Account)
    if parsed_ids:
        acc_q = acc_q.where(Account.id.in_(parsed_ids))
    all_accounts = await db.execute(acc_q)
    acc_map = {a.id: a for a in all_accounts.scalars()}

    # Fetch exchange rates
    await sync_exchange_rates(db)
    rates_res = await db.execute(select(ExchangeRate))
    rate_map = {r.currency_code: r.rate_ten_thousandths / 10000.0 for r in rates_res.scalars()}
    rate_map["EUR"] = 1.0

    result = []
    for month in sorted(monthly_totals.keys()):
        entry = {"month": month, "total": 0}
        for acc_id, balance in monthly_totals[month].items():
            acc = acc_map.get(acc_id)
            if not acc:
                continue
            
            currency = getattr(acc, "currency", "EUR") or "EUR"
            rate = rate_map.get(currency.upper(), 1.0)
            
            # Convert to EUR
            balance_eur = int(balance * rate)
            
            entry[acc.name] = balance_eur
            entry[f"{acc.name}_native"] = balance
            entry["total"] += balance_eur
            
        result.append(entry)
    return result


@router.get("/recurring", response_model=List[RecurringTransaction])
async def recurring(
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    parsed_ids = _parse_account_ids(account_ids)
    rec_filters = [Transaction.is_internal_transfer == False]
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
):
    """Return monthly budget table: last N months of actuals + saved forecasts."""
    from datetime import date as date_type
    import calendar

    today = date_type.today()

    # Generate a range of 12 months (e.g. 6 months past, current, 5 months future, or all from start of year)
    # Let's do January to December of the current year by default if months is 12.
    # Actually, a rolling 12 months starting from 3 months ago is very practical.
    month_list = []
    
    start_y = today.year
    start_m = today.month - 3 # Start 3 months in the past
    
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

    # Get actuals grouped by category and month
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
            )
        )
        .group_by("month", Transaction.category_id)
    )
    actuals: dict = defaultdict(lambda: defaultdict(int))
    for r in rows:
        actuals[r.category_id][r.month] = r.total

    # Get budget entries
    budget_rows = await db.execute(
        select(BudgetEntry).where(BudgetEntry.month.in_(month_list))
    )
    budgets: dict = defaultdict(lambda: defaultdict(int))
    for b in budget_rows.scalars():
        budgets[b.category_id][b.month] = b.expected_amount_cents

    # Get ALL active categories so they are persistently displayed
    all_cat_ids = set()
    cat_map: dict = {}
    cats = await db.execute(select(Category))
    for c in cats.scalars():
        all_cat_ids.add(c.id)
        cat_map[c.id] = c

    # Build rows
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

    # Also add uncategorized row if needed
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

    # Column totals
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
):
    """Create or update a budget entry for a category+month+account."""
    filters = [
        BudgetEntry.category_id == category_id,
        BudgetEntry.month == month,
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
        )
        db.add(entry)
    await db.commit()
    return {"ok": True}


@router.get("/budget-full", response_model=BudgetFullResponse)
async def budget_full(
    year: int = Query(default=None),
    account_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return structured budget table with income, fixed expenses, and variable expenses."""
    import calendar
    from datetime import date as date_type

    if year is None:
        year = date_type.today().year

    # Generate 12 months for the year
    month_list = [f"{year:04d}-{m:02d}" for m in range(1, 13)]

    date_from = f"{year:04d}-01-01"
    date_to = f"{year:04d}-12-31"

    # ── Query actuals grouped by month + category_id ──────────────────────────
    txn_filters = [
        Transaction.date >= date_from,
        Transaction.date <= date_to,
        Transaction.is_internal_transfer == False,
    ]
    if account_id is not None:
        txn_filters.append(Transaction.account_id == account_id)

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
    # actuals: {category_id: {month: cents}}  (positive values)
    actuals: dict = defaultdict(lambda: defaultdict(int))
    for r in rows:
        actuals[r.category_id][r.month] += r.total

    # ── Query budget entries ──────────────────────────────────────────────────
    budget_filters = [BudgetEntry.month.in_(month_list)]
    if account_id is not None:
        budget_filters.append(BudgetEntry.account_id == account_id)
    else:
        budget_filters.append(BudgetEntry.account_id == None)

    budget_rows = await db.execute(
        select(BudgetEntry).where(and_(*budget_filters))
    )
    budgets: dict = defaultdict(lambda: defaultdict(int))
    for b in budget_rows.scalars():
        budgets[b.category_id][b.month] = b.expected_amount_cents

    # ── Load all active categories and group into 3 sections ──────────────────
    cats_result = await db.execute(select(Category))
    all_cats = list(cats_result.scalars())

    income_cats = []
    fixed_cats = []
    variable_cats = []
    for cat in all_cats:
        if cat.is_income:
            income_cats.append(cat)
        elif getattr(cat, "expense_type", None) == "fixed":
            fixed_cats.append(cat)
        else:
            # "variable" or None (default to variable for non-income)
            variable_cats.append(cat)

    income_cats.sort(key=lambda c: c.name)
    fixed_cats.sort(key=lambda c: c.name)
    variable_cats.sort(key=lambda c: c.name)

    # ── Build rows for a section ──────────────────────────────────────────────
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

    # ── Reste row: REVENUS - DEPENSES FIXES per month ─────────────────────────
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

    # ── Grand total row: REVENUS - ALL EXPENSES ───────────────────────────────
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
