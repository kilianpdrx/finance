import type { BudgetFullResponse, BudgetTableRow } from "./api/hooks";
import { orderCategoryTree } from "./group";

export interface MergedCell {
  month: string;
  actual_cents: number;
  expected_cents: number;
  planned_cents: number;
  planned_matched: boolean;
  planned_id: number | null;
}

/** Cell classification for styling (three types + a confirm state):
 *  - "regular"  : plain actual value
 *  - "manual"   : a manual adjustment that adds on top of the actual (unchanged)
 *  - "planned"  : a forecast expense, no real transaction seen yet
 *  - "confirm"  : a transaction appeared but with a different amount than the plan
 *                 → invite the user to confirm it matches the planned expense */
export type CellType = "regular" | "manual" | "planned" | "confirm";

export function cellType(cell: MergedCell): CellType {
  const hasPlan = cell.planned_cents !== 0 && !cell.planned_matched;
  if (hasPlan && cell.actual_cents === 0) return "planned";
  // Exact-amount transaction auto-matches (no confirm needed); a different amount asks.
  if (hasPlan && cell.actual_cents !== 0 && cell.actual_cents !== cell.planned_cents) return "confirm";
  if (cell.expected_cents !== 0) return "manual";
  return "regular";
}
export interface MergedRow {
  category_id: number | null;
  category_name: string;
  category_color: string;
  parent_id?: number | null;
  child?: boolean;   // rendered indented under its parent
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

/** Displayed cell value = realized spend (actual) + any manual adjustment, plus a
 *  planned forecast ONLY while it's unrealized (no transaction yet).
 *
 *  The actual ALWAYS counts — including in future months once a matching
 *  transaction appears — so a realized/confirmed planned expense shows the real
 *  transaction amount instead of going blank. When there's no transaction yet the
 *  actual is 0, so a future cell still shows just its expected/planned forecast. */
export function cellDisplayValue(cell: MergedCell, _currentMonth?: string): number {
  const plannedActive = cell.planned_cents !== 0 && !cell.planned_matched && cell.actual_cents === 0;
  return cell.actual_cents + cell.expected_cents + (plannedActive ? cell.planned_cents : 0);
}

/** A parent's subtotal row: per-month sum of the parent's own displayed value
 *  plus each of its children's (parents hold ~0 directly, so this is effectively
 *  the group total). Rendered read-only as a group header above the children. */
export function parentSubtotalRow(parent: MergedRow, children: MergedRow[], currentMonth?: string): MergedRow {
  const cells: MergedCell[] = parent.cells.map((pc, i) => {
    const sum =
      cellDisplayValue(pc, currentMonth) +
      children.reduce((s, ch) => s + cellDisplayValue(ch.cells[i], currentMonth), 0);
    return { month: pc.month, actual_cents: sum, expected_cents: 0, planned_cents: 0, planned_matched: false, planned_id: null };
  });
  return { ...parent, cells };
}

/** Merge per-year budget-full responses into one continuous 24-month table. */
export function mergeYears(responses: BudgetFullResponse[], targetMonths: string[]): MergedBudget {
  const byYear = new Map<string, BudgetFullResponse>();
  for (const r of responses) {
    if (r.months.length > 0) byYear.set(yearOf(r.months[0]), r);
  }

  const empty = (month: string): MergedCell => ({
    month, actual_cents: 0, expected_cents: 0, planned_cents: 0, planned_matched: false, planned_id: null,
  });
  const findCell = (row: BudgetTableRow | undefined, resp: BudgetFullResponse | undefined, month: string): MergedCell => {
    if (!resp || !row) return empty(month);
    const idx = resp.months.indexOf(month);
    if (idx === -1 || idx >= row.cells.length) return empty(month);
    const c = row.cells[idx];
    return {
      month,
      actual_cents: c.actual_cents,
      expected_cents: c.expected_cents,
      planned_cents: c.planned_cents ?? 0,
      planned_matched: c.planned_matched ?? false,
      planned_id: c.planned_id ?? null,
    };
  };

  const mergeRow = (getRow: (r: BudgetFullResponse) => BudgetTableRow | undefined, fallbackName: string, fallbackColor: string): MergedRow => {
    const cells = targetMonths.map((m) => findCell(byYear.get(yearOf(m)) ? getRow(byYear.get(yearOf(m))!) : undefined, byYear.get(yearOf(m)), m));
    let name = fallbackName, color = fallbackColor, catId: number | null = null, isInvestment = false, parentId: number | null = null;
    for (const resp of responses) {
      const row = getRow(resp);
      if (row) { name = row.category_name; color = row.category_color; catId = row.category_id; isInvestment = row.is_investment ?? false; parentId = row.parent_id ?? null; break; }
    }
    return { category_id: catId, category_name: name, category_color: color, parent_id: parentId, is_investment: isInvestment, cells };
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
    const rawRows = Array.from(cats.keys()).map((key) =>
      mergeRow((resp) => resp.sections.find((s) => s.section === sKey)?.rows.find((r) => (r.category_id ?? r.category_name) === key), "", ""),
    );
    // Order subcategories directly under their parent, flagged for indentation.
    const rows: MergedRow[] = orderCategoryTree(rawRows.map((r) => ({ ...r, id: r.category_id ?? -1 })))
      .map(({ cat, child }) => ({ ...cat, child }));
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
