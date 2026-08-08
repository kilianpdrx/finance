"""Standard-categories seeding and single-level category nesting."""
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Category


async def test_seed_defaults_creates_and_skips_existing(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    # seed_data already created "Alimentation" — it must be skipped, the rest created.
    r = await client.post("/api/categories/seed-defaults", headers=h)
    assert r.status_code == 201
    created = r.json()["created"]
    assert created >= 10  # 14 defaults minus the couple already present

    names = {n for (n,) in (await db_session.execute(select(Category.name).where(Category.profile_id == pid))).all()}
    assert {"Logement", "Transport", "Loisirs", "Divers"} <= names

    # Second run creates nothing (all present now).
    r2 = await client.post("/api/categories/seed-defaults", headers=h)
    assert r2.json()["created"] == 0


async def test_subcategory_create_and_nesting_rules(client: AsyncClient, seed_data: dict):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    parent_id = seed_data["cat_courses"].id  # top-level

    # Create a child under the parent — OK.
    r = await client.post("/api/categories", headers=h, json={"name": "Sous-1", "parent_id": parent_id})
    assert r.status_code == 201
    child_id = r.json()["id"]
    assert r.json()["parent_id"] == parent_id

    # A grandchild (parent is itself a child) is rejected — single level only.
    r2 = await client.post("/api/categories", headers=h, json={"name": "Sous-2", "parent_id": child_id})
    assert r2.status_code == 400

    # A category can't be its own parent.
    r3 = await client.put(f"/api/categories/{child_id}", headers=h, json={"parent_id": child_id})
    assert r3.status_code == 400


async def test_delete_parent_reparents_children(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    parent_id = seed_data["cat_salaire"].id
    child = (await client.post("/api/categories", headers=h, json={"name": "Enfant", "parent_id": parent_id})).json()

    r = await client.delete(f"/api/categories/{parent_id}", headers=h)
    assert r.status_code == 204

    reloaded = (await db_session.execute(select(Category).where(Category.id == child["id"]))).scalar_one()
    assert reloaded.parent_id is None  # re-parented, not orphaned
