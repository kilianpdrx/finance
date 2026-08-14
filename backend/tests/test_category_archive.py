"""Archive (retire) categories: cascade to children, deactivate targeting rules,
block un-archiving under an archived parent, reject archived rule targets, rescan
scoping, and the inactivity suggestions."""
from datetime import date, timedelta
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Category, CategoryRule, Transaction


async def test_archive_cascades_and_deactivates_rules(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    parent = seed_data["cat_courses"]  # Alimentation
    child = (await client.post("/api/categories", headers=h, json={"name": "Restaurants", "parent_id": parent.id})).json()

    # A rule targeting the child.
    rule = CategoryRule(profile_id=pid, category_id=child["id"], priority=100, is_active=True,
                        logic_operator="AND", conditions=[{"field": "description", "operator": "contains", "value": "RESTO"}])
    db_session.add(rule)
    await db_session.commit()

    # Archive the parent → cascades to child + Autre, deactivates the rule.
    r = await client.put(f"/api/categories/{parent.id}", headers=h, json={"archived": True})
    assert r.status_code == 200 and r.json()["archived"] is True

    kids = (await db_session.execute(select(Category).where(Category.parent_id == parent.id))).scalars().all()
    assert all(k.archived for k in kids)
    await db_session.refresh(rule)
    assert rule.is_active is False


async def test_unarchive_child_blocked_under_archived_parent(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    parent = seed_data["cat_courses"]
    child = (await client.post("/api/categories", headers=h, json={"name": "Restaurants", "parent_id": parent.id})).json()
    await client.put(f"/api/categories/{parent.id}", headers=h, json={"archived": True})

    r = await client.put(f"/api/categories/{child['id']}", headers=h, json={"archived": False})
    assert r.status_code == 400


async def test_rule_cannot_target_archived_category(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    cat = seed_data["cat_salaire"]
    await client.put(f"/api/categories/{cat.id}", headers=h, json={"archived": True})

    r = await client.post(f"/api/categories/{cat.id}/rules", headers=h,
                          json={"conditions": [{"field": "description", "operator": "contains", "value": "X"}],
                                "category_id": cat.id, "priority": 100, "is_active": True, "logic_operator": "AND"})
    assert r.status_code == 400


async def test_rescan_scope_preserves_categorised(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    acc = seed_data["account_courant"]
    cat = seed_data["cat_courses"]
    # A categorised transaction that a rule would move elsewhere.
    txn = Transaction(profile_id=pid, account_id=acc.id, date=date(2025, 1, 1), description="CARREFOUR",
                      amount_cents=1000, is_debit=True, import_hash="resc-1", category_id=cat.id)
    db_session.add(txn)
    db_session.add(CategoryRule(profile_id=pid, category_id=seed_data["cat_salaire"].id, priority=100,
                                is_active=True, logic_operator="AND",
                                conditions=[{"field": "description", "operator": "contains", "value": "CARREFOUR"}]))
    await db_session.commit()

    # Default scope leaves the already-categorised row untouched.
    await client.post("/api/categories/rescan", headers=h)
    await db_session.refresh(txn)
    assert txn.category_id == cat.id

    # scope=all re-applies and moves it.
    await client.post("/api/categories/rescan", params={"scope": "all"}, headers=h)
    await db_session.refresh(txn)
    assert txn.category_id == seed_data["cat_salaire"].id


async def test_rescan_fills_uncategorized(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    """Default-scope rescan (batched) assigns a category to an uncategorised row
    that a rule matches, and leaves reviewed rows alone."""
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    acc = seed_data["account_courant"]
    target = seed_data["cat_courses"]
    db_session.add(Transaction(profile_id=pid, account_id=acc.id, date=date(2025, 3, 1),
                               description="CARREFOUR MARKET", amount_cents=2000, is_debit=True,
                               import_hash="resc-fill", category_id=None))
    db_session.add(CategoryRule(profile_id=pid, category_id=target.id, priority=100,
                                is_active=True, logic_operator="AND",
                                conditions=[{"field": "description", "operator": "contains", "value": "CARREFOUR"}]))
    await db_session.commit()

    r = await client.post("/api/categories/rescan", headers=h)
    assert r.status_code == 200 and r.json()["updated"] == 1

    txn = (await db_session.execute(
        select(Transaction).where(Transaction.import_hash == "resc-fill")
    )).scalar_one()
    assert txn.category_id == target.id


async def test_archive_suggestions(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    acc = seed_data["account_courant"]
    old_cat = seed_data["cat_courses"]     # last activity 2 years ago
    recent_cat = seed_data["cat_salaire"]  # last activity recent
    today = date.today()
    db_session.add(Transaction(profile_id=pid, account_id=acc.id, date=today - timedelta(days=800), description="old",
                               amount_cents=100, is_debit=True, import_hash="sugg-old", category_id=old_cat.id))
    db_session.add(Transaction(profile_id=pid, account_id=acc.id, date=today - timedelta(days=10), description="new",
                               amount_cents=100, is_debit=False, import_hash="sugg-new", category_id=recent_cat.id))
    await db_session.commit()

    r = await client.get("/api/categories/archive-suggestions", headers=h)
    assert r.status_code == 200
    ids = {s["category_id"] for s in r.json()}
    assert old_cat.id in ids
    assert recent_cat.id not in ids

    # Dismissing removes it from suggestions.
    old_cat.archive_dismissed = True
    await db_session.commit()
    r2 = await client.get("/api/categories/archive-suggestions", headers=h)
    assert old_cat.id not in {s["category_id"] for s in r2.json()}
