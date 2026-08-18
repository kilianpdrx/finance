"""Foreign purchases keep the amount the bank actually charged.

A purchase abroad is stored converted to the account's currency (that is what
every total is built from), but the original amount used to be discarded on
import. These columns preserve it for display.
"""
import pytest

from models import BankProfile
from services.csv_parser import parse_csv


def _profile(mapping, **kw):
    return BankProfile(name="T", delimiter=";", encoding="utf-8",
                       date_format="%d/%m/%Y", column_mapping=mapping, **kw)


def test_currency_column_captures_the_original_amount():
    csv = (
        "Date;Label;Montant;Devise\n"
        "01/07/2026;HOTEL NEW YORK;-120.00;USD\n"
    ).encode()
    txns, report = parse_csv(csv, _profile(
        {"date": "Date", "description": "Label", "amount": "Montant", "currency": "Devise"}))

    assert len(txns) == 1 and report.total == 0
    t = txns[0]
    assert t.original_currency == "USD"
    # Same column carried both, so the parsed amount IS the foreign amount.
    assert t.original_amount_cents == 12000


def test_separate_original_amount_column():
    csv = (
        "Date;Label;Montant;MontantOrigine;Devise\n"
        "01/07/2026;ACHAT LONDRES;-11.50;10.00;GBP\n"
    ).encode()
    txns, _ = parse_csv(csv, _profile({
        "date": "Date", "description": "Label", "amount": "Montant",
        "original_amount": "MontantOrigine", "currency": "Devise"}))

    t = txns[0]
    assert t.amount_cents == 1150          # charged to the account
    assert t.original_amount_cents == 1000  # what the merchant billed
    assert t.original_currency == "GBP"


def test_no_currency_column_leaves_the_fields_empty():
    csv = b"Date;Label;Montant\n01/07/2026;COURSES;-42.50\n"
    txns, _ = parse_csv(csv, _profile(
        {"date": "Date", "description": "Label", "amount": "Montant"}))
    assert txns[0].original_currency is None
    assert txns[0].original_amount_cents is None


@pytest.mark.asyncio
async def test_import_drops_the_original_when_it_matches_the_account(client, seed_data):
    """Storing the account currency again on every row would be pure noise —
    the field exists to record a *difference*."""
    pid = seed_data["profile"].id
    acc = seed_data["account_courant"]  # EUR
    h = {"X-Profile-Id": str(pid)}
    csv = b"Date;Label;Montant;Devise\n01/07/2026;PARIS;-10.00;EUR\n"

    res = await client.post("/api/upload/confirm", headers=h,
        files={"file": ("t.csv", csv, "text/csv")},
        data={"account_id": str(acc.id), "delimiter": ";", "date_format": "%d/%m/%Y",
              "column_mapping": '{"date":"Date","description":"Label","amount":"Montant","currency":"Devise"}'})
    assert res.status_code == 200 and res.json()["imported"] == 1

    rows = (await client.get("/api/transactions", headers=h)).json()
    t = next(r for r in rows if r["description"] == "PARIS")
    assert t["original_currency"] is None
    assert t["original_amount_cents"] is None


@pytest.mark.asyncio
async def test_import_keeps_a_genuinely_foreign_amount(client, seed_data):
    pid = seed_data["profile"].id
    acc = seed_data["account_courant"]  # EUR
    h = {"X-Profile-Id": str(pid)}
    csv = b"Date;Label;Montant;Devise\n02/07/2026;NEW YORK;-120.00;USD\n"

    res = await client.post("/api/upload/confirm", headers=h,
        files={"file": ("t.csv", csv, "text/csv")},
        data={"account_id": str(acc.id), "delimiter": ";", "date_format": "%d/%m/%Y",
              "column_mapping": '{"date":"Date","description":"Label","amount":"Montant","currency":"Devise"}'})
    assert res.status_code == 200

    rows = (await client.get("/api/transactions", headers=h)).json()
    t = next(r for r in rows if r["description"] == "NEW YORK")
    assert t["original_currency"] == "USD"
    assert t["original_amount_cents"] == 12000
    # The account-currency amount is untouched — totals must not change.
    assert t["amount_cents"] == 12000
    assert t["currency"] == "EUR"
