"""How a transaction got its category is recorded: "rule" when the rule engine
classified it, "manual" when the user chose — so the list can badge and filter
the automatic ones. Rows categorised before the column existed get a source
inferred once from the current rules."""
import json
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Category, CategoryRule, Transaction
from services.category_source import backfill

pytestmark = pytest.mark.asyncio

CSV = "Date;Libelle;Montant\n2026-05-08;PAIEMENT CB SNCB WEBAPP;-10,00\n2026-05-09;ZZZ INCONNU;-5,00\n"
MAPPING = json.dumps({"date": "Date", "description": "Libelle", "amount": "Montant"})


def _form(account_id: int, **extra):
    return {"account_id": str(account_id), "column_mapping": MAPPING,
            "date_format": "%Y-%m-%d", "delimiter": ";", "encoding": "utf-8", **extra}


def _rule(seed: dict, value: str = "SNCB") -> CategoryRule:
    return CategoryRule(profile_id=seed["profile"].id, category_id=seed["cat_courses"].id, is_active=True,
                        logic_operator="AND", conditions=[{"field": "description", "operator": "contains", "value": value}])


def _txn(seed: dict, key: str, description: str, **kw) -> Transaction:
    return Transaction(profile_id=seed["profile"].id, account_id=seed["account_courant"].id, date=date(2026, 5, 8),
                       description=description, amount_cents=1000, currency="EUR", is_debit=True,
                       import_hash=f"src_{key}", **kw)


async def _sources(db: AsyncSession) -> dict:
    db.expire_all()
    rows = (await db.execute(select(Transaction))).scalars().all()
    return {t.description: t.category_source for t in rows}


