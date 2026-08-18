"""Profile isolation on WRITES.

Reads are scoped by profile_id everywhere, but an endpoint that *accepts* a
foreign key must also verify the referenced row is ours. Without that a stale
X-Profile-Id or a UI bug silently attaches data to another profile, where reads
then filter it out and it looks like the data vanished.
"""
import pytest
from datetime import date

from models import Account, AccountType, Category, Transaction


@pytest.fixture
async def foreign(db_session, extra_profile):
    """An account and a category owned by the OTHER profile."""
    acc = Account(profile_id=extra_profile.id, name="Foreign", bank_name="B",
                  account_type=AccountType.courant, currency="EUR")
    cat = Category(profile_id=extra_profile.id, name="ForeignCat", color="#000")
    db_session.add_all([acc, cat])
    await db_session.commit()
    await db_session.refresh(acc)
    await db_session.refresh(cat)
    return {"account": acc, "category": cat}


@pytest.mark.asyncio
async def test_cannot_create_transaction_in_foreign_account(client, seed_data, foreign):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    r = await client.post("/api/transactions", headers=h, json={
        "account_id": foreign["account"].id, "date": "2026-01-01",
        "description": "probe", "amount_cents": 100, "is_debit": True})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cannot_move_transaction_to_foreign_account_or_category(client, seed_data, foreign):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    own = await client.post("/api/transactions", headers=h, json={
        "account_id": seed_data["account_courant"].id, "date": "2026-01-02",
        "description": "own", "amount_cents": 100, "is_debit": True})
    tid = own.json()["id"]

    assert (await client.put(f"/api/transactions/{tid}", headers=h,
                             json={"category_id": foreign["category"].id})).status_code == 404
    assert (await client.put(f"/api/transactions/{tid}", headers=h,
                             json={"account_id": foreign["account"].id})).status_code == 404
    assert (await client.post("/api/transactions/bulk-update-category", headers=h,
                              json={"ids": [tid], "category_id": foreign["category"].id})).status_code == 404


@pytest.mark.asyncio
async def test_cannot_budget_or_rule_on_foreign_category(client, seed_data, foreign):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    assert (await client.put("/api/analytics/budget", headers=h, params={
        "category_id": foreign["category"].id, "month": "2026-03",
        "expected_amount_cents": 5000})).status_code == 404
    assert (await client.post(f"/api/categories/{foreign['category'].id}/rules", headers=h, json={
        "conditions": [{"field": "description", "operator": "contains", "value": "x"}],
        "category_id": foreign["category"].id, "priority": 100,
        "is_active": True, "logic_operator": "AND"})).status_code == 404


@pytest.mark.asyncio
async def test_goal_cannot_be_relinked_to_foreign_account(client, db_session, seed_data, extra_profile, foreign):
    """The worst case: it used to succeed AND then display the other profile's balance."""
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    db_session.add(Transaction(profile_id=extra_profile.id, account_id=foreign["account"].id,
                               date=date(2026, 1, 1), description="SECRET", amount_cents=1234500,
                               is_debit=False, import_hash="xprofile_goal"))
    await db_session.commit()

    g = await client.post("/api/goals", headers=h,
                          json={"name": "Test", "target_amount_cents": 100000})
    gid = g.json()["id"]
    r = await client.put(f"/api/goals/{gid}", headers=h,
                         json={"linked_account_id": foreign["account"].id})
    assert r.status_code == 404
