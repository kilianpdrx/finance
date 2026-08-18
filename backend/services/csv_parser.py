"""Parse a CSV file according to a BankProfile column mapping."""
import io
import re
import hashlib
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional
import chardet
import pandas as pd
from models import BankProfile
from schemas import TransactionCreate

logger = logging.getLogger(__name__)

# How many example rows to keep per skip reason (shown in the import review UI).
_MAX_SAMPLES = 5


@dataclass
class ParseReport:
    """Why rows were dropped during parsing.

    Import silently losing rows is worse than failing loudly, so every skip is
    counted and a few raw examples kept for the UI to show the user.
    """
    malformed: int = 0       # unreadable by the CSV reader (wrong field count, …)
    bad_date: int = 0        # date column present but unparseable
    bad_amount: int = 0      # amount column present but unparseable
    zero_amount: int = 0     # parsed fine, but the amount is 0 (nothing to import)
    missing_fields: int = 0  # blank date/description
    samples: dict = field(default_factory=dict)  # reason -> [raw row excerpts]

    @property
    def total(self) -> int:
        return self.malformed + self.bad_date + self.bad_amount + self.zero_amount + self.missing_fields

    def note(self, reason: str, excerpt: str) -> None:
        bucket = self.samples.setdefault(reason, [])
        if len(bucket) < _MAX_SAMPLES:
            bucket.append(excerpt[:200])

    def as_dict(self) -> dict:
        return {
            "total": self.total,
            "malformed": self.malformed,
            "bad_date": self.bad_date,
            "bad_amount": self.bad_amount,
            "zero_amount": self.zero_amount,
            "missing_fields": self.missing_fields,
            "samples": self.samples,
        }


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


def _parse_amount(value) -> Optional[int]:
    """Convert a string/float amount to integer cents.

    Handles locale grouping robustly: Swiss apostrophes (1'234.56 / 1’234.56),
    German dots (1.234,56), US commas (1,234.56) and spaces (1 234,56). The
    right-most '.' or ',' is treated as the decimal separator; every other '.'/','
    is a thousands separator and is dropped.

    Returns ``None`` when the value is blank or cannot be parsed, so callers can
    distinguish a *failed parse* from a genuine ``0`` amount (they mean different
    things: one is a data problem worth reporting, the other is a real row).
    """
    if pd.isna(value):
        return None
    s = str(value).strip()
    # Strip currency symbols.
    for sym in ["€", "EUR", "CHF", "USD", "GBP", "Fr.", "Fr", "$", "£"]:
        s = s.replace(sym, "")
    # Remove whitespace (incl. NBSP / narrow NBSP) and apostrophe thousands marks.
    for ch in ("\xa0", "\u202f", " ", "'", "’"):
        s = s.replace(ch, "")
    s = s.strip()
    if not s:
        return None

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
        return None

    try:
        amount = float(f"{int_part or '0'}.{frac_part or '0'}")
    except ValueError:
        return None
    cents = int(round(amount * 100))
    return -cents if negative else cents

