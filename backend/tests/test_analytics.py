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


async def test_recurring_merges_broad_keyword(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """Rows that differ only by numbers/refs merge into one broad-keyword group."""
    profile = seed_data["profile"]
    acc = seed_data["account_courant"]
    from datetime import date as _date
    for i, ref in enumerate(["0512", "1806", "2401"]):
        db_session.add(Transaction(
            profile_id=profile.id, account_id=acc.id, date=_date(2026, 1 + i, 5),
            amount_cents=1200 + i, is_debit=True,
            description=f"PAIEMENT CB CARREFOUR MARKET {ref} PARIS",
            import_hash=f"rec_{ref}",
        ))
    await db_session.commit()

    r = await client.get("/api/analytics/recurring", headers={"X-Profile-Id": str(profile.id)})
    assert r.status_code == 200
    rows = r.json()
    carrefour = [x for x in rows if "CARREFOUR" in x["description"]]
    assert len(carrefour) == 1
    assert carrefour[0]["occurrences"] == 3
    # The keyword dropped the numbers and banking boilerplate.
    assert "0512" not in carrefour[0]["description"] and "PAIEMENT" not in carrefour[0]["description"]


FRANPRIX_LABELS = [
    "CARTE X1234 12/09 FRANPRIX 5106 PARIS 11",
    "CARTE X1234 03/10 FRANPRIX 5106 PARIS 11",
    "CARTE X1234 21/10 FRANPRIX 5106 PARIS 11",
]


async def _add_franprix(db_session: AsyncSession, seed_data: dict):
    """Three card payments whose label carries a reference in the MIDDLE."""
    for i, label in enumerate(FRANPRIX_LABELS):
        db_session.add(Transaction(
            profile_id=seed_data["profile"].id, account_id=seed_data["account_courant"].id,
            date=date(2026, 9 + (i > 0), 12 + i), amount_cents=1500 + i, is_debit=True,
            currency="EUR", description=label, import_hash=f"franprix_{i}",
        ))
    await db_session.commit()


def _contains_rule(seed_data: dict, value: str, account_id=None):
    from models import CategoryRule
    return CategoryRule(
        profile_id=seed_data["profile"].id, category_id=seed_data["cat_courses"].id,
        account_id=account_id, is_active=True, logic_operator="AND",
        conditions=[{"field": "description", "operator": "contains", "value": value}],
    )


async def test_recurring_rule_pattern_matches_every_row_of_its_group(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """The cleaned-up keyword drops the reference from the middle of the label, so
    it appears in no real transaction. The rule must be built from `rule_pattern`."""
    await _add_franprix(db_session, seed_data)
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    group = next(g for g in (await client.get("/api/analytics/recurring", headers=h)).json()
                 if "FRANPRIX" in g["description"])
    assert group["description"] == "FRANPRIX PARIS"
    assert group["occurrences"] == 3 and group["currency"] == "EUR"
    assert all(group["rule_pattern"].lower() in label.lower() for label in FRANPRIX_LABELS)

    async def matches(value: str) -> int:
        r = await client.post("/api/categories/rules/preview", headers=h, json={
            "conditions": [{"field": "description", "operator": "contains", "value": value}],
            "logic_operator": "AND"})
        return len(r.json())

    assert await matches(group["rule_pattern"]) == 3
    assert await matches(group["description"]) == 0   # why the keyword can't be the prefill


async def test_recurring_uncovered_checks_real_rows_not_the_keyword(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """A rule that matches the keyword but no real row classifies nothing, so the
    group must stay listed until a rule really covers it."""
    await _add_franprix(db_session, seed_data)
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    async def listed() -> bool:
        rows = (await client.get("/api/analytics/recurring-uncovered", headers=h)).json()
        return any("FRANPRIX" in g["description"] for g in rows)

    assert await listed()

    db_session.add(_contains_rule(seed_data, "FRANPRIX PARIS"))   # matches no real label
    await db_session.commit()
    assert await listed()

    # Bound to another account: it never fires on these rows.
    db_session.add(_contains_rule(seed_data, "FRANPRIX", account_id=seed_data["account_inv"].id))
    await db_session.commit()
    assert await listed()

    db_session.add(_contains_rule(seed_data, "FRANPRIX"))
    await db_session.commit()
    assert not await listed()


async def test_recurring_never_averages_two_currencies(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    acc = seed_data["account_courant"]
    for i, (ccy, cents) in enumerate([("EUR", 1000), ("EUR", 1200), ("CHF", 5000), ("CHF", 7000)]):
        db_session.add(Transaction(
            profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, 1 + i, 5),
            amount_cents=cents, is_debit=True, currency=ccy,
            description="NETFLIX.COM", import_hash=f"netflix_{i}",
        ))
    await db_session.commit()

    rows = (await client.get("/api/analytics/recurring",
                             headers={"X-Profile-Id": str(seed_data["profile"].id)})).json()
    netflix = {g["currency"]: g["avg_amount_cents"] for g in rows if g["description"] == "NETFLIX"}
    assert netflix == {"EUR": 1100, "CHF": 6000}


async def test_recurring_shows_one_direction_at_a_time(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """The Dépenses/Revenus toggle drives both recurring lists: expenses by
    default, income with `income=true` — never the two mixed."""
    acc = seed_data["account_courant"]
    rows = [("LOYER DUPONT", True, 80000), ("VIREMENT SALAIRE ACME", False, 250000)]
    for label, is_debit, cents in rows:
        for month in (7, 8):
            db_session.add(Transaction(
                profile_id=seed_data["profile"].id, account_id=acc.id, date=date(2026, month, 3),
                amount_cents=cents, is_debit=is_debit, currency="EUR",
                description=label, import_hash=f"dir_{label}_{month}",
            ))
    await db_session.commit()
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    async def labels(path: str, **params) -> set:
        return {g["description"] for g in (await client.get(path, headers=h, params=params)).json()}

    for path in ("/api/analytics/recurring", "/api/analytics/recurring-uncovered"):
        assert await labels(path) == {"LOYER DUPONT"}
        assert await labels(path, income="true") == {"SALAIRE ACME"}


async def test_recurring_groups_carry_their_transactions(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """A group can be unfolded: it comes with its real rows — the label as the
    bank wrote it, not the keyword — most recent first."""
    acc, cat = seed_data["account_courant"].id, seed_data["cat_courses"].id
    labels = {7: "CARTE X1234 03/07 BIOCOOP 2231 LYON 03", 8: "CARTE X1234 05/08 BIOCOOP 2231 LYON 03",
              9: "CARTE X1234 02/09 BIOCOOP 2231 LYON 03"}
    for month, label in labels.items():
        db_session.add(Transaction(
            profile_id=seed_data["profile"].id, account_id=acc, date=date(2026, month, 3),
            amount_cents=4000 + month, is_debit=True, currency="EUR", category_id=cat if month == 9 else None,
            description=label, import_hash=f"members_{month}",
        ))
    await db_session.commit()
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    for path in ("/api/analytics/recurring", "/api/analytics/recurring-uncovered"):
        (group,) = (await client.get(path, headers=h)).json()
        rows = group["transactions"]
        assert group["occurrences"] == len(rows) == 3
        assert [r["description"] for r in rows] == [labels[9], labels[8], labels[7]]
        assert [r["date"] for r in rows] == ["2026-09-03", "2026-08-03", "2026-07-03"]
        assert [(r["amount_cents"], r["account_id"], r["category_id"]) for r in rows] == [
            (4009, acc, cat), (4008, acc, None), (4007, acc, None)]
        assert all(isinstance(r["id"], int) for r in rows) and len({r["id"] for r in rows}) == 3


async def _add_spend(db_session: AsyncSession, seed_data: dict, day: date, cents: int, key: str, category_id=None):
    db_session.add(Transaction(
        profile_id=seed_data["profile"].id, account_id=seed_data["account_courant"].id, date=day,
        amount_cents=cents, is_debit=True, currency="EUR", category_id=category_id,
        description=f"ACHAT {key}", import_hash=f"trend_{key}",
    ))


async def test_spending_trends_by_month(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    cat = seed_data["cat_courses"].id
    await _add_spend(db_session, seed_data, date(2026, 3, 4), 1000, "a", cat)
    await _add_spend(db_session, seed_data, date(2026, 3, 20), 500, "b", cat)
    await _add_spend(db_session, seed_data, date(2026, 5, 2), 700, "c", cat)
    await db_session.commit()

    res = await client.get("/api/analytics/spending-trends", headers={"X-Profile-Id": str(seed_data["profile"].id)},
                           params={"date_from": "2026-03-01", "date_to": "2026-05-31"})
    assert res.status_code == 200
    (trend,) = res.json()
    assert trend["category_name"] == "Alimentation"
    # One point per month that has data — no day-level detail by default.
    assert trend["series"] == [{"period": "2026-03", "amount_cents": 1500}, {"period": "2026-05", "amount_cents": 700}]


async def test_spending_trends_by_day_fills_the_whole_range(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """A one-month range must show WHEN in the month the money went: one point per
    day of the range, empty days included, shared by every category."""
    cat = seed_data["cat_courses"].id
    await _add_spend(db_session, seed_data, date(2026, 3, 2), 1000, "d1", cat)
    await _add_spend(db_session, seed_data, date(2026, 3, 2), 250, "d2", cat)
    await _add_spend(db_session, seed_data, date(2026, 3, 5), 400, "d3")          # uncategorised
    await db_session.commit()

    res = await client.get("/api/analytics/spending-trends", headers={"X-Profile-Id": str(seed_data["profile"].id)},
                           params={"date_from": "2026-03-01", "date_to": "2026-03-07", "granularity": "day"})
    assert res.status_code == 200
    by_name = {t["category_name"]: t["series"] for t in res.json()}
    days = [f"2026-03-0{d}" for d in range(1, 8)]
    assert [p["period"] for p in by_name["Alimentation"]] == days
    assert [p["period"] for p in by_name["Non catégorisé"]] == days
    assert [p["amount_cents"] for p in by_name["Alimentation"]] == [0, 1250, 0, 0, 0, 0, 0]
    assert [p["amount_cents"] for p in by_name["Non catégorisé"]] == [0, 0, 0, 0, 400, 0, 0]


async def test_spending_trends_rejects_an_unknown_granularity(client: AsyncClient, seed_data: dict):
    res = await client.get("/api/analytics/spending-trends", headers={"X-Profile-Id": str(seed_data["profile"].id)},
                           params={"granularity": "hour"})
    assert res.status_code == 422


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
