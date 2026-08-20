"""A newly created profile must be usable on its own.

`create_profile` used to insert a Profile row and nothing else, and
`seed_if_empty` guarded on a *global* category count — so every profile after the
first got zero categories, zero rules, no auto-categorisation, and a base currency
that fell back to a hardcoded "CHF".
"""
from sqlalchemy import func, select, text

from models import Category, CategoryRule, Setting
from seed import DEFAULT_CATEGORIES, DEFAULT_RULES


async def _counts(db, profile_id: int) -> tuple[int, int]:
    cats = (await db.execute(
        select(func.count(Category.id)).where(Category.profile_id == profile_id)
    )).scalar()
    rules = (await db.execute(
        select(func.count(CategoryRule.id)).where(CategoryRule.profile_id == profile_id)
    )).scalar()
    return cats, rules


async def test_new_profile_gets_the_default_categories_and_rules(client, db_session, seed_data):
    existing = seed_data["profile"]
    before = await _counts(db_session, existing.id)

    res = await client.post("/api/profiles", json={"name": "Maman", "color": "#f97316"})
    assert res.status_code == 201
    new_id = res.json()["id"]

    cats, rules = await _counts(db_session, new_id)
    assert cats == len(DEFAULT_CATEGORIES)
    assert rules == len(DEFAULT_RULES)

    # Scoped to the new profile — nothing leaked, nothing was rewritten.
    assert await _counts(db_session, existing.id) == before


async def test_new_profile_inherits_the_household_base_currency(client, db_session, seed_data):
    """A profile with no settings row reads as "CHF" whatever the rest of the
    install uses, which is invisible until every amount looks wrong."""
    profile = seed_data["profile"]
    await db_session.execute(text(
        "INSERT OR REPLACE INTO settings (profile_id, key, value)"
        " VALUES (:p, 'base_currency', 'EUR')"
    ), {"p": profile.id})
    await db_session.execute(text("UPDATE profiles SET is_default = 1 WHERE id = :p"),
                             {"p": profile.id})
    await db_session.commit()

    res = await client.post("/api/profiles", json={"name": "Colocataire"})
    new_id = res.json()["id"]

    value = (await db_session.execute(
        select(Setting.value).where(Setting.profile_id == new_id,
                                    Setting.key == "base_currency")
    )).scalar()
    assert value == "EUR"


async def test_seeding_never_rewrites_an_existing_profile(db_session, seed_data):
    """Pins the deliberate decision that corrected seed rules stay out of installs
    that already have categories — a user's own rules are theirs."""
    from seed import seed_if_empty

    profile = seed_data["profile"]
    before = await _counts(db_session, profile.id)
    assert before[0] > 0, "fixture should already provide categories"

    await seed_if_empty(db_session, profile.id)

    assert await _counts(db_session, profile.id) == before


async def test_seeding_is_per_profile_not_global(db_session, seed_data, extra_profile):
    """The original guard counted categories across the whole database, so any
    profile created after the first was skipped entirely."""
    from seed import seed_if_empty

    assert (await _counts(db_session, seed_data["profile"].id))[0] > 0
    await seed_if_empty(db_session, extra_profile.id)

    cats, rules = await _counts(db_session, extra_profile.id)
    assert cats == len(DEFAULT_CATEGORIES)
    assert rules == len(DEFAULT_RULES)
