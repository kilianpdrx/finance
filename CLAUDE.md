# Finance Dashboard

Personal finance management app with CSV import, transaction categorization, budgeting, and analytics.

## Quick Start

```bash
./start.sh
# Frontend: http://localhost:5173
# Backend:  http://localhost:8000
# API docs: http://localhost:8000/docs
```

Requires conda env `finenv` (Python 3.11). The script activates it, installs deps, and starts both servers.

## Architecture

- **Backend**: FastAPI + SQLAlchemy async (aiosqlite) — `backend/`
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS — `frontend/`
- **Database**: SQLite at `backend/data/finance.db` (auto-created on startup)
- **State**: Zustand stores (date range, theme, accounts)
- **Charts**: Recharts
- **Data grid**: AG Grid Community

## Project Structure

```
backend/
  main.py              # FastAPI app, lifespan (DB init + seed + migrations)
  database.py          # SQLAlchemy async engine, session factory
  models.py            # ORM models (Account, Transaction, Category, etc.)
  schemas.py           # Pydantic request/response schemas
  seed.py              # Default categories (~14) and rules (~70)
  utils.py             # generate_import_hash, etc.
  routers/
    accounts.py        # /api/accounts — CRUD, snapshots, computed balance
    transactions.py    # /api/transactions — list/filter/CRUD/export CSV/bulk ops
    categories.py      # /api/categories — CRUD, rules CRUD, rescan
    analytics.py       # /api/analytics — summary, by-category, cash-flow, net-worth, budget
    upload.py          # /api/upload — detect, parse-preview, confirm, save-profile
    bank_profiles.py   # /api/bank-profiles — CRUD
    ml.py              # /api/ml — train/status/suggest-rules
    investments.py     # /api/investments — investment accounts + total series
  services/
    csv_parser.py      # Parse CSV bytes using BankProfile column mapping
    bank_detector.py   # Auto-detect bank from CSV headers
    categorizer.py     # Rule-based (AND/OR) transaction categorization, returns (category_id, source)
    transfer_detector.py # Detect internal transfers between accounts
    ml_trainer.py      # ML categorization model (scikit-learn)

frontend/src/
  main.tsx             # React entry point
  App.tsx              # Router setup, layout (Sidebar + TopBar + content)
  index.css            # Tailwind + AG Grid dark mode overrides
  api/client.ts        # HTTP client wrapping all backend endpoints
  store/index.ts       # Zustand: useDateRangeStore, useThemeStore, useAccountsStore
  types/index.ts       # TypeScript interfaces (Transaction, Category, Account, etc.)
  pages/
    Dashboard.tsx      # / — KPIs + charts
    Transactions.tsx   # /transactions — AG Grid with filters, month timeline
    Accounts.tsx       # /comptes — Account cards, snapshots, net worth chart
    Analytics.tsx      # /analyses — 4-tab analytics (summary, by-category, cash-flow, recurring)
    Budget.tsx         # /budget — 24-month continuous budget table
    Investments.tsx    # /investissements — Investment portfolio
    Upload.tsx         # /importer — Drag-drop CSV import flow
    Settings.tsx       # /parametres — Categories, Rules, ML, Exchange rates tabs
  components/
    layout/Sidebar.tsx, TopBar.tsx
    charts/AccountBreakdown, CashFlowOverTime, NetWorthEvolution, SpendingByCategory
    tables/TransactionTable.tsx — AG Grid with custom filters, inline editing
    AccountFilter.tsx
```

## Key Conventions

### Data
- **Amounts**: Always stored as integer cents in DB. Use `cents_to_display()` from schemas.py for formatting.
- **Dedup**: SHA-256 of `"{date}|{description}|{amount_cents}|{D or C}"` as `import_hash` (unique constraint).
- **Dates**: ISO 8601 (`YYYY-MM-DD`) in API; `dd/MM/yyyy` in UI via date-fns.
- **Currencies**: Accounts have a `currency` field for display purposes.

### Categories
- Types: `is_income=True` (Revenus), `expense_type="fixed"` (Dépenses fixes), `expense_type="variable"` (Dépenses variables).
- Can be account-specific (`account_id`) or global (`account_id=null`).
- Rules use AND or OR logic (`logic_operator` field, default "AND") on conditions `[{field, operator, value}]`, evaluated by priority (lower = first).

### UI
- All user-facing text in **French**.
- Dark mode supported via `useThemeStore` (persisted to localStorage).
- Default date range: "Cette année".
- Sidebar order: Tableau de bord, Budget, Transactions, Analyses, Comptes, Investissements, Importer, Paramètres.

### Import Flow
1. `POST /api/upload/detect` — returns raw headers + preview for column mapping
2. `POST /api/upload/parse-preview` — parses CSV with mapping, flags duplicates (DB + intra-file)
3. `POST /api/upload/save-profile` — saves reusable bank profile
4. `POST /api/upload/confirm` — imports transactions, supports `force_import_hashes` for duplicate override

### Budget
- 24-month continuous timeline (merges multiple year API responses).
- Manual edits stored as `BudgetEntry` (category + month + expected_cents + account_id).
- Display value: past/current months = actual + expected, future = expected only.

### Net Worth / Patrimoine
- `AccountBalanceSnapshot` stores point-in-time balances.
- Net worth endpoint applies snapshot offset to ALL months (shifts entire curve).
- Summary endpoint: snapshot + transactions after snapshot date.

## Development

### Environment Setup
**IMPORTANT**: Always activate the conda environment before running any command:
```bash
source /opt/miniconda3/etc/profile.d/conda.sh && conda activate finenv
```

Node.js is at `/opt/homebrew/bin/node`. It is NOT on the default PATH in all shells. When running node/npm/npx commands in Bash tool calls, use one of:
```bash
# Option 1: Use node directly with full path
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node ./node_modules/.bin/tsc --noEmit

# Option 2: Prepend to PATH
PATH="/opt/homebrew/bin:$PATH" npm run dev
```

Python path: `/opt/miniconda3/envs/finenv/bin/python`

### Backend
```bash
cd backend
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm run dev          # Dev server on :5173 (proxies /api to :8000)
npx tsc --noEmit     # Type check
```

### Database
SQLite file at `backend/data/finance.db`. Schema migrations run automatically on startup via `main.py` lifespan. To reset: delete the file and restart.

Seeding happens automatically if the `categories` table is empty (checked via count at startup).
