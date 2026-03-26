import hashlib

def generate_import_hash(date_str: str, description: str, amount_cents: int) -> str:
    """Generate a SHA-256 hash for deduplication based on transaction core fields."""
    raw = f"{date_str}|{description}|{amount_cents}"
    return hashlib.sha256(raw.encode()).hexdigest()
