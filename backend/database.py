import os
from pathlib import Path
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

# Where the database, backups and logs live. Relocatable via FINANCE_DATA_DIR so
# a process can be pointed at a throwaway directory — the test suite does this
# before importing `main`, which otherwise appends every pytest run to the real
# data/logs/finance.log and crowds out the diagnostics export. `alembic/env.py`
# reads DB_PATH from here, so it follows the override too.
DATA_DIR = Path(os.environ.get("FINANCE_DATA_DIR") or Path(__file__).parent / "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "finance.db"

DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False)

@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _sync_schema_blocking() -> None:
    """Reconcile Alembic's version bookkeeping with the schema `init_db` built.

    `init_db()` runs ``create_all`` from the live models, so a brand-new database
    already matches head. Running the migrations on top would try to re-add
    existing columns/tables, so:
      • a fresh DB (no ``alembic_version`` row) is *stamped* at head;
      • an already-tracked DB is *upgraded* to head.
    The migrations are also written to be idempotent, so this is safe either way.
    Best-effort: the schema is correct from ``create_all`` regardless, so a
    bookkeeping hiccup must never block startup.
    """
    import logging
    from pathlib import Path
    from alembic.config import Config
    from alembic import command
    from sqlalchemy import create_engine, inspect, text

    log = logging.getLogger(__name__)
    try:
        cfg = Config(str(Path(__file__).parent / "alembic.ini"))
        # Keep the app's logging setup — see the note in alembic/env.py.
        cfg.attributes["embedded"] = True
        sync_engine = create_engine(f"sqlite:///{DB_PATH}")
        try:
            with sync_engine.connect() as conn:
                stamped = False
                if "alembic_version" in inspect(conn).get_table_names():
                    stamped = conn.execute(
                        text("SELECT version_num FROM alembic_version LIMIT 1")
                    ).first() is not None
        finally:
            sync_engine.dispose()
        if stamped:
            command.upgrade(cfg, "head")
        else:
            command.stamp(cfg, "head")
    except Exception as e:
        log.warning("Alembic schema sync skipped: %s", e)


async def sync_schema() -> None:
    """Async wrapper around :func:`_sync_schema_blocking` (runs Alembic off-loop)."""
    import asyncio
    await asyncio.to_thread(_sync_schema_blocking)

