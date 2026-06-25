import csv
import io
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

ISIN_TICKER_MAP: dict[str, str] = {
    "FR0000120073": "AI.PA",
    "FR0000120271": "TTE.PA",
    "FR0000120578": "SAN.PA",
    "FR0000121014": "MC.PA",
    "FR0000121972": "SCR.PA",
    "FR0000125486": "DG.PA",
    "FR0000125338": "CAP.PA",
    "FR0000131104": "BNP.PA",
    "FR0000130577": "PUB.PA",
    "FR0010208488": "ENGI.PA",
    "FR0000133308": "ORA.PA",
    "FR0010307819": "LR.PA",
    "FR0000131906": "RI.PA",
    "FR0000073272": "SAF.PA",
    "FR0000120321": "OR.PA",
    "FR0000121261": "ML.PA",
    "FR0010340141": "SLB.PA",
    "FR0004125920": "AMUN.PA",
    "FR0007052782": "C40.PA",
    "FR0007054358": "MSE.PA",
    "FR0011869312": "PAASI.PA",
    "FR0013412020": "PAEEM.PA",
    "FR0013412285": "PE500.PA",
    "FR001400AED5": "0P0001NJ59.F",
    "LU0252633754": "DAXEX.DE",
    "LU1681038672": "RS2K.PA",
    "LU1681043599": "CW8.PA",
    "LU1834987890": "CIN.PA",
    "NL0000226223": "STM.PA",
    "NL0010273215": "ASML",
}


@dataclass
class ParsedHolding:
    ticker: str
    name: str
    quantity: float
    cost_basis_cents: int
    currency: str
    asset_type: str
    last_price_cents: int | None = None
    isin: str | None = None


def detect_holdings_format(file_bytes: bytes) -> str | None:
    text = _decode(file_bytes)
    lines = text.splitlines()

    for line in lines:
        if "Transaction History" in line and "Header" in line and "Symbol" in line:
            return "ibkr"

    for line in lines:
        line_lower = line.lower()
        if "isin" in line_lower and "buyingprice" in line_lower:
            return "bourso"

    return None


def parse_ibkr_holdings(file_bytes: bytes) -> list[ParsedHolding]:
    text = _decode(file_bytes)
    lines = text.splitlines()

    # Detect delimiter: comma vs semicolon
    delimiter = ";"
    for line in lines:
        if "Transaction History" in line and "Header" in line and "Symbol" in line:
            if "," in line and line.count(",") > line.count(";"):
                delimiter = ","
            break

    headers: list[str] = []
    data_rows: list[dict[str, str]] = []

    # Use csv.reader to handle quotes and delimiters safely
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)

    for parts in reader:
        if len(parts) < 3:
            continue
        section, row_type = parts[0].strip(), parts[1].strip()
        if section == "Transaction History" and row_type == "Header":
            headers = [h.strip() for h in parts[2:]]
        elif section == "Transaction History" and row_type == "Data" and headers:
            values = [v.strip() for v in parts[2:]]
            row = dict(zip(headers, values))
            data_rows.append(row)

    buys: dict[str, dict] = {}
    for row in data_rows:
        tx_type = row.get("Transaction Type", "")
        if tx_type != "Buy":
            continue
        symbol = row.get("Symbol", "").strip()
        if not symbol or symbol == "-":
            continue

        qty = _parse_smart_number(row.get("Quantity", "0"))
        price = _parse_smart_number(row.get("Price", "0"))
        price_ccy = row.get("Price Currency", "USD").strip()
        description = row.get("Description", "")

        # Acquisition cost is the per-share `Price` in `Price Currency`, times quantity.
        cost_in_price_ccy = qty * price

        if symbol not in buys:
            buys[symbol] = {
                "quantity": 0.0,
                "total_cost": 0.0,
                "currency": price_ccy,
                "description": description,
            }
        buys[symbol]["quantity"] += qty
        buys[symbol]["total_cost"] += cost_in_price_ccy

    result: list[ParsedHolding] = []
    for symbol, info in buys.items():
        desc = info["description"]
        asset_type = "etf" if "ETF" in desc.upper() else "stock"
        result.append(ParsedHolding(
            ticker=symbol.upper(),
            name=desc,
            quantity=info["quantity"],
            cost_basis_cents=round(info["total_cost"] * 100),
            currency=info["currency"],
            asset_type=asset_type,
        ))

    return result


def parse_bourso_holdings(file_bytes: bytes) -> list[ParsedHolding]:
    text = _decode(file_bytes)
    lines = text.splitlines()

    # Find the header line containing "isin" and "buyingprice" (case-insensitive)
    header_idx = -1
    for idx, line in enumerate(lines):
        line_lower = line.lower()
        if "isin" in line_lower and "buyingprice" in line_lower:
            header_idx = idx
            break

    if header_idx == -1:
        header_idx = 0

    csv_text = "\n".join(lines[header_idx:])

    # Detect delimiter
    delimiter = ";"
    if header_idx < len(lines):
        header_line = lines[header_idx]
        if "," in header_line and header_line.count(",") > header_line.count(";"):
            delimiter = ","

    reader = csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)

    result: list[ParsedHolding] = []
    for row in reader:
        isin = (row.get("isin") or "").strip()
        name = (row.get("name") or "").strip().strip('"')
        if not isin or not name:
            continue

        qty = _parse_smart_number(row.get("quantity", "0"))
        buying_price = _parse_smart_number(row.get("buyingPrice", "0"))
        last_price = _parse_smart_number(row.get("lastPrice", "0"))

        cost_basis_cents = round(qty * buying_price * 100)
        last_price_cents = round(last_price * 100) if last_price else None

        name_upper = name.upper()
        asset_type = "etf" if ("ETF" in name_upper or "UCITS" in name_upper) else "stock"
        if "PROFILE" in name_upper or "SELECT" in name_upper:
            asset_type = "fund"

        ticker = ISIN_TICKER_MAP.get(isin, isin)

        result.append(ParsedHolding(
            ticker=ticker,
            name=name,
            quantity=qty,
            cost_basis_cents=cost_basis_cents,
            currency="EUR",
            asset_type=asset_type,
            last_price_cents=last_price_cents,
            isin=isin,
        ))

    return result


