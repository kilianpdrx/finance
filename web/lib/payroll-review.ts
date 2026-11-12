import type { Payslip, PayslipIn, PayslipLabelRule, PayslipRead } from "@/lib/api/hooks";
import { amountToCents, centsToAmount } from "@/lib/budget-plan";
import { blockIndex, blockOf, linesNet, monthName, ofMonth, type Kind } from "@/lib/payroll";

/** The review of a payslip before it is saved: what was read from a PDF (or
 *  typed, or saved earlier), as the user corrects it. Nothing here is saved:
 *  `draftToBody` is what « Enregistrer » sends.
 *
 *  The lines are kept in BLOCK order (`BLOCKS`, lib/payroll.ts): what is shown
 *  is what is saved, so `position` is the order the user arranged. An
 *  employer's memory is its saved payslips — the order and the types of the
 *  last one, and the one just before as the comparison. */

export interface DraftLine {
  uid: string;
  key: string;                 // normalized label: what a classification is remembered by
  label: string;
  kind: Kind | null;           // null: « à classer »
  amount: string;
  base: number | null;
  rate: number | null;
  employer: number | null;
  negative: boolean;
  seq: number;                 // the order it came in (PDF, last payslip): where a re-typed line lands
}

export interface Draft {
  uid: string;
  file: File | null;           // the PDF read, saved with the payslip
  filename: string | null;
  payslipId: number | null;    // editing a saved payslip
  documentId: number | null;   // its PDF
  error: string | null;        // not a readable PDF
  noText: boolean;             // a scan: figures to type
  duplicatePayslipId: number | null;
  employerId: number | null;
  period: string;              // YYYY-MM, "" when not found
  payDate: string;             // YYYY-MM-DD or ""
  gross: string;               // typed only when no line is gross: else the lines' sum
  net: string;
  contributions: string;       // typed only when there are no lines
  withholding: string;
  withholdingRate: string;     // "10,56" (%)
  taxable: string;
  employerContributions: string;
  /** « Bruttolohn » and « Total Abzüge » as printed: what the subtotals are checked against. */
  printedGross: number | null;
  printedContributions: number | null;
  lines: DraftLine[];
  replace: boolean;
  saved: boolean;
  /** The user changed something: a later save no longer re-arranges it. */
  edited: boolean;
  /** Typed from the employer's payslip of that month (« Saisir »). */
  filledFrom: string | null;
}

let uids = 0;
const uid = (prefix: string) => `${prefix}${uids++}`;
const amount = (cents: number | null | undefined) => (cents == null ? "" : centsToAmount(cents));
const rateText = (bp: number | null | undefined) => (bp == null ? "" : (bp / 100).toString().replace(".", ","));

