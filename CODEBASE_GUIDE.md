# Personal Finance & Investment Tracker — Codebase Guide

This document provides a comprehensive technical reference for the architecture, data models, services, frontend components, and deployment setup of the Personal Finance & Investment Tracker repository.

---

## 1. Overview & Technology Stack

### Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0 (Async `aiosqlite`), Alembic (Database Migrations), Uvicorn.
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, TailwindCSS, TanStack Query v5, Recharts, Lucide Icons.
- **Database**: SQLite 3 operating in **WAL mode** (`PRAGMA journal_mode=WAL;`), normal synchronous mode, and explicit Foreign Key enforcement (`PRAGMA foreign_keys=ON;`).
- **Containerization**: Docker Compose (`backend` + `web` Next.js standalone container).

---

## 2. Directory Structure

```
├── backend/
│   ├── alembic/              # Alembic migration scripts and env configuration
│   ├── data/                 # Persistent SQLite database storage (finance.db)
│   ├── routers/              # FastAPI API route controllers
│   │   ├── accounts.py       # Bank account CRUD & monthly snapshots
│   │   ├── analytics.py      # Net worth, cashflow, category spending, budget
│   │   ├── bank_profiles.py  # Custom bank CSV format rules
│   │   ├── categories.py    # Category & rule management
│   │   ├── investments.py   # Holdings, IBKR sync, dividend calendar, benchmarks
│   │   ├── profiles.py      # Multi-profile switching & management
│   │   ├── settings.py      # System settings & configuration
│   │   ├── system.py        # Database backup/restore & transaction CSV export
│   │   ├── transactions.py  # Transaction CRUD, filters, and batch updates
│   │   └── upload.py        # CSV import preview & batch confirmation
│   ├── services/             # Core business logic & data aggregators
│   │   ├── bank_detector.py # Automatic bank CSV format identification
│   │   ├── categorizer.py   # Batch transaction auto-categorization
│   │   ├── csv_parser.py    # Multi-bank CSV parsing logic
│   │   ├── fx.py            # ECB daily FX exchange rates & conversion
│   │   ├── holdings_csv_parser.py # Broker holdings CSV parsers
│   │   ├── ibkr_flex.py     # Interactive Brokers Flex Query XML parser & sync
│   │   ├── market_data.py   # Stock, ETF & Crypto quotes (yfinance / CoinGecko)
│   │   └── transfer_detector.py # Internal account transfer detection engine
│   ├── database.py           # Async SQLAlchemy engine & SQLite PRAGMAs
│   ├── dependencies.py       # FastAPI request context & profile resolution
│   ├── main.py               # Application entrypoint & lifespan manager
│   └── models.py             # SQLAlchemy ORM database models
├── web/                      # Next.js 15 Frontend
│   ├── app/                  # App Router pages (/comptes, /transactions, /investissements...)
│   │   └── api/[...path]/    # Dynamic Catch-All API proxy route handler
│   ├── components/           # UI components (dashboard, analytics, settings, importer...)
│   └── lib/                  # API hooks (TanStack Query), state stores, formatters
├── docker-compose.yml        # Docker orchestrator with local database volume bind
├── start.sh                  # One-click local development & launcher script
└── CODEBASE_GUIDE.md         # This technical documentation file
```

---

## 3. Data Models (`backend/models.py`)

The application enforces strong relational integrity using SQLAlchemy:

- **`Profile`**: Multi-profile isolation (e.g. personal vs joint vs family). Resolved via `X-Profile-Id` HTTP header.
- **`Account`**: Bank and investment accounts. Types: `courant`, `épargne`, `investissement`, `crédit`.
- **`Transaction`**: Individual bank transactions (date, description, amount in cents, debit/credit, category ID, account ID, internal transfer flag).
- **`Category` & `CategoryRule`**: Expense/Income classification hierarchy with automated rule matching rules (AND/OR condition groups).
- **`Holding`**: Investment portfolio positions (ticker, ISIN, quantity, cost basis, asset type: stock, ETF, crypto, fund).
- **`PriceCache`, `DividendCache`, `IsinTicker`**: Caches for stock quotes, dividend history, and ISIN-to-ticker maps to minimize external network requests.
- **`BankProfile`**: Custom CSV column mapping definitions created by users for non-standard bank exports.

---

## 4. Key Capabilities & Optimization Architectures

### A. High-Performance Batch Lookups
- **Categorization**: `categorize_batch()` in [services/categorizer.py](file:///Users/kilianpouderoux/Documents/Finance/backend/services/categorizer.py) fetches active category rules once per batch instead of executing N+1 queries.
- **Holdings Enrichment**: `enrich_holdings_batch()` in [routers/investments.py](file:///Users/kilianpouderoux/Documents/Finance/backend/routers/investments.py) bulk-fetches ISIN mappings, cached live prices, and dividend details in 3 queries across all holdings.

### B. Dynamic API Proxy Handler
- Located at [web/app/api/[...path]/route.ts](file:///Users/kilianpouderoux/Documents/Finance/web/app/api/%5B...path%5D/route.ts).
- Dynamically proxies all `/api/*` HTTP requests from the Next.js frontend to `process.env.BACKEND_URL` (`http://backend:8000` in Docker, `http://localhost:8000` in local development) at runtime on every request.

### C. Database Health & System Management
- Located at [routers/system.py](file:///Users/kilianpouderoux/Documents/Finance/backend/routers/system.py) and [database.py](file:///Users/kilianpouderoux/Documents/Finance/backend/database.py).
- **WAL Checkpointing**: Automatically flushes SQLite WAL logs prior to streaming backups.
- **Backup Download**: Streams `.sqlite` database snapshots (`GET /api/system/backup`).
- **Backup Restore**: Accepts `.sqlite` files, validates SQLite binary headers, resets connection pools, replaces the DB file, and re-runs Alembic migrations (`POST /api/system/restore`).
- **CSV Export**: Generates formatted CSV exports of all transactions (`GET /api/system/export/transactions.csv`).

---

## 5. Operations & Execution Guide

### Local Launch (Development / Standalone)
```bash
./start.sh
```
Starts FastAPI backend on `http://localhost:8000` and Next.js frontend on `http://localhost:3000`.

### Docker Compose Launch (Production / Containerized)
```bash
docker compose up -d
```
Runs `finance-backend` and `finance-web` containers with local database persistence (`./backend/data:/app/data`).

### Database Migrations (Alembic)
```bash
python -m alembic upgrade head
```
Applies all database migration revisions located in `backend/alembic/versions/`.
