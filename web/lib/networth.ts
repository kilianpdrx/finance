import type { Account, NetWorthPoint } from "@/lib/api/hooks";

/** Latest per-account balance from a net-worth series, in each account's own
 *  currency (falls back to the base-currency value when no native key exists). */
export function balancesFromNetWorth(nw: NetWorthPoint[], accounts: Account[]): Record<number, number> {
  if (!nw.length) return {};
  const last = nw[nw.length - 1];
  const map: Record<number, number> = {};
  for (const a of accounts) {
    const v = (last[`${a.name}_native`] ?? last[a.name]) as number | undefined;
    if (typeof v === "number") map[a.id] = v;
  }
  return map;
}

/** Latest wealth grouped by account type, in the BASE currency (cents) — used by
 *  the dashboard patrimoine pie so accounts in different currencies are comparable.
 *  Only positive balances are kept (credit / overdrawn accounts are excluded). */
export function patrimoineByType(nw: NetWorthPoint[], accounts: Account[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!nw.length) return out;
  const last = nw[nw.length - 1];
  for (const a of accounts) {
    const v = last[a.name] as number | undefined;
    if (typeof v !== "number" || v <= 0) continue;
    out[a.account_type] = (out[a.account_type] ?? 0) + v;
  }
  return out;
}
