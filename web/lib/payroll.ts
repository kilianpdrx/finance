import type { Payslip, PayrollSituation } from "@/lib/api/hooks";

/** Salaire & impôts: what the board and the review compute from payslips.
 *  Amounts are integer cents, rates basis points (10,56 % = 1056). */

export type Kind = "gross" | "social" | "pension" | "tax" | "deduction" | "addition" | "retained" | "released" | "info";

export const KIND_LABEL: Record<Kind, string> = {
  gross: "Salaire brut",
  social: "Cotisations sociales",
  pension: "Prévoyance",
  tax: "Impôt à la source",
  deduction: "Autre retenue",
  addition: "Ajout",
  retained: "Retenu jusqu'à la fin du contrat",
  released: "Versement du retenu",
  info: "Information",
};
/** Taken off the gross on the way to the net paid, in the order a payslip shows them. */
export const TAKEN: Kind[] = ["social", "pension", "tax", "deduction", "retained"];
export const KIND_ORDER: Kind[] = ["gross", "social", "pension", "tax", "deduction", "addition", "retained", "released", "info"];
/** What a line does to the net paid: added, taken off, nothing. */
export const EFFECT: Record<Kind, 1 | -1 | 0> = {
  gross: 1, social: -1, pension: -1, tax: -1, deduction: -1, addition: 1, retained: -1, released: 1, info: 0,
};

export interface LineLike {
  kind: Kind | null;          // null: « à classer »
  amount_cents: number;
}

const sum = (lines: LineLike[], ...kinds: Kind[]) =>
  lines.reduce((s, l) => s + (l.kind && kinds.includes(l.kind) ? l.amount_cents : 0), 0);

/** The net the lines give: gross − contributions − tax − other deductions −
 *  pay held back + additions + held-back pay paid out. Mirrors `figures` in
 *  services/payroll/reading.py: the review compares it with the printed net
 *  while the user classifies the lines. */
export function linesNet(lines: LineLike[], grossCents?: number | null): number {
  const gross = grossCents ?? sum(lines, "gross");
  return lines.reduce((net, l) => net + (l.kind && l.kind !== "gross" ? EFFECT[l.kind] * l.amount_cents : 0), gross);
}

