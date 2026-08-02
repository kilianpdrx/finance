import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from models import Holding, PriceCache, IsinTicker

pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture
async def investments_data(db_session: AsyncSession, seed_data: dict):
    profile = seed_data["profile"]
    acc_inv = seed_data["account_inv"]
    
    h1 = Holding(
        profile_id=profile.id,
        account_id=acc_inv.id,
        ticker="AAPL",
        isin="US0378331005",
        name="Apple Inc",
        quantity=10,
        cost_basis_cents=150000, # 1500 EUR or USD
        currency="USD",
        asset_type="stock"
    )
    
    # Add a cached price so enrichment doesn't fail/hang
    from datetime import datetime
    p1 = PriceCache(
        ticker="AAPL",
        price_cents=16000, # 160 USD
        currency="USD",
        fetched_at=datetime.utcnow()
    )
    
    # ISIN map
    i1 = IsinTicker(
        isin="US0378331005",
        ticker="AAPL",
        name="Apple Inc",
        currency="USD",
        source="manual"
    )
    
    db_session.add_all([h1, p1, i1])
    await db_session.commit()
    await db_session.refresh(h1)
    
    return {"h1": h1}

async def test_list_holdings(client: AsyncClient, seed_data: dict, investments_data: dict):
    profile = seed_data["profile"]
    acc_inv = seed_data["account_inv"]
    
    res = await client.get(f"/api/investments/accounts/{acc_inv.id}/holdings", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["ticker"] == "AAPL"
    # Should be enriched with cached price
    assert data[0]["current_price_cents"] == 16000
    assert data[0]["gain_cents"] is not None

async def test_create_holding(client: AsyncClient, seed_data: dict):
    profile = seed_data["profile"]
    acc_inv = seed_data["account_inv"]
    
    res = await client.post(
        f"/api/investments/accounts/{acc_inv.id}/holdings",
        headers={"X-Profile-Id": str(profile.id)},
        json={
            "ticker": "MSFT",
            "name": "Microsoft",
            "quantity": 5,
            "cost_basis_cents": 120000,
            "currency": "USD",
            "asset_type": "stock"
        }
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ticker"] == "MSFT"

async def test_update_holding(client: AsyncClient, seed_data: dict, investments_data: dict):
    profile = seed_data["profile"]
    h1 = investments_data["h1"]
    
    res = await client.put(
        f"/api/investments/holdings/{h1.id}",
        headers={"X-Profile-Id": str(profile.id)},
        json={"quantity": 12}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["quantity"] == 12

async def test_delete_holding(client: AsyncClient, seed_data: dict, investments_data: dict):
    profile = seed_data["profile"]
    h1 = investments_data["h1"]
    
    res = await client.delete(f"/api/investments/holdings/{h1.id}", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    
    # Verify it is deleted
    acc_inv = seed_data["account_inv"]
    res2 = await client.get(f"/api/investments/accounts/{acc_inv.id}/holdings", headers={"X-Profile-Id": str(profile.id)})
    assert len(res2.json()) == 0

async def test_get_benchmarks(client: AsyncClient, seed_data: dict, investments_data: dict):
    profile = seed_data["profile"]
    acc_inv = seed_data["account_inv"]
    
    # 1. Test benchmark list
    res = await client.get("/api/investments/benchmarks", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    assert any(b["key"] == "cac40" for b in data)
    
    # 2. Test account performance history (returns 200 but might be empty if yahoo doesn't return data in tests)
    res2 = await client.get(f"/api/investments/accounts/{acc_inv.id}/performance?period=1mo", headers={"X-Profile-Id": str(profile.id)})
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["account_id"] == acc_inv.id


async def test_dividend_yield_is_sane(db_session: AsyncSession, seed_data: dict):
    """Regression: dividend_yield must be a realistic percentage, not the old
    ×100-inflated value. Derived from income/value when a per-share rate exists,
    otherwise the stale cached yield_pct is de-inflated."""
    from datetime import datetime
    from models import DividendCache
    from routers.investments import enrich_holdings_batch

    profile = seed_data["profile"]
    acc = seed_data["account_inv"]  # EUR — avoids FX

    # (a) A stock with a per-share rate: yield derived from income / value.
    h_stock = Holding(profile_id=profile.id, account_id=acc.id, ticker="DIVSTK", name="Div Stock",
                      quantity=10, cost_basis_cents=100000, currency="EUR", asset_type="stock")
    # (b) An ETF with only a (miscaled) cached yield and no rate: sanitized fallback.
    h_etf = Holding(profile_id=profile.id, account_id=acc.id, ticker="DIVETF", name="Div ETF",
                    quantity=5, cost_basis_cents=50000, currency="EUR", asset_type="etf")
    db_session.add_all([
        h_stock, h_etf,
        PriceCache(ticker="DIVSTK", price_cents=20000, currency="EUR", fetched_at=datetime.utcnow()),
        PriceCache(ticker="DIVETF", price_cents=40000, currency="EUR", fetched_at=datetime.utcnow()),
        DividendCache(ticker="DIVSTK", annual_rate=4.0, yield_pct=200.0, currency="EUR"),  # 200 = miscaled
        DividendCache(ticker="DIVETF", annual_rate=None, yield_pct=274.0, currency="EUR"),  # ETF, no rate
    ])
    await db_session.commit()

    enr = {e["ticker"]: e for e in await enrich_holdings_batch(db_session, [h_stock, h_etf], "EUR")}
    # income 4.0*10=40€ over value 10*200=2000€ -> 2.0%
    assert enr["DIVSTK"]["dividend_yield"] == 2.0
    # fallback: 274 is implausible -> de-inflated to 2.74
    assert enr["DIVETF"]["dividend_yield"] == 2.74
