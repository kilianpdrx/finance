import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import BudgetEntry

pytestmark = pytest.mark.asyncio


async def test_upsert_does_not_crash_with_account_specific_entry(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """Regression: an existing per-account adjustment used to make the aggregate
    upsert 500. It must succeed and add a separate global (null-account) entry."""
    cat = seed_data["cat_salaire"].id
    acc = seed_data["account_courant"].id
    db_session.add(BudgetEntry(profile_id=seed_data["profile"].id, category_id=cat, month="2026-10",
                               expected_amount_cents=450000, account_id=acc))
    await db_session.commit()

    r = await client.put(f"/api/analytics/budget?category_id={cat}&month=2026-10&expected_amount_cents=4500")
    assert r.status_code == 200

    rows = (await db_session.execute(
        select(BudgetEntry).where(BudgetEntry.category_id == cat, BudgetEntry.month == "2026-10")
    )).scalars().all()
    # the account-specific one plus the new global one
    assert {r.account_id for r in rows} == {acc, None}


async def test_clear_from_aggregate_removes_account_specific(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """Clearing (0) from the aggregate view removes account-specific adjustments
    too, so an adjustment made in a per-account view can always be cleared."""
    cat = seed_data["cat_salaire"].id
    acc = seed_data["account_courant"].id
    db_session.add(BudgetEntry(profile_id=seed_data["profile"].id, category_id=cat, month="2026-10",
                               expected_amount_cents=450000, account_id=acc))
    await db_session.commit()

    r = await client.put(f"/api/analytics/budget?category_id={cat}&month=2026-10&expected_amount_cents=0")
    assert r.status_code == 200

    rows = (await db_session.execute(
        select(BudgetEntry).where(BudgetEntry.category_id == cat, BudgetEntry.month == "2026-10")
    )).scalars().all()
    assert rows == []
