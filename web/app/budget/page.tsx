"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Pencil, CalendarPlus, Check, X, HelpCircle, ChevronRight } from "lucide-react";
import { api, unwrap } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CourantTabs, type CourantSelection } from "@/components/analytics/courant-tabs";
import { useAccounts, useBudgetMutation, usePlannedExpenseMutations, type BudgetFullResponse } from "@/lib/api/hooks";
import { PlanExpenseDialog } from "@/components/budget/plan-expense-dialog";
import { CellTransactions } from "@/components/budget/cell-transactions";
import { buildMonths, cellDisplayValue, cellType, mergeYears, parentSubtotalRow, selectionAmounts, signClass, yearOf, type CellSelection, type MergedBudget, type MergedRow, type MergedCell } from "@/lib/budget";
import { formatCents, formatMonthLabel, deriveCurrency } from "@/lib/format";

// Column geometry (must match the Tailwind widths used in the table).
const COL_W = 96; // month cell  = w-24
const STEP = 12; // months added per lazy extension

// Total-row bands use OPAQUE backgrounds (bg-muted) so the sticky TOTAL/label
// columns don't let the horizontally-scrolled month cells bleed through.
// The cell whose transactions are listed in the right-hand panel.
const PICKED = "ring-2 ring-inset ring-brand";

/** Makes a row's cells clickable: the categories they add up and how to name them. */
interface RowPick {
  rowKey: string;
  label: string;
  color?: string;
  categoryIds: number[];
}

const SECTION: Record<string, { head: string; total: string }> = {
  revenus: { head: "bg-positive text-white", total: "bg-muted text-positive" },
  depenses_fixes: { head: "bg-negative text-white", total: "bg-muted text-negative" },
  depenses_variables: { head: "bg-info text-white", total: "bg-muted text-info" },
};

