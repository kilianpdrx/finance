"use client";

import { useRef, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Category } from "@/lib/api/hooks";
import {
  AMOUNT_LABEL, centsToAmount, clearDetail, draftAmountCents, fillWithTypical, fitsKind, isDetailed, moveCategory,
  setCategoryAmount, type CategoryStats, type DraftEnvelope,
} from "@/lib/budget-plan";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/** The plan as a sheet: one line per category, what it usually does on this
 *  account, and a cell to type what is planned for it.
 *
 *  An envelope is ONE figure until one of its categories gets an amount; from
 *  then on it is the sum of its lines, as a total row would be in a spreadsheet
 *  (a blank line counts for nothing). The same working copy as the envelopes
 *  view: both edit one plan, saved in one go. */
export function PlanSheet({
  drafts,
  onChange,
  byId,
  unassigned,
  stats,
  currency,
}: {
  drafts: DraftEnvelope[];
  onChange: (next: DraftEnvelope[]) => void;
  byId: Map<number, Category>;
  /** Eligible categories no envelope holds. */
  unassigned: Category[];
  stats: Map<number, CategoryStats>;
  currency: string;
}) {
  const table = useRef<HTMLTableElement>(null);
  const patch = (key: string, change: (d: DraftEnvelope) => DraftEnvelope) => onChange(drafts.map((d) => (d.key === key ? change(d) : d)));

  // ↑ ↓ and Enter move down the amounts column, as in a sheet.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = e.key === "ArrowDown" || e.key === "Enter" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const cells = Array.from(table.current?.querySelectorAll<HTMLInputElement>("input[data-sheet-cell]") ?? []);
    const next = cells[cells.indexOf(e.currentTarget) + step];
    if (next) { e.preventDefault(); next.focus(); next.select(); }
  };

  const figure = (cents: number | null | undefined) => (cents == null ? "—" : formatCents(cents, currency));
  const nameOf = (c: Category) => {
    const parent = c.parent_id != null ? byId.get(c.parent_id) : undefined;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
        <span className="truncate">{c.name}</span>
        {parent && <span className="truncate text-xs text-muted-foreground">· {parent.name}</span>}
      </span>
    );
  };
  const envelopeSelect = (c: Category, from: DraftEnvelope | null) => (
    <Select value={from?.key ?? NONE} onValueChange={(v) => onChange(moveCategory(drafts, c.id, v === NONE ? null : v))}>
      <SelectTrigger aria-label={`Enveloppe de ${c.name}`} className="h-8 w-full text-xs [&>span]:truncate"><SelectValue /></SelectTrigger>
      <SelectContent>
        {drafts.filter((d) => fitsKind(c, d.kind)).map((d) => <SelectItem key={d.key} value={d.key}>{d.name.trim() || "Enveloppe sans nom"}</SelectItem>)}
        <SelectItem value={NONE}>Hors enveloppes</SelectItem>
      </SelectContent>
    </Select>
  );
  const statCells = (id: number) => {
    const s = stats.get(id);
    return (
      <>
        <td className="nums blurable border-b border-border/60 px-3 py-1.5 text-right text-muted-foreground">{figure(s?.average_cents)}</td>
        <td className="nums blurable border-b border-border/60 px-3 py-1.5 text-right text-muted-foreground">{figure(s?.last_month_cents)}</td>
      </>
    );
  };

  return (
    <table ref={table} aria-label="Détail par catégorie" className="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 text-left font-medium">Catégorie</th>
          <th className="sticky top-0 z-10 w-52 border-b border-border bg-surface px-3 py-2 text-left font-medium">Enveloppe</th>
          <th className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 text-right font-medium" title="La médiane des 12 derniers mois complets de ce compte">Mois type</th>
          <th className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 text-right font-medium">Moyenne</th>
          <th className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 text-right font-medium">Mois dernier</th>
          <th className="sticky top-0 z-10 w-36 border-b border-border bg-surface px-3 py-2 text-right font-medium">Prévu / mois</th>
        </tr>
      </thead>

      {drafts.map((d) => {
        const title = d.name.trim() || "Enveloppe sans nom";
        const detailed = isDetailed(d);
        const rows = d.categoryIds.map((id) => byId.get(id)).filter((c): c is Category => c !== undefined)
          .sort((a, b) => a.name.localeCompare(b.name));
        return (
          <tbody key={d.key} aria-label={title}>
            <tr className="bg-muted/60">
              <th scope="rowgroup" colSpan={2} className="px-3 py-2 text-left font-semibold">
                {title} <span className="text-xs font-normal text-muted-foreground">· {AMOUNT_LABEL[d.kind]}</span>
              </th>
              <td colSpan={3} className="px-3 py-2 text-right text-xs">
                {d.kind === "unplanned" ? (
                  <span className="text-muted-foreground">pour les dépenses que vous marquez « imprévu »</span>
                ) : rows.length === 0 ? (
                  <span className="text-muted-foreground">aucune catégorie</span>
                ) : detailed ? (
                  <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => patch(d.key, clearDetail)}>
                    Revenir à un seul montant
                  </button>
                ) : (
                  <button type="button" className="text-brand hover:underline"
                    onClick={() => patch(d.key, (x) => fillWithTypical(x, (id) => stats.get(id)?.typical_cents))}>
                    Détailler avec le mois type
                  </button>
                )}
              </td>
              <td className="px-3 py-1.5 text-right">
                {detailed ? (
                  <span className="nums blurable font-semibold" title="La somme des lignes ci-dessous">{formatCents(draftAmountCents(d), currency)}</span>
                ) : (
                  <Input data-sheet-cell aria-label={`Montant mensuel de ${title}`} inputMode="decimal" value={d.amount} placeholder="0"
                    onChange={(e) => patch(d.key, (x) => ({ ...x, amount: e.target.value }))} onKeyDown={onKey}
                    className="nums ml-auto h-8 w-28 text-right font-semibold" />
                )}
              </td>
            </tr>
            {rows.map((c) => {
              const typical = stats.get(c.id)?.typical_cents;
              return (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="border-b border-border/60 px-3 py-1.5">{nameOf(c)}</td>
                  <td className="border-b border-border/60 px-3 py-1">{envelopeSelect(c, d)}</td>
                  <td className="nums blurable border-b border-border/60 px-3 py-1.5 text-right">
                    {typical == null ? "—" : (
                      <button type="button" title="Utiliser comme montant prévu" className="rounded px-1 hover:bg-muted hover:text-brand"
                        onClick={() => onChange(setCategoryAmount(drafts, c.id, centsToAmount(Math.round(typical / 100) * 100)))}>
                        {formatCents(typical, currency)}
                      </button>
                    )}
                  </td>
                  {statCells(c.id)}
                  <td className="border-b border-border/60 px-3 py-1 text-right">
                    <Input data-sheet-cell aria-label={`Montant prévu pour ${c.name}`} inputMode="decimal"
                      value={d.categoryAmounts[c.id] ?? ""} placeholder={detailed ? "0" : "—"}
                      title={detailed ? undefined : "Saisissez un montant pour prévoir cette enveloppe ligne par ligne"}
                      onChange={(e) => onChange(setCategoryAmount(drafts, c.id, e.target.value))} onKeyDown={onKey}
                      className={cn("nums ml-auto h-8 w-28 text-right", !detailed && "border-dashed")} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        );
      })}

      {unassigned.length > 0 && (
        <tbody aria-label="Hors enveloppes">
          <tr className="bg-muted/60">
            <th scope="rowgroup" colSpan={6} className="px-3 py-2 text-left font-semibold">
              Hors enveloppes <span className="text-xs font-normal text-muted-foreground">· {unassigned.length} — visibles dans le plan, sans montant prévu. Choisissez une enveloppe pour en prévoir un.</span>
            </th>
          </tr>
          {unassigned.map((c) => (
            <tr key={c.id} className="text-muted-foreground hover:bg-muted/30">
              <td className="border-b border-border/60 px-3 py-1.5">{nameOf(c)}</td>
              <td className="border-b border-border/60 px-3 py-1">{envelopeSelect(c, null)}</td>
              <td className="nums blurable border-b border-border/60 px-3 py-1.5 text-right">{figure(stats.get(c.id)?.typical_cents)}</td>
              {statCells(c.id)}
              <td className="border-b border-border/60 px-3 py-1.5 text-right">—</td>
            </tr>
          ))}
        </tbody>
      )}
    </table>
  );
}
