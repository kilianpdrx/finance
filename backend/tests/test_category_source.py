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


# ── Re-applying rules to everything never touches a hand label ──────────────
def _rule_to(seed: dict, category, value: str) -> CategoryRule:
    return CategoryRule(profile_id=seed["profile"].id, category_id=category.id, is_active=True,
                        logic_operator="AND", conditions=[{"field": "description", "operator": "contains", "value": value}])


async def _state(db: AsyncSession) -> dict:
    db.expire_all()
    rows = (await db.execute(select(Transaction))).scalars().all()
    return {t.description: (t.category_id, t.category_source) for t in rows}


async def _rescan_fixture(db: AsyncSession, seed: dict) -> None:
    """One rule, "SNCB" → Courses, and every kind of row it can meet."""
    courses, salaire = seed["cat_courses"].id, seed["cat_salaire"].id
    db.add_all([
        _rule(seed),
        # Chosen by hand — whatever the rule thinks of them, they stay.
        _txn(seed, "h1", "SNCB A LA MAIN AUTREMENT", category_id=salaire, category_source="manual"),
        _txn(seed, "h2", "A LA MAIN SANS REGLE", category_id=salaire, category_source="manual"),
        _txn(seed, "h3", "SNCB A LA MAIN PAREIL", category_id=courses, category_source="manual"),
        _txn(seed, "v1", "SNCB VERIFIE", category_id=salaire, category_source="rule", is_manually_reviewed=True),
        _txn(seed, "u1", "SNCB ORIGINE INCONNUE", category_id=salaire),
        # Classified by a rule — they follow the current rules.
        _txn(seed, "r1", "SNCB AUTO ANCIENNE", category_id=salaire, category_source="rule"),
        _txn(seed, "r2", "AUTO SANS REGLE", category_id=salaire, category_source="rule"),
        _txn(seed, "n1", "SNCB SANS CATEGORIE"),
        # A transfer has no category on purpose.
        _txn(seed, "t1", "SNCB VIREMENT", is_internal_transfer=True),
    ])
    await db.commit()


