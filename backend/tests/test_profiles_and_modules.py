import pytest
from models import Profile


@pytest.mark.asyncio
async def test_list_profiles(client, seed_data):
    res = await client.get("/api/profiles")
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert data[0]["name"] == "Test Profile"
    assert "enabled_modules" in data[0]
    assert "investments" in data[0]["enabled_modules"]


@pytest.mark.asyncio
async def test_create_profile_with_modules(client):
    body = {
        "name": "Friend Budget Profile",
        "color": "#10b981",
        "enabled_modules": ["banking", "budgeting"]
    }
    res = await client.post("/api/profiles", json=body)
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Friend Budget Profile"
    assert data["enabled_modules"] == ["banking", "budgeting"]


@pytest.mark.asyncio
async def test_update_profile_modules(client, seed_data):
    pid = seed_data["profile"].id
    # Disable investments module
    update_body = {"enabled_modules": ["banking"]}
    res = await client.put(f"/api/profiles/{pid}", json=update_body)
    assert res.status_code == 200
    data = res.json()
    assert data["enabled_modules"] == ["banking"]

    # Re-enable all modules
    reset_body = {"enabled_modules": ["banking", "budgeting", "investments"]}
    res_reset = await client.put(f"/api/profiles/{pid}", json=reset_body)
    assert res_reset.status_code == 200
    assert res_reset.json()["enabled_modules"] == ["banking", "budgeting", "investments"]


@pytest.mark.asyncio
async def test_base_currency_setting_is_validated(client, seed_data):
    """A typo'd base currency silently breaks every FX conversion in the app, so
    it must be rejected rather than stored."""
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    bad = await client.put("/api/settings/base_currency", json={"value": "EURO"}, headers=h)
    assert bad.status_code == 400

    ok = await client.put("/api/settings/base_currency", json={"value": "chf"}, headers=h)
    assert ok.status_code == 200 and ok.json()["value"] == "CHF"  # normalised

    # Non-currency settings are still free-form.
    other = await client.put("/api/settings/some_flag", json={"value": "anything"}, headers=h)
    assert other.status_code == 200
