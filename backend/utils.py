import hashlib


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
