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
        if line.startswith("Transaction History;Header;") and "Symbol" in line:
            return "ibkr"

    if lines:
        header = lines[0].lower().strip().lstrip("﻿")
        if "isin" in header and "buyingprice" in header:
            return "bourso"

    return None


def parse_ibkr_holdings(file_bytes: bytes) -> list[ParsedHolding]:
    text = _decode(file_bytes)
    lines = text.splitlines()

    headers: list[str] = []
    data_rows: list[dict[str, str]] = []

    for line in lines:
        parts = line.split(";")
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

        qty = _parse_number(row.get("Quantity", "0"))
        price = _parse_number(row.get("Price", "0"))
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
    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text), delimiter=";")

    result: list[ParsedHolding] = []
    for row in reader:
        isin = (row.get("isin") or "").strip()
        name = (row.get("name") or "").strip().strip('"')
        if not isin or not name:
            continue

        qty = _parse_french_number(row.get("quantity", "0"))
        buying_price = _parse_french_number(row.get("buyingPrice", "0"))
        last_price = _parse_french_number(row.get("lastPrice", "0"))

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
