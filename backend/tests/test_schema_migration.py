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

HEAD = "013_txn_original_currency"


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
