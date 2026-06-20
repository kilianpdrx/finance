# Finance — Web (Next.js)

Next.js 15 (App Router) frontend that re-platforms the legacy Vite SPA in `../frontend`.
It is a **BFF over the existing FastAPI backend** — the Python backend (ML, pandas,
analytics) is unchanged. `next.config.ts` rewrites `/api/*` → `http://localhost:8000`.

## Stack

- **Next.js 15 + React 19** (App Router)
- **Tailwind v4** with semantic design tokens in `app/globals.css` (OKLCH, `@theme`)
- **shadcn-style primitives** (Radix) in `components/ui`
- **TanStack Query** for server state (`lib/api/hooks.ts`)
- **Typed API client** generated from the backend OpenAPI schema (`lib/api/schema.d.ts`)
- **next-themes** (light/dark), **Sonner** (toasts), **Framer Motion** (animation)

## Develop

```bash
# from repo root — runs backend + this app
./start.sh                 # http://localhost:3000  (UI=legacy ./start.sh for old SPA)

# or this app alone (backend must be on :8000)
npm install
npm run dev
```

## Regenerate API types

After changing backend schemas, with the backend running on :8000:

```bash
npm run gen:api            # → lib/api/schema.d.ts
```

## Migration status

- [x] Phase 0 — scaffold, tokens, providers, typed client, shell
- [x] Dashboard (`/`) ported end-to-end with live data
- [x] All pages ported: Transactions, Budget, Analyses, Comptes, Investissements, Importer, Paramètres
- [ ] Phase 2 — live FX + market data (backend); then forecasting / AI assistant
