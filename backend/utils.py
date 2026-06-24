import hashlib

def generate_import_hash(date_str: str, description: str, amount_cents: int, account_id=None) -> str:
    """Generate a SHA-256 hash for deduplication based on transaction core fields.

    Includes account_id so identical transactions in different accounts/profiles
    don't collide on the global transactions.import_hash UNIQUE constraint.
    """
    if account_id is not None:
        raw = f"{account_id}|{date_str}|{description}|{amount_cents}"
    else:
        raw = f"{date_str}|{description}|{amount_cents}"
    return hashlib.sha256(raw.encode()).hexdigest()
