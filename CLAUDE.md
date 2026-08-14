# CLAUDE.md — working notes for this repo

Personal finance dashboard, **local-only, single household**. FastAPI + async SQLAlchemy
(SQLite) backend, Next.js 15 App Router frontend. All UI text is **French**.

`CODEBASE_GUIDE.md` has the directory tree and module-by-module reference — read it for
"where does X live". This file covers **how to run things, the invariants that must not
break, and the traps**.

---

## Commands

```bash
./start.sh                 # both servers (dev, --reload); MODE=prod for a build
```

Backend (conda env `finenv`, run from `backend/`):
```bash
/opt/miniconda3/envs/finenv/bin/python3 -m pytest          # 122 tests, ~6s
/opt/miniconda3/envs/finenv/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
```
Note: plain `uvicorn main:app` has **no `--reload`** — after editing backend code you must
restart it, or you'll be testing stale code.

Frontend (from `web/`):
```bash
npm run typecheck        # tsc --noEmit — run after ANY schema change
npm test                 # vitest
npm run test:e2e         # playwright
npm run gen:api          # regenerate lib/api/schema.d.ts (needs backend running on :8000)
BACKEND_URL=http://127.0.0.1:8000 npx next dev -p 3000
```
Next's Fast Refresh sometimes misses edits in a long-running dev server — if a UI change
doesn't appear, **hard-reload the page** before assuming the code is wrong.

---

## Non-negotiable invariants

1. **Money is integer cents.** Never floats in the DB or in transit. Display via
   `cents_to_display()` (`schemas.py`). Amounts are stored **unsigned**; direction lives in
   `is_debit`.
2. **Every query is profile-scoped.** Add `profile_id == pid` to any new query touching user
   data. `pid` comes from `current_profile_id` (`dependencies.py`) via the `X-Profile-Id`
   header. This is the *only* isolation boundary — an unknown id 404s; an absent header
   falls back to the default profile.
3. **The ledger is immutable.** A transaction's `category_id` is assigned once and is not
   rewritten behind the user's back. Anything that reclassifies history must be explicit
   and opt-in (see rescan below).
4. **Schema changes need BOTH.** `init_db()` runs `create_all` (fresh DBs) *and*
   `sync_schema()` runs Alembic (existing DBs). `create_all` never ALTERs, so a new column
   or index needs an **idempotent** migration: inspect what exists, then
   `batch_alter_table` / `create_index`. Copy `010_category_archived.py` (column) or
   `011_txn_profile_index.py` (index). Bump `HEAD` in `tests/test_schema_migration.py`.
   Current head: `011_txn_profile_index`.
   *Known exception:* `budget_entries`' unique constraint omits `profile_id`. Changing it
   would need a full SQLite table rebuild and `category_id` is already profile-specific, so
   it's deliberately left alone.
5. **No auth by design.** Servers bind to `127.0.0.1` only (see the comments in
   `start.sh`). Anyone who can reach the port has full read/write to every profile. Never
   change the bind address or add a public listener.

---

## Domain logic that isn't obvious

**Categories are a 2-level tree with grouping-only parents.** A category that has children
cannot hold transactions; `_ensure_parent_group()` auto-creates an `Autre {parent}` leaf,
moves the parent's transactions into it, and re-points rules. Idempotent, re-run at
startup. Guard: `_reject_grouping_category()` in `transactions.py`.

**Archiving is a soft lifecycle flag, not deletion.** `archived` hides a category from
everywhere you *pick* one, but it still shows in read-only historical views when it has
data in range. Archiving cascades to children and deactivates rules targeting the subtree;
un-archiving a child under an archived parent is blocked; rules can't target an archived
category. `/categories/archive-suggestions` proposes categories idle >12 months
(`archive_dismissed` snoozes it). Frontend: `CategorySelect` hides archived with an
"afficher les archivées" reveal; `ArchivedBadge` is the shared visual.

**Rescan defaults to safe.** `POST /categories/rescan` is `scope=uncategorized` by default
— it only fills rows with no category. `scope=all` rewrites non-`is_manually_reviewed`
history and is gated behind a destructive confirm in the Règles tab. It uses
`categorize_batch` (rules loaded once) — never loop `categorize()` per row.

**A closed account keeps its history.** `DELETE /accounts/{id}` is a soft close
(`is_active = False`). Its transactions **stay** in all historical analytics — you did
spend that money — and only its *balance* leaves net worth (the `is_active` filter in
`summary`). It stays reachable via `GET /accounts?include_inactive=true` (frontend:
`useAllAccounts()`) so the history remains filterable, shown with a `ClosedBadge`. Pickers
use `useAccounts()` (active only). Reopen with `PUT {is_active: true}`.

**FX converts at the transaction's period, not today.**
- Flows (`summary` income/expenses, `by-category`, `spending-trends`, `cash-flow`) and the
  net-worth-over-time chart convert each `(currency, month)` bucket at `_month_end(month)`.
