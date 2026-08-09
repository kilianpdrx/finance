"""Grouping-only parents: a category with children can't hold transactions
directly — an auto-created "Autre {parent}" leaf does, and existing transactions
are moved there."""
from datetime import date
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Category, CategoryRule, Transaction


async def test_making_parent_creates_autre_and_moves_txns(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    parent = seed_data["cat_courses"]  # Alimentation (top-level, currently a leaf)
    acc = seed_data["account_courant"]

    # A transaction pinned directly to the soon-to-be parent.
    txn = Transaction(
        profile_id=pid, account_id=acc.id, date=date(2025, 1, 1), description="Courses X",
        amount_cents=1000, is_debit=True, import_hash="grp-h1", category_id=parent.id,
    )
    db_session.add(txn)
    await db_session.commit()

    # Adding the first child turns the parent into a grouping-only category.
    r = await client.post("/api/categories", headers=h, json={"name": "Restaurants", "parent_id": parent.id})
    assert r.status_code == 201

    autre = (await db_session.execute(
        select(Category).where(Category.name == "Autre Alimentation", Category.profile_id == pid)
    )).scalar_one()
    assert autre.parent_id == parent.id

    # The directly-held transaction was moved onto the "Autre" leaf.
    await db_session.refresh(txn)
    assert txn.category_id == autre.id


async def test_rule_repointed_to_autre_when_parent_created(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    """A rule that classified into a category must follow it to the "Autre" leaf
    when that category becomes grouping-only (so it keeps categorising)."""
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    parent = seed_data["cat_courses"]  # Alimentation

    rule = CategoryRule(
        profile_id=pid, category_id=parent.id, priority=100, is_active=True, logic_operator="AND",
        conditions=[{"field": "description", "operator": "contains", "value": "CARREFOUR"}],
    )
    db_session.add(rule)
    await db_session.commit()

    await client.post("/api/categories", headers=h, json={"name": "Restaurants", "parent_id": parent.id})

    autre = (await db_session.execute(
        select(Category).where(Category.name == "Autre Alimentation", Category.profile_id == pid)
    )).scalar_one()
    await db_session.refresh(rule)
    assert rule.category_id == autre.id


async def test_parent_rejected_as_transaction_category(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    parent = seed_data["cat_courses"]
    acc = seed_data["account_courant"]

    txn = Transaction(
        profile_id=pid, account_id=acc.id, date=date(2025, 1, 2), description="Y",
        amount_cents=500, is_debit=True, import_hash="grp-h2", category_id=None,
    )
    db_session.add(txn)
    await db_session.commit()

    # Make `parent` grouping-only.
    await client.post("/api/categories", headers=h, json={"name": "Restaurants", "parent_id": parent.id})

    # Assigning the grouping category to a transaction is rejected (single + bulk).
    r = await client.put(f"/api/transactions/{txn.id}", headers=h, json={"category_id": parent.id})
    assert r.status_code == 400
    r2 = await client.post(
        "/api/transactions/bulk-update-category", headers=h,
        json={"ids": [txn.id], "category_id": parent.id},
    )
    assert r2.status_code == 400


async def test_normalize_backfills_existing_parents(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession
):
    """A parent that already has children (created directly, bypassing the API)
    gets its "Autre" leaf and its transactions moved when normalize runs."""
    from routers.categories import normalize_parent_groups

    pid = seed_data["profile"].id
    parent = seed_data["cat_salaire"]  # Salaire
    acc = seed_data["account_courant"]

    child = Category(profile_id=pid, name="Prime", parent_id=parent.id, is_income=True)
    db_session.add(child)
    txn = Transaction(
        profile_id=pid, account_id=acc.id, date=date(2025, 2, 1), description="Paie",
        amount_cents=200000, is_debit=False, import_hash="grp-h3", category_id=parent.id,
    )
    db_session.add(txn)
    await db_session.commit()

    processed = await normalize_parent_groups(db_session, pid)
    assert processed >= 1

    autre = (await db_session.execute(
        select(Category).where(Category.name == "Autre Salaire", Category.profile_id == pid)
    )).scalar_one()
    await db_session.refresh(txn)
    assert txn.category_id == autre.id