# ── Written wherever a category is ──────────────────────────────────────────
async def test_import_records_rule_and_review_choices(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    db_session.add(_rule(seed_data))
    await db_session.commit()
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    acc = seed_data["account_courant"]

    preview = (await client.post("/api/upload/parse-preview", headers=h,
                                 files={"file": ("c.csv", CSV, "text/csv")}, data=_form(acc.id))).json()
    unknown = next(t for t in preview["transactions"] if t["description"] == "ZZZ INCONNU")
    # The user picks a category for the unknown row in the review step.
    overrides = json.dumps({unknown["import_hash"]: seed_data["cat_salaire"].id})
    res = await client.post("/api/upload/confirm", headers=h, files={"file": ("c.csv", CSV, "text/csv")},
                            data=_form(acc.id, category_overrides=overrides))
    assert res.status_code == 200, res.text

    assert await _sources(db_session) == {"PAIEMENT CB SNCB WEBAPP": "rule", "ZZZ INCONNU": "manual"}


async def test_applying_rules_records_rule(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    db_session.add_all([_txn(seed_data, "a", "PAIEMENT CB SNCB WEBAPP"), _txn(seed_data, "b", "AUTRE CHOSE"), _rule(seed_data)])
    await db_session.commit()

    await client.post("/api/categories/rescan", headers={"X-Profile-Id": str(seed_data["profile"].id)})

    assert await _sources(db_session) == {"PAIEMENT CB SNCB WEBAPP": "rule", "AUTRE CHOSE": None}


async def test_user_actions_record_manual_and_clearing_clears(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    cat = seed_data["cat_courses"].id
    one = _txn(seed_data, "one", "UN", category_id=cat, category_source="rule")
    many = _txn(seed_data, "many", "PLUSIEURS")
    gone = _txn(seed_data, "gone", "RETIRE", category_id=cat, category_source="rule")
    db_session.add_all([one, many, gone])
    await db_session.commit()

    # Re-categorising by hand overrides what a rule had done.
    await client.put(f"/api/transactions/{one.id}", headers=h, json={"category_id": seed_data["cat_salaire"].id})
    await client.post("/api/transactions/bulk-update-category", headers=h, json={"ids": [many.id], "category_id": cat})
    await client.put(f"/api/transactions/{gone.id}", headers=h, json={"category_id": None})
    created = (await client.post("/api/transactions", headers=h, json={
        "account_id": seed_data["account_courant"].id, "date": "2026-05-10", "description": "SAISIE",
        "amount_cents": 500, "is_debit": True, "category_id": cat})).json()

    assert await _sources(db_session) == {"UN": "manual", "PLUSIEURS": "manual", "RETIRE": None, "SAISIE": "manual"}
    assert created["category_source"] == "manual"


async def test_editing_something_else_keeps_the_source(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    txn = _txn(seed_data, "keep", "GARDE", category_id=seed_data["cat_courses"].id, category_source="rule")
    db_session.add(txn)
    await db_session.commit()

    await client.put(f"/api/transactions/{txn.id}", headers={"X-Profile-Id": str(seed_data["profile"].id)},
                     json={"notes": "vu", "is_manually_reviewed": True})

    assert await _sources(db_session) == {"GARDE": "rule"}


# ── Filter ──────────────────────────────────────────────────────────────────
async def test_filter_on_the_source(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    cat = seed_data["cat_courses"].id
    db_session.add_all([
        _txn(seed_data, "r", "PAR REGLE", category_id=cat, category_source="rule"),
        _txn(seed_data, "m", "A LA MAIN", category_id=cat, category_source="manual"),
        _txn(seed_data, "n", "SANS CATEGORIE"),
    ])
    await db_session.commit()
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    async def found(**params) -> set:
        res = await client.get("/api/transactions", headers=h, params=params)
        assert res.status_code == 200, res.text
        return {t["description"] for t in res.json()}

    assert await found(category_source="rule") == {"PAR REGLE"}
    assert await found(category_source="manual") == {"A LA MAIN"}
    assert await found() == {"PAR REGLE", "A LA MAIN", "SANS CATEGORIE"}
    assert (await client.get("/api/transactions/count", headers=h, params={"category_source": "rule"})).json()["total"] == 1
    assert (await client.get("/api/transactions", headers=h, params={"category_source": "robot"})).status_code == 422
    # The CSV export follows the same filter as the list it is launched from.
    export = (await client.get("/api/transactions/export", headers=h, params={"category_source": "manual"})).text
    assert "A LA MAIN" in export and "PAR REGLE" not in export and "SANS CATEGORIE" not in export


# ── Rows categorised before the column existed ──────────────────────────────
async def test_backfill_infers_from_current_rules_once(db_session: AsyncSession, seed_data: dict):
    cat, other = seed_data["cat_courses"].id, seed_data["cat_salaire"].id
    db_session.add_all([
        _rule(seed_data),
        _txn(seed_data, "match", "PAIEMENT CB SNCB WEBAPP", category_id=cat),      # the rule gives this category
        _txn(seed_data, "differs", "PAIEMENT CB SNCB GARE", category_id=other),     # the rule would give another
        _txn(seed_data, "norule", "AUTRE CHOSE", category_id=cat),                  # no rule at all
        _txn(seed_data, "empty", "SANS CATEGORIE"),                                 # nothing to explain
        _txn(seed_data, "known", "DEJA CONNU", category_id=cat, category_source="manual"),
    ])
    await db_session.commit()

    assert await backfill(db_session) == {"rule": 1, "manual": 2}
    assert await _sources(db_session) == {
        "PAIEMENT CB SNCB WEBAPP": "rule", "PAIEMENT CB SNCB GARE": "manual", "AUTRE CHOSE": "manual",
        "SANS CATEGORIE": None, "DEJA CONNU": "manual",
    }
    # Nothing left to do: a second start changes nothing.
    assert await backfill(db_session) == {"rule": 0, "manual": 0}


async def test_backfill_never_touches_a_category(db_session: AsyncSession, seed_data: dict):
    other = seed_data["cat_salaire"].id
    txn = _txn(seed_data, "kept", "PAIEMENT CB SNCB WEBAPP", category_id=other)
    db_session.add_all([_rule(seed_data), txn])
    await db_session.commit()

    await backfill(db_session)

    await db_session.refresh(txn)
    assert txn.category_id == other and txn.category_source == "manual"


async def test_backfill_uses_each_profile_own_rules(db_session: AsyncSession, seed_data: dict, extra_profile):
    """A rule of one profile must not explain a transaction of another."""
    from models import Account, AccountType
    acc = Account(profile_id=extra_profile.id, name="Autre", bank_name="B", account_type=AccountType.courant, currency="EUR")
    cat = Category(profile_id=extra_profile.id, name="Courses", color="#000")
    db_session.add_all([acc, cat, _rule(seed_data)])
    await db_session.commit()
    theirs = Transaction(profile_id=extra_profile.id, account_id=acc.id, date=date(2026, 5, 8),
                         description="PAIEMENT CB SNCB WEBAPP", amount_cents=1000, currency="EUR", is_debit=True,
                         import_hash="src_theirs", category_id=cat.id)
    db_session.add(theirs)
    await db_session.commit()

    await backfill(db_session)

    await db_session.refresh(theirs)
    assert theirs.category_source == "manual"
