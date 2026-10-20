"""Exercise the real Alembic reconcile path (the app's test suite otherwise
builds the schema with create_all and never runs migrations).

Regression for the fresh-DB startup crash: init_db() runs create_all, so a brand
new database already matches head; the reconcile must STAMP it (not re-run the
migrations, which would try to re-add existing columns/tables and crash).
"""
import tempfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

import database
from models import Base

HEAD = "019_budget_lines_notes"


@pytest.fixture
def temp_db(monkeypatch):
    tmp = Path(tempfile.mkdtemp()) / "finance.db"
    # env.py and _sync_schema_blocking both read database.DB_PATH at call time.
    monkeypatch.setattr(database, "DB_PATH", tmp)
    yield tmp


def _version(db_path: Path):
    eng = create_engine(f"sqlite:///{db_path}")
    try:
        with eng.connect() as c:
            if "alembic_version" not in inspect(c).get_table_names():
                return None
            return c.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        eng.dispose()


def test_fresh_db_is_stamped_not_migrated(temp_db):
    # Simulate init_db(): create_all builds the full current schema.
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    eng.dispose()

    database._sync_schema_blocking()

    assert _version(temp_db) == HEAD
    eng = create_engine(f"sqlite:///{temp_db}")
    try:
        tables = set(inspect(eng).get_table_names())
    finally:
        eng.dispose()
    assert {"goals", "loan_details", "profiles", "transactions"} <= tables


def test_upgrade_from_old_revision_is_idempotent(temp_db):
    # create_all builds everything, but the DB is stamped at an OLD revision, so
    # 002 + 4fe6 run against already-existing objects — must not crash.
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    eng.dispose()
    database._sync_schema_blocking()  # stamps head
    eng = create_engine(f"sqlite:///{temp_db}")
    with eng.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='001_initial_schema'"))
    eng.dispose()

    database._sync_schema_blocking()  # upgrade path

    assert _version(temp_db) == HEAD


def test_rule_priority_column_is_dropped_and_rules_survive(temp_db):
    """An existing install still has `category_rules.priority`. Upgrading must
    remove it without losing a rule."""
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        # Rebuild the pre-014 shape: the column, and a rule that uses it.
        c.execute(text("ALTER TABLE category_rules ADD COLUMN priority INTEGER"))
        c.execute(text("INSERT INTO profiles (id, name, color, is_default) VALUES (1, 'P', '#000', 1)"))
        c.execute(text("INSERT INTO categories (id, profile_id, name, color) VALUES (1, 1, 'Courses', '#000')"))
        c.execute(text(
            "INSERT INTO category_rules (id, profile_id, conditions, category_id, priority, is_active, logic_operator)"
            " VALUES (7, 1, :cond, 1, 45, 1, 'OR')"
        ), {"cond": '[{"field": "description", "operator": "contains", "value": "amazon"}]'})
    eng.dispose()
    database._sync_schema_blocking()  # stamps head (no alembic_version yet)
    eng = create_engine(f"sqlite:///{temp_db}")
    with eng.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='013_txn_original_currency'"))
    eng.dispose()

    database._sync_schema_blocking()  # upgrade path: runs 014

    assert _version(temp_db) == HEAD
    eng = create_engine(f"sqlite:///{temp_db}")
    try:
        cols = {c["name"] for c in inspect(eng).get_columns("category_rules")}
        with eng.connect() as c:
            rule = c.execute(text("SELECT id, category_id, logic_operator, conditions FROM category_rules")).one()
    finally:
        eng.dispose()
    assert "priority" not in cols
    assert (rule.id, rule.category_id, rule.logic_operator) == (7, 1, "OR")
    assert "amazon" in rule.conditions