/** "lohn ag" — the same normalization as `normalize_label` (services/payroll/vocab.py). */
export function labelKey(label: string): string {
  return label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

/** Block by block, each block in the order given (a stable sort). */
const byBlock = (lines: DraftLine[]) =>
  lines.map((l, i) => ({ l, i })).sort((a, b) => blockIndex(a.l.kind) - blockIndex(b.l.kind) || a.i - b.i).map(({ l }) => l);

function blank(employerId: number | null): Draft {
  return {
    uid: uid("d"), file: null, filename: null, payslipId: null, documentId: null, error: null, noText: false,
    duplicatePayslipId: null, employerId, period: "", payDate: "", gross: "", net: "", contributions: "", withholding: "",
    withholdingRate: "", taxable: "", employerContributions: "", printedGross: null, printedContributions: null, lines: [], replace: false,
    saved: false, edited: false, filledFrom: null,
  };
}

export function draftFromRead(read: PayslipRead, file: File, employerId: number | null): Draft {
  const f = (read.figures ?? {}) as Record<string, number | null>;
  return {
    ...blank(employerId),
    file, filename: read.filename, error: read.error ?? null, noText: Boolean(read.checks?.no_text),
    duplicatePayslipId: read.duplicate_payslip_id ?? null,
    period: read.period ?? "", payDate: read.pay_date ?? "",
    gross: amount(f.gross_cents), net: amount(f.net_paid_cents),
    contributions: amount(f.employee_contributions_cents), withholding: amount(f.withholding_cents),
    withholdingRate: rateText(f.withholding_rate_bp), taxable: amount(f.taxable_cents),
    employerContributions: amount(f.employer_contributions_cents),
    // A total printed as 0 is a misread column, not a check.
    printedGross: read.totals?.gross_total || null,
    printedContributions: read.totals?.contributions_total || null,
    lines: byBlock(read.lines.map((l, i) => ({
      uid: uid("l"), key: l.key, label: l.label, kind: (l.kind ?? null) as Kind | null, amount: amount(l.amount_cents),
      base: l.base_cents ?? null, rate: l.rate_bp ?? null, employer: l.employer_cents ?? null, negative: l.negative, seq: i,
    }))),
  };
}

/** The employer of a payslip read: the one whose name it prints (found by
 *  `/read`); else the only employer there is — unless that one already has
 *  this month, saved or earlier in the same import: a second employer is then
 *  likelier than a duplicate, and the user chooses. Assigning it anyway left
 *  « remplacer » as the only way to save a second job's payslip. */
export function employerForRead(read: PayslipRead, employers: { id: number }[], payslips: Payslip[], earlier: Draft[]): number | null {
  if (read.employer_id != null) return read.employer_id;
  if (employers.length !== 1) return null;
  const only = employers[0].id;
  const taken = read.period != null && (payslips.some((p) => p.employer_id === only && p.period === read.period)
    || earlier.some((d) => d.employerId === only && d.period === read.period));
  return taken ? null : only;
}

export function draftManual(employerId: number | null, period: string): Draft {
  return { ...blank(employerId), period };
}

const fromSaved = (l: Payslip["lines"][number], i: number): DraftLine => ({
  uid: uid("l"), key: labelKey(l.label), label: l.label, kind: l.kind as Kind, amount: amount(l.amount_cents),
  base: l.base_cents ?? null, rate: l.rate_bp ?? null, employer: l.employer_cents ?? null, negative: false, seq: i,
});

export function draftFromPayslip(p: Payslip): Draft {
  return {
    ...blank(p.employer_id), payslipId: p.id, documentId: p.document_id ?? null, period: p.period, payDate: p.pay_date ?? "",
    gross: amount(p.gross_cents), net: amount(p.net_paid_cents), contributions: amount(p.employee_contributions_cents),
    withholding: amount(p.withholding_cents), withholdingRate: rateText(p.withholding_rate_bp),
    taxable: amount(p.taxable_cents), employerContributions: amount(p.employer_contributions_cents),
    lines: byBlock(p.lines.map(fromSaved)),
  };
}

// ── Arranging the lines ─────────────────────────────────────────────────────

/** A line takes another type: it leaves its block for the new one, where it
 *  lands among its neighbours of the PDF (before the first one read after it). */
export function setKind(d: Draft, lineUid: string, kind: Kind): Draft {
  const line = d.lines.find((l) => l.uid === lineUid);
  if (!line) return d;
  const moved = { ...line, kind };
  const rest = d.lines.filter((l) => l.uid !== lineUid);
  const block = blockIndex(kind);
  const inBlock = rest.filter((l) => blockIndex(l.kind) === block);
  const before = inBlock.find((l) => l.seq > moved.seq);
  return { ...d, lines: insertAt(rest, moved, before ?? null) };
}

/** Before `next`, or at the end of the line's block. */
function insertAt(lines: DraftLine[], line: DraftLine, next: DraftLine | null): DraftLine[] {
  const at = next ? lines.indexOf(next) : lines.findLastIndex((l) => blockIndex(l.kind) <= blockIndex(line.kind)) + 1;
  return [...lines.slice(0, at), line, ...lines.slice(at)];
}

/** One step up or down, inside its block. */
export function moveLine(d: Draft, lineUid: string, step: -1 | 1): Draft {
  const i = d.lines.findIndex((l) => l.uid === lineUid);
  const j = i + step;
  if (i < 0 || j < 0 || j >= d.lines.length || blockOf(d.lines[j].kind) !== blockOf(d.lines[i].kind)) return d;
  const lines = [...d.lines];
  [lines[i], lines[j]] = [lines[j], lines[i]];
  return { ...d, lines };
}

/** Dropped on another line of its block: takes that line's place. */
export function moveLineTo(d: Draft, lineUid: string, targetUid: string): Draft {
  const line = d.lines.find((l) => l.uid === lineUid);
  const target = d.lines.find((l) => l.uid === targetUid);
  if (!line || !target || line === target || blockOf(line.kind) !== blockOf(target.kind)) return d;
  const down = d.lines.indexOf(line) < d.lines.indexOf(target);
  const rest = d.lines.filter((l) => l !== line);
  const at = rest.indexOf(target) + (down ? 1 : 0);
  return { ...d, lines: [...rest.slice(0, at), line, ...rest.slice(at)] };
}

/** A blank line, « à classer » until the user says what it does. */
export function addLine(d: Draft): Draft {
  const line: DraftLine = { uid: uid("l"), key: "", label: "", kind: null, amount: "", base: null, rate: null, employer: null, negative: false, seq: Infinity };
  return { ...d, lines: insertAt(d.lines, line, null) };
}

// ── An employer's memory: its saved payslips ────────────────────────────────

/** A payslip to compare with: saved, or another one of the same import. */
export interface Reference {
  period: string;
  payDate: string | null;
  saved: boolean;
  gross_cents: number;
  net_paid_cents: number;
  lines: { key: string; label: string; kind: Kind; amount_cents: number; base_cents: number | null; rate_bp: number | null; employer_cents: number | null }[];
}

const fromPayslip = (p: Payslip): Reference => ({
  period: p.period, payDate: p.pay_date ?? null, saved: true, gross_cents: p.gross_cents, net_paid_cents: p.net_paid_cents,
  lines: p.lines.map((l) => ({ key: labelKey(l.label), label: l.label, kind: l.kind as Kind, amount_cents: l.amount_cents,
    base_cents: l.base_cents ?? null, rate_bp: l.rate_bp ?? null, employer_cents: l.employer_cents ?? null })),
});

const fromDraft = (d: Draft): Reference => ({
  period: d.period, payDate: d.payDate || null, saved: false, gross_cents: draftFigures(d).gross_cents, net_paid_cents: amountToCents(d.net),
  lines: d.lines.filter((l) => l.kind).map((l) => ({ key: l.key, label: l.label, kind: l.kind!, amount_cents: amountToCents(l.amount),
    base_cents: l.base, rate_bp: l.rate, employer_cents: l.employer })),
});

const validPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** The employer's closest payslip before this month: saved, or — when
 *  `drafts` are given — another payslip of the same import not saved yet. */
export function referenceFor(d: Draft, payslips: Payslip[], drafts: Draft[] = []): Reference | null {
  if (d.employerId == null || !validPeriod(d.period)) return null;
  const saved = payslips.filter((p) => p.employer_id === d.employerId && p.id !== d.payslipId && p.period < d.period).map(fromPayslip);
  const others = drafts.filter((x) => x.uid !== d.uid && !x.saved && !x.error && x.duplicatePayslipId == null
    && x.employerId === d.employerId && validPeriod(x.period) && x.period < d.period).map(fromDraft);
  // A saved payslip wins over a draft of the same month.
  return [...others, ...saved].sort((a, b) => a.period.localeCompare(b.period)).at(-1) ?? null;
}

/** The order and the types to follow: the employer's latest saved payslip
 *  before this month, else its latest at all. */
function latestSaved(d: Draft, payslips: Payslip[]): Reference | null {
  const mine = payslips.filter((p) => p.employer_id === d.employerId && p.id !== d.payslipId).sort((a, b) => a.period.localeCompare(b.period));
  const before = validPeriod(d.period) ? mine.filter((p) => p.period < d.period) : [];
  const p = before.at(-1) ?? mine.at(-1);
  return p ? fromPayslip(p) : null;
}

/** Lines matched by label, the n-th « AHV » with the n-th « AHV ». */
function pairs<T extends { key: string }>(lines: DraftLine[], ref: T[]): Map<string, T> {
  const pool = new Map<string, T[]>();
  for (const r of ref) pool.set(r.key, [...(pool.get(r.key) ?? []), r]);
  const out = new Map<string, T>();
  for (const l of lines) {
    const match = l.key ? pool.get(l.key)?.shift() : undefined;
    if (match) out.set(l.uid, match);
  }
  return out;
}

/** The draft for this employer: its classifications, then for what is still
 *  « à classer » the type the label had last time, then the order of its last
 *  payslip block by block — a label never seen comes after the known ones of
 *  its block. A form still empty (« Saisir ») starts from that payslip. */
export function forEmployer(d: Draft, rules: PayslipLabelRule[], payslips: Payslip[], employerId: number | null): Draft {
  const mine = new Map(rules.filter((r) => r.employer_id === employerId).map((r) => [r.label_key, r.kind as Kind]));
  const next = { ...d, employerId, lines: d.lines.map((l) => (mine.has(l.key) ? { ...l, kind: mine.get(l.key)! } : l)) };
  if (employerId == null) return next;
  const ref = latestSaved(next, payslips);
  if (!ref) return next;
  if (!next.file && next.payslipId == null && next.lines.length === 0 && !next.gross.trim() && !next.net.trim()) {
    return fillFrom(next, ref);
  }
  const matched = pairs(next.lines, ref.lines.map((l, i) => ({ ...l, i })));
  const lines = next.lines.map((l) => (l.kind == null && matched.has(l.uid) ? { ...l, kind: matched.get(l.uid)!.kind } : l));
  // Known labels in last time's order; the others after them, as they came.
  const rank = (l: DraftLine, i: number) => matched.get(l.uid)?.i ?? ref.lines.length + i;
  const ranked = lines.map((l, i) => ({ l, r: rank(l, i) }));
  return { ...next, lines: ranked.sort((a, b) => blockIndex(a.l.kind) - blockIndex(b.l.kind) || a.r - b.r).map(({ l }) => l) };
}

/** « Saisir »: the employer's last payslip as a starting point, to correct. */
function fillFrom(d: Draft, ref: Reference): Draft {
  return {
    ...d, filledFrom: ref.period, gross: amount(ref.gross_cents), net: amount(ref.net_paid_cents),
    lines: byBlock(ref.lines.map((l, i) => ({
      uid: uid("l"), key: l.key, label: l.label, kind: l.kind, amount: amount(l.amount_cents), base: l.base_cents,
      rate: l.rate_bp, employer: l.employer_cents, negative: false, seq: i,
    }))),
  };
}

/** A line of the reference this payslip does not have, typed back in. */
export function restoreLine(d: Draft, line: Reference["lines"][number]): Draft {
  const restored: DraftLine = {
    uid: uid("l"), key: line.key, label: line.label, kind: line.kind, amount: amount(line.amount_cents), base: line.base_cents,
    rate: line.rate_bp, employer: line.employer_cents, negative: false, seq: Infinity,
  };
  return { ...d, lines: insertAt(d.lines, restored, null) };
}

// ── The comparison ──────────────────────────────────────────────────────────

export interface Comparison {
  ref: Reference | null;
  /** Line uid → the same line in the reference. */
  previous: Map<string, { amount_cents: number; rate_bp: number | null }>;
  /** Line uids whose label the reference does not have. */
  fresh: Set<string>;
  /** The reference's lines this payslip does not have. */
  missing: Reference["lines"];
  /** Months with no payslip between the reference and this one. */
  gapMonths: string[];
  /** Paid before the reference was. */
  payDateBack: boolean;
  /** No payslip of this employer before this month. */
  first: boolean;
  /** This employer already has a payslip for this month: saved, or earlier in
   *  this import. One per employer and month — another employer's is welcome. */
  clash: "saved" | "draft" | null;
}

export const nextMonth = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** This payslip against the employer's one before: the same lines, the same
 *  rates, and months that follow each other. */
export function compare(d: Draft, payslips: Payslip[], drafts: Draft[] = []): Comparison {
  const ref = referenceFor(d, payslips, drafts);
  const empty: Comparison = {
    ref, previous: new Map(), fresh: new Set(), missing: [], gapMonths: [], payDateBack: false, first: false, clash: clashOf(d, payslips, drafts),
  };
  if (!ref) return { ...empty, first: d.employerId != null && validPeriod(d.period) };
  const matched = pairs(d.lines, ref.lines);
  const used = new Set(matched.values());
  const gapMonths: string[] = [];
  for (let m = nextMonth(ref.period); m < d.period; m = nextMonth(m)) gapMonths.push(m);
  return {
    ...empty,
    previous: new Map([...matched].map(([u, r]) => [u, { amount_cents: r.amount_cents, rate_bp: r.rate_bp }])),
    fresh: new Set(d.lines.filter((l) => l.key && !matched.has(l.uid)).map((l) => l.uid)),
    missing: ref.lines.filter((r) => !used.has(r)),
    gapMonths,
    payDateBack: Boolean(ref.payDate && d.payDate && d.payDate < ref.payDate),
  };
}

function clashOf(d: Draft, payslips: Payslip[], drafts: Draft[]): Comparison["clash"] {
  if (d.saved || d.employerId == null || !validPeriod(d.period)) return null;
  if (payslips.some((p) => p.employer_id === d.employerId && p.period === d.period && p.id !== d.payslipId)) return "saved";
  const at = drafts.findIndex((x) => x.uid === d.uid);
  const other = drafts.some((x, i) => x.uid !== d.uid && (x.saved || i < at) && !x.error && x.duplicatePayslipId == null
    && x.employerId === d.employerId && x.period === d.period);
  return other ? "draft" : null;
}

/** What the comparison says, sentence by sentence. */
export function comparisonNotes(c: Comparison): { tone: "warn" | "ok"; text: string }[] {
  const notes: { tone: "warn" | "ok"; text: string }[] = [];
  if (c.first) notes.push({ tone: "ok", text: "Première fiche de cet employeur : les suivantes seront comparées à celle-ci." });
  if (!c.ref) return notes;
  const ref = monthName(c.ref.period);
  if (c.gapMonths.length) {
    notes.push({ tone: "warn", text: `Il manque ${c.gapMonths.map(monthName).join(", ")} entre ${ref} et ce mois-ci : aucune fiche de cet employeur.` });
  } else {
    notes.push({ tone: "ok", text: `Fait suite à ${ref}${c.ref.saved ? "" : " (dans cet import)"}.` });
  }
  if (c.payDateBack) notes.push({ tone: "warn", text: `Versée avant la fiche ${ofMonth(c.ref.period)} : vérifiez la date de versement.` });
  if (c.fresh.size || c.missing.length) {
    const parts = [
      c.fresh.size ? `${c.fresh.size} ligne${c.fresh.size > 1 ? "s" : ""} nouvelle${c.fresh.size > 1 ? "s" : ""}` : "",
      c.missing.length ? `${c.missing.length} absente${c.missing.length > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    notes.push({ tone: "warn", text: `Format différent ${ofMonth(c.ref.period)} : ${parts.join(", ")}.` });
  } else if (c.ref.lines.length) {
    notes.push({ tone: "ok", text: `Mêmes lignes qu'en ${ref}.` });
  }
  return notes;
}

/** A line gone, a line new, a month missing, the month already there: worth a look. */
export const comparisonWarns = (c: Comparison | undefined): boolean =>
  Boolean(c && (c.fresh.size || c.missing.length || c.gapMonths.length || c.payDateBack || c.clash));

// ── Figures and checks ──────────────────────────────────────────────────────

const cents = (lines: DraftLine[], ...kinds: Kind[]) =>
  lines.reduce((s, l) => s + (l.kind && kinds.includes(l.kind) ? amountToCents(l.amount) : 0), 0);

/** With lines, gross, contributions and tax ARE the lines; without, they are typed. */
export const grossFromLines = (d: Draft) => d.lines.some((l) => l.kind === "gross");

export function draftFigures(d: Draft) {
  const withLines = d.lines.length > 0;
  const tax = d.lines.find((l) => l.kind === "tax");
  const employerLines = d.lines.reduce((s, l) => s + (l.employer ?? 0), 0);
  return {
    gross_cents: grossFromLines(d) ? cents(d.lines, "gross") : amountToCents(d.gross),
    employee_contributions_cents: withLines ? cents(d.lines, "social", "pension") : amountToCents(d.contributions),
    employer_contributions_cents: d.employerContributions.trim() ? amountToCents(d.employerContributions) : (employerLines || null),
    taxable_cents: (withLines && tax?.base) || (d.taxable.trim() ? amountToCents(d.taxable) : null),
    withholding_cents: withLines ? cents(d.lines, "tax") : amountToCents(d.withholding),
    withholding_rate_bp: (withLines && tax?.rate) || (d.withholdingRate.trim() ? Math.round(Number(d.withholdingRate.replace(",", ".")) * 100) || null : null),
    net_paid_cents: amountToCents(d.net),
  };
}

export const lineLikes = (d: Draft) => d.lines.map((l) => ({ kind: l.kind, amount_cents: amountToCents(l.amount) }));

const hasGross = (d: Draft) => grossFromLines(d) || d.gross.trim() !== "";

export interface DraftChecks {
  unclassified: number;
  netGap: number;              // what the lines give − the net paid (0: they agree)
  periodOk: boolean;
  employerOk: boolean;
}

export function checkDraft(d: Draft): DraftChecks {
  return {
    unclassified: d.lines.filter((l) => l.kind == null).length,
    netGap: d.lines.length > 0 && d.net.trim() ? linesNet(lineLikes(d), draftFigures(d).gross_cents) - amountToCents(d.net) : 0,
    periodOk: validPeriod(d.period),
    employerOk: d.employerId != null,
  };
}

export type DraftStatus = "saved" | "error" | "duplicate" | "ready" | "check";

/** One word per file in the import list. A gap between the lines and the net,
 *  or a payslip unlike the one before, does not block saving (the printed
 *  payslip is the truth): it asks for a look. */
export function draftStatus(d: Draft, comparison?: Comparison): DraftStatus {
  if (d.saved) return "saved";
  if (d.error) return "error";
  if (d.duplicatePayslipId != null) return "duplicate";
  const c = checkDraft(d);
  if (d.noText || c.unclassified || c.netGap || !c.periodOk || !c.employerOk || !hasGross(d) || !d.net.trim()) return "check";
  if (comparisonWarns(comparison)) return "check";
  return "ready";
}

/** What can be saved at all: every line classified, a month, an employer —
 *  and that employer's month free, or « remplacer » ticked for a saved one. */
export function canSave(d: Draft, comparison?: Comparison): boolean {
  const c = checkDraft(d);
  const clash = comparison?.clash === "draft" || (comparison?.clash === "saved" && !d.replace);
  return !d.saved && !d.error && d.duplicatePayslipId == null && c.unclassified === 0 && c.periodOk && c.employerOk
    && hasGross(d) && d.net.trim() !== "" && !clash;
}

/** Lines in the order shown — block by block — so `position` keeps it. */
export function draftToBody(d: Draft): PayslipIn {
  return {
    employer_id: d.employerId!,
    period: d.period,
    pay_date: d.payDate || null,
    replace: d.replace,
    lines: byBlock(d.lines).filter((l) => l.kind).map((l) => ({
      label: l.label.trim(), kind: l.kind!, amount_cents: amountToCents(l.amount),
      base_cents: l.base, rate_bp: l.rate, employer_cents: l.employer,
    })),
    ...draftFigures(d),
  };
}
