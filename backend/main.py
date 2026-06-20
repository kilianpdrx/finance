import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from database import init_db, AsyncSessionLocal
from routers import accounts, transactions, categories, upload, analytics, ml
from routers import bank_profiles, investments, settings, system

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Seed if empty
    async with AsyncSessionLocal() as db:
        from seed import seed_if_empty
        await seed_if_empty(db)

    # ── Schema migrations (add columns if missing) ────────────────────────────
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text

        # Add expense_type column to categories if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(categories)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "expense_type" not in col_names:
            await db.execute(text("ALTER TABLE categories ADD COLUMN expense_type TEXT"))
            await db.commit()

        # Add account_id column to budget_entries if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(budget_entries)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "account_id" not in col_names:
            await db.execute(text("ALTER TABLE budget_entries ADD COLUMN account_id INTEGER REFERENCES accounts(id)"))
            await db.commit()

        # Add account_id column to categories if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(categories)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "account_id" not in col_names:
            await db.execute(text("ALTER TABLE categories ADD COLUMN account_id INTEGER REFERENCES accounts(id)"))
            await db.commit()

        # Add account_id column to category_rules if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(category_rules)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "account_id" not in col_names:
            await db.execute(text("ALTER TABLE category_rules ADD COLUMN account_id INTEGER REFERENCES accounts(id)"))
            await db.commit()

        # Add logic_operator column to category_rules if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(category_rules)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "logic_operator" not in col_names:
            await db.execute(text("ALTER TABLE category_rules ADD COLUMN logic_operator TEXT DEFAULT 'AND'"))
            await db.commit()

        # Add is_investment column to categories if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(categories)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "is_investment" not in col_names:
            await db.execute(text("ALTER TABLE categories ADD COLUMN is_investment BOOLEAN DEFAULT 0"))
            await db.commit()

        # Create import_batches table if it doesn't exist
        await db.execute(text(
            "CREATE TABLE IF NOT EXISTS import_batches ("
            "  id INTEGER PRIMARY KEY,"
            "  account_id INTEGER REFERENCES accounts(id),"
            "  filename TEXT,"
            "  transaction_count INTEGER DEFAULT 0,"
            "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            ")"
        ))
        await db.commit()

        # Add import_batch_id column to transactions if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(transactions)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "import_batch_id" not in col_names:
            await db.execute(text("ALTER TABLE transactions ADD COLUMN import_batch_id INTEGER REFERENCES import_batches(id)"))
            await db.commit()

        # Add contribution_cents column to account_balance_snapshots if it doesn't exist
        cols = await db.execute(text("PRAGMA table_info(account_balance_snapshots)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "contribution_cents" not in col_names:
            await db.execute(text("ALTER TABLE account_balance_snapshots ADD COLUMN contribution_cents INTEGER DEFAULT 0"))
            await db.commit()

        # Create indexes if they don't exist (idempotent)
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS ix_transactions_date ON transactions(date)",
            "CREATE INDEX IF NOT EXISTS ix_transactions_account_date ON transactions(account_id, date)",
            "CREATE INDEX IF NOT EXISTS ix_transactions_category ON transactions(category_id)",
        ]:
            await db.execute(text(idx_sql))
        await db.commit()

        # Seed expense_type for existing categories
        from models import Category
        from sqlalchemy import select
        cats = await db.execute(select(Category).where(Category.expense_type == None))
        fixed_names = {
            "Logement", "Transport", "Abonnements", "Banque & Finances",
        }
        variable_names = {
            "Alimentation", "Restaurants", "Shopping", "Loisirs", "Voyages",
            "Santé", "Éducation", "Divers",
        }
        updated = False
        for cat in cats.scalars():
            if cat.is_income:
                continue  # income categories keep expense_type=None
            if cat.name in fixed_names:
                cat.expense_type = "fixed"
                updated = True
            elif cat.name in variable_names:
                cat.expense_type = "variable"
                updated = True
        if updated:
            await db.commit()

        # Sync transaction currencies with their account's currency
        await db.execute(text(
            "UPDATE transactions SET currency = ("
            "  SELECT COALESCE(accounts.currency, 'EUR') FROM accounts"
            "  WHERE accounts.id = transactions.account_id"
            ") WHERE currency IS NULL OR (currency = 'EUR' AND account_id IN ("
            "  SELECT id FROM accounts WHERE currency IS NOT NULL AND currency != 'EUR'"
            "))"
        ))
        await db.commit()

        # Migrate exchange_rates table (old schema had currency_code/rate_ten_thousandths)
        cols = await db.execute(text("PRAGMA table_info(exchange_rates)"))
        col_names = [r[1] for r in cols.fetchall()]
        if "base_currency" not in col_names:
            await db.execute(text("DROP TABLE IF EXISTS exchange_rates"))
            await db.commit()
        await db.execute(text(
            "CREATE TABLE IF NOT EXISTS exchange_rates ("
            "  id INTEGER PRIMARY KEY,"
            "  base_currency TEXT NOT NULL,"
            "  target_currency TEXT NOT NULL,"
            "  date DATE NOT NULL,"
            "  rate REAL NOT NULL,"
            "  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
            "  UNIQUE(base_currency, target_currency, date)"
            ")"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_exchange_rate_lookup "
            "ON exchange_rates(base_currency, target_currency, date)"
        ))
        await db.commit()

        # Create settings table and seed base_currency
        await db.execute(text(
            "CREATE TABLE IF NOT EXISTS settings ("
            "  id INTEGER PRIMARY KEY,"
            "  key TEXT UNIQUE NOT NULL,"
            "  value TEXT NOT NULL"
            ")"
        ))
        await db.execute(text(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('base_currency', 'CHF')"
        ))
        await db.commit()

        # Create holdings table
        await db.execute(text(
            "CREATE TABLE IF NOT EXISTS holdings ("
            "  id INTEGER PRIMARY KEY,"
            "  account_id INTEGER NOT NULL REFERENCES accounts(id),"
            "  ticker TEXT NOT NULL,"
            "  name TEXT NOT NULL,"
            "  quantity REAL NOT NULL,"
            "  cost_basis_cents INTEGER NOT NULL,"
            "  currency TEXT DEFAULT 'USD',"
            "  asset_type TEXT DEFAULT 'stock',"
            "  added_date DATE,"
            "  notes TEXT,"
            "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
            "  UNIQUE(account_id, ticker)"
            ")"
        ))
        await db.commit()

        # Create price_cache table
        await db.execute(text(
            "CREATE TABLE IF NOT EXISTS price_cache ("
            "  id INTEGER PRIMARY KEY,"
            "  ticker TEXT UNIQUE NOT NULL,"
            "  price_cents INTEGER NOT NULL,"
            "  currency TEXT NOT NULL,"
            "  fetched_at DATETIME NOT NULL"
            ")"
        ))
        await db.commit()

    # ── FX backfill on startup ──────────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text as sql_text
        from services.fx import backfill_range, refresh_latest
        from datetime import date as date_type

        try:
            row = (await db.execute(sql_text(
                "SELECT MIN(date), MAX(date) FROM transactions"
            ))).one_or_none()
            min_date, max_date = row if row else (None, None)

            acc_rows = await db.execute(sql_text("SELECT DISTINCT currency FROM accounts WHERE currency IS NOT NULL"))
            currencies = [r[0] for r in acc_rows]

            base_row = await db.execute(sql_text("SELECT value FROM settings WHERE key='base_currency'"))
            base_ccy = (base_row.scalar() or "CHF")

            if min_date and max_date:
                from_d = date_type.fromisoformat(str(min_date))
                to_d = min(date_type.fromisoformat(str(max_date)), date_type.today())
                for ccy in currencies:
                    if ccy != base_ccy:
                        await backfill_range(db, ccy, base_ccy, from_d, to_d)
                logger.info("FX backfill complete")

            await refresh_latest(db, currencies, base_ccy)
            logger.info("FX refresh complete")
        except Exception as e:
            logger.warning("FX startup tasks failed: %s", e)

    # ── Scheduler ─────────────────────────────────────────────────────────────────
    scheduler = AsyncIOScheduler()

    async def daily_fx_refresh():
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text as sql_text
            from services.fx import refresh_latest
            try:
                acc_rows = await db.execute(sql_text("SELECT DISTINCT currency FROM accounts WHERE currency IS NOT NULL"))
                currencies = [r[0] for r in acc_rows]
                base_row = await db.execute(sql_text("SELECT value FROM settings WHERE key='base_currency'"))
                base_ccy = (base_row.scalar() or "CHF")
                await refresh_latest(db, currencies, base_ccy)
                logger.info("Scheduled FX refresh complete")
            except Exception as e:
                logger.warning("Scheduled FX refresh failed: %s", e)

    async def periodic_price_refresh():
        async with AsyncSessionLocal() as db:
            from services.market_data import refresh_all_prices
            try:
                await refresh_all_prices(db)
            except Exception as e:
                logger.warning("Scheduled price refresh failed: %s", e)

    scheduler.add_job(daily_fx_refresh, "cron", hour=7, minute=0, id="daily_fx")
    scheduler.add_job(periodic_price_refresh, "interval", minutes=15, id="price_refresh")
    scheduler.start()
    logger.info("Scheduler started (FX daily at 07:00, prices every 15min)")

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Finance Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"])
app.include_router(transactions.router, prefix="/api/transactions", tags=["transactions"])
app.include_router(categories.router, prefix="/api/categories", tags=["categories"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(ml.router, prefix="/api/ml", tags=["ml"])
app.include_router(bank_profiles.router, prefix="/api/bank-profiles", tags=["bank-profiles"])
app.include_router(investments.router, prefix="/api/investments", tags=["investments"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(system.router, prefix="/api/system", tags=["system"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
