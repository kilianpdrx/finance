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
  /** Payslips added up: two employers in one month are two. */
  count: number;
}

/** Month by month, or year by year, in one currency. Several employers in the
 *  same month add up. */
export function series(payslips: Payslip[], mode: "month" | "year"): Point[] {
  const by = new Map<string, Point>();
  for (const p of payslips) {
    const key = mode === "year" ? p.period.slice(0, 4) : p.period;
    const point = by.get(key) ?? { period: key, gross: 0, contributions: 0, tax: 0, net: 0, held: 0, count: 0 };
    point.gross += p.gross_cents;
    point.contributions += p.employee_contributions_cents;
    point.tax += p.withholding_cents;
    point.net += p.net_paid_cents;
    point.held += kindSum(p.lines, "retained") - kindSum(p.lines, "released");
    point.count += 1;
    by.set(key, point);
  }
  return [...by.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/** A payslip's base salary: its largest gross line (a bonus month is not a raise). */
const baseOf = (p: Payslip) => Math.max(0, ...p.lines.filter((l) => l.kind === "gross").map((l) => l.amount_cents));

/** An employer's base salary at the end of a month, and the month it took
 *  that value — a change under 0,5 % is rounding, not a new salary. Null when
 *  its payslips have no gross line. Compared within ONE employer only. */
export function baseSalary(payslips: Payslip[], employerId: number, upTo?: string): { cents: number; since: string } | null {
  const mine = payslips.filter((p) => p.employer_id === employerId && (upTo == null || p.period <= upTo) && baseOf(p) > 0)
    .sort((a, b) => a.period.localeCompare(b.period));
  const last = mine.at(-1);
  if (!last) return null;
  const cents = baseOf(last);
  let since = last.period;
  for (let i = mine.length - 2; i >= 0 && Math.abs(baseOf(mine[i]) - cents) <= cents * 0.005; i--) since = mine[i].period;
  return { cents, since };
}

export interface Totals {
  gross: number;
  contributions: number;
  tax: number;
  net: number;
  held: number;
  /** Payslips. */
  count: number;
  /** Months with at least one payslip. */
  months: number;
}

export function totals(payslips: Payslip[]): Totals {
  return series(payslips, "month").reduce((s, p) => ({
    gross: s.gross + p.gross, contributions: s.contributions + p.contributions, tax: s.tax + p.tax, net: s.net + p.net,
    held: s.held + p.held, count: s.count + p.count, months: s.months + 1,
  }), { gross: 0, contributions: 0, tax: 0, net: 0, held: 0, count: 0, months: 0 });
}

/** Shares of the gross, in basis points. */
export interface Rates {
  contributions: number | null;
  tax: number | null;
  /** Everything else gone for good: other deductions, less what is added
   *  (expenses, allowances) — negative when additions win. */
  other: number | null;
  /** « Prélevé (hors retenu) »: the share of the gross gone for good —
   *  contributions, tax, other deductions less additions. Pay held back is
   *  NOT counted: it comes back at the end of the contract. */
  taken: number | null;
  /** « Non versé (retenu compris) »: the share of the gross not in the payout,
   *  (gross − net paid) / gross — what is held back included. */
  unpaid: number | null;
  /** « dont retenu »: what `unpaid` adds to `taken` — pay held back less what
   *  was paid out of it; negative in a month that pays it out. */
  held: number | null;
}

export const RATE_LABEL: Record<keyof Rates, string> = {
  contributions: "Cotisations",
  tax: "Impôt retenu",
  other: "Autres retenues",
  taken: "Prélevé (hors retenu)",
  unpaid: "Non versé (retenu compris)",
  held: "dont retenu",
};

/** The rates of a month, a year or a period. `other` is what `taken` leaves
 *  once contributions and tax are counted, and `held` what `unpaid` adds to
 *  `taken`: the figures add up exactly, also for a payslip typed without lines. */
export function rates(p: Pick<Point, "gross" | "contributions" | "tax" | "net" | "held">): Rates {
  const contributions = share(p.contributions, p.gross);
  const tax = share(p.tax, p.gross);
  const taken = share(p.gross - p.net - p.held, p.gross);
  const unpaid = share(p.gross - p.net, p.gross);
  return {
    contributions, tax, taken, unpaid,
    other: taken == null ? null : taken - (contributions ?? 0) - (tax ?? 0),
    held: taken == null || unpaid == null ? null : unpaid - taken,
  };
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
    for (let period = sorted[0]; period < sorted.at(-1)!; period = addMonths(period, 1)) {
      if (!have.has(period)) out.push({ employer_id, period });
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

// ── Employers ───────────────────────────────────────────────────────────────

export interface EmployerFigures {
  employerId: number;
  currency: string;
  /** First and last month with a payslip. */
  from: string;
  to: string;
  totals: Totals;
  rates: Rates;
  /** Payslips whose salary was found on the account (exactly or within 2 %). */
  deposits: { found: number; total: number };
}

/** Each employer's figures over the payslips given, in the order they started. */
export function byEmployer(payslips: Payslip[]): EmployerFigures[] {
  const by = new Map<number, Payslip[]>();
  for (const p of payslips) by.set(p.employer_id, [...(by.get(p.employer_id) ?? []), p]);
  return [...by.entries()].map(([employerId, mine]) => {
    const periods = mine.map((p) => p.period).sort();
    const t = totals(mine);
    return {
      employerId, currency: mine[0].currency, from: periods[0], to: periods.at(-1)!, totals: t, rates: rates(t),
      deposits: { found: mine.filter((p) => p.deposit.status === "paid" || p.deposit.status === "gap").length, total: mine.length },
    };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.employerId - b.employerId);
}

/** The categorical palette (globals.css `--series-*`), validated for adjacent
 *  pairs in both themes. */
export const SERIES = 8;

/** Each employer's colour: the palette's slots in the order employers first
 *  appear in ALL the payslips — so a filter or a period never repaints one —
 *  never cycled: a ninth employer and later share a neutral grey. */
export function employerColors(payslips: Payslip[], employers: { id: number }[]): Map<number, string> {
  const first = new Map<number, string>();
  for (const p of payslips) if (!first.has(p.employer_id) || p.period < first.get(p.employer_id)!) first.set(p.employer_id, p.period);
  const order = [...employers].sort((a, b) =>
    (first.get(a.id) ?? "9999").localeCompare(first.get(b.id) ?? "9999") || a.id - b.id);
  return new Map(order.map((e, i) => [e.id, i < SERIES ? `var(--series-${i + 1})` : "var(--muted-foreground)"]));
}

export interface Segment {
  employerId: number;
  from: string;
  to: string;
  /** Months paid in this stretch. */
  months: number;
  /** 0: the band; 1, 2…: an employer at the same time as another, below it. */
  lane: number;
}

/** The employers in sequence on one band: each employer's stretches of
 *  consecutive months (a month without a payslip ends one). Two employers at
 *  the same time take two lanes: each stretch goes on the first lane free by
 *  then, the longer of two starting together on the band. */
export function timeline(payslips: Payslip[]): { segments: Segment[]; lanes: number } {
  const months = new Map<number, Set<string>>();
  for (const p of payslips) months.set(p.employer_id, (months.get(p.employer_id) ?? new Set()).add(p.period));
  const runs: Omit<Segment, "lane">[] = [];
  for (const [employerId, set] of months) {
    const sorted = [...set].sort();
    let run = { employerId, from: sorted[0], to: sorted[0], months: 1 };
    for (const m of sorted.slice(1)) {
      if (m === addMonths(run.to, 1)) run = { ...run, to: m, months: run.months + 1 };
      else { runs.push(run); run = { employerId, from: m, to: m, months: 1 }; }
    }
    runs.push(run);
  }
  runs.sort((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to) || a.employerId - b.employerId);
  const ends: string[] = [];
  const segments = runs.map((r) => {
    let lane = ends.findIndex((end) => end < r.from);
    if (lane < 0) lane = ends.push(r.to) - 1;
    else ends[lane] = r.to;
    return { ...r, lane };
  });
  return { segments, lanes: ends.length };
}

/** Month by month, each employer's gross or net paid, for bars stacked by employer. */
export function employerSeries(payslips: Payslip[], metric: "gross" | "net", months: string[]): Record<string, number | string>[] {
  return months.map((period) => {
    const row: Record<string, number | string> = { period };
    for (const p of payslips) {
      if (p.period !== period) continue;
      const key = `e${p.employer_id}`;
      row[key] = (Number(row[key]) || 0) + (metric === "gross" ? p.gross_cents : p.net_paid_cents);
    }
    return row;
  });
}

// ── Several currencies ──────────────────────────────────────────────────────

/** A currency and month's rate to the currency shown (`GET /payroll/fx`); null: none found. */
export interface FxRate { currency: string; period: string; rate: number | null }

/** The payslips in `to`, for totals and charts that add employers up: each one
 *  converted at its own month's rate, every amount and line rounded to the cent
 *  (rates in bp are kept). A payslip whose month has no rate is kept with its
 *  amounts as they are, and listed in `unconverted` so the page says the totals
 *  are approximate — the app's rule for a missing rate (analytics' `fx_incomplete`):
 *  never dropped, which hid whole stretches of an employer. The copies keep their
 *  id: edit and delete the original, never a copy. */
export function convertPayslips(payslips: Payslip[], to: string, fx: FxRate[]): { payslips: Payslip[]; unconverted: Payslip[] } {
  const rateOf = new Map(fx.map((r) => [`${r.currency}|${r.period}`, r.rate]));
  const out: Payslip[] = [];
  const unconverted: Payslip[] = [];
  for (const p of payslips) {
    if (p.currency === to) { out.push(p); continue; }
    const found = rateOf.get(`${p.currency}|${p.period}`);
    if (found == null) unconverted.push(p);
    const rate = found ?? 1;
    const c = (cents: number) => Math.round(cents * rate);
    const n = (cents: number | null | undefined) => (cents == null ? cents : c(cents));
    out.push({
      ...p, currency: to,
      gross_cents: c(p.gross_cents), employee_contributions_cents: c(p.employee_contributions_cents),
      employer_contributions_cents: n(p.employer_contributions_cents), taxable_cents: n(p.taxable_cents),
      withholding_cents: c(p.withholding_cents), net_paid_cents: c(p.net_paid_cents),
      lines: p.lines.map((l) => ({ ...l, amount_cents: c(l.amount_cents), base_cents: n(l.base_cents), employer_cents: n(l.employer_cents) })),
      deposit: { ...p.deposit, amount_cents: n(p.deposit.amount_cents) ?? null, difference_cents: c(p.deposit.difference_cents) },
    });
  }
  return { payslips: out, unconverted };
}

// ── The period shown ────────────────────────────────────────────────────────

export type Range =
  | { kind: "year"; year: number }
  | { kind: "12m" }
  | { kind: "all" }
  | { kind: "custom"; from: string; to: string };

export interface Bounds { from: string; to: string }

/** "2026-11" + 3 → "2027-02". */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** The months a period covers. « 12 derniers mois »: the twelve ending with
 *  the latest payslip; a year: January to December; « Tout »: the first
 *  payslip to the last; a custom period as chosen. Null with nothing to show. */
export function bounds(payslips: Payslip[], range: Range): Bounds | null {
  const periods = payslips.map((p) => p.period).sort();
  if (range.kind === "year") return { from: `${range.year}-01`, to: `${range.year}-12` };
  if (range.kind === "custom") return range.from <= range.to ? { from: range.from, to: range.to } : { from: range.to, to: range.from };
  const latest = periods.at(-1);
  if (!latest) return null;
  return range.kind === "all" ? { from: periods[0], to: latest } : { from: addMonths(latest, -11), to: latest };
}

export const within = (payslips: Payslip[], b: Bounds | null): Payslip[] =>
  b ? payslips.filter((p) => p.period >= b.from && p.period <= b.to) : [];

export function inRange(payslips: Payslip[], range: Range): Payslip[] {
  return within(payslips, bounds(payslips, range));
}

/** The same months a year earlier, up to the latest month paid in the period:
 *  January to September of this year against January to September of last
 *  year, never 9 months against 12. Null when the period has no payslip, or
 *  spans more than a year (it would be compared with part of itself). */
export function yearBefore(b: Bounds, shown: Payslip[]): Bounds | null {
  const latest = shown.map((p) => p.period).sort().at(-1);
  if (!latest || addMonths(b.from, 12) <= b.to) return null;
  return { from: addMonths(b.from, -12), to: addMonths(latest < b.to ? latest : b.to, -12) };
}

/** A change in per mille of what it is compared with; null without a base. */
export function change(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 1000) : null;
}

/** "septembre 2026", "janvier – septembre 2026", "mars 2025 – février 2026". */
export function spanLabel(b: Bounds): string {
  if (b.from === b.to) return monthName(b.from);
  if (b.from.slice(0, 4) === b.to.slice(0, 4)) return `${monthName(b.from).split(" ")[0]} – ${monthName(b.to)}`;
  return `${monthName(b.from)} – ${monthName(b.to)}`;
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