def test_category_source_column_is_added_to_an_existing_database(temp_db):
    """An install on 014 has no `transactions.category_source`: upgrading adds it,
    empty, and leaves the transactions alone."""
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        # Rebuild the pre-015 shape, with one categorised transaction in it.
        c.execute(text("ALTER TABLE transactions DROP COLUMN category_source"))
        c.execute(text("INSERT INTO profiles (id, name, color, is_default) VALUES (1, 'P', '#000', 1)"))
        c.execute(text("INSERT INTO accounts (id, profile_id, name, bank_name, account_type, currency, color, is_active)"
                       " VALUES (1, 1, 'A', 'B', 'courant', 'EUR', '#000', 1)"))
        c.execute(text("INSERT INTO categories (id, profile_id, name, color) VALUES (1, 1, 'Courses', '#000')"))
        c.execute(text("INSERT INTO transactions (id, profile_id, account_id, date, description, amount_cents,"
                       " category_id, is_debit, import_hash) VALUES (5, 1, 1, '2026-09-01', 'X', 1000, 1, 1, 'h5')"))
    eng.dispose()
    database._sync_schema_blocking()  # stamps head (no alembic_version yet)
    eng = create_engine(f"sqlite:///{temp_db}")
    with eng.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='014_drop_rule_priority'"))
    eng.dispose()

    database._sync_schema_blocking()  # upgrade path: runs 015

    assert _version(temp_db) == HEAD
    eng = create_engine(f"sqlite:///{temp_db}")
    try:
        cols = {c["name"] for c in inspect(eng).get_columns("transactions")}
        with eng.connect() as c:
            row = c.execute(text("SELECT id, category_id, category_source, amount_cents FROM transactions")).one()
    finally:
        eng.dispose()
    assert "category_source" in cols
    assert (row.id, row.category_id, row.category_source, row.amount_cents) == (5, 1, None, 1000)


def test_budget_plan_is_added_to_an_existing_database(temp_db):
    """An install on 015 has neither the plan's tables nor `is_unplanned`:
    upgrading adds them, and no transaction is marked by it."""
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        # Rebuild the pre-016 shape, with one transaction in it.
        for table in ("budget_envelope_amounts", "budget_envelope_categories", "budget_envelopes"):
            c.execute(text(f"DROP TABLE {table}"))
        c.execute(text("ALTER TABLE transactions DROP COLUMN is_unplanned"))
        c.execute(text("INSERT INTO profiles (id, name, color, is_default) VALUES (1, 'P', '#000', 1)"))
        c.execute(text("INSERT INTO accounts (id, profile_id, name, bank_name, account_type, currency, color, is_active)"
                       " VALUES (1, 1, 'A', 'B', 'courant', 'EUR', '#000', 1)"))
        c.execute(text("INSERT INTO transactions (id, profile_id, account_id, date, description, amount_cents,"
                       " is_debit, import_hash) VALUES (5, 1, 1, '2026-09-01', 'X', 1000, 1, 'h5')"))
    eng.dispose()
    database._sync_schema_blocking()  # stamps head (no alembic_version yet)
    eng = create_engine(f"sqlite:///{temp_db}")
    with eng.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='015_txn_category_source'"))
    eng.dispose()

    database._sync_schema_blocking()  # upgrade path: runs 016
    database._sync_schema_blocking()  # and again: nothing left to do

    assert _version(temp_db) == HEAD
    eng = create_engine(f"sqlite:///{temp_db}")
    try:
        tables = set(inspect(eng).get_table_names())
        unique = {u["name"] for t in ("budget_envelope_categories", "budget_envelope_amounts")
                  for u in inspect(eng).get_unique_constraints(t)}
        with eng.connect() as c:
            row = c.execute(text("SELECT id, amount_cents, is_unplanned FROM transactions")).one()
    finally:
        eng.dispose()
    assert {"budget_envelopes", "budget_envelope_categories", "budget_envelope_amounts"} <= tables
    assert unique == {"uq_envelope_category_per_account", "uq_envelope_amount_month"}
    assert (row.id, row.amount_cents, row.is_unplanned) == (5, 1000, None)



