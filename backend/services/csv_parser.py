"""Parse a CSV file according to a BankProfile column mapping."""
import io
import re
import hashlib
import logging
from datetime import date, datetime
from typing import Optional
import chardet
import pandas as pd
from models import BankProfile
from schemas import TransactionCreate

logger = logging.getLogger(__name__)


def _decode(file_bytes: bytes, encoding: str) -> str:
    """Decode bytes, trying the given encoding first then common fallbacks."""
    encodings = [encoding]
    if encoding.lower() in ("utf-8", "utf8"):
        encodings = ["utf-8-sig", "utf-8"]
    # Always add fallbacks
    for fallback in ["latin-1", "windows-1252"]:
        if fallback not in encodings:
            encodings.append(fallback)
    for enc in encodings:
        try:
            return file_bytes.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    # Last resort
    return file_bytes.decode("utf-8", errors="replace")


def _parse_amount(value) -> int:
    """Convert a string/float amount to integer cents.

    Handles locale grouping robustly: Swiss apostrophes (1'234.56 / 1’234.56),
    German dots (1.234,56), US commas (1,234.56) and spaces (1 234,56). The
    right-most '.' or ',' is treated as the decimal separator; every other '.'/','
    is a thousands separator and is dropped. Returns 0 for blank/unparseable
    input (callers treat 0 as "no amount").
    """
    if pd.isna(value):
        return 0
    s = str(value).strip()
    # Strip currency symbols.
    for sym in ["€", "EUR", "CHF", "USD", "GBP", "Fr.", "Fr", "$", "£"]:
        s = s.replace(sym, "")
    # Remove whitespace (incl. NBSP / narrow NBSP) and apostrophe thousands marks.
    for ch in ("\xa0", "\u202f", " ", "'", "’"):
        s = s.replace(ch, "")
    s = s.strip()
    if not s:
        return 0

    negative = s[0] == "-"
    s = s.lstrip("+-")

    # The right-most separator is the decimal point; anything before it is grouping.
    dec_pos = max(s.rfind("."), s.rfind(","))
    if dec_pos == -1:
        int_part, frac_part = s, ""
    else:
        int_part, frac_part = s[:dec_pos], s[dec_pos + 1:]

    int_part = re.sub(r"\D", "", int_part)
    frac_part = re.sub(r"\D", "", frac_part)
    if not int_part and not frac_part:
        return 0

    try:
        amount = float(f"{int_part or '0'}.{frac_part or '0'}")
    except ValueError:
        return 0
    cents = int(round(amount * 100))
    return -cents if negative else cents

def _compute_hash(date_str: str, description: str, amount_cents: int, is_debit: bool = True) -> str:
    sign = "D" if is_debit else "C"
    raw = f"{date_str}|{description}|{amount_cents}|{sign}"
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_csv(file_bytes: bytes, profile: BankProfile) -> list[TransactionCreate]:
    """Parse CSV bytes using the given bank profile and return TransactionCreate list."""
    detected = chardet.detect(file_bytes)
    encoding = profile.encoding or detected.get("encoding") or "utf-8"

    try:
        text = _decode(file_bytes, encoding)
    except Exception as e:
        logger.error("Failed to decode file with encoding %s: %s", encoding, e)
        raise ValueError(f"Impossible de décoder le fichier avec l'encodage '{encoding}': {e}")

    mapping = profile.column_mapping
    expected_header_cols = list(mapping.values())

    lines = text.splitlines()
    if not lines:
        raise ValueError("Le fichier CSV est vide")

    # Find the header row by looking for most expected column names
    header_line_idx = 0
    for i, line in enumerate(lines):
        matches = sum(1 for col in expected_header_cols if col.lower() in line.lower())
        if matches >= max(1, len(expected_header_cols) // 2):
            header_line_idx = i
            break

    cleaned_text = "\n".join(lines[header_line_idx:])

    try:
        df = pd.read_csv(
            io.StringIO(cleaned_text),
            sep=profile.delimiter or ";",
            dtype=str,
            on_bad_lines="skip",
        )
    except Exception as e:
        logger.error("pandas read_csv failed: %s", e)
        raise ValueError(f"Erreur de lecture du CSV: {e}")

    # Strip whitespace from column names (and BOM remnants)
    df.columns = [c.strip().lstrip("\ufeff") for c in df.columns]

    logger.info("CSV columns detected: %s", list(df.columns))
    logger.info("Column mapping requested: %s", mapping)

    date_fmt = profile.date_format or "%d/%m/%Y"

    date_col = mapping.get("date")
    desc_col = mapping.get("description")
    amount_col = mapping.get("amount")
    debit_col = mapping.get("debit")
    credit_col = mapping.get("credit")
    balance_col = mapping.get("balance")

    # Verify required columns exist
    missing = []
    for role, col in [("date", date_col), ("description", desc_col)]:
        if col and col not in df.columns:
            missing.append(f"'{col}' (rôle: {role})")
    if missing:
        available = list(df.columns)
        raise ValueError(
            f"Colonnes introuvables dans le CSV: {', '.join(missing)}. "
            f"Colonnes disponibles: {available}"
        )

    transactions = []
    skipped_dates = 0
    skipped_amounts = 0

    for _, row in df.iterrows():
        # Parse date
        if not date_col or date_col not in df.columns:
            continue
        raw_date = str(row[date_col]).strip()
        if not raw_date or raw_date.lower() in ("nan", ""):
            continue
        parsed_date: Optional[date] = None
        try:
            parsed_date = datetime.strptime(raw_date, date_fmt).date()
        except ValueError:
            for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d.%m.%Y"]:
                try:
                    parsed_date = datetime.strptime(raw_date, fmt).date()
                    break
                except ValueError:
                    continue
        if parsed_date is None:
            logger.debug("Skipping row: could not parse date '%s'", raw_date)
            skipped_dates += 1
            continue

        # Parse description
        if not desc_col or desc_col not in df.columns:
            continue
        description = str(row[desc_col]).strip()
        if not description or description.lower() == "nan":
            continue

        # Parse amount
        if amount_col and amount_col in df.columns:
            raw_amount = _parse_amount(row[amount_col])
            is_debit = raw_amount < 0
            amount_cents = abs(raw_amount)
        elif debit_col and credit_col:
            debit_val = _parse_amount(row.get(debit_col, 0)) if debit_col in df.columns else 0
            credit_val = _parse_amount(row.get(credit_col, 0)) if credit_col in df.columns else 0
            if debit_val != 0:
                amount_cents = abs(debit_val)
                is_debit = True
            elif credit_val != 0:
                amount_cents = abs(credit_val)
                is_debit = False
            else:
                skipped_amounts += 1
                continue
        else:
            continue

        if amount_cents == 0:
            skipped_amounts += 1
            continue

        # Balance after — keep a real 0 balance (only treat blank/NaN as unknown).
        balance_after: Optional[int] = None
        if balance_col and balance_col in df.columns:
            raw_balance = str(row[balance_col]).strip()
            if raw_balance and raw_balance.lower() != "nan":
                balance_after = _parse_amount(row[balance_col])

        import_hash = _compute_hash(str(parsed_date), description, amount_cents, is_debit)

        transactions.append(TransactionCreate(
            account_id=0,  # set by upload router
            date=parsed_date,
            description=description,
            amount_cents=amount_cents,
            currency="EUR",
            is_debit=is_debit,
            balance_after_cents=balance_after,
            import_hash=import_hash,
        ))

    logger.info(
        "Parsed %d transactions (skipped %d date errors, %d zero/missing amounts)",
        len(transactions), skipped_dates, skipped_amounts,
    )
    return transactions
