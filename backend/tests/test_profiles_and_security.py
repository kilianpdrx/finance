import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from models import Profile, Transaction, Account

pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture
async def extra_profile(db_session: AsyncSession):
    p = Profile(name="Secondary Profile", color="#ff0000", is_default=False, enabled_modules=["transactions"])
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p

async def test_list_profiles(client: AsyncClient, seed_data: dict, extra_profile: Profile):
    res = await client.get("/api/profiles")
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 2
    # Ensure default is first
    assert data[0]["is_default"] is True

async def test_create_profile(client: AsyncClient):
    res = await client.post(
        "/api/profiles",
        json={"name": "New Profile", "color": "#00ff00", "enabled_modules": ["transactions", "investments"]}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "New Profile"
    assert data["is_default"] is False
    assert "investments" in data["enabled_modules"]

async def test_update_profile(client: AsyncClient, extra_profile: Profile):
    res = await client.put(
        f"/api/profiles/{extra_profile.id}",
        json={"name": "Updated Profile Name", "enabled_modules": ["transactions"]}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Updated Profile Name"
    assert "investments" not in data["enabled_modules"]

async def test_delete_profile_cascade(client: AsyncClient, seed_data: dict, db_session: AsyncSession, extra_profile: Profile):
    # Add a transaction for this profile
    acc = Account(profile_id=extra_profile.id, name="Temp Acc", bank_name="Bank")
    db_session.add(acc)
    await db_session.commit()
    await db_session.refresh(acc)
    
    from datetime import date
    txn = Transaction(profile_id=extra_profile.id, account_id=acc.id, date=date(2026, 7, 23), description="Test", amount_cents=1000, is_debit=True, import_hash="test_hash")
    db_session.add(txn)
    await db_session.commit()
    
    # Delete the profile
    res = await client.delete(f"/api/profiles/{extra_profile.id}")
    assert res.status_code == 204
    
    # Ensure it's deleted
    res2 = await client.get("/api/profiles")
    assert all(p["id"] != extra_profile.id for p in res2.json())
    
    # Ensure cascade worked
    from sqlalchemy import select
    accs = (await db_session.execute(select(Account).where(Account.profile_id == extra_profile.id))).scalars().all()
    assert len(accs) == 0
    txns = (await db_session.execute(select(Transaction).where(Transaction.profile_id == extra_profile.id))).scalars().all()
    assert len(txns) == 0

async def test_delete_profile_with_goal_and_loan(
    client: AsyncClient, seed_data: dict, db_session: AsyncSession, extra_profile: Profile
):
    """A profile that owns a goal and a loan account (loan_details has no
    profile_id and both carry FKs to accounts) must delete cleanly."""
    from models import Goal, LoanDetails, AccountType

    acc = Account(profile_id=extra_profile.id, name="Prêt Immo", bank_name="Bank",
                  account_type=AccountType.emprunt)
    db_session.add(acc)
    await db_session.commit()
    await db_session.refresh(acc)

    db_session.add(LoanDetails(account_id=acc.id, interest_rate_pct=1.5,
                               monthly_payment_cents=120000, term_months=240))
    db_session.add(Goal(profile_id=extra_profile.id, name="Apport",
                        target_amount_cents=1000000, linked_account_id=acc.id))
    await db_session.commit()

    res = await client.delete(f"/api/profiles/{extra_profile.id}")
    assert res.status_code == 204

    from sqlalchemy import select, text
    goals = (await db_session.execute(select(Goal).where(Goal.profile_id == extra_profile.id))).scalars().all()
    assert len(goals) == 0
    loans = (await db_session.execute(
        text("SELECT * FROM loan_details WHERE account_id = :a"), {"a": acc.id}
    )).all()
    assert len(loans) == 0


async def test_delete_default_profile_fails(client: AsyncClient, seed_data: dict):
    profile = seed_data["profile"]
    res = await client.delete(f"/api/profiles/{profile.id}")
    assert res.status_code == 400
    assert "par défaut" in res.json()["detail"]

async def test_header_resolution(client: AsyncClient, seed_data: dict, extra_profile: Profile):
    # Test that requests are scoped by header
    acc = seed_data["account_courant"]
    # Request to get accounts with extra_profile ID
    res = await client.get("/api/accounts", headers={"X-Profile-Id": str(extra_profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 0  # extra profile has no accounts!
    
    # Request with default profile
    res2 = await client.get("/api/accounts", headers={"X-Profile-Id": str(seed_data["profile"].id)})
    assert res2.status_code == 200
    assert len(res2.json()) >= 2