def test_category_amount_is_added_to_an_existing_plan(temp_db):
    """An install on 016 has plans without per-category amounts: upgrading adds
    the column, leaves every membership as it was (no amount: the envelope stays
    planned as one amount), and keeps the one-envelope-per-account constraint."""
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        c.execute(text("ALTER TABLE budget_envelope_categories DROP COLUMN amount_cents"))
        c.execute(text("INSERT INTO profiles (id, name, color, is_default) VALUES (1, 'P', '#000', 1)"))
        c.execute(text("INSERT INTO accounts (id, profile_id, name, bank_name, account_type, currency, color, is_active)"
                       " VALUES (1, 1, 'A', 'B', 'courant', 'EUR', '#000', 1)"))
        c.execute(text("INSERT INTO categories (id, profile_id, name, color) VALUES (7, 1, 'Courses', '#000')"))
        c.execute(text("INSERT INTO budget_envelopes (id, profile_id, account_id, name, kind, position)"
                       " VALUES (3, 1, 1, 'Quotidien', 'expense', 0)"))
        c.execute(text("INSERT INTO budget_envelope_categories (id, profile_id, envelope_id, category_id, account_id)"
                       " VALUES (9, 1, 3, 7, 1)"))
        c.execute(text("INSERT INTO budget_envelope_amounts (id, profile_id, envelope_id, effective_from, amount_cents)"
                       " VALUES (4, 1, 3, '2026-10', 40000)"))
    eng.dispose()
    database._sync_schema_blocking()  # stamps head (no alembic_version yet)
    eng = create_engine(f"sqlite:///{temp_db}")
    with eng.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='016_budget_plan'"))
    eng.dispose()

    database._sync_schema_blocking()  # upgrade path: runs 017
    database._sync_schema_blocking()  # and again: nothing left to do

    assert _version(temp_db) == HEAD
    eng = create_engine(f"sqlite:///{temp_db}")
    try:
        unique = {u["name"] for u in inspect(eng).get_unique_constraints("budget_envelope_categories")}
        with eng.connect() as c:
            link = c.execute(text("SELECT id, envelope_id, category_id, account_id, amount_cents FROM budget_envelope_categories")).one()
            amount = c.execute(text("SELECT amount_cents FROM budget_envelope_amounts WHERE envelope_id = 3")).scalar()
    finally:
        eng.dispose()
    assert tuple(link) == (9, 3, 7, 1, None)
    assert amount == 40000
    assert unique == {"uq_envelope_category_per_account"}


def test_holdings_get_a_sync_source_and_accept_an_unknown_cost(temp_db):
    """An install on 017 has `holdings.cost_basis_cents NOT NULL` and no
    `sync_source`: upgrading rebuilds the table, keeps every position and its
    cost, keeps the one-ticker-per-account constraint, and then accepts a
    position whose cost is unknown."""
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        # Rebuild the pre-018 shape, with one position in it.
        c.execute(text("DROP TABLE holdings"))
        c.execute(text(
            "CREATE TABLE holdings (id INTEGER NOT NULL, profile_id INTEGER, account_id INTEGER NOT NULL,"
            " ticker VARCHAR NOT NULL, name VARCHAR NOT NULL, quantity FLOAT NOT NULL,"
            " cost_basis_cents INTEGER NOT NULL, currency VARCHAR, asset_type VARCHAR, added_date DATE,"
            " notes VARCHAR, created_at DATETIME, isin VARCHAR, ref_price_cents INTEGER, ref_price_date DATE,"
            " price_locked BOOLEAN, PRIMARY KEY (id),"
            " CONSTRAINT uq_holding_account_ticker UNIQUE (account_id, ticker),"
            " FOREIGN KEY(profile_id) REFERENCES profiles (id), FOREIGN KEY(account_id) REFERENCES accounts (id))"
        ))
        c.execute(text("INSERT INTO profiles (id, name, color, is_default) VALUES (1, 'P', '#000', 1)"))
        c.execute(text("INSERT INTO accounts (id, profile_id, name, bank_name, account_type, currency, color, is_active)"
                       " VALUES (1, 1, 'A', 'B', 'investissement', 'EUR', '#000', 1)"))
        c.execute(text("INSERT INTO holdings (id, profile_id, account_id, ticker, name, quantity, cost_basis_cents,"
                       " currency, asset_type, price_locked) VALUES (4, 1, 1, 'CW8.PA', 'MSCI World', 3, 150000,"
                       " 'EUR', 'etf', 0)"))
    eng.dispose()
    database._sync_schema_blocking()  # stamps head (no alembic_version yet)
    eng = create_engine(f"sqlite:///{temp_db}")
    with eng.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='017_envelope_category_amount'"))
    eng.dispose()

    database._sync_schema_blocking()  # upgrade path: runs 018
    database._sync_schema_blocking()  # and again: nothing left to do

    assert _version(temp_db) == HEAD
    eng = create_engine(f"sqlite:///{temp_db}")
    try:
        cols = {c["name"]: c for c in inspect(eng).get_columns("holdings")}
        unique = {u["name"] for u in inspect(eng).get_unique_constraints("holdings")}
        with eng.begin() as c:
            row = c.execute(text("SELECT id, ticker, quantity, cost_basis_cents, sync_source FROM holdings")).one()
            c.execute(text("INSERT INTO holdings (profile_id, account_id, ticker, name, quantity, cost_basis_cents,"
                           " currency, asset_type, sync_source) VALUES (1, 1, 'BTC', 'Bitcoin', 0.1, NULL, 'EUR',"
                           " 'crypto', 'binance')"))
    finally:
        eng.dispose()
    assert cols["cost_basis_cents"]["nullable"] and "sync_source" in cols
    assert tuple(row) == (4, "CW8.PA", 3, 150000, None)
    assert unique == {"uq_holding_account_ticker"}


