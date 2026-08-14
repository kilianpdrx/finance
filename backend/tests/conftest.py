import asyncio
import os
import sys
import tempfile
from pathlib import Path
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import event

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database import Base, get_db
from main import app
from models import Profile, Category, Account, AccountType


@pytest_asyncio.fixture
async def test_engine():
    """Create an isolated temporary SQLite database for testing."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    test_db_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(test_db_url, echo=False)

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    await engine.dispose()
    if os.path.exists(db_path):
        try:
            os.remove(db_path)
        except OSError:
            pass


@pytest_asyncio.fixture
async def db_session(test_engine):
    """Provide an isolated AsyncSession for database unit testing."""
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(test_engine):
    """Provide an AsyncClient wired to the test database for FastAPI integration testing."""
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def extra_profile(db_session):
    """A second profile, for cross-profile isolation checks."""
    p = Profile(name="Secondary Profile", color="#ff0000", is_default=False, enabled_modules=["transactions"])
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


@pytest_asyncio.fixture
async def seed_data(db_session):
    """Seed initial Profile, Account, and Categories for testing."""
    profile = Profile(
        name="Test Profile",
        color="#6366f1",
        is_default=True,
        enabled_modules=["banking", "budgeting", "investments"],
    )
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(profile)

    account_courant = Account(
        profile_id=profile.id,
        name="Compte Courant Test",
        bank_name="Banque Test",
        account_type=AccountType.courant,
        currency="EUR",
    )
    from models import Setting
    base_ccy_setting = Setting(profile_id=profile.id, key="base_currency", value="EUR")
    db_session.add(base_ccy_setting)
    account_inv = Account(
        profile_id=profile.id,
        name="PEA Test",
        bank_name="Broker Test",
        account_type=AccountType.investissement,
        currency="EUR",
    )
    db_session.add_all([account_courant, account_inv])

    cat_courses = Category(profile_id=profile.id, name="Alimentation", color="#22c55e")
    cat_salaire = Category(profile_id=profile.id, name="Salaire", color="#3b82f6", is_income=True)
    db_session.add_all([cat_courses, cat_salaire])

    await db_session.commit()
    return {
        "profile": profile,
        "account_courant": account_courant,
        "account_inv": account_inv,
        "cat_courses": cat_courses,
        "cat_salaire": cat_salaire,
    }
