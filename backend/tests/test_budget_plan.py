"""The monthly budget plan: a few envelopes per account, read against what the
budget table adds up — with unplanned expenses set apart, a provision for them,
and amounts that apply from the month they are set."""
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    Account, AccountType, BudgetEntry, BudgetEnvelope, BudgetEnvelopeAmount, BudgetEnvelopeCategory, Category,
    PlannedExpense, Transaction,
)
from services import budget_plan as bp

pytestmark = pytest.mark.asyncio

NOW = "2026-06"


@pytest.fixture(autouse=True)
def frozen_month(monkeypatch):
    """Writes plan "from the current month": pin it."""
    monkeypatch.setattr(bp, "current_month", lambda: NOW)


async def _world(db: AsyncSession, seed: dict) -> dict:
    """The seeded profile, plus the categories a household budget needs."""
    pid = seed["profile"].id
    extra = {
        "loyer": Category(profile_id=pid, name="Loyer", expense_type="fixed"),
        "loisirs": Category(profile_id=pid, name="Loisirs", expense_type="variable"),
        "bourse": Category(profile_id=pid, name="Bourse", expense_type="variable", is_investment=True),
    }
    db.add_all(extra.values())
    await db.commit()
    return {
        "pid": pid, "h": {"X-Profile-Id": str(pid)}, "account": seed["account_courant"].id,
        "courses": seed["cat_courses"].id, "salaire": seed["cat_salaire"].id,
        **{name: cat.id for name, cat in extra.items()},
    }


_n = 0


def _txn(w: dict, day: str, cents: int, category=None, *, label="ACHAT", debit=True, account=None, **kw) -> Transaction:
    global _n
    _n += 1
    return Transaction(
        profile_id=w["pid"], account_id=account or w["account"], date=date.fromisoformat(day), description=label,
        amount_cents=cents, currency="EUR", is_debit=debit, category_id=category, import_hash=f"plan_{_n}", **kw)


def _env(name: str, kind: str, amount: int, categories=(), **kw) -> dict:
    return {"name": name, "kind": kind, "amount_cents": amount, "category_ids": list(categories), **kw}


async def _save(client: AsyncClient, w: dict, envelopes: list, account=None):
    return await client.put("/api/budget-plan", params={"account_id": account or w["account"]},
                            headers=w["h"], json={"envelopes": envelopes})


async def _plan(client: AsyncClient, w: dict, month: str = NOW, account=None) -> dict:
    res = await client.get("/api/budget-plan", params={"account_id": account or w["account"], "month": month}, headers=w["h"])
    assert res.status_code == 200, res.text
    return res.json()


def _by_name(plan: dict) -> dict:
    return {e["name"]: e for e in plan["envelopes"]}


# ── Pure pieces ─────────────────────────────────────────────────────────────

async def test_months_and_amounts_in_force():
    assert bp.month_add("2026-11", 3) == "2027-02" and bp.month_add("2026-01", -1) == "2025-12"
    assert bp.months_until("2026-02", 4) == ["2025-11", "2025-12", "2026-01", "2026-02"]

    amounts = [("2026-04", 400_00), ("2026-06", 500_00)]
    assert bp.amount_in_force(amounts, "2026-03") is None       # before the plan existed
    assert bp.amount_in_force(amounts, "2026-04") == 400_00
    assert bp.amount_in_force(amounts, "2026-05") == 400_00      # a past month keeps what was planned
    assert bp.amount_in_force(amounts, "2026-09") == 500_00
    assert bp.amount_in_force([], "2026-09") is None


async def test_a_typical_month_ignores_the_exceptional_one():
    months = [300_00] * 11 + [3000_00]
    assert bp.typical(months) == 300_00                          # the average would say 525
    assert bp.typical([]) is None
    assert [bp.round_amount(c) for c in (412_37, 95_00, 13_49, 0, None, 2_00)] == [410_00, 95_00, 15_00, 0, 0, 5_00]


# ── The plan reads the same numbers as the budget table ─────────────────────

