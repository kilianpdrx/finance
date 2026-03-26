from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db, AsyncSessionLocal
from routers import accounts, transactions, categories, upload, analytics, ml
from routers import bank_profiles, settings


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

    yield


app = FastAPI(
    title="Finance Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
