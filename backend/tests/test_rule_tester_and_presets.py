"""The two things a user actually struggles with.

Rule tester: rules are evaluated by ascending priority and the first match wins,
so losing rules are invisible in the list — which is why a mis-ordered rule is
impossible to diagnose by reading it.

Presets: column mapping is the hardest step of an import. A preset must only ever
be applied when its columns genuinely match, since a wrong column silently
produces wrong amounts.
"""
import pytest

from models import CategoryRule
from bank_presets import BANK_PRESETS, match_preset


# ── Rule tester ─────────────────────────────────────────────────────────────
@pytest.fixture
async def two_competing_rules(db_session, seed_data):
    """Two rules matching the same text, at different priorities."""
    pid = seed_data["profile"].id
    db_session.add_all([
        CategoryRule(profile_id=pid, category_id=seed_data["cat_courses"].id, priority=50,
                     is_active=True, logic_operator="OR",
                     conditions=[{"field": "description", "operator": "contains", "value": "amazon"}]),
        CategoryRule(profile_id=pid, category_id=seed_data["cat_salaire"].id, priority=45,
                     is_active=True, logic_operator="OR",
                     conditions=[{"field": "description", "operator": "contains", "value": "amazon prime"}]),
    ])
    await db_session.commit()
    return pid


@pytest.mark.asyncio
async def test_tester_reports_the_winner_and_the_losers(client, seed_data, two_competing_rules):
    h = {"X-Profile-Id": str(two_competing_rules)}
    res = await client.post("/api/categories/rules/test", headers=h,
                            json={"description": "PAIEMENT CB AMAZON PRIME VIDEO"})
    assert res.status_code == 200
    body = res.json()

    # Lower priority number wins.
    assert body["matched"]["priority"] == 45
    assert body["matched"]["category_name"] == seed_data["cat_salaire"].name
    # The rule that loses is still reported — that's the whole point.
    assert len(body["all_matches"]) == 2
    assert body["all_matches"][1]["priority"] == 50


@pytest.mark.asyncio
async def test_tester_reports_no_match(client, seed_data, two_competing_rules):
    h = {"X-Profile-Id": str(two_competing_rules)}
    body = (await client.post("/api/categories/rules/test", headers=h,
                              json={"description": "QUELQUE CHOSE D INCONNU"})).json()
    assert body["matched"] is None
    assert body["all_matches"] == []
    assert body["rules_evaluated"] >= 2


@pytest.mark.asyncio
async def test_tester_ignores_inactive_rules(client, db_session, seed_data):
    pid = seed_data["profile"].id
    db_session.add(CategoryRule(
        profile_id=pid, category_id=seed_data["cat_courses"].id, priority=10,
        is_active=False, logic_operator="OR",
        conditions=[{"field": "description", "operator": "contains", "value": "carrefour"}]))
    await db_session.commit()

    body = (await client.post("/api/categories/rules/test",
                              headers={"X-Profile-Id": str(pid)},
                              json={"description": "CARREFOUR MARKET"})).json()
    assert body["matched"] is None, "a disabled rule must not classify anything"


@pytest.mark.asyncio
async def test_tester_is_profile_scoped(client, db_session, seed_data, extra_profile):
    """Another profile's rules must not appear in your test result."""
    from models import Category
    foreign_cat = Category(profile_id=extra_profile.id, name="ForeignCat", color="#000")
    db_session.add(foreign_cat)
    await db_session.commit()
    await db_session.refresh(foreign_cat)
    db_session.add(CategoryRule(
        profile_id=extra_profile.id, category_id=foreign_cat.id, priority=1,
        is_active=True, logic_operator="OR",
        conditions=[{"field": "description", "operator": "contains", "value": "test"}]))
    await db_session.commit()

    body = (await client.post("/api/categories/rules/test",
                              headers={"X-Profile-Id": str(seed_data["profile"].id)},
                              json={"description": "TEST"})).json()
    assert all(m["category_name"] != "ForeignCat" for m in body["all_matches"])


# ── Bank presets ────────────────────────────────────────────────────────────
def test_presets_are_well_formed():
    assert BANK_PRESETS, "at least one verified preset should ship"
    for p in BANK_PRESETS:
        assert p["name"] and p["column_mapping"]
        roles = set(p["column_mapping"])
        # Every preset must be importable: a date, a label, and an amount source.
        assert "date" in roles and "description" in roles
        assert "amount" in roles or {"debit", "credit"} <= roles
        assert p["date_format"] and p["delimiter"]


def test_match_preset_requires_every_column():
    """A partial overlap must not silently select the wrong bank — a wrong column
    produces wrong amounts with no visible error."""
    cm = next(p for p in BANK_PRESETS if p["name"] == "Crédit Mutuel")
    headers = list(cm["column_mapping"].values())

    assert match_preset(headers)["name"] == "Crédit Mutuel"
    assert match_preset(headers + ["Colonne en plus"])["name"] == "Crédit Mutuel"
    assert match_preset(headers[:-1]) is None      # one column missing
    assert match_preset(["Date", "Autre"]) is None


@pytest.mark.asyncio
async def test_presets_endpoint(client):
    res = await client.get("/api/bank-profiles/presets")
    assert res.status_code == 200
    names = [p["name"] for p in res.json()]
    assert "Crédit Mutuel" in names


@pytest.mark.asyncio
async def test_account_scoped_rules_are_evaluated_and_flagged(client, db_session, seed_data):
    """Most real rules are bound to an account. Hiding them when no account is
    given made the tester answer "no rule matches" for descriptions that clearly
    do — so they are evaluated anyway and flagged as unverified."""
    pid = seed_data["profile"].id
    acc = seed_data["account_courant"]
    db_session.add(CategoryRule(
        profile_id=pid, category_id=seed_data["cat_courses"].id, priority=10,
        is_active=True, logic_operator="OR", account_id=acc.id,
        conditions=[{"field": "description", "operator": "contains", "value": "SUPERMARCHE"}]))
    await db_session.commit()
    h = {"X-Profile-Id": str(pid)}

    # No account given: the rule still surfaces, marked as account-scoped.
    body = (await client.post("/api/categories/rules/test", headers=h,
                              json={"description": "ACHAT SUPERMARCHE"})).json()
    assert body["matched"] is not None, "an account-scoped rule must not be hidden"
    assert body["matched"]["account_scoped_unverified"] is True
    assert body["matched"]["account_name"] == acc.name

    # Correct account given: it matches for real.
    body = (await client.post("/api/categories/rules/test", headers=h,
                              json={"description": "ACHAT SUPERMARCHE", "account_id": acc.id})).json()
    assert body["matched"]["account_scoped_unverified"] is False

    # A different account: the rule must not apply at all.
    other = seed_data["account_inv"]
    body = (await client.post("/api/categories/rules/test", headers=h,
                              json={"description": "ACHAT SUPERMARCHE", "account_id": other.id})).json()
    assert body["matched"] is None