def parse_custom_holdings(file_bytes: bytes, profile) -> list[ParsedHolding]:
    text = _decode(file_bytes)
    lines = text.splitlines()

    # Find the header line by matching the mapped columns
    mapping = profile.column_mapping or {}
    expected_cols = [str(v).lower().strip() for v in mapping.values() if v]

    header_idx = -1
    for idx, line in enumerate(lines):
        line_lower = line.lower()
        if expected_cols and any(col in line_lower for col in expected_cols):
            matches = sum(1 for col in expected_cols if col in line_lower)
            if matches >= len(expected_cols) * 0.5:
                header_idx = idx
                break

    if header_idx == -1:
        header_idx = 0

    csv_text = "\n".join(lines[header_idx:])

    # Detect delimiter
    delimiter = profile.delimiter or ";"
    if header_idx < len(lines):
        header_line = lines[header_idx]
        if "," in header_line and header_line.count(",") > header_line.count(";"):
            delimiter = ","

    reader = csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)

    col_ticker = mapping.get("ticker")
    col_isin = mapping.get("isin")
    col_name = mapping.get("name")
    col_quantity = mapping.get("quantity")
    col_buying_price = mapping.get("buyingPrice")
    col_last_price = mapping.get("lastPrice")
    col_currency = mapping.get("currency")

    result: list[ParsedHolding] = []
    for row in reader:
        ticker = (row.get(col_ticker) if col_ticker else "") or ""
        isin = (row.get(col_isin) if col_isin else "") or ""
        name = (row.get(col_name) if col_name else "") or ""

        ticker = ticker.strip()
        isin = isin.strip()
        name = name.strip().strip('"')

        # Require at least name and ticker/isin to exist
        if not name or (not ticker and not isin):
            continue

        qty_str = row.get(col_quantity) if col_quantity else "0"
        qty = _parse_smart_number(qty_str) if qty_str else 0.0

        buying_price_str = row.get(col_buying_price) if col_buying_price else "0"
        buying_price = _parse_smart_number(buying_price_str) if buying_price_str else 0.0

        last_price_str = row.get(col_last_price) if col_last_price else None
        last_price = _parse_smart_number(last_price_str) if last_price_str else None

        cost_basis_cents = round(qty * buying_price * 100)
        last_price_cents = round(last_price * 100) if last_price else None

        ccy = "EUR"
        if col_currency and row.get(col_currency):
            ccy = row.get(col_currency).strip()

        name_upper = name.upper()
        asset_type = "etf" if ("ETF" in name_upper or "UCITS" in name_upper) else "stock"
        if "PROFILE" in name_upper or "SELECT" in name_upper:
            asset_type = "fund"

        if not ticker and isin:
            ticker = ISIN_TICKER_MAP.get(isin, isin)

        result.append(ParsedHolding(
            ticker=ticker,
            name=name,
            quantity=qty,
            cost_basis_cents=cost_basis_cents,
            currency=ccy,
            asset_type=asset_type,
            last_price_cents=last_price_cents,
            isin=isin,
        ))

    return result


def detect_custom_holdings_profile(file_bytes: bytes, profiles: list) -> any:
    text = _decode(file_bytes)
    lines = text.splitlines()
    if not lines:
        return None

    best_profile = None
    best_score = 0

    for p in profiles:
        mapping = p.column_mapping or {}
        expected_cols = [str(v).lower().strip() for v in mapping.values() if v]
        if not expected_cols:
            continue

        for line in lines[:20]:
            line_lower = line.lower()
            score = sum(1 for col in expected_cols if col in line_lower)
            if score > best_score:
                best_score = score
                best_profile = p

    if best_profile:
        mapping = best_profile.column_mapping or {}
        expected_cols = [str(v).lower().strip() for v in mapping.values() if v]
        if best_score >= len(expected_cols) * 0.5:
            return best_profile

    return None


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def _parse_number(s: str) -> float:
    s = s.strip().replace(",", "").replace("\xa0", "")
    if not s or s == "-":
        return 0.0
    return float(s)


def _parse_french_number(s: str) -> float:
    s = s.strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    if not s or s == "-":
        return 0.0
    return float(s)


def _parse_smart_number(s: str) -> float:
    s = s.strip().replace("\xa0", "").replace(" ", "")
    if not s or s == "-":
        return 0.0

    # English thousand separator + decimal point: "1,234.56"
    if "," in s and "." in s:
        if s.rfind(",") < s.rfind("."):
            s = s.replace(",", "")
        else:
            s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        # Standard French decimal comma (e.g. "12,50" -> "12.50")
        s = s.replace(",", ".")

    try:
        return float(s)
    except ValueError:
        return 0.0
