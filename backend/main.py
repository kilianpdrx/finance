import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from database import init_db, AsyncSessionLocal, sync_schema
from routers import accounts, transactions, categories, upload, analytics
from routers import bank_profiles, investments, settings, system, profiles, goals, loans, planned

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # ── Reconcile Alembic bookkeeping with the create_all-built schema ───────────
    # (stamps a fresh DB at head, upgrades an existing one; best-effort).
    await sync_schema()

    # ── Seed default data if empty ───────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        from seed import seed_if_empty
        await seed_if_empty(db)

        from sqlalchemy import text
        existing = (await db.execute(text("SELECT id FROM profiles WHERE is_default = 1 LIMIT 1"))).first()
        if not existing:
            await db.execute(text("INSERT INTO profiles (name, color, is_default) VALUES ('Principal', '#6366f1', 1)"))
            await db.commit()
        default_pid = (await db.execute(text("SELECT id FROM profiles WHERE is_default = 1 LIMIT 1"))).scalar()

        # Ensure base_currency setting exists
        await db.execute(text(
            "INSERT OR IGNORE INTO settings (profile_id, key, value) VALUES (:p, 'base_currency', 'CHF')"
        ), {"p": default_pid})
        await db.commit()

        # Seed ISIN→ticker lookup map
        from services.holdings_csv_parser import ISIN_TICKER_MAP
        for _isin, _ticker in ISIN_TICKER_MAP.items():
            await db.execute(text(
                "INSERT OR IGNORE INTO isin_ticker (isin, ticker, source) VALUES (:i, :t, 'seed')"
            ), {"i": _isin, "t": _ticker})
        await db.commit()


    # ── Deferred startup work (network-bound; runs in the background) ───────────
    # FX backfill, the one-shot price refresh and the IBKR sync all make slow
    # network calls. Running them inline here would delay uvicorn from opening the
    # port, so the frontend's first API calls fail with ECONNREFUSED. Instead we
    # fire them as a background task so the API is available immediately and these
    # fill in a moment later.
    async def _deferred_startup():
        # FX backfill + refresh
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

        # Helper to check if any profile has investments enabled
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select as sql_select
            from models import Profile
            prof_rows = (await db.execute(sql_select(Profile))).scalars().all()
            has_investment_profiles = any(
                p.enabled_modules is None or "investments" in (p.enabled_modules or [])
                for p in prof_rows
            )

        # One-shot holdings price refresh (only if investments module is enabled for at least 1 profile)
        if has_investment_profiles:
            async with AsyncSessionLocal() as db:
                from services.market_data import refresh_all_prices
                try:
                    n = await refresh_all_prices(db)
                    logger.info("Startup price refresh complete (%d prices)", n)
                except Exception as e:
                    logger.warning("Startup price refresh failed: %s", e)

        # IBKR Flex positions sync (silent; only profiles with ibkr_auto_sync=true & investments enabled)
        if has_investment_profiles:
            async with AsyncSessionLocal() as db:
                from services.ibkr_flex import sync_ibkr_holdings, get_setting
                try:
                    for prof in prof_rows:
                        if prof.enabled_modules is not None and "investments" not in prof.enabled_modules:
                            continue
                        try:
                            if (await get_setting(db, prof.id, "ibkr_auto_sync")) != "true":
                                continue
                            res = await sync_ibkr_holdings(db, prof.id, mode="auto")
                            if res.get("ok"):
                                logger.info("IBKR startup sync (profile %d): %s", prof.id, res)
                            elif res.get("reason") != "not_configured":
                                logger.warning("IBKR startup sync (profile %d): %s", prof.id, res.get("reason"))
                        except Exception as e:
                            logger.warning("IBKR startup sync failed (profile %d): %s", prof.id, e)
                except Exception as e:
                    logger.warning("IBKR startup iteration failed: %s", e)


    startup_task = asyncio.create_task(_deferred_startup())

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

    startup_task.cancel()
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Finance Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"])
app.include_router(transactions.router, prefix="/api/transactions", tags=["transactions"])
app.include_router(categories.router, prefix="/api/categories", tags=["categories"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(bank_profiles.router, prefix="/api/bank-profiles", tags=["bank-profiles"])
app.include_router(investments.router, prefix="/api/investments", tags=["investments"])
app.include_router(goals.router, prefix="/api/goals", tags=["goals"])
app.include_router(loans.router, prefix="/api/loans", tags=["loans"])
app.include_router(planned.router, prefix="/api/planned-expenses", tags=["planned-expenses"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(profiles.router, prefix="/api/profiles", tags=["profiles"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
