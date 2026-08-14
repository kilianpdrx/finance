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
    ("0", 0),                  # a genuine zero — NOT a parse failure
    ("0,00", 0),
    ("3,50", 350),
])
def test_parse_amount_locales(raw, expected):
    assert _parse_amount(raw) == expected


@pytest.mark.parametrize("raw", ["", "-", "   ", "n/a", "abc"])
def test_parse_amount_unparseable_is_none(raw):
    """None (unreadable) must be distinguishable from 0 (a real zero amount), so a
    broken row can be reported instead of silently vanishing."""
    assert _parse_amount(raw) is None


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
    txns, report = parse_csv(csv_bytes, bp)
    assert len(txns) == 1
    assert txns[0].amount_cents == 4250
    assert txns[0].is_debit is True
    assert "SUPERMARCHE" in txns[0].description
    assert report.total == 0


def _simple_profile() -> BankProfile:
    return BankProfile(
        name="Custom Bank", delimiter=";", encoding="utf-8", date_format="%d/%m/%Y",
        column_mapping={"date": "Date", "description": "Label", "amount": "Montant"},
    )


def test_parse_csv_reports_every_skipped_row():
    """Each dropped row is counted under its own reason, with samples — so the
    importer can explain a short import instead of losing rows silently."""
    csv_bytes = (
        b"Date;Label;Montant\n"
        b"01/07/2026;BON;-42.50\n"        # ok
        b"pas-une-date;MAUVAISE DATE;-1.00\n"  # bad_date
        b"02/07/2026;MONTANT ILLISIBLE;abc\n"  # bad_amount
        b"03/07/2026;ZERO REEL;0,00\n"          # zero_amount (parsed fine, just empty)
        b"04/07/2026;SANS LIBELLE;;\n"          # malformed (extra field)
    )
    txns, report = parse_csv(csv_bytes, _simple_profile())

    assert len(txns) == 1 and txns[0].description == "BON"
    assert report.bad_date == 1
    assert report.bad_amount == 1
    assert report.zero_amount == 1
    assert report.malformed == 1
    assert report.total == 4
    # Samples are captured so the UI can show the offending line.
    assert report.samples["bad_date"] and report.samples["bad_amount"]
    assert report.as_dict()["total"] == 4

