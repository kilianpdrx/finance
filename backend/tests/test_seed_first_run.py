"""First-run seeding.

Everything the app reads is scoped by profile_id, so seeded rows written without
one are invisible: a brand-new install would show no categories and never
auto-categorise an import. These tests pin that contract.
"""
import pytest
from sqlalchemy import select, func

from models import Category, CategoryRule, Profile
from seed import DEFAULT_CATEGORIES, DEFAULT_RULES, seed_if_empty


@pytest.mark.asyncio
async def test_seed_assigns_profile_to_categories_and_rules(db_session):
    profile = Profile(name="Principal", color="#6366f1", is_default=True)
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(profile)

    await seed_if_empty(db_session, profile.id)

    cats = (await db_session.execute(select(Category))).scalars().all()
    rules = (await db_session.execute(select(CategoryRule))).scalars().all()

    assert len(cats) == len(DEFAULT_CATEGORIES)
    assert len(rules) > 0
    # The whole point: nothing may be orphaned.
    assert [c.name for c in cats if c.profile_id != profile.id] == []
    assert [r.id for r in rules if r.profile_id != profile.id] == []


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session):
    profile = Profile(name="Principal", color="#6366f1", is_default=True)
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(profile)

    await seed_if_empty(db_session, profile.id)
    await seed_if_empty(db_session, profile.id)  # second boot must not duplicate

    n = (await db_session.execute(select(func.count(Category.id)))).scalar()
    assert n == len(DEFAULT_CATEGORIES)


@pytest.mark.asyncio
async def test_seeded_rules_actually_categorise(db_session):
    """A seeded rule must be visible to the categoriser for that profile —
    otherwise imports silently land 100% uncategorised."""
    from services.categorizer import categorize

    profile = Profile(name="Principal", color="#6366f1", is_default=True)
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(profile)
    await seed_if_empty(db_session, profile.id)

    cat_id, source = await categorize(
        {"description": "VIREMENT SALAIRE JUILLET", "amount_cents": 250000,
         "date": "2026-07-28", "is_debit": False, "currency": "EUR", "account_id": 1},
        db_session, profile.id,
    )
    assert cat_id is not None and source == "rule"


@pytest.mark.asyncio
async def test_seed_defaults_endpoint_restores_categories_and_rules(client, seed_data):
    """The Paramètres recovery button must restore rules too, not just categories."""
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}

    res = await client.post("/api/categories/seed-defaults", headers=h)
    assert res.status_code == 201
    body = res.json()
    assert body["created"] > 0
    assert body["rules_created"] > 0, "rules must be restored, not only categories"

    rules = (await client.get("/api/categories/rules/all", headers=h)).json()
    assert all(r["category_id"] is not None for r in rules)

    # Pressing it again must not duplicate anything.
    again = (await client.post("/api/categories/seed-defaults", headers=h)).json()
    assert again["created"] == 0 and again["rules_created"] == 0


@pytest.mark.asyncio
async def test_profile_with_null_modules_does_not_500(client, db_session):
    """A profile row whose enabled_modules is NULL (raw-SQL insert bypasses the
    ORM default) must still serialise — otherwise /api/profiles 500s and the
    profile switcher breaks for every brand-new install."""
    from sqlalchemy import text
    from schemas import DEFAULT_MODULES

    await db_session.execute(text(
        "INSERT INTO profiles (name, color, is_default, enabled_modules) "
        "VALUES ('Principal', '#6366f1', 1, NULL)"
    ))
    await db_session.commit()

    res = await client.get("/api/profiles")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body[0]["enabled_modules"] == DEFAULT_MODULES


@pytest.mark.asyncio
async def test_orm_created_profile_has_modules(db_session):
    """The default profile must be created through the ORM so its modules default
    is applied (a raw INSERT leaves the column NULL)."""
    p = Profile(name="Principal", color="#6366f1", is_default=True)
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    assert p.enabled_modules  # not None, not empty


async def _seeded_profile(db_session) -> Profile:
    profile = Profile(name="Principal", color="#6366f1", is_default=True)
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(profile)
    await seed_if_empty(db_session, profile.id)
    return profile