export default function BudgetPage() {
  const { data: accounts = [] } = useAccounts();
  const courant = useMemo(() => accounts.filter((a) => a.account_type === "courant"), [accounts]);
  const courantIds = courant.map((a) => a.id);
  const courantKey = courantIds.join(",");
  const [accountSel, setAccountSel] = useState<CourantSelection>("all");
  const accountId = accountSel === "all" ? undefined : accountSel;
  // The accounts an "all accounts" budget covers — the same list the API is given.
  const scopeIds = useMemo(() => (courantKey ? courantKey.split(",").map(Number) : null), [courantKey]);
  // Clicked cell → its transactions, listed to the right of the table.
  const [selected, setSelected] = useState<CellSelection | null>(null);
  const budgetMut = useBudgetMutation();
  const plannedMut = usePlannedExpenseMutations();
  const [planOpen, setPlanOpen] = useState(false);
  const [planPrefill, setPlanPrefill] = useState<{ categoryId?: number; month?: string } | null>(null);
  const openPlan = (prefill?: { categoryId?: number; month?: string }) => { setPlanPrefill(prefill ?? null); setPlanOpen(true); };

  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  // Continuous, lazily-extended month window (offsets from the current month).
  const [range, setRange] = useState({ start: -12, end: 11 });
  const targetMonths = useMemo(() => buildMonths(range.start, range.end), [range]);
  const years = useMemo(() => Array.from(new Set(targetMonths.map(yearOf))).map(Number).sort(), [targetMonths]);

  const currency = deriveCurrency(courant, accountId != null ? [accountId] : null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingPrepend = useRef(0);
  const extending = useRef(false);
  const rafPending = useRef(false);
  const inited = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  // Collapsed parent namespaces (by parent category id) — hides their children.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggleCollapsed = (pid: number) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; });

  // After prepending months, keep the viewport visually stable (no jump). Hold
  // the `extending` lock briefly after the layout settles so a fast scroll can't
  // fire a second extension before the position adjustment lands (which caused a
  // visible jump / double-jump when scrolling quickly).
  useLayoutEffect(() => {
    if (pendingPrepend.current && scrollRef.current) {
      scrollRef.current.scrollLeft += pendingPrepend.current * COL_W;
      pendingPrepend.current = 0;
    }
    const t = setTimeout(() => { extending.current = false; }, 180);
    return () => clearTimeout(t);
  }, [targetMonths]);

  // Throttle scroll handling to one check per frame so rapid scrolling doesn't
  // queue multiple range extensions.
  const onScroll = () => {
    if (rafPending.current || extending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      const el = scrollRef.current;
      if (!el || extending.current) return;
      if (el.scrollLeft < COL_W * 2) {
        extending.current = true;
        pendingPrepend.current = STEP;
        setRange((r) => ({ ...r, start: r.start - STEP }));
      } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - COL_W * 2) {
        extending.current = true;
        setRange((r) => ({ ...r, end: r.end + STEP }));
      }
    });
  };

  const results = useQueries({
    queries: years.map((yr) => ({
      queryKey: ["budget-full", yr, accountId, courantKey],
      queryFn: () =>
        unwrap(
          api.GET("/api/analytics/budget-full", {
            params: { query: { year: yr, account_id: accountId, account_ids: accountId ? undefined : courantKey || undefined } },
          }),
        ) as Promise<BudgetFullResponse>,
    })),
  });

  const data: MergedBudget | null = useMemo(() => {
    const resp = results.map((r) => r.data).filter(Boolean) as BudgetFullResponse[];
    return resp.length ? mergeYears(resp, targetMonths) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(","), targetMonths]);
  // Only block the whole table on the very first load — extensions fill in place.
  const loading = !data;
  // The selected cell's amounts, read from the current data so the panel follows
  // a category change made from it.
  const selectedAmounts = useMemo(() => (data && selected ? selectionAmounts(data, selected) : null), [data, selected]);

  // On first data, bring the current month into view: a third of the way into
  // the months area, with the previous months to its left. Measured on the real
  // column rather than computed from COL_W — columns shrink to their content, so
  // an assumed width lands several months off, and with the transactions panel
  // taking the right of the screen there is no slack left to hide that. Waits for
  // every year to have loaded: amounts widen their columns, so measuring after
  // the first year only would be off again once the others arrive.
  const allYearsLoaded = results.every((r) => r.data !== undefined);
  useEffect(() => {
    const el = scrollRef.current;
    if (inited.current || !data || !allYearsLoaded || !el) return;
    const current = el.querySelector<HTMLElement>("th[data-current-month]");
    if (!current) return;
    const labelWidth = el.querySelector<HTMLElement>("thead th")?.offsetWidth ?? 0;
    el.scrollLeft = Math.max(0, current.offsetLeft - labelWidth - (el.clientWidth - labelWidth) / 3);
    inited.current = true;
  }, [data, allYearsLoaded, targetMonths, currentMonth]);

  const fmt = (cents: number, isTotal = false) =>
    cents === 0 ? (
      <span className="text-muted-foreground/40">{isTotal ? "0,0" : "—"}</span>
    ) : (
      <span className="nums blurable">{formatCents(cents, currency, { decimals: 1 })}</span>
    );

  const saveCell = (row: MergedRow, monthIdx: number) => {
    if (row.category_id == null) return;
    const cents = Math.round(parseFloat(editValue.replace(",", ".") || "0") * 100);
    budgetMut.mutate({ category_id: row.category_id, month: targetMonths[monthIdx], expected_amount_cents: cents, account_id: accountId ?? null });
    setEditing(null);
  };

  const yearSpans = useMemo(() => {
    const spans: { year: string; count: number }[] = [];
    for (const m of targetMonths) {
      const yr = yearOf(m);
      const last = spans[spans.length - 1];
      if (last && last.year === yr) last.count++;
      else spans.push({ year: yr, count: 1 });
    }
    return spans;
  }, [targetMonths]);

  // Indices in `targetMonths` that are the last month of their year (where a
  // fixed per-year Total column is inserted right after).
  const yearBoundaries = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < targetMonths.length; i++) {
      if (i === targetMonths.length - 1 || yearOf(targetMonths[i + 1]) !== yearOf(targetMonths[i])) set.add(i);
    }
    return set;
  }, [targetMonths]);

  const yearTotal = (cells: MergedCell[], year: string) =>
    cells.filter((c) => yearOf(c.month) === year).reduce((s, c) => s + cellDisplayValue(c, currentMonth), 0);

  const pickCell = (pick: RowPick, period: string) =>
    setSelected({ key: `${pick.rowKey}|${period}`, rowKey: pick.rowKey, label: pick.label, color: pick.color, period, categoryIds: pick.categoryIds });
  const isPicked = (pick: RowPick | undefined, period: string) => pick != null && selected?.key === `${pick.rowKey}|${period}`;

  // Renders a row's month cells, inserting a per-year Total cell after each year.
  // `totalCls` may depend on the total (balance rows are coloured by sign), and
  // `pick` makes the year totals clickable like the month cells.
  const renderCells = (
    cells: MergedCell[],
    renderCell: (cell: MergedCell, mIdx: number) => ReactNode,
    totalCls: string | ((total: number) => string) = "",
    pick?: RowPick,
  ) =>
    cells.map((cell, mIdx) => {
      const year = yearOf(cell.month);
      const total = yearBoundaries.has(mIdx) ? yearTotal(cells, year) : 0;
      return (
        <Fragment key={mIdx}>
          {renderCell(cell, mIdx)}
          {yearBoundaries.has(mIdx) && (
            <td
              onClick={pick ? () => pickCell(pick, year) : undefined}
              className={`w-24 border-l-2 border-border bg-muted/60 px-2 py-2 text-right text-sm font-semibold ${typeof totalCls === "function" ? totalCls(total) : totalCls} ${pick ? "cursor-pointer" : ""} ${isPicked(pick, year) ? PICKED : ""}`}
            >
              {fmt(total, true)}
            </td>
          )}
        </Fragment>
      );
    });

  const idsOf = (rows: MergedRow[]) => rows.flatMap((r) => (r.category_id == null ? [] : [r.category_id]));

  // The three row renderers below are plain FUNCTIONS, called as `catRow({...})`,
  // not components rendered as JSX tags. Declared in here, a component would be a
  // new type on every render, so React would unmount and rebuild every row each
  // time any state changed — and a cell replaced between two clicks never
  // receives its double-click (clicking selects the cell, which re-renders).
  function catRow({ row, sIdx, rIdx }: { row: MergedRow; sIdx: number; rIdx: number }) {
    const pick: RowPick | undefined = row.category_id == null ? undefined : {
      rowKey: `cat:${row.category_id}`, label: row.category_name, color: row.category_color,
      categoryIds: [row.category_id],
    };
    return (
      <tr className="border-b border-border/60 hover:bg-muted/40">
        <td className="sticky left-0 z-10 w-52 border-r border-border bg-surface px-4 py-2">
          <div className={`flex items-center gap-2 ${row.child ? "pl-4" : ""}`}>
            {row.child && <span className="text-muted-foreground/60">↳</span>}
            {row.category_color && <span className="size-2 shrink-0 rounded-full" style={{ background: row.category_color }} />}
            <span className="truncate text-sm" title={row.category_name}>{row.category_name}</span>
          </div>
        </td>
        {renderCells(row.cells, (cell, mIdx) => {
          const key = `${sIdx}-${rIdx}-${mIdx}`;
          const isEditing = editing === key;
          const value = cellDisplayValue(cell, currentMonth);
          const isCurrent = cell.month === currentMonth;
          const isFuture = cell.month > currentMonth;
          const type = cellType(cell);
          const bg =
            type === "planned"
              ? "bg-info/15 text-info"
              : type === "confirm"
                ? "bg-warning/20 text-warning ring-1 ring-inset ring-warning/40"
                : `hover:bg-muted ${isCurrent ? "bg-brand/8" : ""} ${isFuture ? "bg-muted/30" : ""}`;
          return (
            <td
              onClick={pick ? () => pickCell(pick, cell.month) : undefined}
              onDoubleClick={() => { setEditing(key); setEditValue(cell.expected_cents ? String(cell.expected_cents / 100) : ""); }}
              className={`group/cell relative w-24 cursor-pointer px-2 py-2 text-right text-sm ${bg} ${isPicked(pick, cell.month) ? PICKED : ""}`}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => saveCell(row, mIdx)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCell(row, mIdx); if (e.key === "Escape") setEditing(null); }}
                  className="w-20 rounded border border-brand bg-background px-1.5 py-0.5 text-right text-sm focus:outline-none"
                />
              ) : (
                <>
                  {/* Value (always visible, right-aligned) */}
                  <span className="flex items-center justify-end gap-1">
                    {type === "confirm" && <span className="text-[10px] font-normal opacity-70">réel</span>}
                    {fmt(value)}
                    {type === "manual" && <Pencil className="size-3 text-warning" />}
                  </span>
                  {/* Action overlay on the left — absolutely positioned so it never
                      pushes the value out of the narrow cell. */}
                  <span className="absolute inset-y-0 left-1 flex items-center gap-0.5">
                    {type === "confirm" && cell.planned_id != null && (
                      <button
                        title={`Confirmer : cette transaction correspond à la dépense planifiée de ${formatCents(cell.planned_cents, currency)} ?`}
                        onClick={(e) => { e.stopPropagation(); plannedMut.confirm.mutate(cell.planned_id!); }}
                        className="rounded bg-warning/25 p-0.5 text-warning hover:bg-warning/40"
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                    {(type === "planned" || type === "confirm") && cell.planned_id != null && (
                      <button
                        title={type === "confirm" ? "Ce n'est pas cette dépense (supprimer la planification)" : "Supprimer la dépense planifiée"}
                        onClick={(e) => { e.stopPropagation(); plannedMut.remove.mutate(cell.planned_id!); }}
                        className="hidden rounded p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100 group-hover/cell:inline-flex"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                    {type === "regular" && value === 0 && (
                      <button
                        title="Planifier une dépense ici"
                        onClick={(e) => { e.stopPropagation(); openPlan({ categoryId: row.category_id ?? undefined, month: cell.month }); }}
                        className="hidden rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover/cell:inline-flex"
                      >
                        <CalendarPlus className="size-3" />
                      </button>
                    )}
                  </span>
                </>
              )}
            </td>
          );
        }, "", pick)}
      </tr>
    );
  }

  // A grouping category (parent): read-only subtotal header = Σ of its children.
  // Clicking the chevron collapses/expands its sub-categories.
  // `members` are the real rows it adds up (itself and its sub-categories).
  function groupRow({ row, members }: { row: MergedRow; members: MergedRow[] }) {
    const pid = row.category_id;
    const isCollapsed = pid != null && collapsed.has(pid);
    const pick: RowPick = {
      rowKey: `group:${pid}`, label: row.category_name, color: row.category_color,
      categoryIds: members.flatMap((m) => (m.category_id == null ? [] : [m.category_id])),
    };
    return (
      <tr className="border-b border-border/60 font-semibold hover:bg-muted/40">
        <td className="sticky left-0 z-10 w-52 border-r border-border bg-surface px-4 py-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => pid != null && toggleCollapsed(pid)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={isCollapsed ? "Développer" : "Réduire"}
            >
              <ChevronRight className={`size-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
            </button>
            {row.category_color && <span className="size-2 shrink-0 rounded-full" style={{ background: row.category_color }} />}
            <span className="truncate text-sm" title={row.category_name}>{row.category_name}</span>
          </div>
        </td>
        {renderCells(row.cells, (cell) => (
          <td
            onClick={() => pickCell(pick, cell.month)}
            className={`w-24 cursor-pointer px-2 py-2 text-right text-sm ${isPicked(pick, cell.month) ? PICKED : ""}`}
          >
            {fmt(cellDisplayValue(cell, currentMonth), true)}
          </td>
        ), "", pick)}
      </tr>
    );
  }

  // `signed`: a balance row (RESTE, SOLDE NET) — each amount is red below zero and
  // green above, instead of the row having one colour. `categoryIds`: the row adds
  // up those categories, so its cells can be clicked to list their transactions.
  function totalRow({ row, label, cls, signed = false, rowKey, categoryIds }: {
    row: MergedRow; label: string; cls: string; signed?: boolean; rowKey?: string; categoryIds?: number[];
  }) {
    const pick: RowPick | undefined = rowKey && categoryIds
      ? { rowKey, label, categoryIds }
      : undefined;
    return (
      <tr className={`border-b-2 border-border font-semibold ${cls}`}>
        <td className={`sticky left-0 z-10 w-52 border-r border-border px-4 py-2.5 text-sm ${cls}`}>{label}</td>
        {renderCells(row.cells, (cell) => {
          const value = cellDisplayValue(cell, currentMonth);
          return (
            <td
              onClick={pick ? () => pickCell(pick, cell.month) : undefined}
              className={`w-24 px-2 py-2.5 text-right text-sm ${signed ? signClass(value) : ""} ${pick ? "cursor-pointer" : ""} ${isPicked(pick, cell.month) ? PICKED : ""}`}
            >
              <span className="inline-flex items-center justify-end gap-1">{fmt(value, true)}</span>
            </td>
          );
        }, signed ? signClass : cls, pick)}
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Cliquez sur un montant pour voir ses transactions, double-cliquez pour un ajustement manuel. Utilisez « Planifier » (ou le bouton sur une cellule vide) pour anticiper une dépense future.</p>
        <div className="flex flex-wrap items-center gap-3">
          <CourantTabs accounts={accounts} value={accountSel} onChange={(v) => { setAccountSel(v); setSelected(null); }} />
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Pencil className="size-3 text-warning" /> ajustement manuel</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm bg-info/60" /> planifiée</span>
            <span className="flex items-center gap-1.5"><Check className="size-3 text-warning" /> à confirmer</span>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label="Aide sur les types de cellules"
                  className="text-muted-foreground transition-colors hover:text-foreground">
                  <HelpCircle className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3">
                <p className="text-sm font-semibold text-foreground">Types de cellules</p>
                <ul className="space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex gap-2.5">
                    <span className="mt-0.5 inline-block size-3 shrink-0 rounded-sm border border-border bg-surface" />
                    <span><span className="font-medium text-foreground">Normale</span> — le montant réellement dépensé ou reçu ce mois-ci, calculé depuis vos transactions.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <Pencil className="mt-0.5 size-3 shrink-0 text-warning" />
                    <span><span className="font-medium text-foreground">Ajustement manuel</span> — un montant que vous ajoutez par-dessus le réel (double-cliquez une cellule). Il s&apos;additionne au réel.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="mt-0.5 inline-block size-3 shrink-0 rounded-sm bg-info/60" />
                    <span><span className="font-medium text-foreground">Planifiée</span> — une dépense ou un revenu anticipé. Disparaît automatiquement dès que la transaction réelle apparaît.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 size-3 shrink-0 text-warning" />
                    <span><span className="font-medium text-foreground">À confirmer</span> — une transaction est apparue mais son montant diffère du plan. Validez (✓) ou retirez (✗) la prévision.</span>
                  </li>
                </ul>
              </PopoverContent>
            </Popover>
          </div>
          <Button size="sm" onClick={() => openPlan()}><CalendarPlus className="mr-1.5 size-4" /> Planifier</Button>
        </div>
      </div>

      {/* Table on the left; on the right, the transactions of the clicked cell. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
      {loading || !data ? (
        <Skeleton className="h-[28rem] w-full rounded-2xl" />
      ) : (
        <div ref={scrollRef} onScroll={onScroll} className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table className="table-fixed whitespace-nowrap text-sm">
            <thead>
              <tr className="bg-muted">
                <th rowSpan={2} className="sticky left-0 z-20 w-52 border-r border-border bg-muted px-4 py-3 text-left text-sm font-bold text-foreground">
                  {accountId ? accounts.find((a) => a.id === accountId)?.name ?? "Compte" : "BUDGET"}
                </th>
                {yearSpans.map((ys) => (
                  <th key={ys.year} colSpan={ys.count + 1} className="border-l border-border px-2 py-1.5 text-center text-xs font-bold tracking-wider text-muted-foreground">{ys.year}</th>
                ))}
              </tr>
              <tr className="bg-muted">
                {targetMonths.map((m, i) => {
                  const isCurrent = m === currentMonth;
                  return (
                    <Fragment key={m}>
                      <th data-current-month={isCurrent || undefined}
                        className={`w-24 px-2 py-2 text-center text-xs font-semibold ${isCurrent ? "border-b-2 border-brand text-brand" : "text-muted-foreground"}`}>
                        {formatMonthLabel(m)}
                      </th>
                      {yearBoundaries.has(i) && (
                        <th className="w-24 border-l-2 border-border px-2 py-2 text-right text-xs font-bold text-foreground">Total {yearOf(m)}</th>
                      )}
                    </Fragment>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.sections.map((section, sIdx) => {
                const style = SECTION[section.section] ?? SECTION.depenses_variables;
                const nonInvest = section.rows.filter((r) => !r.is_investment);
                const hasInvest = section.section === "depenses_variables" && section.rows.some((r) => r.is_investment);
                // Categories that group others → rendered as read-only subtotal headers.
                const parentIds = new Set(section.rows.filter((r) => r.parent_id != null).map((r) => r.parent_id));
                return (
                  <Fragment key={section.section}>
                    <tr className={style.head}>
                      <td className={`sticky left-0 z-10 w-52 px-4 py-2 text-sm font-bold tracking-wide ${style.head}`}>{section.section_label}</td>
                      <td colSpan={data.months.length + yearSpans.length} className={style.head} />
                    </tr>
                    {section.rows.map((row, rIdx) => {
                      // Hide children of a collapsed parent namespace.
                      if (row.parent_id != null && collapsed.has(row.parent_id)) return null;
                      const children = section.rows.filter((r) => r.parent_id === row.category_id);
                      return (
                        <Fragment key={rIdx}>
                          {row.category_id != null && parentIds.has(row.category_id)
                            ? groupRow({ row: parentSubtotalRow(row, children, currentMonth), members: [row, ...children] })
                            : catRow({ row, sIdx, rIdx })}
                        </Fragment>
                      );
                    })}
                    {totalRow({
                      row: section.section_totals, label: `TOTAL ${section.section_label}`, cls: style.total,
                      rowKey: `total:${section.section}`, categoryIds: idsOf(section.rows),
                    })}
                    {hasInvest && totalRow({
                      label: "TOTAL HORS INVESTISSEMENTS",
                      cls: "bg-muted text-brand",
                      rowKey: "total:hors-investissements",
                      categoryIds: idsOf(nonInvest),
                      row: {
                        category_id: null, category_name: "", category_color: "", is_investment: false,
                        cells: data.months.map((m, i) => {
                          const actual = nonInvest.reduce((s, r) => s + r.cells[i].actual_cents, 0);
                          const expected = nonInvest.reduce((s, r) => s + r.cells[i].expected_cents, 0);
                          // Include active planned forecasts (mirrors the backend totals).
                          const planned = nonInvest.reduce((s, r) => {
                            const c = r.cells[i];
                            return s + (c.planned_cents !== 0 && !c.planned_matched && c.actual_cents === 0 ? c.planned_cents : 0);
                          }, 0);
                          return { month: m, actual_cents: actual, expected_cents: expected + planned, planned_cents: 0, planned_matched: false, planned_id: null };
                        }),
                      },
                    })}
                    {section.section === "depenses_fixes" && totalRow({ row: data.reste_row, label: "RESTE POUR DÉPENSES VARIABLES", cls: "bg-muted text-foreground", signed: true })}
                  </Fragment>
                );
              })}
              {totalRow({ row: data.grand_total_row, label: "SOLDE NET", cls: "bg-muted text-foreground", signed: true })}
            </tbody>
          </table>
        </div>
      )}
      </div>
      <aside className="lg:sticky lg:top-4 lg:w-80 lg:shrink-0 xl:w-96" aria-label="Transactions de la cellule sélectionnée">
        <CellTransactions selection={selected} amounts={selectedAmounts} accountId={accountId} accountIds={scopeIds} currency={currency} onClose={() => setSelected(null)} />
      </aside>
      </div>

      <PlanExpenseDialog open={planOpen} onOpenChange={setPlanOpen} accountId={accountId ?? null} prefill={planPrefill} />
    </div>
  );
}
