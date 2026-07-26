import pytest


@pytest.mark.asyncio
async def test_list_accounts(client, seed_data):
    pid = seed_data["profile"].id
    res = await client.get("/api/accounts", headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 2
    names = [a["name"] for a in data]
    assert "Compte Courant Test" in names
    assert "PEA Test" in names


@pytest.mark.asyncio
async def test_create_account(client, seed_data):
    pid = seed_data["profile"].id
    body = {
        "name": "Livret A",
        "bank_name": "Caisse d'Épargne",
        "account_type": "épargne",
        "currency": "EUR"
    }
    res = await client.post("/api/accounts", json=body, headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Livret A"
    assert data["account_type"] == "épargne"


@pytest.mark.asyncio
async def test_account_balance_snapshot(client, seed_data):
    pid = seed_data["profile"].id
    acc_id = seed_data["account_courant"].id
    snapshot_body = {
        "date": "2026-07-01",
        "amount_cents": 150000,  # 1500,00 €
        "currency": "EUR",
        "notes": "Solde initial"
    }
    res = await client.post(
        f"/api/accounts/{acc_id}/snapshots",
        json=snapshot_body,
        headers={"X-Profile-Id": str(pid)}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["amount_cents"] == 150000

