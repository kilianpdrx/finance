"""When >= 2 distinct categories match a transaction via rules, it is flagged
with category_conflict in the transactions list, the import preview, and the
rule-test preview."""
import json
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import CategoryRule, Transaction

pytestmark = pytest.mark.asyncio

CSV = "Date;Libelle;Montant\n2026-05-08;PAIEMENT CB SNCB WEBAPP;-10,00\n"
MAPPING = json.dumps({"date": "Date", "description": "Libelle", "amount": "Montant"})


def _form(account_id: int):
    return {"account_id": str(account_id), "column_mapping": MAPPING,
            "date_format": "%Y-%m-%d", "delimiter": ";", "encoding": "utf-8"}


def _rule(seed, cat_id, value="SNCB", account_scoped=True):
    return CategoryRule(
        profile_id=seed["profile"].id, category_id=cat_id,
        account_id=seed["account_courant"].id if account_scoped else None,
        priority=100, is_active=True, logic_operator="AND",
        conditions=[{"field": "description", "operator": "contains", "value": value}],
    )


async def _add_conflicting_rules(db: AsyncSession, seed: dict):
    db.add_all([_rule(seed, seed["cat_courses"].id), _rule(seed, seed["cat_salaire"].id)])
    await db.commit()


async def test_preview_flags_conflict(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _add_conflicting_rules(db_session, seed_data)
    r = await client.post("/api/upload/parse-preview",
                          headers={"X-Profile-Id": str(seed_data["profile"].id)},
                          files={"file": ("c.csv", CSV, "text/csv")}, data=_form(seed_data["account_courant"].id))
    assert r.json()["transactions"][0]["category_conflict"] is True


async def test_preview_single_rule_no_conflict(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    db_session.add(_rule(seed_data, seed_data["cat_courses"].id))
    await db_session.commit()
    r = await client.post("/api/upload/parse-preview",
                          headers={"X-Profile-Id": str(seed_data["profile"].id)},
                          files={"file": ("c.csv", CSV, "text/csv")}, data=_form(seed_data["account_courant"].id))
    assert r.json()["transactions"][0]["category_conflict"] is False


async def test_transactions_list_flags_conflict(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    acc = seed_data["account_courant"]
    db_session.add(Transaction(profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 5, 8),
                               description="PAIEMENT CB SNCB WEBAPP", amount_cents=1000, currency="EUR",
                               is_debit=True, import_hash="conflict_hash_1"))
    await _add_conflicting_rules(db_session, seed_data)

    r = await client.get("/api/transactions", headers={"X-Profile-Id": str(seed_data["profile"].id)})
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1 and rows[0]["category_conflict"] is True


async def test_rule_preview_flags_conflict(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    acc = seed_data["account_courant"]
    db_session.add(Transaction(profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 5, 8),
                               description="PAIEMENT CB SNCB WEBAPP", amount_cents=1000, currency="EUR",
                               is_debit=True, import_hash="conflict_hash_2"))
    await _add_conflicting_rules(db_session, seed_data)

    r = await client.post("/api/categories/rules/preview",
                          headers={"X-Profile-Id": str(seed_data["profile"].id)},
                          json={"conditions": [{"field": "description", "operator": "contains", "value": "SNCB"}],
                                "account_id": acc.id, "logic_operator": "AND"})
    assert r.status_code == 200
    matched = r.json()
    assert len(matched) == 1 and matched[0]["category_conflict"] is True
