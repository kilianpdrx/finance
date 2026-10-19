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


# ── « Tous »: each entry against its own account ────────────────────────────

async def _two_accounts(db_session, seed_data: dict):
    from models import Account, AccountType
    other = Account(profile_id=seed_data["profile"].id, name="Compte joint", bank_name="Banque",
                    account_type=AccountType.courant, currency="EUR")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)
    return seed_data["account_courant"].id, other.id


async def _spend(db_session, seed_data: dict, account_id: int, day: str, cents: int, tag: str):
    from datetime import date
    from models import Transaction
    db_session.add(Transaction(profile_id=seed_data["profile"].id, account_id=account_id, date=date.fromisoformat(day),
                               description=f"ACHAT {tag}", amount_cents=cents, currency="EUR", is_debit=True,
                               category_id=seed_data["cat_courses"].id, import_hash=f"planned_{tag}"))
    await db_session.commit()


async def _table(client: AsyncClient, **params):
    return (await client.get("/api/analytics/budget-full", params={"year": 2026, **params})).json()


async def _plan(client: AsyncClient, cat: int, month: str, cents: int, account_id=None):
    r = await client.post("/api/planned-expenses", json={"category_id": cat, "month": month, "amount_cents": cents, "account_id": account_id})
    assert r.status_code == 201
    return r.json()["id"]


async def test_another_accounts_purchase_does_not_offer_to_confirm(client: AsyncClient, seed_data: dict, db_session):
    """How a 310 CHF entry got hidden: « Tous » offered to confirm it against a
    13,50 subscription of ANOTHER account."""
    cat = seed_data["cat_courses"].id
    a, b = await _two_accounts(db_session, seed_data)
    planned_id = await _plan(client, cat, "2026-09", 31000, a)
    await _spend(db_session, seed_data, b, "2026-09-03", 1350, "b")

    tous = _cell(await _table(client, account_ids=f"{a},{b}"), cat, "2026-09")
    assert (tous["actual_cents"], tous["planned_state"], tous["planned_active_cents"]) == (1350, "planned", 31000)
    assert (tous["planned_count"], tous["planned_id"]) == (1, planned_id)

    own = _cell(await _table(client, account_id=a), cat, "2026-09")
    assert (own["actual_cents"], own["planned_state"], own["planned_active_cents"]) == (0, "planned", 31000)
    elsewhere = _cell(await _table(client, account_id=b), cat, "2026-09")
    assert (elsewhere["planned_count"], elsewhere["planned_state"]) == (0, "none")


async def test_its_own_accounts_purchase_asks_or_settles(client: AsyncClient, seed_data: dict, db_session):
    cat = seed_data["cat_courses"].id
    a, b = await _two_accounts(db_session, seed_data)
    await _plan(client, cat, "2026-09", 31000, a)
    await _spend(db_session, seed_data, a, "2026-09-03", 29900, "other-amount")
    for params in ({"account_ids": f"{a},{b}"}, {"account_id": a}):
        cell = _cell(await _table(client, **params), cat, "2026-09")
        assert (cell["planned_state"], cell["planned_active_cents"]) == ("confirm", 0), params

    # The same amount settles it, with nothing to confirm.
    await _plan(client, cat, "2026-10", 5000, a)
    await _spend(db_session, seed_data, a, "2026-10-03", 5000, "same-amount")
    cell = _cell(await _table(client, account_ids=f"{a},{b}"), cat, "2026-10")
    assert (cell["planned_state"], cell["planned_active_cents"]) == ("none", 0)


async def test_every_entry_of_a_cell_counts(client: AsyncClient, seed_data: dict, db_session):
    """One per account plus one typed in « Tous »: the last one read used to hide the others."""
    cat = seed_data["cat_courses"].id
    a, b = await _two_accounts(db_session, seed_data)
    await _plan(client, cat, "2026-11", 10000, a)
    await _plan(client, cat, "2026-11", 20000, b)
    await _plan(client, cat, "2026-11", 5000)
    table = await _table(client, account_ids=f"{a},{b}")
    cell = _cell(table, cat, "2026-11")
    assert (cell["planned_count"], cell["planned_cents"], cell["planned_active_cents"]) == (3, 35000, 35000)
    assert cell["planned_id"] is None and cell["planned_state"] == "planned"   # several: acted on from each account
    totals = next(s for s in table["sections"] if s["section"] == "depenses_variables")["section_totals"]
    assert next(c for c in totals["cells"] if c["month"] == "2026-11")["expected_cents"] == 35000


async def test_an_entry_typed_in_tous_is_judged_on_every_account(client: AsyncClient, seed_data: dict, db_session):
    cat = seed_data["cat_courses"].id
    a, b = await _two_accounts(db_session, seed_data)
    await _plan(client, cat, "2026-08", 8000)
    await _spend(db_session, seed_data, b, "2026-08-12", 7500, "tous")
    cell = _cell(await _table(client, account_ids=f"{a},{b}"), cat, "2026-08")
    assert (cell["planned_state"], cell["planned_active_cents"]) == ("confirm", 0)


async def test_a_confirmed_entry_is_settled(client: AsyncClient, seed_data: dict, db_session):
    cat = seed_data["cat_courses"].id
    a, b = await _two_accounts(db_session, seed_data)
    planned_id = await _plan(client, cat, "2026-07", 12000, a)
    await client.patch(f"/api/planned-expenses/{planned_id}", json={"matched": True})
    for params in ({"account_ids": f"{a},{b}"}, {"account_id": a}):
        cell = _cell(await _table(client, **params), cat, "2026-07")
        assert (cell["planned_matched"], cell["planned_state"], cell["planned_active_cents"]) == (True, "none", 0), params
