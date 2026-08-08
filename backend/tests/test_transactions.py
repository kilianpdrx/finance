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
