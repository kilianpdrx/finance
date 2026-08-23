from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def test_manual_goal_contributions(client: AsyncClient, seed_data: dict):
    r = await client.post("/api/goals", json={
        "name": "Japon", "target_amount_cents": 500000, "initial_amount_cents": 100000,
    })
    assert r.status_code == 201
    g = r.json()
    assert g["is_linked"] is False
    assert g["current_amount_cents"] == 100000  # seeded as an initial contribution
    gid = g["id"]

    r = await client.post(f"/api/goals/{gid}/contributions", json={"date": "2026-07-01", "amount_cents": 50000})
    assert r.status_code == 201

    goals = (await client.get("/api/goals")).json()
    g2 = next(x for x in goals if x["id"] == gid)
    assert g2["current_amount_cents"] == 150000
    assert g2["progress_pct"] == 30.0

    contribs = (await client.get(f"/api/goals/{gid}/contributions")).json()
    assert len(contribs) == 2


async def test_linked_goal_follows_account_balance(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    from models import AccountBalanceSnapshot
    acc = seed_data["account_courant"]
    db_session.add(AccountBalanceSnapshot(
        account_id=acc.id, profile_id=seed_data["profile"].id,
        date=date(2026, 1, 1), amount_cents=250000, currency="EUR",
    ))
    await db_session.commit()

    r = await client.post("/api/goals", json={
        "name": "Fonds d'urgence", "target_amount_cents": 500000, "linked_account_id": acc.id,
    })
    assert r.status_code == 201
    g = r.json()
    assert g["is_linked"] is True
    assert g["current_amount_cents"] == 250000
    assert g["linked_account_name"] == acc.name

    # A linked goal is driven by the account — manual contributions are rejected.
    r = await client.post(f"/api/goals/{g['id']}/contributions", json={"date": "2026-07-01", "amount_cents": 1000})
    assert r.status_code == 400


async def test_goal_update_can_clear_deadline(client: AsyncClient, seed_data: dict):
    g = (await client.post("/api/goals", json={
        "name": "X", "target_amount_cents": 1000, "deadline": "2027-01-01",
    })).json()
    assert g["deadline"] == "2027-01-01"
    r = await client.put(f"/api/goals/{g['id']}", json={"deadline": None})
    assert r.status_code == 200
    assert r.json()["deadline"] is None


async def test_loan_amortization_and_extra_payment(client: AsyncClient, seed_data: dict):
    r = await client.post("/api/accounts", json={
        "name": "Prêt Immo", "bank_name": "Banque", "account_type": "emprunt", "currency": "EUR",
        "loan_details": {
            "principal_cents": 20000000, "interest_rate_pct": 1.5,
            "term_months": 240, "start_date": "2023-07-01",
        },
    })
    assert r.status_code == 201
    acc_id = r.json()["id"]

    loans = (await client.get("/api/loans")).json()
    assert len(loans) == 1
    loan = loans[0]
    assert loan["computable"] is True
    assert loan["monthly_payment_cents"] > 0
    assert 0 < loan["remaining_cents"] < 20000000
    assert loan["progress_pct"] > 0
    remaining_before = loan["remaining_cents"]
    term_before = loan["actual_term_months"]

    r = await client.post(f"/api/loans/{acc_id}/payments", json={"date": "2024-01-15", "amount_cents": 5000000})
    assert r.status_code == 201

    loan2 = (await client.get("/api/loans")).json()[0]
    assert loan2["extra_paid_cents"] >= 5000000
    assert loan2["remaining_cents"] < remaining_before
    assert loan2["actual_term_months"] < term_before  # paid off sooner

    sched = (await client.get(f"/api/loans/{acc_id}/schedule")).json()
    assert len(sched["schedule"]) > 0
    assert sched["schedule"][-1]["balance_cents"] == 0


async def test_loan_debt_reduces_net_worth(client: AsyncClient, seed_data: dict):
    """A computed loan should subtract its remaining balance from net worth even
    with no snapshot/transactions on the account."""
    base = (await client.get("/api/analytics/summary")).json()["net_worth_cents"]
    acc_id = (await client.post("/api/accounts", json={
        "name": "Crédit Auto", "bank_name": "Banque", "account_type": "emprunt", "currency": "EUR",
        "loan_details": {
            "principal_cents": 1200000, "interest_rate_pct": 3.0,
            "term_months": 48, "start_date": "2026-01-01",
        },
    })).json()["id"]
    s = (await client.get("/api/analytics/summary")).json()
    assert s["net_worth_cents"] < base  # debt lowered net worth
    # With/without-loans split is consistent.
    assert s["total_loans_cents"] > 0
    assert s["net_worth_excl_loans_cents"] == s["net_worth_cents"] + s["total_loans_cents"]

    # Deleting the loan must remove its debt from every summary value.
    assert (await client.delete(f"/api/accounts/{acc_id}")).status_code == 204
    after = (await client.get("/api/analytics/summary")).json()
    assert after["net_worth_cents"] == base
    assert after["total_loans_cents"] == 0
