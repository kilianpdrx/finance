"""Detect bank profile from CSV file bytes and filename."""
import io
import logging
import unicodedata
import chardet
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import BankProfile

logger = logging.getLogger(__name__)


def _norm(s: str) -> str:
    """Lowercase, strip accents and surrounding whitespace for keyword matching."""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


# Keyword hints per mapping role (FR + EN + DE), accent-insensitive.
_ROLE_KEYWORDS = {
    "date": ["date", "jour", "datum", "buchung"],
    "debit": ["debit", "retrait", "withdrawal", "depense", "sortie"],
    "credit": ["credit", "versement", "deposit", "recette", "entree"],
    "amount": ["montant", "amount", "betrag", "valeur", "value"],
    "balance": ["solde", "balance", "saldo"],
    "currency": ["devise", "currency", "monnaie", "waehrung", "ccy"],
    "description": ["description", "libelle", "label", "wording", "nature", "motif",
                    "detail", "communication", "name", "payee", "memo", "narrative", "objet"],
}
# More specific roles first so e.g. a "Débit" column isn't stolen by "amount".
_ROLE_PRIORITY = ["date", "debit", "credit", "amount", "balance", "currency", "description"]


def guess_columns(headers: list[str]) -> dict[str, str]:
    """Best-effort guess of {header_name: role} from CSV headers, so the mapping
    UI can pre-select the likely field for each column. Each role is assigned to
    at most one header; unmatched headers are simply omitted."""
    norm = {h: _norm(h) for h in headers}
    assigned: set[str] = set()
    result: dict[str, str] = {}
    for role in _ROLE_PRIORITY:
        for h in headers:
            if h in assigned:
                continue
            if any(kw in norm[h] for kw in _ROLE_KEYWORDS[role]):
                assigned.add(h)
                result[h] = role
                break
    return result


def guess_confidence(guesses: dict[str, str]) -> float:
    """0..1 confidence that the guesses are usable: fraction of the essential
    roles (date, description, and an amount source) that were found."""
    roles = set(guesses.values())
    has_amount = "amount" in roles or {"debit", "credit"} <= roles
    essential = ["date" in roles, "description" in roles, has_amount]
    return round(sum(essential) / len(essential), 2)


def _decode_safe(file_bytes: bytes, encoding: str) -> str:
    """Decode bytes with fallback chain."""
    encodings = [encoding]
    if encoding.lower() in ("utf-8", "utf8"):
        encodings = ["utf-8-sig", "utf-8"]
    for fallback in ["latin-1", "windows-1252"]:
        if fallback not in encodings:
            encodings.append(fallback)
    for enc in encodings:
        try:
            return file_bytes.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return file_bytes.decode("utf-8", errors="replace")


async def detect_bank(file_bytes: bytes, filename: str, db: AsyncSession, profile_id: int | None = None) -> BankProfile | None:
    """Score each bank profile and return the best match, or None."""
    q = select(BankProfile)
    if profile_id is not None:
        q = q.where(BankProfile.profile_id == profile_id)
    result = await db.execute(q)
    profiles = result.scalars().all()

    if not profiles:
        return None

    detected = chardet.detect(file_bytes)
    encoding = detected.get("encoding") or "utf-8"

    # Try to read header row with various delimiters
    header_cols: list[str] = []
    for delim in [";", ",", "\t", "|"]:
        try:
            text = _decode_safe(file_bytes, encoding)
            df = pd.read_csv(io.StringIO(text), sep=delim, nrows=0)
            # Strip BOM from column names
            df.columns = [c.strip().lstrip("\ufeff") for c in df.columns]
            if len(df.columns) > 1:
                header_cols = list(df.columns)
                break
        except Exception:
            continue

    if not header_cols:
        logger.warning("Could not extract headers from file '%s'", filename)
        return None

    header_lower = [c.lower().strip() for c in header_cols]
    logger.info("Detected headers for '%s': %s", filename, header_cols)

    best_profile = None
    best_score = 0

    for profile in profiles:
        fp = profile.detection_fingerprint
        if not fp or "columns" not in fp:
            continue

        expected_cols = fp["columns"]
        score = sum(
            1 for col in expected_cols
            if col.lower().strip() in header_lower
        )
        normalized = score / len(expected_cols) if expected_cols else 0

        if normalized > best_score:
            best_score = normalized
            best_profile = profile

    if best_score >= 0.5 and best_profile is not None:
        # Validate that the profile's column_mapping values actually exist in the CSV
        mapping = best_profile.column_mapping or {}
        mapped_cols = set(v.lower().strip() for v in mapping.values())
        available = set(header_lower)
        if not mapped_cols.issubset(available):
            missing = mapped_cols - available
            logger.info(
                "Profile '%s' matched by fingerprint but column mapping has missing columns: %s",
                best_profile.name, missing,
            )
            return None
        logger.info("Matched profile '%s' (score %.2f)", best_profile.name, best_score)
        return best_profile

    logger.info("No profile matched (best score: %.2f)", best_score)
    return None
