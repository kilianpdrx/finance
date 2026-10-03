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



@pytest.mark.asyncio
async def test_closed_account_hidden_by_default_but_listable(client, seed_data):
    """Deactivating an account retires it from the default list, but it must stay
    reachable via include_inactive so its history remains attributable."""
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    acc_id = seed_data["account_courant"].id

    assert (await client.delete(f"/api/accounts/{acc_id}", headers=h)).status_code == 204

    default = (await client.get("/api/accounts", headers=h)).json()
    assert acc_id not in [a["id"] for a in default]

    everything = (await client.get("/api/accounts", params={"include_inactive": True}, headers=h)).json()
    closed = next(a for a in everything if a["id"] == acc_id)
    assert closed["is_active"] is False


@pytest.mark.asyncio
async def test_closed_account_can_be_reactivated(client, seed_data):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    acc_id = seed_data["account_courant"].id
    await client.delete(f"/api/accounts/{acc_id}", headers=h)

    res = await client.put(f"/api/accounts/{acc_id}", json={"is_active": True}, headers=h)
    assert res.status_code == 200 and res.json()["is_active"] is True
    assert acc_id in [a["id"] for a in (await client.get("/api/accounts", headers=h)).json()]


@pytest.mark.asyncio
async def test_computed_balance_rejects_other_profiles_account(client, seed_data, extra_profile):
    """Must 404 rather than silently returning 0 for an account you don't own."""
    acc_id = seed_data["account_courant"].id
    res = await client.get(
        f"/api/accounts/{acc_id}/computed-balance",
        headers={"X-Profile-Id": str(extra_profile.id)},
    )
    assert res.status_code == 404


# ── Base currency: decided by the first account, never by a hardcoded default ──
async def _blank_profile(db_session):
    """A profile with no account and no stored base currency (a fresh install)."""
    from models import Profile
    p = Profile(name="Nouveau", color="#6366f1", is_default=False, enabled_modules=["banking"])
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


def _account(name: str, currency: str) -> dict:
    return {"name": name, "bank_name": "Banque", "account_type": "courant", "currency": currency}


@pytest.mark.asyncio
async def test_first_account_sets_the_base_currency(client, db_session):
    h = {"X-Profile-Id": str((await _blank_profile(db_session)).id)}

    # Nothing stored yet: the API still answers with a currency, not a 404.
    assert (await client.get("/api/settings", headers=h)).json()["base_currency"] == "EUR"

    assert (await client.post("/api/accounts", json=_account("Courant", "USD"), headers=h)).status_code == 201
    assert (await client.get("/api/settings", headers=h)).json()["base_currency"] == "USD"
    assert (await client.get("/api/settings/base_currency", headers=h)).json()["value"] == "USD"

    # A later account in another currency does not move it.
    await client.post("/api/accounts", json=_account("Épargne", "CHF"), headers=h)
    assert (await client.get("/api/settings", headers=h)).json()["base_currency"] == "USD"
    assert (await client.get("/api/analytics/summary", headers=h)).json()["base_currency"] == "USD"


@pytest.mark.asyncio
async def test_creating_an_account_never_overwrites_a_chosen_base_currency(client, seed_data):
    """seed_data stores EUR explicitly; a new CHF account must leave it alone."""
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    await client.post("/api/accounts", json=_account("Compte suisse", "CHF"), headers=h)
    assert (await client.get("/api/settings", headers=h)).json()["base_currency"] == "EUR"


@pytest.mark.asyncio
async def test_profile_with_accounts_but_no_setting_reports_in_its_first_account_currency(client, db_session):
    """A profile created before the setting was written must not fall back to an
    arbitrary default while it has accounts that say otherwise."""
    from models import Account, AccountType
    p = await _blank_profile(db_session)
    db_session.add(Account(profile_id=p.id, name="Ancien", bank_name="B",
                           account_type=AccountType.courant, currency="GBP"))
    await db_session.commit()

    h = {"X-Profile-Id": str(p.id)}
    assert (await client.get("/api/settings", headers=h)).json()["base_currency"] == "GBP"

