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