async def test_rescan_all_keeps_what_the_user_chose(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    courses, salaire = seed_data["cat_courses"].id, seed_data["cat_salaire"].id
    await _rescan_fixture(db_session, seed_data)
    before = await _state(db_session)

    expected = {"updated": 3, "cleared": 1, "total": 3, "conflicts": 0, "manual_disagreements": 1}
    dry = await client.post("/api/categories/rescan", params={"scope": "all", "dry_run": "true"}, headers=h)
    assert dry.json() == expected
    assert await _state(db_session) == before, "a dry run must not write"

    res = await client.post("/api/categories/rescan", params={"scope": "all"}, headers=h)
    assert res.json() == expected
    assert await _state(db_session) == {
        "SNCB A LA MAIN AUTREMENT": (salaire, "manual"),   # the rule disagrees: kept, and counted
        "A LA MAIN SANS REGLE": (salaire, "manual"),       # no rule: used to be wiped
        "SNCB A LA MAIN PAREIL": (courses, "manual"),
        "SNCB VERIFIE": (salaire, "rule"),
        "SNCB ORIGINE INCONNUE": (salaire, None),          # unknown origin: not ours to overwrite
        "SNCB AUTO ANCIENNE": (courses, "rule"),           # follows the rule
        "AUTO SANS REGLE": (None, None),                   # its rule is gone: cleared, and counted
        "SNCB SANS CATEGORIE": (courses, "rule"),
        "SNCB VIREMENT": (None, None),
    }

    # Nothing left to do, and the disagreement is still there to be seen.
    again = await client.post("/api/categories/rescan", params={"scope": "all"}, headers=h)
    assert again.json() == {"updated": 0, "cleared": 0, "total": 3, "conflicts": 0, "manual_disagreements": 1}


async def test_default_rescan_fills_only_what_has_no_category(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    courses = seed_data["cat_courses"].id
    await _rescan_fixture(db_session, seed_data)
    before = await _state(db_session)

    res = await client.post("/api/categories/rescan", headers=h)

    # The transfer is not "sans catégorie": it is left out of the count too.
    assert res.json() == {"updated": 1, "cleared": 0, "total": 1, "conflicts": 0, "manual_disagreements": 0}
    assert await _state(db_session) == {**before, "SNCB SANS CATEGORIE": (courses, "rule")}


# ── « ≠ règle »: a hand label the rules would set differently ───────────────
async def test_list_flags_hand_labels_the_rules_contradict(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    await _rescan_fixture(db_session, seed_data)
    rule_id = (await db_session.execute(select(CategoryRule.id))).scalar_one()

    rows = {t["description"]: t for t in (await client.get("/api/transactions", headers=h)).json()}

    flagged = rows["SNCB A LA MAIN AUTREMENT"]
    assert flagged["rule_category_id"] == seed_data["cat_courses"].id
    assert flagged["disagreeing_rule_ids"] == [rule_id]
    assert flagged["category_id"] == seed_data["cat_salaire"].id
    # Not flagged: no rule, rule agrees, or the row was not classified by hand
    # (a stale "auto" row is for « Réappliquer », not for this badge).
    assert {d for d, t in rows.items() if t["rule_category_id"] is not None} == {"SNCB A LA MAIN AUTREMENT"}
    assert all(t["disagreeing_rule_ids"] == [] for d, t in rows.items() if d != "SNCB A LA MAIN AUTREMENT")


async def test_rules_in_conflict_are_not_a_disagreement(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """Two rules that contradict each other say nothing: « conflit » covers it."""
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    other = Category(name="Transport", profile_id=seed_data["profile"].id)
    db_session.add(other)
    await db_session.flush()
    db_session.add_all([
        _rule(seed_data), _rule_to(seed_data, other, "WEBAPP"),
        _txn(seed_data, "c1", "PAIEMENT CB SNCB WEBAPP", category_id=seed_data["cat_salaire"].id, category_source="manual"),
    ])
    await db_session.commit()

    row = (await client.get("/api/transactions", headers=h)).json()[0]
    assert row["category_conflict"] is True and row["rule_category_id"] is None
    assert (await client.get("/api/transactions/count", headers=h, params={"contradicts_rule": "true"})).json()["total"] == 0


async def test_filter_on_contradicted_hand_labels(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    salaire = seed_data["cat_salaire"].id
    await _rescan_fixture(db_session, seed_data)
    db_session.add_all([
        Transaction(profile_id=seed_data["profile"].id, account_id=seed_data["account_courant"].id, date=date(2026, 5, d),
                    description=f"SNCB CONTREDIT {d}", amount_cents=100 * d, currency="EUR", is_debit=True,
                    import_hash=f"src_x{d}", category_id=salaire, category_source="manual")
        for d in (1, 2, 3)
    ])
    await db_session.commit()

    async def listed(**params) -> list:
        res = await client.get("/api/transactions", headers=h, params={"contradicts_rule": "true", **params})
        assert res.status_code == 200, res.text
        return [t["description"] for t in res.json()]

    everything = await listed()
    assert sorted(everything) == ["SNCB A LA MAIN AUTREMENT", "SNCB CONTREDIT 1", "SNCB CONTREDIT 2", "SNCB CONTREDIT 3"]
    # Paged AFTER the rule engine decided, in the requested order.
    by_amount = await listed(sort_by="amount", sort_dir="asc")
    assert by_amount == ["SNCB CONTREDIT 1", "SNCB CONTREDIT 2", "SNCB CONTREDIT 3", "SNCB A LA MAIN AUTREMENT"]
    assert await listed(sort_by="amount", sort_dir="asc", limit=2, offset=1) == ["SNCB CONTREDIT 2", "SNCB CONTREDIT 3"]
    # Combined with the other filters.
    assert await listed(search="CONTREDIT 2") == ["SNCB CONTREDIT 2"]

    count = await client.get("/api/transactions/count", headers=h, params={"contradicts_rule": "true"})
    assert count.json()["total"] == 4
    ids = await client.get("/api/transactions/ids", headers=h, params={"contradicts_rule": "true", "search": "CONTREDIT"})
    assert len(ids.json()["ids"]) == 3


async def test_following_the_rule_is_an_explicit_choice(client: AsyncClient, seed_data: dict, db_session: AsyncSession, extra_profile):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    other_h = {"X-Profile-Id": str(extra_profile.id)}
    courses, salaire = seed_data["cat_courses"].id, seed_data["cat_salaire"].id
    await _rescan_fixture(db_session, seed_data)
    ids = {t.description: t.id for t in (await db_session.execute(select(Transaction))).scalars().all()}

    res = await client.post(f"/api/transactions/{ids['SNCB A LA MAIN AUTREMENT']}/apply-rules", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["category_id"], body["category_source"], body["rule_category_id"]) == (courses, "rule", None)
    assert (await _state(db_session))["SNCB A LA MAIN AUTREMENT"] == (courses, "rule")
    assert (await client.get("/api/transactions/count", headers=h, params={"contradicts_rule": "true"})).json()["total"] == 0

    # No rule to follow: refused, and the hand label stays.
    none = await client.post(f"/api/transactions/{ids['A LA MAIN SANS REGLE']}/apply-rules", headers=h)
    assert none.status_code == 409 and "Aucune règle" in none.json()["detail"]
    assert (await _state(db_session))["A LA MAIN SANS REGLE"] == (salaire, "manual")

    # Another profile cannot reach the row.
    foreign = await client.post(f"/api/transactions/{ids['SNCB A LA MAIN PAREIL']}/apply-rules", headers=other_h)
    assert foreign.status_code == 404


async def test_following_conflicting_rules_is_refused(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    salaire = seed_data["cat_salaire"].id
    other = Category(name="Transport", profile_id=seed_data["profile"].id)
    db_session.add(other)
    await db_session.flush()
    txn = _txn(seed_data, "c2", "PAIEMENT CB SNCB WEBAPP", category_id=salaire, category_source="manual")
    db_session.add_all([_rule(seed_data), _rule_to(seed_data, other, "WEBAPP"), txn])
    await db_session.commit()
    txn_id = txn.id

    res = await client.post(f"/api/transactions/{txn_id}/apply-rules", headers=h)

    assert res.status_code == 409 and "se contredisent" in res.json()["detail"]
    assert (await _state(db_session))["PAIEMENT CB SNCB WEBAPP"] == (salaire, "manual")
