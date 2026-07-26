import pytest
from services.bank_detector import detect_bank
from services.csv_parser import parse_csv, _parse_amount
from models import BankProfile
from utils import generate_import_hash


@pytest.mark.parametrize("raw, expected", [
    ("1'234.56", 123456),      # Swiss apostrophe (e.g. UBS)
    ("1’234.56", 123456),  # Swiss typographic apostrophe
    ("1.234,56", 123456),      # German / continental dot grouping
    ("1,234.56", 123456),      # US comma grouping
    ("1 234,56", 123456),      # space grouping
    ("-1'000.00", -100000),
    ("CHF 1’000.00", 100000),
    ("0", 0),
    ("", 0),
    ("-", 0),
    ("3,50", 350),
])
def test_parse_amount_locales(raw, expected):
    assert _parse_amount(raw) == expected


def test_import_hash_distinguishes_debit_credit():
    """A charge and a same-day, same-amount refund with identical descriptions
    must not collide on the dedup hash (previously they did)."""
    debit = generate_import_hash("2026-07-01", "ACME", 5000, 1, True)
    credit = generate_import_hash("2026-07-01", "ACME", 5000, 1, False)
    assert debit != credit


@pytest.mark.asyncio
async def test_detect_bank_none_if_no_profiles(db_session):
    res = await detect_bank(b"date;amount\n01/01/2026;10.00\n", "test.csv", db_session)
    assert res is None


def test_parse_csv_with_bank_profile():
    bp = BankProfile(
        name="Custom Bank",
        delimiter=";",
        encoding="utf-8",
        date_format="%d/%m/%Y",
        column_mapping={
            "date": "Date",
            "description": "Label",
            "amount": "Montant"
        }
    )
    csv_bytes = b"Date;Label;Montant\n01/07/2026;SUPERMARCHE;-42.50\n"
    txns = parse_csv(csv_bytes, bp)
    assert len(txns) == 1
    assert txns[0].amount_cents == 4250
    assert txns[0].is_debit is True
    assert "SUPERMARCHE" in txns[0].description

