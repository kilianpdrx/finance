import pytest
from services.categorizer import categorize_batch, evaluate_conditions, evaluate_rules_batch
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


def test_evaluate_conditions_not_contains():
    """The exclusion that tells "amazon" apart from "amazon prime"."""
    conds = [{"field": "description", "operator": "contains", "value": "amazon"},
             {"field": "description", "operator": "not_contains", "value": "prime"}]
    assert evaluate_conditions({"description": "ACHAT AMAZON.FR"}, conds, "AND") is True
    assert evaluate_conditions({"description": "AMAZON PRIME VIDEO"}, conds, "AND") is False


def test_evaluate_conditions_whole_word():
    """A short keyword must not fire inside a longer word."""
    eau = [{"field": "description", "operator": "word", "value": "eau"}]
    assert evaluate_conditions({"description": "VEOLIA EAU PARIS"}, eau, "AND") is True
    assert evaluate_conditions({"description": "FACTURE EAU."}, eau, "AND") is True
    assert evaluate_conditions({"description": "INSTITUT BEAUTE"}, eau, "AND") is False
    assert evaluate_conditions({"description": "BUREAU VALLEE"}, eau, "AND") is False
    # Several words are matched as one unit, and regex characters are literal.
    assert evaluate_conditions({"description": "CANAL+ SAT"},
                               [{"field": "description", "operator": "word", "value": "canal+"}], "AND") is True
    # An empty value never matches (it would otherwise match everything).
    assert evaluate_conditions({"description": "X"},
                               [{"field": "description", "operator": "word", "value": ""}], "AND") is False


@pytest.mark.asyncio
async def test_rules_of_different_categories_conflict_instead_of_one_winning(db_session, seed_data):
    """Rules have no priority: when two categories match, none is assigned."""
    pid = seed_data["profile"].id
    courses, salaire = seed_data["cat_courses"], seed_data["cat_salaire"]
    amazon = CategoryRule(profile_id=pid, category_id=courses.id, is_active=True, logic_operator="AND",
                          conditions=[{"field": "description", "operator": "contains", "value": "amazon"}])
    prime = CategoryRule(profile_id=pid, category_id=salaire.id, is_active=True, logic_operator="AND",
                         conditions=[{"field": "description", "operator": "contains", "value": "prime"}])
    db_session.add_all([amazon, prime])
    await db_session.commit()

    both, one = await evaluate_rules_batch(
        [{"description": "AMAZON PRIME VIDEO"}, {"description": "AMAZON MARKETPLACE"}],
        db_session, profile_id=pid)

    assert both.conflict and both.category_id is None and both.source is None
    assert both.category_ids == {courses.id, salaire.id}
    assert both.rule_ids == [amazon.id, prime.id]
    assert not one.conflict and one.category_id == courses.id and one.source == "rule"

    # The simple API reports the same thing: no category on a conflict.
    assert await categorize_batch([{"description": "AMAZON PRIME VIDEO"}], db_session, profile_id=pid) == [(None, None)]


def test_amount_is_compared_without_its_sign():
    """Amounts are stored unsigned, so an amount condition says nothing about
    direction: "> 0" holds for an expense and an income alike, and "< 0" for
    neither. Direction is the `is_debit` condition (« Sens » in the editor)."""
    positive = [{"field": "amount", "operator": ">", "value": "0"}]
    assert evaluate_conditions({"description": "x", "amount_cents": 4000, "is_debit": True}, positive, "AND") is True
    assert evaluate_conditions({"description": "x", "amount_cents": 4000, "is_debit": False}, positive, "AND") is True
    negative = [{"field": "amount", "operator": "<", "value": "0"}]
    assert evaluate_conditions({"description": "x", "amount_cents": 4000, "is_debit": True}, negative, "AND") is False

    # What "money coming in with this label" really is:
    income = [{"field": "description", "operator": "contains", "value": "acme"},
              {"field": "is_debit", "operator": "equals", "value": "false"}]
    assert evaluate_conditions({"description": "VIREMENT ACME", "amount_cents": 185000, "is_debit": False}, income, "AND") is True
    assert evaluate_conditions({"description": "PRLV ACME", "amount_cents": 4000, "is_debit": True}, income, "AND") is False


def test_amount_threshold_accepts_a_comma():
    """ "12,5" used to be read as 0, so "> 12,5" matched a 10,00 amount."""
    over = [{"field": "amount", "operator": ">", "value": "12,5"}]
    assert evaluate_conditions({"description": "x", "amount_cents": 1000}, over, "AND") is False
    assert evaluate_conditions({"description": "x", "amount_cents": 1300}, over, "AND") is True
    grouped = [{"field": "amount", "operator": ">=", "value": "1 850"}]
    assert evaluate_conditions({"description": "x", "amount_cents": 185000}, grouped, "AND") is True


def test_amount_threshold_that_is_not_a_number_never_matches():
    """It used to be read as 0, which made "> abc" match every transaction."""
    for operator in (">", ">=", "<", "<=", "equals"):
        cond = [{"field": "amount", "operator": operator, "value": "abc"}]
        assert evaluate_conditions({"description": "x", "amount_cents": 1000}, cond, "AND") is False, operator

