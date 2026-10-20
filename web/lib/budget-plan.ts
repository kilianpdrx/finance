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
export type EnvelopeCategory = components["schemas"]["EnvelopeCategoryOut"];
export type CategoryStats = components["schemas"]["CategoryStatsOut"];
export type EnvelopeLine = components["schemas"]["EnvelopeLineOut"];

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

/** What the envelopes' amounts add up to. The same figures in the editor and
 *  in the plan once saved: nothing else (a « Planifier » entry, say) is added. */
export function planTotals(envelopes: Pick<Envelope, "kind" | "amount_cents">[]): PlanTotals {
  const sum = (kind: EnvelopeKind) => envelopes.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount_cents, 0);
  const income = sum("income"), ceilings = sum("expense"), goals = sum("goal"), provision = sum("unplanned");
  return { income, ceilings, goals, provision, unassigned: income - ceilings - goals - provision };
}

// ── The editor's working copy ────────────────────────────────────────────────

/** A sub-line as typed: a name and an amount, no category behind it. */
export interface DraftLine {
  key: string;
  name: string;
  amount: string;
}

export interface DraftEnvelope {
  key: string;                 // stable while editing (an id, or a local key for a new one)
  id: number | null;
  name: string;
  kind: EnvelopeKind;
  amount: string;              // as typed: the envelope planned as ONE figure
  categoryIds: number[];
  /** The detail, as typed: what is planned for a category alone. A category
   *  without an entry (or with an empty one) has no line of its own. */
  categoryAmounts: Record<number, string>;
  /** Sub-lines that are not categories (« Épargne », « Actions »). Each one is
   *  a line: the envelope is then the sum of its lines. */
  lines: DraftLine[];
  note: string;
}

/** "412,50" → 41250. Empty or unreadable is 0: an amount is never negative. */
export function amountToCents(text: string): number {
  const n = Number(String(text).trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export function centsToAmount(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");
}

/** Something was typed: an empty cell is "no line", a typed 0 is a line. */
function hasLine(text: string | undefined): boolean {
  return text != null && text.trim() !== "";
}

type Lines = Pick<DraftEnvelope, "kind" | "amount" | "categoryIds" | "categoryAmounts" | "lines">;

/** Planned line by line: a category with a line, or a sub-line. */
export function isDetailed(d: Omit<Lines, "amount">): boolean {
  return d.kind !== "unplanned" && (d.lines.length > 0 || d.categoryIds.some((id) => hasLine(d.categoryAmounts[id])));
}

/** What the envelope plans per month. With a detail it IS the sum of its lines,
 *  categories and sub-lines alike (a blank one counts for nothing) — the one
 *  figure is then not read, so the two can never disagree. */
export function draftAmountCents(d: Lines): number {
  if (!isDetailed(d)) return amountToCents(d.amount);
  return d.categoryIds.reduce((sum, id) => sum + amountToCents(d.categoryAmounts[id] ?? ""), 0)
    + d.lines.reduce((sum, line) => sum + amountToCents(line.amount), 0);
}

export function draftsFromPlan(plan: Pick<BudgetPlan, "envelopes">): DraftEnvelope[] {
  return plan.envelopes.map((e, i) => ({
    key: e.id != null ? `e${e.id}` : `p${i}`,
    id: e.id ?? null,
    name: e.name,
    kind: e.kind,
    amount: centsToAmount(e.amount_cents),
    categoryIds: [...e.category_ids],
    categoryAmounts: Object.fromEntries(
      (e.categories ?? []).flatMap((c) => (c.amount_cents != null ? [[c.category_id, centsToAmount(c.amount_cents)]] : [])),
    ),
    lines: (e.lines ?? []).map((line, j) => ({ key: `l${line.id ?? `${i}-${j}`}`, name: line.name, amount: centsToAmount(line.amount_cents) })),
    note: e.note ?? "",
  }));
}

/** Put a category in one envelope (or in none: `toKey` null). A category is in
 *  at most one envelope, so it leaves wherever it was. Its line follows it only
 *  into an envelope already planned line by line: dropped into one planned as a
 *  single figure, it would turn that figure into its own amount. */
export function moveCategory(drafts: DraftEnvelope[], categoryId: number, toKey: string | null): DraftEnvelope[] {
  const carried = drafts.map((d) => d.categoryAmounts[categoryId]).find(hasLine);
  return drafts.map((d) => {
    const without = d.categoryIds.filter((c) => c !== categoryId);
    const { [categoryId]: _left, ...amounts } = d.categoryAmounts;
    if (d.key !== toKey) return { ...d, categoryIds: without, categoryAmounts: amounts };
    const keep = carried !== undefined && isDetailed({ ...d, categoryIds: without, categoryAmounts: amounts });
    return { ...d, categoryIds: [...without, categoryId], categoryAmounts: keep ? { ...amounts, [categoryId]: carried } : amounts };
  });
}

/** Type an amount on a category's line, in whichever envelope holds it. */
export function setCategoryAmount(drafts: DraftEnvelope[], categoryId: number, text: string): DraftEnvelope[] {
  return drafts.map((d) => (d.categoryIds.includes(categoryId) ? { ...d, categoryAmounts: { ...d.categoryAmounts, [categoryId]: text } } : d));
}

/** Start an envelope's detail from what each category usually does: its typical
 *  month, to the unit. A category with no history gets a 0 to correct. */
export function fillWithTypical(d: DraftEnvelope, typicalOf: (categoryId: number) => number | null | undefined): DraftEnvelope {
  return {
    ...d,
    categoryAmounts: Object.fromEntries(d.categoryIds.map((id) => [id, centsToAmount(Math.round(Math.max(0, typicalOf(id) ?? 0) / 100) * 100)])),
  };
}

/** Back to one figure: the lines go — category lines and sub-lines — and what
 *  they added up to stays. */
export function clearDetail(d: DraftEnvelope): DraftEnvelope {
  return { ...d, amount: centsToAmount(draftAmountCents(d)), categoryAmounts: {}, lines: [] };
}

export function draftsToPayload(drafts: DraftEnvelope[]): EnvelopeIn[] {
  return drafts.map((d) => {
    const base = {
      id: d.id,
      name: d.name.trim(),
      kind: d.kind,
      amount_cents: draftAmountCents(d),
      category_ids: d.kind === "unplanned" ? [] : d.categoryIds,
      note: d.note.trim() ? d.note : null,
    };
    if (!isDetailed(d)) return base;
    return {
      ...base,
      category_amounts: Object.fromEntries(
        d.categoryIds.filter((id) => hasLine(d.categoryAmounts[id])).map((id) => [id, amountToCents(d.categoryAmounts[id])]),
      ),
      lines: d.lines.map((line) => ({ name: line.name.trim(), amount_cents: amountToCents(line.amount) })),
    };
  });
}

let lineKeys = 0;
/** A new, empty sub-line at the end of an envelope. */
export function addLine(d: DraftEnvelope, name = ""): DraftEnvelope {
  return { ...d, lines: [...d.lines, { key: `nl${lineKeys++}`, name, amount: "" }] };
}

export function setLine(d: DraftEnvelope, key: string, change: Partial<Omit<DraftLine, "key">>): DraftEnvelope {
  return { ...d, lines: d.lines.map((line) => (line.key === key ? { ...line, ...change } : line)) };
}

export function removeLine(d: DraftEnvelope, key: string): DraftEnvelope {
  return { ...d, lines: d.lines.filter((line) => line.key !== key) };
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
