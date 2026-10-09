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


# ── Deleting a closed account for good ──────────────────────────────────────
async def _closed_account_with_data(db_session, seed_data):
    """A closed account holding one of everything, plus what merely points at
    it from elsewhere: a goal, the other half of a transfer, a shared category."""
    from datetime import date
    from models import (Account, AccountBalanceSnapshot, AccountType, BudgetEntry, Category, CategoryRule, Goal,
                        Holding, ImportBatch, PlannedExpense, Setting, Transaction)
    pid = seed_data["profile"].id
    acc = Account(profile_id=pid, name="Ancien compte", bank_name="B", account_type=AccountType.courant,
                  currency="EUR", is_active=False)
    db_session.add(acc)
    await db_session.commit()
    await db_session.refresh(acc)

    own_cat = Category(profile_id=pid, name="Propre au compte", color="#000", account_id=acc.id)
    shared_cat = Category(profile_id=pid, name="Encore utilisée", color="#000", account_id=acc.id)
    batch = ImportBatch(profile_id=pid, account_id=acc.id, filename="old.csv", transaction_count=2)
    db_session.add_all([own_cat, shared_cat, batch])
    await db_session.commit()
    for obj in (own_cat, shared_cat, batch):
        await db_session.refresh(obj)

    kept = seed_data["account_courant"]
    inside = Transaction(profile_id=pid, account_id=acc.id, date=date(2026, 3, 1), description="DANS LE COMPTE",
                         amount_cents=1000, is_debit=True, import_hash="del_inside", category_id=own_cat.id,
                         import_batch_id=batch.id)
    out_leg = Transaction(profile_id=pid, account_id=acc.id, date=date(2026, 3, 2), description="VIREMENT SORTANT",
                          amount_cents=5000, is_debit=True, import_hash="del_out", is_internal_transfer=True)
    in_leg = Transaction(profile_id=pid, account_id=kept.id, date=date(2026, 3, 2), description="VIREMENT ENTRANT",
                         amount_cents=5000, is_debit=False, import_hash="del_in", is_internal_transfer=True)
    elsewhere = Transaction(profile_id=pid, account_id=kept.id, date=date(2026, 3, 3), description="AILLEURS",
                            amount_cents=700, is_debit=True, import_hash="del_elsewhere", category_id=shared_cat.id)
    db_session.add_all([inside, out_leg, in_leg, elsewhere])
    await db_session.commit()
    for t in (out_leg, in_leg):
        await db_session.refresh(t)
    out_leg.transfer_pair_id, in_leg.transfer_pair_id = in_leg.id, out_leg.id

    goal = Goal(profile_id=pid, name="Vacances", target_amount_cents=100000, linked_account_id=acc.id)
    db_session.add_all([
        goal,
        AccountBalanceSnapshot(profile_id=pid, account_id=acc.id, date=date(2026, 3, 1), amount_cents=12345),
        Holding(profile_id=pid, account_id=acc.id, ticker="CASH.EUR", name="Liquidités", quantity=1, cost_basis_cents=100),
        BudgetEntry(profile_id=pid, category_id=own_cat.id, month="2026-03", expected_amount_cents=500, account_id=acc.id),
        PlannedExpense(profile_id=pid, category_id=own_cat.id, month="2026-04", amount_cents=900, account_id=acc.id),
        CategoryRule(profile_id=pid, category_id=own_cat.id, account_id=acc.id, is_active=True, logic_operator="AND",
                     conditions=[{"field": "description", "operator": "contains", "value": "dans"}]),
        Setting(profile_id=pid, key="ibkr_account_id", value=str(acc.id)),
    ])
    await db_session.commit()
    return {"account": acc, "own_cat": own_cat, "shared_cat": shared_cat, "in_leg": in_leg, "elsewhere": elsewhere, "goal": goal}


@pytest.mark.asyncio
async def test_deletion_summary_counts_what_would_go(client, db_session, seed_data):
    data = await _closed_account_with_data(db_session, seed_data)
    res = await client.get(f"/api/accounts/{data['account'].id}/deletion-summary",
                           headers={"X-Profile-Id": str(seed_data["profile"].id)})
    assert res.status_code == 200, res.text
    assert res.json() == {"name": "Ancien compte", "is_active": False, "transactions": 2, "snapshots": 1,
                          "holdings": 1, "imports": 1, "rules": 1, "budget_entries": 2}


