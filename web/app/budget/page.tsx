"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { api, unwrap } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { CourantTabs, type CourantSelection } from "@/components/analytics/courant-tabs";
import { useAccounts, useBudgetMutation, type BudgetFullResponse } from "@/lib/api/hooks";
import { buildMonths, cellDisplayValue, mergeYears, yearOf, type MergedBudget, type MergedRow, type MergedCell } from "@/lib/budget";
import { formatCents, formatMonthLabel, deriveCurrency } from "@/lib/format";

// Column geometry (must match the Tailwind widths used in the table).
const COL_W = 96; // month cell  = w-24
const STEP = 12; // months added per lazy extension

// Total-row bands use OPAQUE backgrounds (bg-muted) so the sticky TOTAL/label
// columns don't let the horizontally-scrolled month cells bleed through.
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
  const budgetMut = useBudgetMutation();

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
  const inited = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // After prepending months, keep the viewport visually stable (no jump).
  useLayoutEffect(() => {
    if (pendingPrepend.current && scrollRef.current) {
      scrollRef.current.scrollLeft += pendingPrepend.current * COL_W;
      pendingPrepend.current = 0;
    }
    extending.current = false;
  }, [targetMonths]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (extending.current) return;
    if (el.scrollLeft < COL_W * 2) {
      extending.current = true;
      pendingPrepend.current = STEP;
      setRange((r) => ({ ...r, start: r.start - STEP }));
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - COL_W * 2) {
      extending.current = true;
      setRange((r) => ({ ...r, end: r.end + STEP }));
    }
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

  // On first data, centre the viewport on the current month.
  useEffect(() => {
    if (inited.current || !data || !scrollRef.current) return;
    const curIdx = targetMonths.indexOf(currentMonth);
    if (curIdx >= 0) {
      scrollRef.current.scrollLeft = Math.max(0, curIdx * COL_W - scrollRef.current.clientWidth / 3);
      inited.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, targetMonths, currentMonth]);

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

  // Renders a row's month cells, inserting a per-year Total cell after each year.
  const renderCells = (cells: MergedCell[], renderCell: (cell: MergedCell, mIdx: number) => ReactNode, totalCls = "") =>
    cells.map((cell, mIdx) => (
      <Fragment key={mIdx}>
        {renderCell(cell, mIdx)}
        {yearBoundaries.has(mIdx) && (
          <td className={`w-24 border-l-2 border-border bg-muted/60 px-2 py-2 text-right text-sm font-semibold ${totalCls}`}>
            {fmt(yearTotal(cells, yearOf(cell.month)), true)}
          </td>
        )}
      </Fragment>
    ));

  function CatRow({ row, sIdx, rIdx }: { row: MergedRow; sIdx: number; rIdx: number }) {
    return (
      <tr className="border-b border-border/60 hover:bg-muted/40">
        <td className="sticky left-0 z-10 w-52 border-r border-border bg-surface px-4 py-2">
          <div className="flex items-center gap-2">
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
          return (
            <td
              onDoubleClick={() => { setEditing(key); setEditValue(cell.expected_cents ? String(cell.expected_cents / 100) : ""); }}
              className={`w-24 cursor-pointer px-2 py-2 text-right text-sm hover:bg-muted ${isCurrent ? "bg-brand/8" : ""} ${isFuture ? "bg-muted/30" : ""}`}
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
                <span className="inline-flex items-center justify-end gap-1">
                  {fmt(value)}
                  {cell.expected_cents !== 0 && <Pencil className="size-3 text-warning" />}
                </span>
              )}
            </td>
          );
        })}
      </tr>
    );
  }

  function TotalRow({ row, label, cls }: { row: MergedRow; label: string; cls: string }) {
    return (
      <tr className={`border-b-2 border-border font-semibold ${cls}`}>
        <td className={`sticky left-0 z-10 w-52 border-r border-border px-4 py-2.5 text-sm ${cls}`}>{label}</td>
        {renderCells(row.cells, (cell) => (
          <td className="w-24 px-2 py-2.5 text-right text-sm">
            <span className="inline-flex items-center justify-end gap-1">{fmt(cellDisplayValue(cell, currentMonth), true)}{cell.expected_cents !== 0 && <Pencil className="size-3 text-warning" />}</span>
          </td>
        ), cls)}
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Double-cliquez sur une cellule pour saisir un ajustement manuel. Faites défiler horizontalement, année après année.</p>
        <div className="flex items-center gap-3">
          <CourantTabs accounts={accounts} value={accountSel} onChange={setAccountSel} />
          <span className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <Pencil className="size-3 text-warning" /> = ajustement manuel
          </span>
        </div>
      </div>

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
                      <th className={`w-24 px-2 py-2 text-center text-xs font-semibold ${isCurrent ? "border-b-2 border-brand text-brand" : "text-muted-foreground"}`}>
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
                return (
                  <Fragment key={section.section}>
                    <tr className={style.head}>
                      <td className={`sticky left-0 z-10 w-52 px-4 py-2 text-sm font-bold tracking-wide ${style.head}`}>{section.section_label}</td>
                      <td colSpan={data.months.length + yearSpans.length} className={style.head} />
                    </tr>
                    {section.rows.map((row, rIdx) => <CatRow key={rIdx} row={row} sIdx={sIdx} rIdx={rIdx} />)}
                    <TotalRow row={section.section_totals} label={`TOTAL ${section.section_label}`} cls={style.total} />
                    {hasInvest && (
                      <TotalRow
                        label="TOTAL HORS INVESTISSEMENTS"
                        cls="bg-muted text-brand"
                        row={{
                          category_id: null, category_name: "", category_color: "", is_investment: false,
                          cells: data.months.map((m, i) => ({ month: m, actual_cents: nonInvest.reduce((s, r) => s + r.cells[i].actual_cents, 0), expected_cents: nonInvest.reduce((s, r) => s + r.cells[i].expected_cents, 0) })),
                        }}
                      />
                    )}
                    {section.section === "depenses_fixes" && <TotalRow row={data.reste_row} label="RESTE pour dépenses variables" cls="bg-muted text-positive" />}
                  </Fragment>
                );
              })}
              <TotalRow row={data.grand_total_row} label="SOLDE NET" cls="bg-brand/15 text-foreground" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
