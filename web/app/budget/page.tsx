"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { api, unwrap } from "@/lib/api/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccounts, useBudgetMutation, type BudgetFullResponse } from "@/lib/api/hooks";
import { build24Months, cellDisplayValue, mergeYears, yearOf, type MergedBudget, type MergedRow, type MergedCell } from "@/lib/budget";
import { formatCents, formatMonthLabel, deriveCurrency } from "@/lib/format";

const ALL = "__all__";

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
  const [accountSel, setAccountSel] = useState(ALL);
  const accountId = accountSel === ALL ? undefined : Number(accountSel);
  const budgetMut = useBudgetMutation();

  const targetMonths = useMemo(() => build24Months(), []);
  const years = useMemo(() => Array.from(new Set(targetMonths.map(yearOf))).map(Number).sort(), [targetMonths]);
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const currency = deriveCurrency(courant, accountId != null ? [accountId] : null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  const loading = results.some((r) => r.isLoading);
  const data: MergedBudget | null = useMemo(() => {
    const resp = results.map((r) => r.data).filter(Boolean) as BudgetFullResponse[];
    return resp.length ? mergeYears(resp, targetMonths) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(","), targetMonths]);

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

  const totalOf = (cells: MergedCell[]) => cells.reduce((s, c) => s + cellDisplayValue(c, currentMonth), 0);

  function CatRow({ row, sIdx, rIdx }: { row: MergedRow; sIdx: number; rIdx: number }) {
    return (
      <tr className="border-b border-border/60 hover:bg-muted/40">
        <td className="sticky left-0 z-10 w-52 border-r border-border bg-surface px-4 py-2">
          <div className="flex items-center gap-2">
            {row.category_color && <span className="size-2 shrink-0 rounded-full" style={{ background: row.category_color }} />}
            <span className="truncate text-sm" title={row.category_name}>{row.category_name}</span>
          </div>
        </td>
        {row.cells.map((cell, mIdx) => {
          const key = `${sIdx}-${rIdx}-${mIdx}`;
          const isEditing = editing === key;
          const value = cellDisplayValue(cell, currentMonth);
          const isCurrent = cell.month === currentMonth;
          const isFuture = cell.month > currentMonth;
          return (
            <td
              key={mIdx}
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
        <td className="sticky right-0 z-10 w-28 border-l border-border bg-muted px-3 py-2 text-right text-sm font-semibold">{fmt(totalOf(row.cells), true)}</td>
      </tr>
    );
  }

  function TotalRow({ row, label, cls }: { row: MergedRow; label: string; cls: string }) {
    return (
      <tr className={`border-b-2 border-border font-semibold ${cls}`}>
        <td className={`sticky left-0 z-10 w-52 border-r border-border px-4 py-2.5 text-sm ${cls}`}>{label}</td>
        {row.cells.map((cell, i) => (
          <td key={i} className="w-24 px-2 py-2.5 text-right text-sm">
            <span className="inline-flex items-center justify-end gap-1">{fmt(cellDisplayValue(cell, currentMonth), true)}{cell.expected_cents !== 0 && <Pencil className="size-3 text-warning" />}</span>
          </td>
        ))}
        <td className={`sticky right-0 z-10 w-28 border-l border-border px-3 py-2.5 text-right text-sm ${cls}`}>{fmt(totalOf(row.cells), true)}</td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Double-cliquez sur une cellule pour saisir un ajustement manuel. Vue continue sur 24 mois.</p>
        <div className="flex items-center gap-3">
          <Select value={accountSel} onValueChange={setAccountSel}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous les comptes</SelectItem>
              {courant.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <Pencil className="size-3 text-warning" /> = ajustement manuel
          </span>
        </div>
      </div>

      {loading || !data ? (
        <Skeleton className="h-[28rem] w-full rounded-2xl" />
      ) : (
        <div ref={scrollRef} className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table className="table-fixed whitespace-nowrap text-sm">
            <thead>
              <tr className="bg-foreground">
                <th rowSpan={2} className="sticky left-0 z-20 w-52 border-r border-border bg-foreground px-4 py-3 text-left text-sm font-bold text-background">
                  {accountId ? accounts.find((a) => a.id === accountId)?.name ?? "Compte" : "BUDGET"}
                </th>
                {yearSpans.map((ys) => (
                  <th key={ys.year} colSpan={ys.count} className="border-l border-background/15 px-2 py-1.5 text-center text-xs font-bold tracking-wider text-background/60">{ys.year}</th>
                ))}
                <th rowSpan={2} className="sticky right-0 z-20 w-28 border-l border-border bg-foreground px-3 py-3 text-right text-sm font-bold text-warning">TOTAL</th>
              </tr>
              <tr className="bg-foreground">
                {targetMonths.map((m) => {
                  const isCurrent = m === currentMonth;
                  return (
                    <th key={m} className={`w-24 px-2 py-2 text-center text-xs font-semibold ${isCurrent ? "border-b-2 border-brand text-brand" : "text-background/55"}`}>
                      {formatMonthLabel(m)}
                    </th>
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
                      <td colSpan={data.months.length} className={style.head} />
                      <td className={`sticky right-0 w-28 ${style.head}`} />
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
              <TotalRow row={data.grand_total_row} label="SOLDE NET" cls="bg-foreground text-background" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