@pytest.mark.asyncio
async def test_permanent_delete_removes_the_account_and_everything_in_it(client, db_session, seed_data):
    from sqlalchemy import select, func
    from models import (Account, AccountBalanceSnapshot, BudgetEntry, Category, CategoryRule, Goal, Holding,
                        ImportBatch, PlannedExpense, Setting, Transaction)
    data = await _closed_account_with_data(db_session, seed_data)
    aid, pid = data["account"].id, seed_data["profile"].id
    # Ids read now: the objects are expired below to re-read what the API wrote.
    in_leg_id, goal_id, elsewhere_id = data["in_leg"].id, data["goal"].id, data["elsewhere"].id

    res = await client.delete(f"/api/accounts/{aid}", params={"permanent": "true"}, headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 204, res.text
    db_session.expire_all()

    assert (await db_session.execute(select(Account).where(Account.id == aid))).scalar_one_or_none() is None
    for model in (Transaction, AccountBalanceSnapshot, Holding, ImportBatch, CategoryRule, BudgetEntry, PlannedExpense):
        left = (await db_session.execute(select(func.count(model.id)).where(model.account_id == aid))).scalar()
        assert left == 0, model.__name__

    # What only pointed at the account is detached, not deleted.
    in_leg = (await db_session.execute(select(Transaction).where(Transaction.id == in_leg_id))).scalar_one()
    assert in_leg.transfer_pair_id is None and in_leg.is_internal_transfer is True
    goal = (await db_session.execute(select(Goal).where(Goal.id == goal_id))).scalar_one()
    assert goal.linked_account_id is None

    # A category that existed only for the account is gone; one still used elsewhere becomes global.
    cats = {c.name: c for c in (await db_session.execute(select(Category).where(Category.profile_id == pid))).scalars()}
    assert "Propre au compte" not in cats
    assert cats["Encore utilisée"].account_id is None
    elsewhere = (await db_session.execute(select(Transaction).where(Transaction.id == elsewhere_id))).scalar_one()
    assert elsewhere.category_id == cats["Encore utilisée"].id

    # The IBKR sync no longer targets it; the other accounts are untouched.
    assert (await db_session.execute(select(Setting).where(Setting.key == "ibkr_account_id"))).scalar_one_or_none() is None
    assert (await client.get("/api/accounts", headers={"X-Profile-Id": str(pid)})).status_code == 200
    assert (await db_session.execute(select(func.count(Account.id)).where(Account.profile_id == pid))).scalar() == 2


@pytest.mark.asyncio
async def test_permanent_delete_is_refused_on_an_open_account(client, db_session, seed_data):
    """Two steps on purpose: close, then delete."""
    from sqlalchemy import select
    from models import Account
    aid = seed_data["account_courant"].id
    res = await client.delete(f"/api/accounts/{aid}", params={"permanent": "true"},
                              headers={"X-Profile-Id": str(seed_data["profile"].id)})
    assert res.status_code == 400
    assert "Clôturez" in res.json()["detail"]
    db_session.expire_all()
    still = (await db_session.execute(select(Account).where(Account.id == aid))).scalar_one()
    assert still.is_active is True


@pytest.mark.asyncio
async def test_plain_delete_still_only_closes(client, db_session, seed_data):
    from sqlalchemy import select
    from models import Account
    aid = seed_data["account_courant"].id
    res = await client.delete(f"/api/accounts/{aid}", headers={"X-Profile-Id": str(seed_data["profile"].id)})
    assert res.status_code == 204
    db_session.expire_all()
    assert (await db_session.execute(select(Account).where(Account.id == aid))).scalar_one().is_active is False


@pytest.mark.asyncio
async def test_permanent_delete_is_profile_scoped(client, db_session, seed_data, extra_profile):
    from sqlalchemy import select
    from models import Account
    data = await _closed_account_with_data(db_session, seed_data)
    h = {"X-Profile-Id": str(extra_profile.id)}
    aid = data["account"].id
    assert (await client.delete(f"/api/accounts/{aid}", params={"permanent": "true"}, headers=h)).status_code == 404
    assert (await client.get(f"/api/accounts/{aid}/deletion-summary", headers=h)).status_code == 404
    db_session.expire_all()
    assert (await db_session.execute(select(Account).where(Account.id == aid))).scalar_one_or_none() is not None