export function unclassified(lines: LineLike[]): number {
  return lines.filter((l) => l.kind == null).length;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export type BlockId = "unclassified" | "gross" | "contributions" | "tax" | "other" | "retained" | "info";

export interface Block {
  id: BlockId;
  title: string;
  kinds: (Kind | null)[];
  /** The intermediate line closing the block; none for what is not counted. */
  subtotal: string | null;
  /** Mixes money taken off and added: its total is shown with its sign. */
  signed: boolean;
  /** Tailwind classes, written out so the build keeps them. */
  tone: { text: string; border: string; tint: string; bar: string };
}

/** A payslip's lines, block by block, in the order a payslip reads — the one
 *  definition of the review's blocks and of the « Le mois » cascade. What is
 *  not classified yet comes first, to be seen. */
export const BLOCKS: Block[] = [
  { id: "unclassified", title: "À classer", kinds: [null], subtotal: null, signed: false,
    tone: { text: "text-warning", border: "border-l-warning", tint: "bg-warning/10", bar: "bg-warning" } },
  { id: "gross", title: "Salaire brut", kinds: ["gross"], subtotal: "Total brut", signed: false,
    tone: { text: "text-positive", border: "border-l-positive", tint: "bg-positive/10", bar: "bg-positive" } },
  { id: "contributions", title: "Cotisations", kinds: ["social", "pension"], subtotal: "Total cotisations", signed: false,
    tone: { text: "text-orange-600 dark:text-orange-400", border: "border-l-orange-500", tint: "bg-orange-500/10", bar: "bg-orange-500" } },
  { id: "tax", title: "Impôt à la source", kinds: ["tax"], subtotal: "Total impôt", signed: false,
    tone: { text: "text-negative", border: "border-l-negative", tint: "bg-negative/10", bar: "bg-negative" } },
  { id: "other", title: "Autres retenues et ajouts", kinds: ["deduction", "addition"], subtotal: "Total autres", signed: true,
    tone: { text: "text-info", border: "border-l-info", tint: "bg-info/10", bar: "bg-info" } },
  { id: "retained", title: "Retenu jusqu'à la fin du contrat", kinds: ["retained", "released"], subtotal: "Total retenu", signed: true,
    tone: { text: "text-violet-600 dark:text-violet-400", border: "border-l-violet-500", tint: "bg-violet-500/10", bar: "bg-violet-500" } },
  { id: "info", title: "Informations (non comptées)", kinds: ["info"], subtotal: null, signed: false,
    tone: { text: "text-muted-foreground", border: "border-l-border", tint: "bg-muted/60", bar: "bg-muted-foreground" } },
];

const BLOCK_OF = new Map(BLOCKS.flatMap((b) => b.kinds.map((k) => [k, b] as const)));
export const blockOf = (kind: Kind | null): Block => BLOCK_OF.get(kind)!;
export const blockIndex = (kind: Kind | null): number => BLOCKS.indexOf(blockOf(kind));

/** A block's total: the plain sum, or — for a signed block — what it does to
 *  the net (a canteen of 120 and expenses of 150 make +30). */
export function blockTotal(block: Block, lines: LineLike[]): number {
  return lines.reduce((s, l) => {
    if (!block.kinds.includes(l.kind)) return s;
    return s + (block.signed && l.kind ? EFFECT[l.kind] * l.amount_cents : l.amount_cents);
  }, 0);
}

/** The situation in force for a year: the latest that started that year or
 *  before, else the first one (mirrors `_in_force` in routers/payroll.py). */
export function situationFor(situations: PayrollSituation[], year: number): PayrollSituation | null {
  const sorted = [...situations].sort((a, b) => a.from_year - b.from_year);
  const before = sorted.filter((s) => s.from_year <= year);
  return before.at(-1) ?? sorted[0] ?? null;
}

// ── One month ───────────────────────────────────────────────────────────────

export interface Step {
  block: Block;
  /** What the step does to the net: positive adds, negative takes off. */
  effect: number;
  lines: Payslip["lines"];
}

/** A payslip as the « Le mois » cascade reads it: after the gross, each
 *  counted block that moves money, in the review's order. A payslip typed
 *  without lines still has its figures. */
export function breakdown(p: Payslip): Step[] {
  const steps: Step[] = [];
  for (const block of BLOCKS) {
    if (block.id === "unclassified" || block.id === "info" || block.id === "gross") continue;
    const lines = p.lines.filter((l) => block.kinds.includes(l.kind as Kind));
    let effect = lines.reduce((s, l) => s + EFFECT[l.kind as Kind] * l.amount_cents, 0);
    if (block.id === "contributions" && lines.length === 0) effect = -p.employee_contributions_cents;
    if (block.id === "tax" && lines.length === 0) effect = -p.withholding_cents;
    if (effect !== 0 || lines.length > 0) steps.push({ block, effect, lines });
  }
  return steps;
}

// ── Held back until the end of the contract ─────────────────────────────────

export interface HeldMonth { period: string; retained: number; released: number; balance: number }

export interface Held {
  employerId: number;
  /** Still owed: every « Rückbehalt » less what was paid out. */
  balance: number;
  retained: number;
  released: number;
  since: string;
  months: HeldMonth[];
  labels: string[];
}

const kindSum = (lines: Payslip["lines"], kind: Kind) => lines.reduce((s, l) => s + (l.kind === kind ? l.amount_cents : 0), 0);

/** Per employer that ever held pay back: month after month, what it held,
 *  what it paid out, and what it still owes. Computed, never stored. */
export function heldBack(payslips: Payslip[]): Held[] {
  const by = new Map<number, Held>();
  for (const p of [...payslips].sort((a, b) => a.period.localeCompare(b.period))) {
    const retained = kindSum(p.lines, "retained");
    const released = kindSum(p.lines, "released");
    let held = by.get(p.employer_id);
    if (!held) {
      if (!retained && !released) continue;
      held = { employerId: p.employer_id, balance: 0, retained: 0, released: 0, since: p.period, months: [], labels: [] };
      by.set(p.employer_id, held);
    }
    held.retained += retained;
    held.released += released;
    held.balance += retained - released;
    held.months.push({ period: p.period, retained, released, balance: held.balance });
    for (const l of p.lines) {
      if ((l.kind === "retained" || l.kind === "released") && !held.labels.includes(l.label)) held.labels.push(l.label);
    }
  }
  return [...by.values()];
}

/** What an employer still holds back for you at the end of a month. Null when it never held any. */
export function retainedBalance(payslips: Payslip[], employerId: number, upTo: string): { cents: number; since: string } | null {
  const held = heldBack(payslips.filter((p) => p.period <= upTo)).find((h) => h.employerId === employerId);
  return held ? { cents: held.balance, since: held.since } : null;
}

/** Lines the vocabulary calls held-back pay but saved as another type —
 *  classified before the app knew the type. Grouped by label. */
export function heldElsewhere(payslips: Payslip[]): { label: string; kind: Kind; payslips: Payslip[] }[] {
  const by = new Map<string, { label: string; kind: Kind; payslips: Payslip[] }>();
  for (const p of payslips) {
    for (const l of p.lines) {
      if ((l.vocab_kind === "retained" || l.vocab_kind === "released") && l.kind !== l.vocab_kind) {
        const entry = by.get(l.label) ?? { label: l.label, kind: l.kind as Kind, payslips: [] };
        if (!entry.payslips.includes(p)) entry.payslips.push(p);
        by.set(l.label, entry);
      }
    }
  }
  return [...by.values()];
}

// ── Over time ───────────────────────────────────────────────────────────────

export interface Point {
  period: string;             // YYYY-MM, or YYYY
  gross: number;
  contributions: number;
  tax: number;
  net: number;
  /** Held back until the end of the contract, less what was paid out of it:
   *  still the employee's money, only not paid yet. */
  held: number;
  months: number;
}

/** Month by month, or year by year, in one currency. Several employers in the
 *  same month add up. */
export function series(payslips: Payslip[], mode: "month" | "year"): Point[] {
  const by = new Map<string, Point>();
  for (const p of payslips) {
    const key = mode === "year" ? p.period.slice(0, 4) : p.period;
    const point = by.get(key) ?? { period: key, gross: 0, contributions: 0, tax: 0, net: 0, held: 0, months: 0 };
    point.gross += p.gross_cents;
    point.contributions += p.employee_contributions_cents;
    point.tax += p.withholding_cents;
    point.net += p.net_paid_cents;
    point.held += kindSum(p.lines, "retained") - kindSum(p.lines, "released");
    point.months += 1;
    by.set(key, point);
  }
  return [...by.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/** The months where the base salary changed: the payslip's largest gross line
 *  (a bonus month is not a raise). */
export function raises(payslips: Payslip[]): Set<string> {
  const base = (p: Payslip) => Math.max(0, ...p.lines.filter((l) => l.kind === "gross").map((l) => l.amount_cents));
  const out = new Set<string>();
  const sorted = [...payslips].sort((a, b) => a.period.localeCompare(b.period));
  for (let i = 1; i < sorted.length; i++) {
    const before = base(sorted[i - 1]);
    const now = base(sorted[i]);
    if (before > 0 && now > 0 && sorted[i].employer_id === sorted[i - 1].employer_id && Math.abs(now - before) > before * 0.005) {
      out.add(sorted[i].period);
    }
  }
  return out;
}

export interface Totals { gross: number; contributions: number; tax: number; net: number; months: number }

const totals = (payslips: Payslip[]): Totals => payslips.reduce((t, p) => ({
  gross: t.gross + p.gross_cents,
  contributions: t.contributions + p.employee_contributions_cents,
  tax: t.tax + p.withholding_cents,
  net: t.net + p.net_paid_cents,
  months: t.months + 1,
}), { gross: 0, contributions: 0, tax: 0, net: 0, months: 0 });

/** Shares of the gross, in basis points. */
export interface Rates {
  contributions: number | null;
  tax: number | null;
  /** Everything else between gross and net: other deductions, less what is
   *  added (expenses, allowances) — negative when additions win. */
  other: number | null;
  /** The share of the gross the employee does not get: (gross − net paid −
   *  pay held back) / gross. Held-back pay is theirs, only paid later
   *  (« Retenues en attente »): it is not counted as taken. */
  total: number | null;
}

/** The rates of a month or a year. `other` is what `total` leaves once
 *  contributions and tax are counted, so the three add up to `total` exactly —
 *  also for a payslip typed without lines. */
export function rates(p: Pick<Point, "gross" | "contributions" | "tax" | "net" | "held">): Rates {
  const contributions = share(p.contributions, p.gross);
  const tax = share(p.tax, p.gross);
  const total = share(p.gross - p.net - p.held, p.gross);
  return { contributions, tax, total, other: total == null ? null : total - (contributions ?? 0) - (tax ?? 0) };
}

export interface YearRate extends Rates { year: string; months: number }

/** Each year's rates: the year's totals over its total gross — not an average
 *  of the monthly rates, where a month with a bonus would weigh no more than
 *  any other. */
export function yearRates(payslips: Payslip[]): YearRate[] {
  return series(payslips, "year").map((p) => ({
    year: p.period, months: new Set(payslips.filter((x) => x.period.startsWith(p.period)).map((x) => x.period)).size,
    ...rates(p),
  }));
}

/** From January to the latest month paid this year, against the same months
 *  of the year before (the comparison would otherwise set 9 months against 12). */
export function yearToDate(payslips: Payslip[], year: number): { now: Totals; before: Totals; untilMonth: string | null } {
  const thisYear = payslips.filter((p) => p.period.startsWith(`${year}-`));
  const until = thisYear.map((p) => p.period.slice(5)).sort().at(-1) ?? null;
  const before = payslips.filter((p) => p.period.startsWith(`${year - 1}-`) && until != null && p.period.slice(5) <= until);
  return { now: totals(thisYear), before: totals(before), untilMonth: until };
}

/** Share of the gross, in basis points. */
export function share(part: number, gross: number): number | null {
  return gross > 0 ? Math.round((part / gross) * 10_000) : null;
}

export function formatRate(bp: number | null | undefined, decimals = 2): string {
  if (bp == null) return "—";
  return `${(bp / 100).toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} %`;
}

/** Months with no payslip between an employer's first and last one. */
export function gaps(payslips: Payslip[]): { employer_id: number; period: string }[] {
  const byEmployer = new Map<number, string[]>();
  for (const p of payslips) byEmployer.set(p.employer_id, [...(byEmployer.get(p.employer_id) ?? []), p.period]);
  const out: { employer_id: number; period: string }[] = [];
  for (const [employer_id, periods] of byEmployer) {
    const have = new Set(periods);
    const sorted = [...have].sort();
    let [y, m] = sorted[0].split("-").map(Number);
    const last = sorted.at(-1)!;
    for (;;) {
      const period = `${y}-${String(m).padStart(2, "0")}`;
      if (period >= last) break;
      if (!have.has(period)) out.push({ employer_id, period });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

// ── The period shown ────────────────────────────────────────────────────────

export type Range = { kind: "year"; year: number } | { kind: "12m" } | { kind: "all" };

export function inRange(payslips: Payslip[], range: Range): Payslip[] {
  if (range.kind === "all") return payslips;
  if (range.kind === "year") return payslips.filter((p) => p.period.startsWith(`${range.year}-`));
  const latest = payslips.map((p) => p.period).sort().at(-1);
  if (!latest) return [];
  const [y, m] = latest.split("-").map(Number);
  const from = `${m === 12 ? y : y - 1}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  return payslips.filter((p) => p.period >= from);
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** "2026-09" → "septembre 2026". */
export function monthName(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1] ?? period} ${y}`;
}

/** "de septembre 2026", "d'octobre 2026". */
export function ofMonth(period: string): string {
  const name = monthName(period);
  return /^[aeiou]/.test(name) ? `d'${name}` : `de ${name}`;
}
