"""Which bank deposit is a payslip's salary — computed on read, never stored.

In the employer's account, a credit around the pay date (the month paid when
the payslip gives none) whose amount is the payslip's net paid. Stored, the
link could point at a transaction deleted or re-imported since; computed, it
always describes the ledger as it is. It never writes anything: not a link,
not a category (invariant 3).

Statuses: paid (the exact amount), gap (within 2 %, the difference given),
missing, no_account (the employer has no account), other_currency (the account
is in another currency than the payslip — no conversion is guessed).
"""
import calendar
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Account, Employer, Payslip, Transaction

WINDOW = timedelta(days=10)
TOLERANCE = 0.02


def window(p: Payslip) -> tuple[date, date]:
    if p.pay_date is not None:
        return p.pay_date - WINDOW, p.pay_date + WINDOW
    year, month = int(p.period[:4]), int(p.period[5:7])
    last = date(year, month, calendar.monthrange(year, month)[1])
    return date(year, month, 1) - timedelta(days=5), last + WINDOW


def _status(status: str, t=None, difference: int = 0) -> dict:
    return {
        "status": status, "transaction_id": t.id if t else None, "date": t.date if t else None,
        "amount_cents": t.amount_cents if t else None, "description": t.description if t else None,
        "difference_cents": difference,
    }


async def deposits(db: AsyncSession, pid: int, payslips: list[Payslip], employers: dict[int, Employer]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    by_account: dict[int, list[Payslip]] = {}
    for p in payslips:
        employer = employers.get(p.employer_id)
        if employer is None or employer.account_id is None:
            out[p.id] = _status("no_account")
        else:
            by_account.setdefault(employer.account_id, []).append(p)

    for account_id, slips in by_account.items():
        account = await db.get(Account, account_id)
        if account is None or account.profile_id != pid:
            for p in slips:
                out[p.id] = _status("no_account")
            continue
        spans = {p.id: window(p) for p in slips}
        rows = (await db.execute(select(Transaction).where(
            Transaction.profile_id == pid, Transaction.account_id == account_id, Transaction.is_debit.is_(False),
            Transaction.date >= min(s for s, _ in spans.values()), Transaction.date <= max(e for _, e in spans.values()),
        ))).scalars().all()
        rows = [t for t in rows if not t.is_internal_transfer]
        used: set[int] = set()
        # Exact amounts first, every payslip of the account: a near amount must
        # never take the deposit that is exactly another month's salary.
        for exact in (True, False):
            for p in sorted(slips, key=lambda s: s.period):
                if p.id in out:
                    continue
                if (account.currency or "EUR") != p.currency:
                    out[p.id] = _status("other_currency")
                    continue
                start, end = spans[p.id]
                hint = (employers[p.employer_id].label_hint or "").lower()
                candidates = [t for t in rows if start <= t.date <= end and t.id not in used
                              and (not hint or hint in t.description.lower())]
                target = p.pay_date or end - WINDOW
                if exact:
                    found = sorted((t for t in candidates if t.amount_cents == p.net_paid_cents),
                                   key=lambda t: abs((t.date - target).days))
                    if found:
                        used.add(found[0].id)
                        out[p.id] = _status("paid", found[0])
                    continue
                near = sorted((t for t in candidates if abs(t.amount_cents - p.net_paid_cents) <= TOLERANCE * p.net_paid_cents),
                              key=lambda t: (abs(t.amount_cents - p.net_paid_cents), abs((t.date - target).days)))
                if near:
                    used.add(near[0].id)
                    out[p.id] = _status("gap", near[0], near[0].amount_cents - p.net_paid_cents)
                else:
                    out[p.id] = _status("missing")
    return out