async def test_plan_adds_up_to_the_budget_table(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    other = Account(profile_id=w["pid"], name="Autre", bank_name="B", account_type=AccountType.courant, currency="EUR")
    db_session.add(other)
    await db_session.flush()
    db_session.add_all([
        _txn(w, "2026-06-01", 2500_00, w["salaire"], debit=False),
        _txn(w, "2026-06-02", 800_00, w["loyer"]),
        _txn(w, "2026-06-03", 60_00, w["courses"]),
        _txn(w, "2026-06-04", 45_00, w["courses"]),
        _txn(w, "2026-06-05", 12_00, w["courses"], debit=False),     # a refund: the table ADDS it, so does the plan
        _txn(w, "2026-06-06", 70_00, w["loisirs"]),                  # no envelope → outside
        _txn(w, "2026-06-07", 33_00),                                # no category → outside, spent
        _txn(w, "2026-06-08", 20_00, debit=False),                   # no category → outside, received
        _txn(w, "2026-06-09", 900_00, w["courses"], is_unplanned=True),
        _txn(w, "2026-06-10", 500_00, is_internal_transfer=True),    # ignored, as in the table
        _txn(w, "2026-06-11", 999_00, w["courses"], account=other.id),   # another account
        _txn(w, "2026-05-11", 77_00, w["courses"]),                  # another month
        BudgetEntry(profile_id=w["pid"], category_id=w["courses"], month=NOW, expected_amount_cents=15_00, account_id=w["account"]),
    ])
    await db_session.commit()
    assert (await _save(client, w, [
        _env("Revenus", "income", 2500_00, [w["salaire"]]),
        _env("Logement", "expense", 800_00, [w["loyer"]]),
        _env("Courses", "expense", 300_00, [w["courses"]]),
        _env("Imprévus", "unplanned", 150_00),
    ])).status_code == 200

    plan = await _plan(client, w)
    env = _by_name(plan)
    assert env["Revenus"]["realised_cents"] == 2500_00
    assert env["Logement"]["realised_cents"] == 800_00
    assert env["Courses"]["realised_cents"] == 60_00 + 45_00 + 12_00 + 15_00   # the marked 900 is NOT here
    assert env["Imprévus"]["realised_cents"] == plan["unplanned_cents"] == 900_00
    assert (plan["outside_spent_cents"], plan["outside_received_cents"]) == (70_00 + 33_00, 20_00)
    assert plan["outside_category_ids"] == [w["loisirs"]]

    # The same month in the budget table: every cell as it is displayed, plus the
    # uncategorised rows the table has no line for.
    table = (await client.get("/api/analytics/budget-full", params={"year": 2026, "account_id": w["account"]}, headers=w["h"])).json()
    shown = sum(
        cell["actual_cents"] + cell["expected_cents"]
        for section in table["sections"] for row in section["rows"] for cell in row["cells"] if cell["month"] == NOW
    )
    in_plan = sum(e["realised_cents"] for e in plan["envelopes"]) + plan["outside_spent_cents"] + plan["outside_received_cents"]
    assert in_plan == shown + 33_00 + 20_00


# ── Amounts over time ───────────────────────────────────────────────────────

async def test_an_amount_applies_from_the_month_it_is_set(client: AsyncClient, seed_data: dict, db_session: AsyncSession, monkeypatch):
    w = await _world(db_session, seed_data)
    db_session.add_all([
        *[_txn(w, f"2026-{m:02d}-05", (m * 100) * 100, w["courses"]) for m in (3, 4, 5, 6)],
        # A known one-off, entered with « Planifier »: it raises May's target.
        PlannedExpense(profile_id=w["pid"], category_id=w["courses"], account_id=w["account"], month="2026-05", amount_cents=200_00),
    ])
    await db_session.commit()

    monkeypatch.setattr(bp, "current_month", lambda: "2026-04")
    saved = (await _save(client, w, [_env("Courses", "expense", 400_00, [w["courses"]])])).json()
    envelope_id = saved["envelopes"][0]["id"]

    monkeypatch.setattr(bp, "current_month", lambda: "2026-06")
    res = await client.put(f"/api/budget-plan/envelopes/{envelope_id}/amount", headers=w["h"], json={"amount_cents": 500_00})
    assert res.status_code == 204

    evolution = (await client.get("/api/budget-plan/evolution", headers=w["h"],
                                  params={"account_id": w["account"], "months": 4, "month": "2026-06"})).json()
    assert evolution["months"] == ["2026-03", "2026-04", "2026-05", "2026-06"]
    row = next(r for r in evolution["rows"] if r["key"] == f"envelope-{envelope_id}")
    assert [(c["realised_cents"], c["target_cents"]) for c in row["cells"]] == [
        (300_00, None),               # before the plan: what happened, uncompared
        (400_00, 400_00),
        (500_00, 400_00 + 200_00),    # the amount of the time, plus the planned one-off
        (600_00, 500_00),             # the new amount, from the month it was set
    ]
    assert row["reference_cents"] == 500_00

    may = _by_name(await _plan(client, w, "2026-05"))["Courses"]
    assert (may["amount_cents"], may["planned_extra_cents"], may["target_cents"]) == (400_00, 200_00, 600_00)

    # Setting the same month twice replaces that month's amount, it does not stack.
    await client.put(f"/api/budget-plan/envelopes/{envelope_id}/amount", headers=w["h"], json={"amount_cents": 550_00})
    count = (await db_session.execute(select(func.count(BudgetEnvelopeAmount.id)))).scalar()
    assert count == 2
    assert _by_name(await _plan(client, w, "2026-06"))["Courses"]["amount_cents"] == 550_00


async def test_typical_month_reads_the_account_own_history(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    # The account starts in March: January and February must not count as zeros.
    db_session.add_all([_txn(w, f"2026-{m:02d}-05", cents, w["courses"]) for m, cents in ((3, 300_00), (4, 320_00), (5, 2000_00))])
    await db_session.commit()
    await _save(client, w, [_env("Courses", "expense", 300_00, [w["courses"]])])

    courses = _by_name(await _plan(client, w))["Courses"]

    assert courses["typical_cents"] == 320_00                # the median of three months, not of twelve
    assert courses["average_cents"] == round((300_00 + 320_00 + 2000_00) / 3)
    assert courses["last_month_cents"] == 2000_00
    assert courses["realised_cents"] == 0                    # nothing yet in June


# ── What a plan may contain ─────────────────────────────────────────────────

async def test_a_category_sits_in_one_envelope_on_its_own_side(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    other = Account(profile_id=w["pid"], name="Autre", bank_name="B", account_type=AccountType.courant, currency="CHF")
    db_session.add(other)
    await db_session.flush()
    elsewhere = Category(profile_id=w["pid"], name="Ailleurs", account_id=other.id)
    parent = Category(profile_id=w["pid"], name="Maison")
    db_session.add_all([elsewhere, parent])
    await db_session.flush()
    child = Category(profile_id=w["pid"], name="Bricolage", parent_id=parent.id)
    db_session.add(child)
    await db_session.commit()
    elsewhere_id, parent_id, inv_id = elsewhere.id, parent.id, seed_data["account_inv"].id

    async def refused(envelopes, status=400, account=None) -> str:
        res = await _save(client, w, envelopes, account=account)
        assert res.status_code == status, res.text
        return res.json()["detail"]

    assert "dans deux enveloppes" in await refused([
        _env("A", "expense", 1, [w["courses"]]), _env("B", "expense", 1, [w["courses"]])])
    assert "catégorie de revenus" in await refused([_env("A", "expense", 1, [w["salaire"]])])
    assert "catégorie de dépenses" in await refused([_env("A", "income", 1, [w["courses"]])])
    assert "réservée à un autre compte" in await refused([_env("A", "expense", 1, [elsewhere_id])])
    assert "regroupe des sous-catégories" in await refused([_env("A", "expense", 1, [parent_id])])
    assert "Une seule enveloppe" in await refused([_env("A", "unplanned", 1), _env("B", "unplanned", 1)])
    assert "ne contient pas de catégories" in await refused([_env("A", "unplanned", 1, [w["courses"]])])
    assert "doit avoir un nom" in await refused([_env("  ", "expense", 1)])
    assert await refused([_env("A", "expense", 1, [999_999])], 404) == "Catégorie introuvable"
    assert await refused([_env("A", "expense", 1, id=999_999)], 404) == "Enveloppe introuvable"
    assert "compte courant" in await refused([], account=inv_id)
    assert (await client.put("/api/budget-plan", params={"account_id": w["account"]}, headers=w["h"],
                             json={"envelopes": [_env("A", "expense", -5)]})).status_code == 422

    # Nothing of the above was saved.
    assert (await _plan(client, w))["exists"] is False

    # Per account: the same category can be planned on each account separately.
    assert (await _save(client, w, [_env("Courses", "expense", 300_00, [w["courses"]])])).status_code == 200
    assert (await _save(client, w, [_env("Food", "expense", 250_00, [w["courses"]])], account=other.id)).status_code == 200
    assert (await _plan(client, w, account=other.id))["currency"] == "CHF"
    assert _by_name(await _plan(client, w))["Courses"]["amount_cents"] == 300_00


async def test_saving_replaces_the_plan_and_keeps_what_stays(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    first = (await _save(client, w, [
        _env("Courses", "expense", 300_00, [w["courses"]]),
        _env("Sorties", "expense", 100_00, [w["loisirs"]]),
    ])).json()
    courses_id = first["envelopes"][0]["id"]

    second = (await _save(client, w, [
        _env("Revenus", "income", 2000_00, [w["salaire"]]),
        _env("Vie courante", "expense", 300_00, [w["courses"], w["loisirs"]], id=courses_id),
    ])).json()

    names = [e["name"] for e in second["envelopes"]]
    assert names == ["Revenus", "Vie courante"]                       # the order given is the order kept
    kept = _by_name(second)["Vie courante"]
    assert kept["id"] == courses_id and sorted(kept["category_ids"]) == sorted([w["courses"], w["loisirs"]])
    # The removed envelope is gone with its amount; the kept one did not get a second amount.
    # (By name: SQLite hands a freed id to the next row, here to « Revenus ».)
    assert (await db_session.execute(select(BudgetEnvelope.name).order_by(BudgetEnvelope.position))).scalars().all() == names
    amounts = (await db_session.execute(select(BudgetEnvelopeAmount.envelope_id, BudgetEnvelopeAmount.amount_cents))).all()
    assert sorted(amounts) == sorted([(courses_id, 300_00), (_by_name(second)["Revenus"]["id"], 2000_00)])
    assert (await db_session.execute(select(func.count(BudgetEnvelopeCategory.id)))).scalar() == 3

    # An empty plan is "no plan".
    assert (await _save(client, w, [])).json()["exists"] is False
    assert (await db_session.execute(select(func.count(BudgetEnvelope.id)))).scalar() == 0


# ── Unplanned expenses ──────────────────────────────────────────────────────

async def test_an_unplanned_expense_leaves_its_envelope(client: AsyncClient, seed_data: dict, db_session: AsyncSession, monkeypatch):
    w = await _world(db_session, seed_data)
    repair = _txn(w, "2026-06-12", 1200_00, w["loisirs"], label="GARAGE DUPONT")
    old = _txn(w, "2026-02-12", 700_00, w["loisirs"], label="DENTISTE", is_unplanned=True)
    salary = _txn(w, "2026-06-01", 2500_00, w["salaire"], debit=False)
    db_session.add_all([repair, old, salary, _txn(w, "2026-06-13", 80_00, w["loisirs"]), _txn(w, "2026-05-20", 340_00, w["loisirs"], is_unplanned=True)])
    await db_session.commit()
    repair_id, salary_id = repair.id, salary.id

    monkeypatch.setattr(bp, "current_month", lambda: "2026-04")       # the provision exists since April
    await _save(client, w, [_env("Loisirs", "expense", 200_00, [w["loisirs"]]), _env("Imprévus", "unplanned", 150_00)])
    monkeypatch.setattr(bp, "current_month", lambda: NOW)

    before = _by_name(await _plan(client, w))
    assert before["Loisirs"]["realised_cents"] == 1280_00 and before["Imprévus"]["realised_cents"] == 0

    res = await client.put(f"/api/transactions/{repair_id}", headers=w["h"], json={"is_unplanned": True})
    assert res.status_code == 200 and res.json()["is_unplanned"] is True
    # The mark is not an edit of the transaction, and its category does not move.
    assert res.json()["is_manually_edited"] is False and res.json()["category_id"] == w["loisirs"]

    after = _by_name(await _plan(client, w))
    assert after["Loisirs"]["realised_cents"] == 80_00
    assert after["Imprévus"]["realised_cents"] == 1200_00
    # Judged over the year, since the provision exists: April, May, June — the
    # February expense predates it and is not held against it.
    assert (after["Imprévus"]["ytd_provision_cents"], after["Imprévus"]["ytd_realised_cents"]) == (3 * 150_00, 340_00 + 1200_00)
    assert after["Loisirs"]["ytd_provision_cents"] is None

    # Only an expense can be unplanned; the answer can be withdrawn.
    refused = await client.put(f"/api/transactions/{salary_id}", headers=w["h"], json={"is_unplanned": True})
    assert refused.status_code == 400 and "Seule une dépense" in refused.json()["detail"]
    await client.put(f"/api/transactions/{repair_id}", headers=w["h"], json={"is_unplanned": None})
    assert _by_name(await _plan(client, w))["Loisirs"]["realised_cents"] == 1280_00


async def test_marked_expenses_show_even_without_a_provision(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    db_session.add_all([
        _txn(w, "2026-06-01", 2000_00, w["salaire"], debit=False),
        _txn(w, "2026-06-12", 900_00, w["loisirs"], is_unplanned=True),
        _txn(w, "2026-06-13", 50_00, w["loisirs"]),
    ])
    await db_session.commit()
    await _save(client, w, [_env("Revenus", "income", 2000_00, [w["salaire"]]), _env("Loisirs", "expense", 200_00, [w["loisirs"]])])

    plan = await _plan(client, w)
    evolution = (await client.get("/api/budget-plan/evolution", headers=w["h"],
                                  params={"account_id": w["account"], "months": 2, "month": NOW})).json()

    assert plan["unplanned_cents"] == 900_00 and _by_name(plan)["Loisirs"]["realised_cents"] == 50_00
    rows = {r["key"]: r for r in evolution["rows"]}
    assert [r["kind"] for r in evolution["rows"]] == ["income", "expense", "unplanned", "remainder"]
    assert rows["unplanned"]["cells"][-1] == {"month": NOW, "realised_cents": 900_00, "target_cents": None}
    # « Reste du mois »: everything in, minus everything out — the unplanned one included.
    assert rows["remainder"]["cells"][-1] == {"month": NOW, "realised_cents": 2000_00 - 50_00 - 900_00, "target_cents": 2000_00 - 200_00}
    assert rows["remainder"]["cells"][0]["target_cents"] is None


async def test_suggestions_ask_about_large_one_offs_only(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    rows = []
    stays = ["HOTEL ALPHA", "AUBERGE BRAVO", "GITE CHARLIE", "CAMPING DELTA", "REFUGE ECHO", "PENSION FOXTROT"]
    for m in range(1, 7):                                           # six months of habits
        rows += [
            _txn(w, f"2026-{m:02d}-03", 800_00, w["loyer"], label="PRLV LOYER DUPONT"),
            # The same shop under a new reference each month: one label, a habit.
            _txn(w, f"2026-{m:02d}-08", 300_00 + m * 100, w["courses"], label=f"CARTE {m:02d}/08 SUPERMARCHE 4410"),
            _txn(w, f"2026-{m:02d}-15", 1000_00, w["loisirs"], label=stays[m - 1]),   # a different place every time
        ]
    wanted = _txn(w, "2026-06-18", 900_00, w["courses"], label="GARAGE MARTIN REPARATION")
    answered = _txn(w, "2026-06-19", 650_00, w["courses"], label="CLINIQUE VETERINAIRE", is_unplanned=False)
    rows += [
        wanted, answered,
        _txn(w, "2026-06-20", 60_00, w["courses"], label="FLEURISTE DU COIN"),            # under 100
        _txn(w, "2026-06-21", 120_00, w["loisirs"], label="BILLETTERIE CONCERT"),          # small next to the usual 1 000 € one-offs
        _txn(w, "2026-06-22", 5000_00, w["bourse"], label="ACHAT TITRES"),                 # an investment
        # A one-off in a fixed-expense category: unusual, however large the rent beside it.
        _txn(w, "2026-06-23", 350_00, w["loyer"], label="PLOMBERIE DURAND URGENCE"),
        _txn(w, "2026-06-24", 700_00, label="RETRAIT EXCEPTIONNEL"),                       # no category: still asked
        _txn(w, "2026-06-25", 4000_00, w["salaire"], label="PRIME", debit=False),          # not an expense
        _txn(w, "2026-06-26", 3000_00, label="VIR INTERNE", is_internal_transfer=True),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    wanted_id, answered_id = wanted.id, answered.id
    await _save(client, w, [_env("Courses", "expense", 300_00, [w["courses"]])])

    async def asked(**params) -> list:
        res = await client.get("/api/budget-plan/suggestions", headers=w["h"],
                               params={"account_id": w["account"], "month": NOW, **params})
        assert res.status_code == 200, res.text
        return res.json()

    current = await asked(months=1)
    assert [s["description"] for s in current] == [
        "RETRAIT EXCEPTIONNEL", "PLOMBERIE DURAND URGENCE", "GARAGE MARTIN REPARATION", "PENSION FOXTROT"]
    assert "PRLV LOYER DUPONT" not in [s["description"] for s in await asked(months=6)]   # a habit, at any amount
    garage = current[2]
    assert (garage["id"], garage["amount_cents"], garage["envelope_name"]) == (wanted_id, 900_00, "Courses")
    assert garage["typical_cents"] == 300_00 + 300        # a typical month of « Courses », Jan–May

    # Further back: the stays of the earlier months, each a one-off label.
    assert len(await asked(months=3)) == 4 + 2

    # Answered — either way — it is not asked again.
    await client.put(f"/api/transactions/{wanted_id}", headers=w["h"], json={"is_unplanned": True})
    assert "GARAGE MARTIN REPARATION" not in [s["description"] for s in await asked(months=1)]
    await client.put(f"/api/transactions/{answered_id}", headers=w["h"], json={"is_unplanned": None})
    assert "CLINIQUE VETERINAIRE" in [s["description"] for s in await asked(months=1)]


# ── The first split ─────────────────────────────────────────────────────────

async def test_proposal_is_a_starting_point_and_saves_nothing(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    unused = Category(profile_id=w["pid"], name="Jamais utilisée")
    retired = Category(profile_id=w["pid"], name="Ancienne", archived=True)
    db_session.add_all([unused, retired])
    await db_session.flush()
    rows = [_txn(w, "2026-03-09", 50_00, retired.id)]
    for m in range(1, 6):
        rows += [
            _txn(w, f"2026-{m:02d}-01", 2512_00, w["salaire"], debit=False, label="VIREMENT SALAIRE"),
            _txn(w, f"2026-{m:02d}-03", 800_00, w["loyer"], label="PRLV LOYER"),
            _txn(w, f"2026-{m:02d}-08", 412_00, w["courses"], label="SUPERMARCHE"),
            _txn(w, f"2026-{m:02d}-10", 88_00, w["loisirs"], label="CINEMA"),
            _txn(w, f"2026-{m:02d}-12", 300_00, w["bourse"], label="VERSEMENT PEA"),
        ]
    rows.append(_txn(w, "2026-04-20", 1500_00, w["courses"], label="GARAGE MARTIN"))     # one unusual expense in 5 months
    db_session.add_all(rows)
    await db_session.commit()

    res = await client.get("/api/budget-plan/proposal", params={"account_id": w["account"], "month": NOW}, headers=w["h"])
    assert res.status_code == 200, res.text
    proposal = res.json()

    assert proposal["exists"] is False and all(e["id"] is None for e in proposal["envelopes"])
    assert [(e["name"], e["kind"], e["amount_cents"]) for e in proposal["envelopes"]] == [
        ("Revenus", "income", 2510_00),
        ("Dépenses fixes", "expense", 800_00),
        ("Dépenses variables", "expense", 500_00),           # a typical month: the garage does not inflate it
        ("Investissements", "goal", 300_00),
        ("Imprévus", "unplanned", 300_00),                   # 1 500 over five months
    ]
    by = _by_name(proposal)
    assert by["Dépenses variables"]["category_ids"] == sorted([w["courses"], w["loisirs"]])   # only what the account used
    assert by["Dépenses variables"]["average_cents"] == 500_00 + 300_00
    # Shown, not saved.
    assert (await _plan(client, w))["exists"] is False
    assert (await db_session.execute(select(func.count(BudgetEnvelope.id)))).scalar() == 0

    # What it proposes can be saved as is.
    as_is = [_env(e["name"], e["kind"], e["amount_cents"], e["category_ids"]) for e in proposal["envelopes"]]
    assert (await _save(client, w, as_is)).status_code == 200


async def test_preview_reads_a_draft_without_saving_it(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    w = await _world(db_session, seed_data)
    for m in (3, 4, 5):
        db_session.add_all([_txn(w, f"2026-{m:02d}-08", 400_00, w["courses"]), _txn(w, f"2026-{m:02d}-10", 90_00, w["loisirs"])])
    await db_session.commit()

    async def preview(envelopes):
        return await client.post("/api/budget-plan/preview", params={"account_id": w["account"], "month": NOW},
                                 headers=w["h"], json={"envelopes": envelopes})

    together = (await preview([_env("", "expense", 0, [w["courses"], w["loisirs"]])])).json()   # the name is still being typed
    apart = (await preview([_env("A", "expense", 0, [w["courses"]]), _env("B", "expense", 0, [w["loisirs"]])])).json()

    assert together["envelopes"][0]["typical_cents"] == 490_00
    assert [e["typical_cents"] for e in apart["envelopes"]] == [400_00, 90_00]
    assert together["exists"] is False and (await _plan(client, w))["exists"] is False
    # A draft is still checked for what would make its numbers wrong.
    twice = await preview([_env("A", "expense", 0, [w["courses"]]), _env("B", "expense", 0, [w["courses"]])])
    assert twice.status_code == 400


# ── Isolation and clean-up ──────────────────────────────────────────────────

async def test_plan_is_scoped_to_its_profile(client: AsyncClient, seed_data: dict, db_session: AsyncSession, extra_profile):
    w = await _world(db_session, seed_data)
    stranger = {"X-Profile-Id": str(extra_profile.id)}
    saved = (await _save(client, w, [_env("Courses", "expense", 300_00, [w["courses"]])])).json()
    envelope_id = saved["envelopes"][0]["id"]
    params = {"account_id": w["account"]}

    for path in ("", "/proposal", "/evolution", "/suggestions"):
        assert (await client.get(f"/api/budget-plan{path}", params=params, headers=stranger)).status_code == 404
    assert (await client.post("/api/budget-plan/preview", params=params, headers=stranger, json={"envelopes": []})).status_code == 404
    assert (await client.put("/api/budget-plan", params=params, headers=stranger, json={"envelopes": []})).status_code == 404
    assert (await client.put(f"/api/budget-plan/envelopes/{envelope_id}/amount", headers=stranger,
                             json={"amount_cents": 1})).status_code == 404
    assert _by_name(await _plan(client, w))["Courses"]["amount_cents"] == 300_00


async def test_deleting_what_a_plan_points_at(client: AsyncClient, seed_data: dict, db_session: AsyncSession, extra_profile):
    w = await _world(db_session, seed_data)
    await _save(client, w, [
        _env("Vie courante", "expense", 300_00, [w["courses"], w["loisirs"]]), _env("Imprévus", "unplanned", 100_00)])

    # A category that becomes a group hands its place to its "Autre …" leaf.
    created = await client.post("/api/categories", headers=w["h"], json={"name": "Cinéma", "parent_id": w["loisirs"]})
    assert created.status_code == 201, created.text
    autre = (await db_session.execute(select(Category.id).where(Category.name == "Autre Loisirs"))).scalar_one()
    assert sorted(_by_name(await _plan(client, w))["Vie courante"]["category_ids"]) == sorted([w["courses"], autre])

    # A deleted category leaves the plan.
    assert (await client.delete(f"/api/categories/{w['courses']}", headers=w["h"])).status_code == 204
    assert _by_name(await _plan(client, w))["Vie courante"]["category_ids"] == [autre]

    # A deleted account takes its plan with it.
    await client.delete(f"/api/accounts/{w['account']}", headers=w["h"])
    gone = await client.delete(f"/api/accounts/{w['account']}", params={"permanent": "true"}, headers=w["h"])
    assert gone.status_code == 204, gone.text
    for model in (BudgetEnvelope, BudgetEnvelopeCategory, BudgetEnvelopeAmount):
        assert (await db_session.execute(select(func.count(model.id)))).scalar() == 0


async def test_deleting_a_profile_with_a_plan(client: AsyncClient, seed_data: dict, db_session: AsyncSession, extra_profile):
    pid = extra_profile.id
    account = Account(profile_id=pid, name="Compte", bank_name="B", account_type=AccountType.courant, currency="EUR")
    category = Category(profile_id=pid, name="Courses")
    db_session.add_all([account, category])
    await db_session.commit()
    w = {"h": {"X-Profile-Id": str(pid)}, "account": account.id}
    assert (await _save(client, w, [_env("Courses", "expense", 300_00, [category.id])])).status_code == 200

    res = await client.delete(f"/api/profiles/{pid}")

    assert res.status_code in (200, 204), res.text
    assert (await db_session.execute(select(func.count(BudgetEnvelope.id)))).scalar() == 0
