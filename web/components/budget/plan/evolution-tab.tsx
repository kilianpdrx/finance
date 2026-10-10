"use client";

import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useBudgetEvolution } from "@/lib/api/hooks";
import { isMinimum, standing, type EvolutionRow, type Standing } from "@/lib/budget-plan";
import { formatCents, formatCentsCompact, formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE: Record<Standing, string> = {
  none: "",
  ok: "",
  over: "font-medium text-negative",
  short: "font-medium text-negative",
  reached: "text-positive",
};
const BAR: Record<Standing, string> = {
  none: "var(--muted-foreground)",
  ok: "var(--brand)",
  over: "var(--negative)",
  short: "var(--negative)",
  reached: "var(--positive)",
};

/** How a row's cell reads. Envelopes compare with their target of that month;
 *  the remainder is a balance (its sign is the message); unplanned and outside
 *  rows are amounts to notice, not to judge month by month. */
function cellState(row: EvolutionRow, realised: number, target: number | null | undefined, monthOver: boolean): Standing {
  // A balance is read once the month is over: mid-month, the salary may simply not be in yet.
  if (row.kind === "remainder") return !monthOver || realised === 0 ? "none" : realised < 0 ? "over" : "reached";
  if (row.kind === "outside" || row.kind === "unplanned") return "none";
  return standing(row.kind, realised, target, monthOver);
}

/** The plan over several months: one row per envelope, one column per month,
 *  and the curve of each row with today's amount as a dashed line. Clicking a
 *  row draws it full size above the table. Months before the plan existed show
 *  what happened, uncompared. */
export function EvolutionTab({ accountId }: { accountId: number }) {
  const [months, setMonths] = useState(6);
  const { data, isLoading } = useBudgetEvolution(accountId, months);
  const [picked, setPicked] = useState<string | null>(null);

  if (isLoading || !data) return <Skeleton className="h-96 w-full rounded-2xl" />;

  const currency = data.currency;
  const hasPlan = data.rows.some((r) => r.key.startsWith("envelope-") || (r.key === "unplanned" && r.reference_cents != null));
  const selected = data.rows.find((r) => r.key === picked) ?? data.rows[data.rows.length - 1];
  const over = (month: string) => month < data.current_month;

  const chart = selected.cells.map((c) => ({
    month: c.month,
    Réalisé: c.realised_cents,
    Prévu: c.target_cents,
    state: cellState(selected, c.realised_cents, c.target_cents, over(c.month)),
  }));

  return (
    <div className="space-y-4">
      {!hasPlan && (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Ce compte n&apos;a pas encore de plan : créez-le dans l&apos;onglet « Plan » pour comparer chaque mois à ce que vous prévoyez.
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle>{selected.name}</CardTitle>
            <CardDescription>
              {selected.kind === "remainder"
                ? "Ce qui est rentré moins tout ce qui est sorti, mois par mois. En pointillé : ce que le plan laisse."
                : selected.reference_cents != null
                  ? `Réalisé chaque mois. En pointillé : le montant prévu (${isMinimum(selected.kind) ? "à atteindre" : selected.kind === "unplanned" ? "la provision" : "à ne pas dépasser"}) ; avant le plan, celui d'aujourd'hui pour repère.`
                  : "Réalisé chaque mois, sans montant prévu."}
            </CardDescription>
          </div>
          <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface p-0.5 text-sm">
            {[6, 12].map((n) => (
              <button key={n} type="button" aria-pressed={months === n} onClick={() => setMonths(n)}
                className={cn("rounded-md px-3 py-1 font-medium transition-colors", months === n ? "bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground")}>
                {n} mois
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="month" tickFormatter={(m) => formatMonthLabel(m)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => formatCentsCompact(v, currency)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={56} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<ChartTooltip currency={currency} labelFormatter={(m) => formatMonthLabel(m, { withYear: true })} />} />
              <Bar dataKey="Réalisé" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                {chart.map((c) => <Cell key={c.month} fill={BAR[c.state]} fillOpacity={c.month === data.current_month ? 0.55 : 1} />)}
              </Bar>
              {/* Months from before the plan have no target of their own: today's
                  amount is drawn across, lighter, as a reference to read them against. */}
              {selected.reference_cents != null && chart.some((c) => c.Prévu == null) && (
                <ReferenceLine y={selected.reference_cents} stroke="var(--muted-foreground)" strokeDasharray="2 4" strokeWidth={1} />
              )}
              <Line dataKey="Prévu" type="stepAfter" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Enveloppe</th>
                {data.months.map((m) => (
                  <th key={m} className={cn("px-3 py-2.5 text-right font-medium", m === data.current_month && "text-foreground")}>
                    {formatMonthLabel(m)}{m === data.current_month && " *"}
                  </th>
                ))}
                <th className="w-28 px-4 py-2.5 text-right font-medium">Évolution</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key} onClick={() => setPicked(row.key)} aria-selected={row.key === selected.key}
                  className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-muted/50",
                    row.key === selected.key && "bg-muted/60", row.kind === "remainder" && "font-semibold")}>
                  <td className="px-4 py-2.5">
                    {/* A real button, so a row can be picked from the keyboard too. */}
                    <button type="button" className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); setPicked(row.key); }}>
                      {row.name}
                    </button>
                    {row.reference_cents != null && row.kind !== "remainder" && (
                      <span className="nums blurable block text-xs font-normal text-muted-foreground">
                        {isMinimum(row.kind) ? "objectif" : row.kind === "unplanned" ? "provision" : "plafond"} {formatCents(row.reference_cents, currency)}
                      </span>
                    )}
                  </td>
                  {row.cells.map((c) => {
                    const state = cellState(row, c.realised_cents, c.target_cents, over(c.month));
                    return (
                      <td key={c.month}
                        title={c.target_cents != null ? `Prévu : ${formatCents(c.target_cents, currency)}` : undefined}
                        className={cn("nums blurable px-3 py-2.5 text-right",
                          c.month === data.current_month && state === "none" && "text-muted-foreground",
                          row.kind === "outside" && "text-muted-foreground",
                          row.kind === "unplanned" && c.realised_cents > 0 && "text-warning",
                          TONE[state])}>
                        {formatCents(c.realised_cents, currency, { sign: row.kind === "remainder" })}
                      </td>
                    );
                  })}
                  <td className="px-4 py-1.5 text-right"><Sparkline row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          * mois en cours. En rouge : un plafond dépassé, ou un objectif manqué une fois le mois terminé. Les mois d&apos;avant le plan ne sont pas comparés.
        </p>
      </Card>
    </div>
  );
}

/** A row's months as a small curve, with today's planned amount dashed. */
function Sparkline({ row }: { row: EvolutionRow }) {
  const W = 96, H = 28, PAD = 3;
  const values = row.cells.map((c) => c.realised_cents);
  const reference = row.reference_cents;
  const lo = Math.min(0, ...values, reference ?? 0);
  const hi = Math.max(1, ...values, reference ?? 0);
  const x = (i: number) => (values.length > 1 ? (i * (W - 2 * PAD)) / (values.length - 1) + PAD : W / 2);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Évolution de ${row.name}`} className="inline-block">
      {reference != null && <line x1={PAD} x2={W - PAD} y1={y(reference)} y2={y(reference)} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} />}
      <polyline points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="var(--brand)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