def test_sub_lines_and_notes_are_added_to_an_existing_plan(temp_db):
    """An install on 018 has plans without sub-lines or notes: upgrading adds
    them, empty, and leaves every envelope as it was."""
    eng = create_engine(f"sqlite:///{temp_db}")
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        c.execute(text("DROP TABLE budget_envelope_lines"))
        c.execute(text("DROP TABLE budget_plans"))
        c.execute(text("ALTER TABLE budget_envelopes DROP COLUMN note"))
        c.execute(text("INSERT INTO profiles (id, name, color, is_default) VALUES (1, 'P', '#000', 1)"))
        c.execute(text("INSERT INTO accounts (id, profile_id, name, bank_name, account_type, currency, color, is_active)"
                       " VALUES (1, 1, 'A', 'B', 'courant', 'EUR', '#000', 1)"))
        c.execute(text("INSERT INTO budget_envelopes (id, profile_id, account_id, name, kind, position)"
                       " VALUES (3, 1, 1, 'Investissements', 'goal', 0)"))
        c.execute(text("INSERT INTO budget_envelope_amounts (id, profile_id, envelope_id, effective_from, amount_cents)"
                       " VALUES (4, 1, 3, '2026-10', 80000)"))
    eng.dispose()
    database._sync_schema_blocking()  # stamps head (no alembic_version yet)
    eng = create_engine(f"sqlite:///{temp_db}")
    with eng.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num='018_holding_binance'"))
    eng.dispose()

    database._sync_schema_blocking()  # upgrade path: runs 019
    database._sync_schema_blocking()  # and again: nothing left to do

    assert _version(temp_db) == HEAD
    eng = create_engine(f"sqlite:///{temp_db}")
    try:
        tables = set(inspect(eng).get_table_names())
        cols = {c["name"] for c in inspect(eng).get_columns("budget_envelopes")}
        unique = {u["name"] for u in inspect(eng).get_unique_constraints("budget_plans")}
        with eng.connect() as c:
            envelope = c.execute(text("SELECT id, name, kind, note FROM budget_envelopes")).one()
            amount = c.execute(text("SELECT amount_cents FROM budget_envelope_amounts")).scalar()
    finally:
        eng.dispose()
    assert {"budget_envelope_lines", "budget_plans"} <= tables and "note" in cols
    assert unique == {"uq_budget_plan_account"}
    assert tuple(envelope) == (3, "Investissements", "goal", None) and amount == 80000
