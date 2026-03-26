import os
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "finance.db"

DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add new columns to existing tables if they don't exist (simple SQLite migration)
        await _migrate(conn)


async def _migrate(conn):
    """Add new columns to existing tables for schema upgrades."""
    from sqlalchemy import text
    migrations = [
        # transactions table new columns
        ("transactions", "is_internal_transfer", "BOOLEAN NOT NULL DEFAULT 0"),
        ("transactions", "transfer_pair_id", "INTEGER REFERENCES transactions(id)"),
    ]
    for table, column, col_def in migrations:
        try:
            # Check if column exists
            result = await conn.execute(text(f"PRAGMA table_info({table})"))
            existing_cols = {row[1] for row in result}
            if column not in existing_cols:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))
        except Exception:
            pass  # column may already exist or table doesn't exist yet
