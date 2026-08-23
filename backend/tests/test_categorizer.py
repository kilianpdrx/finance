import pytest
from services.categorizer import categorize_batch, evaluate_conditions
from models import CategoryRule


def test_evaluate_conditions_contains():
    txn = {"description": "CARREFOUR EXPRESS PARIS", "amount_cents": 1000}
    conds = [{"field": "description", "operator": "contains", "value": "CARREFOUR"}]
    assert evaluate_conditions(txn, conds, "AND") is True

    txn_no_match = {"description": "AUCHAN MARKET", "amount_cents": 1000}
    assert evaluate_conditions(txn_no_match, conds, "AND") is False


def test_evaluate_conditions_startswith():
    txn = {"description": "VIR SALAIRE ACME", "amount_cents": 200000}
    conds = [{"field": "description", "operator": "startswith", "value": "VIR"}]
    assert evaluate_conditions(txn, conds, "AND") is True


def test_evaluate_conditions_regex():
    txn = {"description": "UBER * EATS PARIS", "amount_cents": 1500}
    conds = [{"field": "description", "operator": "regex", "value": r"UBER\s*\*\s*EATS"}]
    assert evaluate_conditions(txn, conds, "AND") is True


@pytest.mark.asyncio
async def test_categorize_batch_rules(db_session, seed_data):
    pid = seed_data["profile"].id
    cat = seed_data["cat_courses"]

    rule = CategoryRule(
        profile_id=pid,
        category_id=cat.id,
        category=cat,
        priority=10,
        is_active=True,
        logic_operator="AND",
        conditions=[{"field": "description", "operator": "contains", "value": "MONOPRIX"}]
    )
    db_session.add(rule)
    await db_session.commit()

    txns = [
        {"description": "MONOPRIX NATION", "amount_cents": 4200, "category_id": None},
        {"description": "LEROY MERLIN", "amount_cents": 8500, "category_id": None},
    ]

    results = await categorize_batch(txns, db_session, profile_id=pid)

    assert len(results) == 2
    cat_id_0, source_0 = results[0]
    cat_id_1, source_1 = results[1]
    assert cat_id_0 == cat.id
    assert source_0 == "rule"
    assert cat_id_1 is None


