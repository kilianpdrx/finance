"""Detect bank profile from CSV file bytes and filename."""
import io
import logging
import chardet
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import BankProfile

logger = logging.getLogger(__name__)


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
