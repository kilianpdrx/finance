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

HEAD = "014_drop_rule_priority"


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

