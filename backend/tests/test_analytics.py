import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date, timedelta
from database import Base
from models import Transaction, AccountBalanceSnapshot, BudgetEntry

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def analytics_data(db_session: AsyncSession, seed_data: dict):
    profile = seed_data["profile"]
    acc_courant = seed_data["account_courant"]
    cat_courses = seed_data["cat_courses"]
    cat_salaire = seed_data["cat_salaire"]
    
    today = date.today()
    
    # Snapshot: balance 1000 EUR yesterday
    snap = AccountBalanceSnapshot(
        account_id=acc_courant.id,
        profile_id=profile.id,
        date=today - timedelta(days=1),
        amount_cents=100000,
    )
    db_session.add(snap)

    # Transactions today
    t1 = Transaction(
        profile_id=profile.id,
        account_id=acc_courant.id,
        date=today,
        amount_cents=200000, # 2000 EUR
        is_debit=False,
        category_id=cat_salaire.id,
        description="Salaire",
        import_hash="hash1",
    )
    t2 = Transaction(
        profile_id=profile.id,
        account_id=acc_courant.id,
        date=today,
        amount_cents=5000, # 50 EUR
        is_debit=True,
        category_id=cat_courses.id,
        description="Courses",
        import_hash="hash2",
    )
    t3 = Transaction(
        profile_id=profile.id,
        account_id=acc_courant.id,
        date=today,
        amount_cents=10000, # 100 EUR
        is_debit=True,
        is_internal_transfer=True,
        description="Transfer to saving",
        import_hash="hash3",
    )
    db_session.add_all([t1, t2, t3])
    
    # Budget entry for courses
    month_str = today.strftime("%Y-%m")
    b1 = BudgetEntry(
        profile_id=profile.id,
        category_id=cat_courses.id,
        month=month_str,
        expected_amount_cents=10000, # 100 EUR expected
    )
    db_session.add(b1)

    await db_session.commit()
    return {"today": today, "month_str": month_str, "cat_courses": cat_courses, "cat_salaire": cat_salaire}


async def test_analytics_summary(client: AsyncClient, seed_data: dict, analytics_data: dict):
    profile = seed_data["profile"]
    res = await client.get("/api/analytics/summary", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    
    # Income: 2000 EUR
    assert data["total_income_cents"] == 200000
    # Expenses: 50 EUR (transfer excluded)
    assert data["total_expenses_cents"] == 5000
    assert data["net_cash_flow_cents"] == 195000
    
    # Net worth: Snapshot 1000 + Income 2000 - Expense 50 - Transfer 100 (it is deducted from balance but excluded from expenses)
    # Wait, internal transfer is excluded from the net worth query `is_internal_transfer == False` ?
    # Let's check: 1000 + 2000 - 50 = 2950 ? Wait, internal transfers ARE excluded from net worth transaction sum in `summary` endpoint !
    # Ah, let's see. If excluded, then balance is 1000 + 2000 - 50 = 2950.
    assert data["net_worth_cents"] == 295000


async def test_analytics_by_category(client: AsyncClient, seed_data: dict, analytics_data: dict):
    profile = seed_data["profile"]
    res = await client.get("/api/analytics/by-category", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    
    # Only debit, non-internal
    assert len(data) == 1
    assert data[0]["category_id"] == seed_data["cat_courses"].id
    assert data[0]["total_cents"] == 5000


async def test_analytics_by_category_income(client: AsyncClient, seed_data: dict, analytics_data: dict):
    """income=true flips the breakdown to credits (Revenus)."""
    profile = seed_data["profile"]
    res = await client.get(
        "/api/analytics/by-category", params={"income": "true"},
        headers={"X-Profile-Id": str(profile.id)},
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["category_id"] == seed_data["cat_salaire"].id
    assert data[0]["total_cents"] == 200000


async def test_analytics_cash_flow(client: AsyncClient, seed_data: dict, analytics_data: dict):
    profile = seed_data["profile"]
    res = await client.get("/api/analytics/cash-flow", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    
    assert len(data) == 1
    assert data[0]["month"] == analytics_data["month_str"]
    assert data[0]["income_cents"] == 200000
    assert data[0]["expenses_cents"] == 5000


async def test_analytics_budget_full(client: AsyncClient, seed_data: dict, analytics_data: dict):
    profile = seed_data["profile"]
    res = await client.get("/api/analytics/budget-full", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    
    sections = data["sections"]
    assert len(sections) == 3 # revenus, fixes, variables
    
    revenus_sec = next(s for s in sections if s["section"] == "revenus")
    assert revenus_sec["section_totals"]["total_actual_cents"] == 200000
    
    var_sec = next(s for s in sections if s["section"] == "depenses_variables")
    assert var_sec["section_totals"]["total_actual_cents"] == 5000
    assert var_sec["section_totals"]["total_expected_cents"] == 10000 # The budget entry