- Net worth **as of now** (the summary KPI + `net_worth_by_currency`) stays at today's rate
  — it's a current snapshot.
- This makes the startup `backfill_range` historical rates load-bearing. If you add a new
  aggregation, convert at the row's period, not `date.today()`.
- Missing rate → `convert_cents_checked` returns `ok=False`, the amount passes through
  unconverted, and `AnalyticsSummary.fx_incomplete` drives a dashboard warning banner.
- In analytics, convert through the per-request `RateCache` (`rates.convert()` /
  `rates.convert_checked()`), not the bare functions — the same `(pair, date)` recurs
  across every category/account bucket. Never share a `RateCache` between requests.

**Price history is fetched concurrently and pre-warmed.** `_holdings_monthly_values` and
`account_performance` `asyncio.gather` their per-holding `fetch_historical_prices` calls —
never re-introduce a sequential `await` in a loop there; it put ~4s of blocking network I/O
on the dashboard's critical path. `warm_history_cache()` runs from the background startup
task and the 15-min refresh job because `_history_cache` is in-memory with a 1h TTL.

**CSV import never drops rows silently.** `parse_csv` returns
`(transactions, ParseReport)`; every skip is counted by reason with sample rows, surfaced
as `skipped` (parse-preview) / `unparsed` (confirm) and shown in the review step's
« ignorées » card. `_parse_amount` returns `None` for unparseable and `0` for a genuine
zero — keep that distinction.

**Import dedup** = SHA-256 of `{account_id}|{date}|{description}|{amount_cents}|{is_debit}`
(`generate_import_hash`, `utils.py` — `account_id` and `is_debit` are optional and omitted
from the hash when `None`). Account-scoped, with the legacy no-account hash also checked so
older imports still dedupe. Intra-file duplicates are caught too; force-import mints a
unique hash. `import_hash` is globally UNIQUE.

**Internal transfers** are detected by exact `amount_cents` + opposite direction +
different account within 3 days, requiring a description signal (counterpart account name,
or a transfer keyword on both) — otherwise only accepted when unambiguous. Matched pairs
get `category_id = None` so they don't pollute budgets. Cross-currency transfers are **not**
detected (exact-cents match only).

**Investment accounts**: holdings value *supersedes* the snapshot/transaction balance in
net worth (avoids double-counting) — this assumes such accounts hold no loose cash.

---

## Conventions

- Dates ISO 8601 in the API, `dd/MM/yyyy` in the UI (date-fns).
- Bulk id operations chunk at 900 (`_ID_CHUNK`) — SQLite's variable cap is 999.
- Backend errors: `HTTPException` with a **French** `detail`; the frontend surfaces it.
- Frontend data access goes through `web/lib/api/hooks.ts` (TanStack Query). Query keys are
  arrays like `["analytics", "summary", query]`, `["categories"]`. `client.ts` patches
  `window.fetch` to inject `X-Profile-Id` on every `/api/*` call.
- Types are generated: after changing a Pydantic schema, regenerate `schema.d.ts` and run
  `typecheck`. A field with a default becomes **required** in the generated TS type — that's
  why output-only fields belong on `*Out` models, not on shared bases.
- Zustand stores (`web/lib/stores.ts`, localStorage-persisted): `useDateRangeStore`,
  `useProfileStore`, `useSelectedAccountsStore`, `usePrivacyStore` (amount masking).
  Dark/light is **next-themes**, not a store.
- Requests are same-origin `/api/*`, proxied server-side by `web/app/api/[...path]/route.ts`
  to `BACKEND_URL`. The browser never calls :8000 directly (so the backend's CORS config is
  effectively unused).

---

## Data & safety

- Everything lives in `backend/data/finance.db` (gitignored, WAL mode).
- Profiles in this install: **1 = Kilian, 2 = Maman**.
- Treat the DB as **real personal data**: don't mutate categories/transactions to "try
  something" — write a test with the `seed_data` fixture instead (`tests/conftest.py`
  builds an isolated temp DB).
- Bank CSVs (`csv files/`) and `autre/` are gitignored — never commit them.
- Backup/restore is in-app: Paramètres → Sauvegarde (`/api/system/backup|restore`).

---

## Testing

- Backend: `backend/tests/`, pytest with `asyncio_mode=auto`. Shared fixtures in
  `conftest.py`: `test_engine` (temp SQLite), `db_session`, `client` (httpx ASGI +
  overridden `get_db`), `seed_data` (profile + 2 accounts + 2 categories + base currency
  EUR), `extra_profile` (a second profile, for isolation checks).
- FX tests must avoid the network: pre-seed an `ExchangeRate` row, or call
  `fx._mark_pair_failed(a, b)` to force the offline path.
- Frontend: vitest unit tests colocated (`*.test.ts[x]`), Playwright specs in `web/e2e/`.
- Add a test for every backend behavior change; the suite is fast and currently green.
