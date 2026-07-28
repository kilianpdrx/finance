import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


def _cell(budget_full: dict, category_id: int, month: str):
    for sec in budget_full["sections"]:
        for row in sec["rows"]:
            if row["category_id"] == category_id:
                for c in row["cells"]:
                    if c["month"] == month:
                        return c
    return None


async def _bf(client: AsyncClient):
    return (await client.get("/api/analytics/budget-full", params={"year": 2026})).json()


async def test_single_planned_appears_in_budget(client: AsyncClient, seed_data: dict):
    cat = seed_data["cat_courses"].id
    r = await client.post("/api/planned-expenses", json={"category_id": cat, "month": "2026-09", "amount_cents": 15000})
    assert r.status_code == 201
    created = r.json()

    cell = _cell(await _bf(client), cat, "2026-09")
    assert cell is not None
    assert cell["planned_cents"] == 15000
    assert cell["planned_matched"] is False
    assert cell["planned_id"] == created["id"]
    # It's a separate layer: the manual "expected" adjustment is untouched.
    assert cell["expected_cents"] == 0


async def test_recurring_count(client: AsyncClient, seed_data: dict):
    cat = seed_data["cat_courses"].id
    r = await client.post("/api/planned-expenses/recurring", json={
        "category_id": cat, "start_month": "2026-08", "amount_cents": 5000,
        "every_n_months": 1, "end_mode": "count", "count": 3,
    })
    assert r.status_code == 201
    assert r.json()["months"] == ["2026-08", "2026-09", "2026-10"]
    bf = await _bf(client)
    for m in ("2026-08", "2026-09", "2026-10"):
        assert _cell(bf, cat, m)["planned_cents"] == 5000


async def test_recurring_year_with_interval(client: AsyncClient, seed_data: dict):
    cat = seed_data["cat_courses"].id
    r = await client.post("/api/planned-expenses/recurring", json={
        "category_id": cat, "start_month": "2026-09", "amount_cents": 1000,
        "every_n_months": 2, "end_mode": "year",
    })
    assert r.json()["months"] == ["2026-09", "2026-11"]


async def test_recurring_until(client: AsyncClient, seed_data: dict):
    cat = seed_data["cat_courses"].id
    r = await client.post("/api/planned-expenses/recurring", json={
        "category_id": cat, "start_month": "2026-10", "amount_cents": 1000,
        "every_n_months": 1, "end_mode": "until", "end_month": "2027-01",
    })
    assert r.json()["months"] == ["2026-10", "2026-11", "2026-12", "2027-01"]


async def test_confirm_and_delete(client: AsyncClient, seed_data: dict):
    cat = seed_data["cat_courses"].id
    p = (await client.post("/api/planned-expenses", json={"category_id": cat, "month": "2026-09", "amount_cents": 15000})).json()

    r = await client.patch(f"/api/planned-expenses/{p['id']}", json={"matched": True})
    assert r.status_code == 200 and r.json()["matched"] is True
    assert _cell(await _bf(client), cat, "2026-09")["planned_matched"] is True

    assert (await client.delete(f"/api/planned-expenses/{p['id']}")).status_code == 204
    assert _cell(await _bf(client), cat, "2026-09")["planned_cents"] == 0
