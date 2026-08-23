"""Loan amortization.

Computes a fixed-rate amortization schedule from a loan's principal, annual
nominal rate, term and start date, applying any extra (early) principal payments
month by month. Everything downstream (remaining balance, payoff date, interest
paid/remaining, progress, and the net-worth contribution) is derived from this.

All money is integer cents. Rate is an annual percentage (e.g. 1.5 for 1.5 %).
"""
from datetime import date
from collections import defaultdict
from typing import Iterable, Optional

from dateutil.relativedelta import relativedelta

# Safety cap on the simulation loop (a 40-year monthly loan is 480 rows).
_MAX_MONTHS = 1000


def compute_monthly_payment_cents(principal_cents: int, annual_rate_pct: float, term_months: int) -> int:
    """Standard fixed-rate annuity payment. Falls back to straight-line when the
    rate is 0. Returns 0 when the inputs are incomplete."""
    if not principal_cents or not term_months or term_months <= 0:
        return 0
    i = (annual_rate_pct or 0) / 100 / 12
    if i <= 0:
        return round(principal_cents / term_months)
    factor = (1 + i) ** term_months
    return round(principal_cents * i * factor / (factor - 1))


def compute_amortization(
    principal_cents: Optional[int],
    annual_rate_pct: Optional[float],
    term_months: Optional[int],
    start_date: Optional[date],
    monthly_payment_cents: Optional[int] = None,
    extra_payments: Optional[Iterable[tuple]] = None,
    as_of: Optional[date] = None,
    include_schedule: bool = False,
) -> dict:
    """Return an amortization summary dict (see keys below).

    `extra_payments` is an iterable of (date, amount_cents). `as_of` splits the
    schedule into paid-so-far vs. remaining (defaults to the last elapsed row's
    figures). When inputs are incomplete the summary is still returned with
    ``computable=False`` so the UI can show what it has.
    """
    principal = principal_cents or 0
    term = term_months or 0
    rate = annual_rate_pct or 0
    i = rate / 100 / 12

    payment = monthly_payment_cents or compute_monthly_payment_cents(principal, rate, term)

    base = {
        "principal_cents": principal,
        "monthly_payment_cents": payment,
        "interest_rate_pct": rate,
        "term_months": term,
        "start_date": start_date.isoformat() if start_date else None,
        "remaining_cents": principal,
        "paid_principal_cents": 0,
        "progress_pct": 0.0,
        "months_elapsed": 0,
        "months_remaining": term,
        "actual_term_months": term,
        "payoff_date": None,
        "interest_total_cents": 0,
        "interest_paid_cents": 0,
        "interest_remaining_cents": 0,
        "extra_paid_cents": 0,
        "computable": False,
        "insufficient_payment": False,
        "schedule": [] if include_schedule else None,
    }

    if principal <= 0 or payment <= 0 or not start_date:
        return base

    extra_by_month: dict = defaultdict(int)
    for d, amt in (extra_payments or []):
        if d and amt:
            extra_by_month[(d.year, d.month)] += amt

    schedule = []
    balance = principal
    month_date = start_date
    months = 0
    total_interest = 0
    total_extra = 0
    insufficient = False

    while balance > 0 and months < _MAX_MONTHS:
        interest = round(balance * i)
        sched_principal = payment - interest
        if sched_principal <= 0:
            # Payment doesn't even cover interest — the loan never amortizes.
            insufficient = True
            break
        sched_principal = min(sched_principal, balance)
        balance -= sched_principal

        extra = extra_by_month.get((month_date.year, month_date.month), 0)
        applied_extra = min(extra, balance) if extra > 0 else 0
        balance -= applied_extra

        total_interest += interest
        total_extra += applied_extra
        months += 1
        schedule.append({
            "date": month_date.isoformat(),
            "payment_cents": interest + sched_principal + applied_extra,
            "interest_cents": interest,
            "principal_cents": sched_principal + applied_extra,
            "balance_cents": balance,
        })
        month_date = month_date + relativedelta(months=1)

    as_of = as_of or date.today()
    elapsed = sum(1 for row in schedule if row["date"] <= as_of.isoformat())
    interest_paid = sum(row["interest_cents"] for row in schedule[:elapsed])
    remaining = schedule[elapsed - 1]["balance_cents"] if elapsed > 0 else principal

    base.update({
        "monthly_payment_cents": payment,
        "remaining_cents": remaining,
        "paid_principal_cents": principal - remaining,
        "progress_pct": round((principal - remaining) / principal * 100, 1) if principal else 0.0,
        "months_elapsed": elapsed,
        "months_remaining": max(0, len(schedule) - elapsed),
        "actual_term_months": len(schedule),
        "payoff_date": schedule[-1]["date"] if schedule else None,
        "interest_total_cents": total_interest,
        "interest_paid_cents": interest_paid,
        "interest_remaining_cents": total_interest - interest_paid,
        "extra_paid_cents": total_extra,
        "computable": True,
        "insufficient_payment": insufficient,
        "schedule": schedule if include_schedule else None,
    })
    return base
