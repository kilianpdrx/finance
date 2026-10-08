import hashlib
import re
from typing import NamedTuple, Optional


def csv_safe_cell(value) -> str:
    """Neutralize CSV/Excel formula injection.

    A description like ``=HYPERLINK(...)`` or ``@SUM(...)`` imported from a bank
    file would execute when the exported CSV is opened in a spreadsheet. Prefix
    any cell that starts with a formula trigger with a single quote so it's read
    as text. Apply to user-derived TEXT fields only — never to numeric columns
    (a leading '-' on an amount is legitimate).
    """
    s = "" if value is None else str(value)
    if s[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def generate_import_hash(date_str: str, description: str, amount_cents: int, account_id=None, is_debit=None) -> str:
    """Generate a SHA-256 hash for deduplication based on transaction core fields.

    Includes account_id so identical transactions in different accounts/profiles
    don't collide on the global transactions.import_hash UNIQUE constraint, and the
    debit/credit direction so a charge and a same-amount refund on the same day
    (identical description) are NOT treated as duplicates of each other.
    """
    parts = []
    if account_id is not None:
        parts.append(str(account_id))
    parts += [str(date_str), description, str(amount_cents)]
    if is_debit is not None:
        parts.append("D" if is_debit else "C")
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()


class AmountQuery(NamedTuple):
    """A search text read as an amount (see `parse_amount_query`)."""
    lo_cents: int
    hi_cents: int
    is_debit: Optional[bool]   # set when the text carried a sign
    amount_only: bool          # the text can only be an amount, not a label


# sign · digits (grouped by spaces or apostrophes) · up to two decimals · currency
_AMOUNT_QUERY = re.compile(
    r"^(?P<sign>[+\-\u2212])?\s*(?P<int>\d[\d\s\u00a0\u202f']*)"
    r"(?:(?P<sep>[.,])(?P<dec>\d{0,2}))?\s*(?P<cur>€|\$|£|eur|chf|usd|gbp|fr\.?)?$",
    re.IGNORECASE,
)


def parse_amount_query(text: Optional[str]) -> Optional[AmountQuery]:
    """Read a search box entry as an amount, the way it is displayed in the app.

    The precision typed is the precision searched, so the result narrows as the
    user types: "23" covers 23,00–23,99, "23,4" covers 23,40–23,49 and "23,40" is
    exact. A leading "-" or "+" restricts to expenses or income. Thousands may be
    grouped ("1 850", "1'850"); comma and point both work as the decimal mark.

    `amount_only` is true when the text cannot be a label search — it has a
    decimal mark, a sign or a currency. A bare whole number ("5106") could just
    as well be a reference inside a label, so the caller searches both.

    Returns None when the text is not an amount at all."""
    m = _AMOUNT_QUERY.match((text or "").strip())
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group("int"))
    if not digits or len(digits) > 9:
        return None
    dec = m.group("dec") or ""
    lo = int(digits) * 100 + (int(dec.ljust(2, "0")) if dec else 0)
    hi = lo + (99 if not dec else 9 if len(dec) == 1 else 0)
    sign = m.group("sign")
    return AmountQuery(
        lo_cents=lo,
        hi_cents=hi,
        is_debit=None if sign is None else sign != "+",
        amount_only=bool(sign or m.group("sep") or m.group("cur")),
    )

