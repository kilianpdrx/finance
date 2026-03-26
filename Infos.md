# Finance Dashboard — Claude Code Guide

## Project Overview
Local-first personal finance dashboard. Python/FastAPI backend + React/TypeScript frontend.

## Architecture
- **Backend**: FastAPI + SQLAlchemy async (aiosqlite) — `backend/`
- **Frontend**: React + Vite + TypeScript + Tailwind — `frontend/`
- **Database**: SQLite at `backend/data/finance.db`
- **ML Model**: scikit-learn pipeline at `backend/data/model.pkl`

## Key Conventions

### Amounts
- Always stored as **Integer cents** in the database (no floats)
- Parse: `int(round(float(s.replace(",", ".").replace(" ", "")) * 100))`
- Display: `f"{abs(cents)//100} €"` with space thousands separator

### Deduplication
SHA-256 hash of `"{date}|{description}|{amount_cents}"` stored as `import_hash` (unique constraint).

### Date Handling
- Backend: ISO 8601 strings in JSON
- Frontend display: `DD/MM/YYYY` via date-fns

## Running Locally
```bash
bash start.sh
```
Then open http://localhost:5173

## Backend API
All routes prefixed with `/api`. FastAPI docs at http://localhost:8000/docs

## Routers
- `/api/accounts` — account CRUD
- `/api/transactions` — transaction list/edit/export
- `/api/categories` — category + rule CRUD
- `/api/upload` — CSV detect + confirm
- `/api/analytics` — summary, by-category, cash-flow, net-worth, recurring
- `/api/ml` — train + status

## Language
UI is entirely in French. Comments and code in English.