def _txn(description: str, is_debit: bool = True) -> dict:
    return {"description": description, "amount_cents": 1000, "date": "2026-07-01",
            "is_debit": is_debit, "currency": "EUR", "account_id": 1}


@pytest.mark.asyncio
async def test_seeded_rules_keep_every_condition(db_session):
    """One rule per DEFAULT_RULES entry. Keyword lists are OR-ed — with AND a
    description would have to contain every keyword at once, i.e. never match —
    and the explicit `all` entries are AND-ed."""
    await _seeded_profile(db_session)

    rules = (await db_session.execute(select(CategoryRule))).scalars().all()
    assert len(rules) == len(DEFAULT_RULES)
    assert {r.logic_operator for r in rules} == {"OR", "AND"}
    # Grouping is the point: at least one rule must carry several keywords.
    assert max(len(r.conditions) for r in rules if r.logic_operator == "OR") > 1
    # Every condition survived.
    expected = sum(
        len(g["all"]) if "all" in g else len(g.get("keywords", [])) + len(g.get("words", []))
        for g in DEFAULT_RULES
    )
    assert sum(len(r.conditions) for r in rules) == expected


@pytest.mark.asyncio
async def test_default_rules_never_conflict_with_each_other(db_session):
    """Rules have no priority, so two defaults matching the same label would leave
    it uncategorised on a brand-new install. Every default keyword, used as a
    label, must classify into exactly one category: its own."""
    from services.categorizer import evaluate_rules_batch

    profile = await _seeded_profile(db_session)
    names = {c.id: c.name for c in (await db_session.execute(select(Category))).scalars().all()}

    probes = []  # (label, expected category, txn)
    for entry in DEFAULT_RULES:
        if "all" in entry:
            label = next(v for f, op, v in entry["all"] if f == "description" and op in ("contains", "word"))
            is_debit = ("is_debit", "equals", "false") not in entry["all"]
            probes.append((label, entry["category"], _txn(label.upper(), is_debit)))
        else:
            for label in entry.get("keywords", []) + entry.get("words", []):
                probes.append((label, entry["category"], _txn(label.upper())))

    evals = await evaluate_rules_batch([t for _, _, t in probes], db_session, profile.id)
    wrong = {
        label: sorted(names[c] for c in ev.category_ids)
        for (label, expected, _), ev in zip(probes, evals)
        if {names[c] for c in ev.category_ids} != {expected}
    }
    assert wrong == {}


@pytest.mark.asyncio
async def test_default_rules_tell_similar_labels_apart(db_session):
    """What priority used to settle is now settled by the rules themselves:
    exclusions for a brand contained in a longer one, whole-word matching for
    keywords short enough to hide inside other words."""
    from services.categorizer import categorize

    profile = await _seeded_profile(db_session)
    names = {c.id: c.name for c in (await db_session.execute(select(Category))).scalars().all()}

    async def classify(description: str, is_debit: bool = True):
        cat_id, _ = await categorize(_txn(description, is_debit), db_session, profile.id)
        return names.get(cat_id)

    # A brand contained in a longer one.
    assert await classify("PAIEMENT CB AMAZON PRIME VIDEO") == "Abonnements"
    assert await classify("ACHAT AMAZON.FR") == "Shopping"
    assert await classify("UBER EATS COMMANDE") == "Restaurants"
    assert await classify("UBER TRIP PARIS") == "Transport"
    assert await classify("COTISATION MUTUELLE") == "Santé"
    assert await classify("COTISATION CARTE") == "Banque & Finances"
    # Short keywords only as whole words.
    assert await classify("SALLE DE SPORT BASIC FIT") == "Loisirs"
    assert await classify("TRANSPORTS RATP") == "Transport"      # not "sport"
    assert await classify("FREE MOBILE") == "Abonnements"
    assert await classify("MISSION FREELANCE") is None           # not "free"
    assert await classify("INSTITUT BEAUTE") is None             # not "eau"
    # "prime" is income only as a whole word on a credit.
    assert await classify("PRIME EXCEPTIONNELLE", is_debit=False) == "Revenus"
    assert await classify("PRIMEUR DU MARCHE") is None
