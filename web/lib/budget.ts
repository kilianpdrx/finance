import type { BudgetFullResponse, BudgetTableRow } from "./api/hooks";

export interface MergedCell {
  month: string;
  actual_cents: number;
  expected_cents: number;
}
export interface MergedRow {
  category_id: number | null;
  category_name: string;
  category_color: string;
  is_investment: boolean;
  cells: MergedCell[];
}
export interface MergedSection {
  section: string;
  section_label: string;
  rows: MergedRow[];
  section_totals: MergedRow;
}
export interface MergedBudget {
  months: string[];
  sections: MergedSection[];
  reste_row: MergedRow;
  grand_total_row: MergedRow;
}

export function yearOf(m: string): string {
  return m.split("-")[0];
}

/** Continuous month range relative to the current month, by offset (inclusive). */
export function buildMonths(startOffset: number, endOffset: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let offset = startOffset; offset <= endOffset; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/** Displayed cell value: future = expected only; past/current = actual + expected. */
export function cellDisplayValue(cell: MergedCell, currentMonth: string): number {
  if (cell.month > currentMonth) return cell.expected_cents;
  return cell.actual_cents + cell.expected_cents;
}

/** Merge per-year budget-full responses into one continuous 24-month table. */
export function mergeYears(responses: BudgetFullResponse[], targetMonths: string[]): MergedBudget {
  const byYear = new Map<string, BudgetFullResponse>();
  for (const r of responses) {
    if (r.months.length > 0) byYear.set(yearOf(r.months[0]), r);
  }

  const findCell = (row: BudgetTableRow | undefined, resp: BudgetFullResponse | undefined, month: string): MergedCell => {
    if (!resp || !row) return { month, actual_cents: 0, expected_cents: 0 };
    const idx = resp.months.indexOf(month);
    if (idx === -1 || idx >= row.cells.length) return { month, actual_cents: 0, expected_cents: 0 };
    const c = row.cells[idx];
    return { month, actual_cents: c.actual_cents, expected_cents: c.expected_cents };
  };

  const mergeRow = (getRow: (r: BudgetFullResponse) => BudgetTableRow | undefined, fallbackName: string, fallbackColor: string): MergedRow => {
    const cells = targetMonths.map((m) => findCell(byYear.get(yearOf(m)) ? getRow(byYear.get(yearOf(m))!) : undefined, byYear.get(yearOf(m)), m));
    let name = fallbackName, color = fallbackColor, catId: number | null = null, isInvestment = false;
    for (const resp of responses) {
      const row = getRow(resp);
      if (row) { name = row.category_name; color = row.category_color; catId = row.category_id; isInvestment = row.is_investment ?? false; break; }
    }
    return { category_id: catId, category_name: name, category_color: color, is_investment: isInvestment, cells };
  };

  const sectionKeys: string[] = [];
  const sectionLabels = new Map<string, string>();
  for (const resp of responses) {
    for (const s of resp.sections) {
      if (!sectionKeys.includes(s.section)) { sectionKeys.push(s.section); sectionLabels.set(s.section, s.section_label); }
    }
  }

  const sections: MergedSection[] = sectionKeys.map((sKey) => {
    const cats = new Map<number | string, { id: number | null; name: string; color: string }>();
    for (const resp of responses) {
      const sec = resp.sections.find((s) => s.section === sKey);
      if (!sec) continue;
      for (const row of sec.rows) {
        const key = row.category_id ?? row.category_name;
        if (!cats.has(key)) cats.set(key, { id: row.category_id, name: row.category_name, color: row.category_color });
      }
    }
    const rows = Array.from(cats.keys()).map((key) =>
      mergeRow((resp) => resp.sections.find((s) => s.section === sKey)?.rows.find((r) => (r.category_id ?? r.category_name) === key), "", ""),
    );
    const section_totals = mergeRow((resp) => resp.sections.find((s) => s.section === sKey)?.section_totals, `TOTAL ${sectionLabels.get(sKey) ?? sKey}`, "");
    return { section: sKey, section_label: sectionLabels.get(sKey) ?? sKey, rows, section_totals };
  });

  return {
    months: targetMonths,
    sections,
    reste_row: mergeRow((resp) => resp.reste_row, "RESTE", ""),
    grand_total_row: mergeRow((resp) => resp.grand_total_row, "SOLDE NET", ""),
  };
}