def _compute_hash(date_str: str, description: str, amount_cents: int, is_debit: bool = True) -> str:
    sign = "D" if is_debit else "C"
    raw = f"{date_str}|{description}|{amount_cents}|{sign}"
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_csv(file_bytes: bytes, profile: BankProfile) -> tuple[list[TransactionCreate], ParseReport]:
    """Parse CSV bytes using the given bank profile.

    Returns ``(transactions, report)`` — the report explains every row that was
    dropped so the caller can surface it instead of silently importing fewer rows.
    """
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
    report = ParseReport()

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

    # `on_bad_lines="skip"` drops unreadable rows silently — recover the count by
    # comparing against the non-blank data lines that were handed to the reader.
    data_lines = [ln for ln in lines[header_line_idx + 1:] if ln.strip()]
    dropped = len(data_lines) - len(df)
    if dropped > 0:
        report.malformed = dropped
        expected_fields = len(df.columns)
        sep = profile.delimiter or ";"
        for ln in data_lines:
            if len(ln.split(sep)) != expected_fields:
                report.note("malformed", ln)

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
    # Optional: what the bank actually charged abroad. `currency` alone is enough
    # when the statement shows the foreign amount in the same column; otherwise
    # `original_amount` carries it separately.
    currency_col = mapping.get("currency")
    orig_amount_col = mapping.get("original_amount")

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

    def _excerpt(row) -> str:
        return " | ".join(f"{c}={row[c]}" for c in df.columns if c in row)

    for _, row in df.iterrows():
        # Parse date
        if not date_col or date_col not in df.columns:
            continue
        raw_date = str(row[date_col]).strip()
        if not raw_date or raw_date.lower() in ("nan", ""):
            report.missing_fields += 1
            report.note("missing_fields", _excerpt(row))
            continue
        parsed_date: Optional[date] = None
        try:
            parsed_date = datetime.strptime(raw_date, date_fmt).date()
        except ValueError:
            for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d.%m.%Y", "%d/%m/%y", "%d.%m.%y"]:
                try:
                    parsed_date = datetime.strptime(raw_date, fmt).date()
                    break
                except ValueError:
                    continue
        if parsed_date is None:
            logger.debug("Skipping row: could not parse date '%s'", raw_date)
            report.bad_date += 1
            report.note("bad_date", _excerpt(row))
            continue

        # Parse description
        if not desc_col or desc_col not in df.columns:
            continue
        description = str(row[desc_col]).strip()
        if not description or description.lower() == "nan":
            report.missing_fields += 1
            report.note("missing_fields", _excerpt(row))
            continue

        # Parse amount. `None` = unparseable (a data problem worth reporting);
        # 0 = a real zero-amount row (nothing to import, but not an error).
        if amount_col and amount_col in df.columns:
            raw_amount = _parse_amount(row[amount_col])
            if raw_amount is None:
                report.bad_amount += 1
                report.note("bad_amount", _excerpt(row))
                continue
            is_debit = raw_amount < 0
            amount_cents = abs(raw_amount)
        elif debit_col and credit_col:
            debit_val = _parse_amount(row.get(debit_col)) if debit_col in df.columns else None
            credit_val = _parse_amount(row.get(credit_col)) if credit_col in df.columns else None
            if debit_val is None and credit_val is None:
                report.bad_amount += 1
                report.note("bad_amount", _excerpt(row))
                continue
            if debit_val:
                amount_cents = abs(debit_val)
                is_debit = True
            elif credit_val:
                amount_cents = abs(credit_val)
                is_debit = False
            else:
                # Both columns parsed as 0 — a real but empty row.
                report.zero_amount += 1
                report.note("zero_amount", _excerpt(row))
                continue
        else:
            continue

        if amount_cents == 0:
            report.zero_amount += 1
            report.note("zero_amount", _excerpt(row))
            continue

        # Balance after — keep a real 0 balance (only treat blank/NaN as unknown).
        balance_after: Optional[int] = None
        if balance_col and balance_col in df.columns:
            raw_balance = str(row[balance_col]).strip()
            if raw_balance and raw_balance.lower() != "nan":
                balance_after = _parse_amount(row[balance_col])  # None if unreadable

        # Original (foreign) amount, when the statement provides one. Only kept
        # when it actually differs from the account currency — otherwise it is
        # noise. The account currency is applied by the upload router.
        original_currency = None
        original_amount_cents = None
        if currency_col and currency_col in df.columns:
            raw_ccy = str(row[currency_col]).strip().upper()
            if raw_ccy and raw_ccy.lower() != "nan" and len(raw_ccy) <= 4:
                original_currency = raw_ccy
        if orig_amount_col and orig_amount_col in df.columns:
            oa = _parse_amount(row[orig_amount_col])
            if oa is not None:
                original_amount_cents = abs(oa)
        if original_currency and original_amount_cents is None:
            # Same column carried both: the parsed amount IS the foreign amount.
            original_amount_cents = amount_cents

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
            original_amount_cents=original_amount_cents,
            original_currency=original_currency,
        ))

    logger.info("Parsed %d transactions (skipped %d: %s)", len(transactions), report.total, report.as_dict())
    return transactions, report
