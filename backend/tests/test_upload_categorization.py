"""Import must apply categorization rules — including ACCOUNT-SCOPED rules —
to the imported transactions, both in the preview and on confirm.

Regression: parse_csv leaves account_id=0, and parse-preview used to categorize
against that placeholder, so an account-scoped rule never fired in the review
list (it did on confirm, which set the real account_id — an inconsistency)."""
import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import CategoryRule, Transaction

pytestmark = pytest.mark.asyncio

CSV = "Date;Libelle;Montant\n2026-05-08;PAIEMENT CB SNCB WEBAPP;-10,00\n"
MAPPING = json.dumps({"date": "Date", "description": "Libelle", "amount": "Montant"})


def _form(account_id: int):
    return {"account_id": str(account_id), "column_mapping": MAPPING,
            "date_format": "%Y-%m-%d", "delimiter": ";", "encoding": "utf-8"}


async def _add_scoped_rule(db: AsyncSession, seed_data: dict):
    """A rule scoped to the courant account: description contains 'SNCB' -> Alimentation."""
    db.add(CategoryRule(
        profile_id=seed_data["profile"].id,
        category_id=seed_data["cat_courses"].id,
        account_id=seed_data["account_courant"].id,
        is_active=True, logic_operator="AND",
        conditions=[{"field": "description", "operator": "contains", "value": "SNCB"}],
    ))
    await db.commit()


async def test_preview_applies_account_scoped_rule(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _add_scoped_rule(db_session, seed_data)
    acc, cat = seed_data["account_courant"], seed_data["cat_courses"]

    r = await client.post("/api/upload/parse-preview",
                          headers={"X-Profile-Id": str(seed_data['profile'].id)},
                          files={"file": ("courant.csv", CSV, "text/csv")}, data=_form(acc.id))
    assert r.status_code == 200
    row = r.json()["transactions"][0]
    assert row["category_id"] == cat.id
    assert row["categorization_source"] == "rule"


async def test_preview_scoped_rule_does_not_leak_to_other_account(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _add_scoped_rule(db_session, seed_data)
    other = seed_data["account_inv"]  # rule is scoped to account_courant, not this one

    r = await client.post("/api/upload/parse-preview",
                          headers={"X-Profile-Id": str(seed_data['profile'].id)},
                          files={"file": ("courant.csv", CSV, "text/csv")}, data=_form(other.id))
    assert r.status_code == 200
    assert r.json()["transactions"][0]["category_id"] is None


async def test_confirm_applies_account_scoped_rule(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _add_scoped_rule(db_session, seed_data)
    acc, cat = seed_data["account_courant"], seed_data["cat_courses"]

    r = await client.post("/api/upload/confirm",
                          headers={"X-Profile-Id": str(seed_data['profile'].id)},
                          files={"file": ("courant.csv", CSV, "text/csv")}, data=_form(acc.id))
    assert r.status_code == 200
    body = r.json()
    assert {k: body[k] for k in ("imported", "skipped", "total", "categorized")} == {
        "imported": 1, "skipped": 0, "total": 1, "categorized": 1
    }
    assert body["unparsed"]["total"] == 0  # nothing was dropped by the parser

    stored = (await db_session.execute(
        select(Transaction).where(Transaction.account_id == acc.id)
    )).scalars().all()
    assert len(stored) == 1 and stored[0].category_id == cat.id


async def test_a_bank_profile_remembers_the_account_its_files_went_to(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """The preview runs the rules (and the duplicate check) against the account it
    is given: it now opens on the account this bank's files went to last time."""
    from models import BankProfile
    profile = BankProfile(profile_id=seed_data["profile"].id, name="Banque test",
                          column_mapping={"date": "Date", "description": "Libelle", "amount": "Montant"},
                          date_format="%Y-%m-%d", delimiter=";", encoding="utf-8",
                          detection_fingerprint={"columns": ["Date", "Libelle", "Montant"]})
    db_session.add(profile)
    await db_session.commit()
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    first = (await client.post("/api/upload/detect", headers=h, files={"file": ("b.csv", CSV, "text/csv")})).json()
    assert first["detected"] and first["profile"]["last_account_id"] is None

    acc = seed_data["account_courant"]
    r = await client.post("/api/upload/confirm", headers=h, files={"file": ("b.csv", CSV, "text/csv")},
                          data={"account_id": str(acc.id), "profile_id": str(profile.id)})
    assert r.status_code == 200, r.text
    again = (await client.post("/api/upload/detect", headers=h, files={"file": ("b.csv", CSV, "text/csv")})).json()
    assert again["profile"]["last_account_id"] == acc.id
