"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useDividendCalendar } from "@/lib/api/hooks";
import { formatCents, formatCentsCompact } from "@/lib/format";
import { projectionByHolding, type ProjectionSeries } from "@/lib/dividend-projection";
import { CHART_PALETTE } from "@/components/charts/spending-donut";
import { Skeleton } from "@/components/ui/skeleton";

/** « Projection des revenus sur 12 mois »: one stacked series per holding (lib/dividend-projection.ts). */
export function DividendCalendar({ currency }: { currency: string }) {
  const { data, isLoading } = useDividendCalendar(12);
  const projection = useMemo(
    () => (data ? projectionByHolding(data.monthly, CHART_PALETTE) : null),
    [data],
  );

  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (!projection || projection.series.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun dividende projeté sur les 12 prochains mois.</p>;
  }

  const byKey = new Map(projection.series.map((s) => [s.key, s]));

  return (
    <div className="space-y-3">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={projection.rows} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickFormatter={formatMonth}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => formatCentsCompact(v, currency)}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const rows = payload
                  .map((p) => ({ s: byKey.get(String(p.dataKey)), value: Number(p.value ?? 0) }))
                  .filter((r): r is { s: ProjectionSeries; value: number } => !!r.s && r.value > 0)
                  .reverse(); // top of the stack first, as drawn
                if (rows.length === 0) return null;
                const total = rows.reduce((sum, r) => sum + r.value, 0);
                return (
                  <div className="card-surface min-w-[11rem] max-w-[18rem] px-3 py-2 text-xs shadow-lg">
                    <p className="mb-1.5 font-semibold text-foreground">{formatMonth(String(label))}</p>
                    <div className="space-y-1">
                      {rows.map(({ s, value }) => (
                        <div key={s.key} className="flex items-center gap-2">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
                          <span className="nums font-medium text-foreground">{formatCents(value, currency, { decimals: 0 })}</span>
                        </div>
                      ))}
                    </div>
                    {rows.length > 1 && (
                      <div className="mt-1.5 border-t border-border pt-1.5 text-right font-semibold text-foreground">
                        {formatCents(total, currency, { decimals: 0 })}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {projection.series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} maxBarSize={36} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend: largest first, with what each holding brings over the 12 months. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {projection.series.map((s) => (
          <li key={s.key} className="flex min-w-0 items-center gap-1.5" title={s.other ? s.tickers.join(", ") : s.label === s.tickers[0] ? s.label : `${s.label} (${s.tickers[0]})`}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="max-w-[14rem] truncate text-muted-foreground">{s.label}</span>
            <span className="nums blurable font-medium text-foreground">{formatCents(s.total_cents, currency, { decimals: 0 })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatMonth(ym: string) {
  const [y, m] = ym.split("-");
  const labels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  return `${labels[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}
