"""When >= 2 distinct categories match a transaction via rules, it is flagged
with category_conflict in the transactions list, the import preview, and the
rule-test preview.

Rules have no priority, so a conflict is never settled silently: the row gets no
category (import, rescan) and the rules involved are returned so the UI can show
them."""
import json
from datetime import date

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


def _rule(seed, cat_id, value="SNCB", account_scoped=True):
    return CategoryRule(
        profile_id=seed["profile"].id, category_id=cat_id,
        account_id=seed["account_courant"].id if account_scoped else None,
        is_active=True, logic_operator="AND",
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
    # The conflicting category names are surfaced (sorted).
    assert rows[0]["conflict_categories"] == sorted(["Alimentation", "Salaire"])


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


# ── A conflict is never settled silently ────────────────────────────────────
def _txn(seed: dict, import_hash: str, category_id=None) -> Transaction:
    return Transaction(profile_id=seed["profile"].id, account_id=seed["account_courant"].id,
                       date=date(2026, 5, 8), description="PAIEMENT CB SNCB WEBAPP", amount_cents=1000,
                       currency="EUR", is_debit=True, import_hash=import_hash, category_id=category_id)


async def test_preview_leaves_a_conflicting_row_uncategorised(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _add_conflicting_rules(db_session, seed_data)
    r = await client.post("/api/upload/parse-preview",
                          headers={"X-Profile-Id": str(seed_data["profile"].id)},
                          files={"file": ("c.csv", CSV, "text/csv")}, data=_form(seed_data["account_courant"].id))
    row = r.json()["transactions"][0]
    assert row["category_id"] is None and row["categorization_source"] is None
    assert len(row["conflict_rule_ids"]) == 2


async def test_confirm_leaves_a_conflicting_row_uncategorised(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _add_conflicting_rules(db_session, seed_data)
    r = await client.post("/api/upload/confirm",
                          headers={"X-Profile-Id": str(seed_data["profile"].id)},
                          files={"file": ("c.csv", CSV, "text/csv")}, data=_form(seed_data["account_courant"].id))
    assert r.status_code == 200
    assert r.json()["imported"] == 1 and r.json()["categorized"] == 0

    stored = (await db_session.execute(select(Transaction))).scalars().all()
    assert len(stored) == 1 and stored[0].category_id is None


async def test_transactions_list_names_the_conflicting_rules(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    db_session.add(_txn(seed_data, "conflict_hash_3"))
    await _add_conflicting_rules(db_session, seed_data)
    rule_ids = sorted((await db_session.execute(select(CategoryRule.id))).scalars().all())

    rows = (await client.get("/api/transactions", headers={"X-Profile-Id": str(seed_data["profile"].id)})).json()
    assert rows[0]["conflict_rule_ids"] == rule_ids


async def test_rescan_never_writes_a_conflicting_row(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """Neither scope may settle a conflict — and "all" must not wipe the
    category a conflicting row already has."""
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    empty = _txn(seed_data, "conflict_hash_4")
    filed = _txn(seed_data, "conflict_hash_5", category_id=seed_data["cat_courses"].id)
    db_session.add_all([empty, filed])
    await _add_conflicting_rules(db_session, seed_data)

    r = await client.post("/api/categories/rescan", headers=h)
    assert r.json() == {"updated": 0, "total": 1, "conflicts": 1}

    r = await client.post("/api/categories/rescan", params={"scope": "all"}, headers=h)
    assert r.json() == {"updated": 0, "total": 2, "conflicts": 2}

    await db_session.refresh(empty)
    await db_session.refresh(filed)
    assert empty.category_id is None
    assert filed.category_id == seed_data["cat_courses"].id


async def test_rescan_dry_run_counts_without_writing(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    txn = _txn(seed_data, "dry_run_hash")
    db_session.add_all([txn, _rule(seed_data, seed_data["cat_courses"].id)])
    await db_session.commit()

    r = await client.post("/api/categories/rescan", params={"dry_run": "true"}, headers=h)
    assert r.json() == {"updated": 1, "total": 1, "conflicts": 0}
    await db_session.refresh(txn)
    assert txn.category_id is None, "a dry run must not write"

    r = await client.post("/api/categories/rescan", headers=h)
    assert r.json()["updated"] == 1
    await db_session.refresh(txn)
    assert txn.category_id == seed_data["cat_courses"].id
