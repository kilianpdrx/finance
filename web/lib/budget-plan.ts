import type { components } from "@/lib/api/schema";

/** The monthly budget plan of one account: a few envelopes read against what
 *  the budget table adds up. The arithmetic is done by the API
 *  (`services/budget_plan.py`); this is how the screens READ it. */

export type BudgetPlan = components["schemas"]["BudgetPlanOut"];
export type Envelope = components["schemas"]["EnvelopeOut"];
export type EnvelopeIn = components["schemas"]["EnvelopeIn"];
export type EnvelopeKind = Envelope["kind"];
export type BudgetEvolution = components["schemas"]["BudgetEvolutionOut"];
export type EvolutionRow = components["schemas"]["EvolutionRow"];
export type UnplannedSuggestion = components["schemas"]["UnplannedSuggestion"];

export const KIND_LABEL: Record<EnvelopeKind, string> = {
  income: "Revenus",
  expense: "Dépenses",
  goal: "Objectif",
  unplanned: "Imprévus",
};

/** What the amount means, in the words shown next to it. */
export const AMOUNT_LABEL: Record<EnvelopeKind, string> = {
  income: "attendu",
  expense: "plafond",
  goal: "objectif",
  unplanned: "provision",
};

/** What happened, in the words shown under a bar. */
export const DONE_LABEL: Record<EnvelopeKind, string> = {
  income: "reçus",
  expense: "dépensés",
  goal: "investis",
  unplanned: "d'imprévus",
};

/** Income and investment goals are amounts to REACH; the others are not to exceed. */
export function isMinimum(kind: string): boolean {
  return kind === "income" || kind === "goal";
}

export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** How far into `month` we are today, from 0 to 1 — the tick on the bars. A past
 *  month is over (1), a future one has not started (0). */
export function monthPace(month: string, today: Date): number {
  const current = monthOf(today);
  if (month < current) return 1;
  if (month > current) return 0;
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() / days;
}

/** How a realised amount reads against its target.
 *  - "none": nothing to compare with (no plan that month).
 *  - a ceiling is "over" once exceeded, "ok" otherwise;
 *  - a minimum is "reached" once met; before that it is "short" only when the
 *    month is over — until then there is still time, so it is "ok". */
export type Standing = "none" | "ok" | "over" | "reached" | "short";
export function standing(kind: string, realised: number, target: number | null | undefined, monthOver: boolean): Standing {
  if (target == null) return "none";
  if (isMinimum(kind)) {
    if (realised >= target) return "reached";
    return monthOver ? "short" : "ok";
  }
  return realised > target ? "over" : "ok";
}

/** Width of a progress bar, 0–100. Spending without any amount planned fills it. */
export function barFill(realised: number, target: number): number {
  if (target <= 0) return realised > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (realised / target) * 100));
}

export interface PlanTotals {
  income: number;      // planned to come in
  ceilings: number;    // planned to be spent at most
  goals: number;       // planned to be invested at least
  provision: number;   // set aside for the unplanned
  /** What the plan leaves unassigned. Negative: it spends more than it earns. */
  unassigned: number;
}

/** What the envelopes' targets add up to for the month shown. */
export function planTotals(envelopes: Pick<Envelope, "kind" | "target_cents">[]): PlanTotals {
  const sum = (kind: EnvelopeKind) => envelopes.filter((e) => e.kind === kind).reduce((s, e) => s + e.target_cents, 0);
  const income = sum("income"), ceilings = sum("expense"), goals = sum("goal"), provision = sum("unplanned");
  return { income, ceilings, goals, provision, unassigned: income - ceilings - goals - provision };
}

// ── The editor's working copy ────────────────────────────────────────────────

export interface DraftEnvelope {
  key: string;                 // stable while editing (an id, or a local key for a new one)
  id: number | null;
  name: string;
  kind: EnvelopeKind;
  amount: string;              // as typed
  categoryIds: number[];
}

/** "412,50" → 41250. Empty or unreadable is 0: an amount is never negative. */
export function amountToCents(text: string): number {
  const n = Number(String(text).trim().replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export function centsToAmount(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");
}

export function draftsFromPlan(plan: Pick<BudgetPlan, "envelopes">): DraftEnvelope[] {
  return plan.envelopes.map((e, i) => ({
    key: e.id != null ? `e${e.id}` : `p${i}`,
    id: e.id ?? null,
    name: e.name,
    kind: e.kind,
    amount: centsToAmount(e.amount_cents),
    categoryIds: [...e.category_ids],
  }));
}

/** Put a category in one envelope (or in none: `toKey` null). A category is in
 *  at most one envelope, so it leaves wherever it was. */
export function moveCategory(drafts: DraftEnvelope[], categoryId: number, toKey: string | null): DraftEnvelope[] {
  return drafts.map((d) => {
    const without = d.categoryIds.filter((c) => c !== categoryId);
    return { ...d, categoryIds: d.key === toKey ? [...without, categoryId] : without };
  });
}

export function draftsToPayload(drafts: DraftEnvelope[]): EnvelopeIn[] {
  return drafts.map((d) => ({
    id: d.id,
    name: d.name.trim(),
    kind: d.kind,
    amount_cents: amountToCents(d.amount),
    category_ids: d.kind === "unplanned" ? [] : d.categoryIds,
  }));
}

/** The categories an envelope of this account may hold: unarchived leaves,
 *  global or bound to this account (mirrors `eligible_categories` in the API). */
export function eligibleCategories<C extends { id: number; parent_id?: number | null; account_id?: number | null; archived?: boolean }>(
  categories: C[],
  accountId: number,
): C[] {
  const parents = new Set(categories.map((c) => c.parent_id).filter((p): p is number => p != null));
  return categories.filter((c) => !c.archived && !parents.has(c.id) && (c.account_id == null || c.account_id === accountId));
}

/** An envelope takes the categories of its own side: income ones for income. */
export function fitsKind(category: { is_income?: boolean }, kind: EnvelopeKind): boolean {
  if (kind === "unplanned") return false;
  return Boolean(category.is_income) === (kind === "income");
}
