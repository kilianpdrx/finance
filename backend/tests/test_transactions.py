import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date
from models import Transaction

pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture
async def transactions_data(db_session: AsyncSession, seed_data: dict):
    profile = seed_data["profile"]
    acc = seed_data["account_courant"]
    cat1 = seed_data["cat_courses"]
    cat2 = seed_data["cat_salaire"]
    
    t1 = Transaction(
        profile_id=profile.id,
        account_id=acc.id,
        date=date(2026, 7, 10),
        amount_cents=10000,
        is_debit=True,
        category_id=cat1.id,
        description="Supermarket A",
        import_hash="tx_hash_1"
    )
    t2 = Transaction(
        profile_id=profile.id,
        account_id=acc.id,
        date=date(2026, 7, 12),
        amount_cents=5000,
        is_debit=True,
        category_id=None,
        description="Unknown Store",
        import_hash="tx_hash_2"
    )
    t3 = Transaction(
        profile_id=profile.id,
        account_id=acc.id,
        date=date(2026, 7, 15),
        amount_cents=200000,
        is_debit=False,
        category_id=cat2.id,
        description="Salary July",
        import_hash="tx_hash_3"
    )
    db_session.add_all([t1, t2, t3])
    await db_session.commit()
    await db_session.refresh(t1)
    await db_session.refresh(t2)
    await db_session.refresh(t3)
    return {"t1": t1, "t2": t2, "t3": t3}

async def test_list_transactions_no_filters(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    res = await client.get("/api/transactions", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3

async def test_list_transactions_filters(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    # Filter by category
    cat_id = seed_data["cat_courses"].id
    res = await client.get(f"/api/transactions?category_id={cat_id}", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    
    # Filter uncategorized
    res = await client.get("/api/transactions?uncategorized=true", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["description"] == "Unknown Store"
    
    # Filter search
    res = await client.get("/api/transactions?search=Supermarket", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    
    # Filter is_debit
    res = await client.get("/api/transactions?is_debit=false", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["amount_cents"] == 200000

async def test_transaction_stats(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    h = {"X-Profile-Id": str(profile.id)}
    # No filters: 3 total, 2 categorised (t1, t3), 1 uncategorised (t2), 0 transfers.
    res = await client.get("/api/transactions/stats", headers=h)
    assert res.status_code == 200
    d = res.json()
    assert d == {"total": 3, "categorized": 2, "uncategorized": 1, "transfers": 0}

    # Stats respect base filters (is_debit) but ignore the category toggles.
    res = await client.get("/api/transactions/stats", params={"is_debit": "true"}, headers=h)
    d = res.json()
    assert d["total"] == 2 and d["categorized"] == 1 and d["uncategorized"] == 1


async def test_transaction_ids_respects_filters(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    h = {"X-Profile-Id": str(profile.id)}
    res = await client.get("/api/transactions/ids", headers=h)
    assert res.status_code == 200
    ids = res.json()["ids"]
    assert set(ids) == {transactions_data[k].id for k in ("t1", "t2", "t3")}

    # Filtered ids (uncategorised) return just t2.
    res = await client.get("/api/transactions/ids", params={"uncategorized": "true"}, headers=h)
    assert res.json()["ids"] == [transactions_data["t2"].id]


async def test_bulk_delete_chunks_large_selection(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """A selection larger than SQLite's parameter cap must still delete (chunked)."""
    profile = seed_data["profile"]
    acc = seed_data["account_courant"]
    txns = [
        Transaction(profile_id=profile.id, account_id=acc.id, date=date(2026, 1, 1),
                    amount_cents=100, is_debit=True, description=f"bulk {i}", import_hash=f"bulk_{i}")
        for i in range(1500)
    ]
    db_session.add_all(txns)
    await db_session.commit()
    ids = [t.id for t in txns]

    res = await client.post("/api/transactions/bulk-delete", headers={"X-Profile-Id": str(profile.id)}, json={"ids": ids})
    assert res.status_code == 204
    remaining = (await client.get("/api/transactions/count", headers={"X-Profile-Id": str(profile.id)})).json()["total"]
    assert remaining == 0


async def test_bulk_delete_transactions(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t_id = transactions_data["t1"].id
    
    res = await client.request(
        "POST", "/api/transactions/bulk-delete",
        headers={"X-Profile-Id": str(profile.id)},
        json={"ids": [t_id]}
    )
    assert res.status_code == 204
    
    res2 = await client.get("/api/transactions", headers={"X-Profile-Id": str(profile.id)})
    assert len(res2.json()) == 2

async def test_bulk_update_category(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t2_id = transactions_data["t2"].id
    cat_salaire = seed_data["cat_salaire"]
    
    res = await client.post(
        "/api/transactions/bulk-update-category",
        headers={"X-Profile-Id": str(profile.id)},
        json={"ids": [t2_id], "category_id": cat_salaire.id}
    )
    assert res.status_code == 200
    
    res2 = await client.get(f"/api/transactions?category_id={cat_salaire.id}", headers={"X-Profile-Id": str(profile.id)})
    data = res2.json()
    assert len(data) == 2


async def test_editing_core_field_sets_manually_edited(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t1_id = transactions_data["t1"].id
    h = {"X-Profile-Id": str(profile.id)}

    res = await client.put(f"/api/transactions/{t1_id}", headers=h, json={"description": "Supermarket A (corrected)"})
    assert res.status_code == 200
    assert res.json()["is_manually_edited"] is True


async def test_recategorizing_does_not_set_manually_edited(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t1_id = transactions_data["t1"].id
    cat_salaire = seed_data["cat_salaire"]
    h = {"X-Profile-Id": str(profile.id)}

    # Changing only the category (the everyday inline action) must NOT flag it.
    res = await client.put(f"/api/transactions/{t1_id}", headers=h, json={"category_id": cat_salaire.id})
    assert res.status_code == 200
    assert res.json()["is_manually_edited"] is False


async def test_editing_date_amount_persists(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t2_id = transactions_data["t2"].id
    h = {"X-Profile-Id": str(profile.id)}

    res = await client.put(f"/api/transactions/{t2_id}", headers=h,
                           json={"date": "2026-07-20", "amount_cents": 7777, "is_debit": False})
    assert res.status_code == 200
    body = res.json()
    assert body["date"] == "2026-07-20"
    assert body["amount_cents"] == 7777
    assert body["is_debit"] is False
    assert body["is_manually_edited"] is True


async def test_count_and_categorized_filter(client: AsyncClient, seed_data: dict, transactions_data: dict):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    # transactions_data seeds 3 txns: t1 (cat_courses), t2 (None), t3 (see fixture).
    total = (await client.get("/api/transactions/count", headers=h)).json()["total"]
    assert total >= 3

    uncat = (await client.get("/api/transactions/count?uncategorized=true", headers=h)).json()["total"]
    cat = (await client.get("/api/transactions/count?categorized=true", headers=h)).json()["total"]
    assert uncat >= 1 and cat >= 1
    assert uncat + cat == total

    # The categorized list excludes uncategorized rows.
    rows = (await client.get("/api/transactions?categorized=true", headers=h)).json()
    assert all(r["category_id"] is not None for r in rows)
    assert len(rows) == cat
