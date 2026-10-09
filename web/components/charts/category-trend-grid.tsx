"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import type { SpendingTrend, Account } from "@/lib/api/hooks";
import { ChartTooltip } from "./chart-tooltip";
import { formatCents } from "@/lib/format";
import { movingAverage, periodLabel, periodTick, trendCurveName, trendWindow, TREND_MIN_POINTS, type TrendGranularity } from "@/lib/trends";

/** Grid of per-category mini bar charts — the evolution of *every* category, one
 *  bar per period (a month, or a day on short ranges).
 *
 *  Bars, not a line: each point is a total for a discrete period. A smoothed line
 *  between a salary in March and one in April suggests money arriving
 *  continuously in between. The dashed curve over them is something else: a
 *  moving average, which IS a smoothed quantity — the trend, not the amounts. */
export function CategoryTrendGrid({ data, currency, accounts, granularity = "month" }: {
  data: SpendingTrend[];
  currency: string;
  accounts: Account[];
  granularity?: TrendGranularity;
}) {
  const accountName = (id: number | null) => (id == null ? "Tous" : accounts.find((a) => a.id === id)?.name ?? "?");
  const curveName = trendCurveName(granularity);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((trend) => {
        const average = movingAverage(trend.series.map((s) => s.amount_cents), trendWindow(granularity));
        const rows = trend.series.map((s, i) => ({ period: s.period, value: s.amount_cents, average: average[i] }));
        const total = trend.series.reduce((s, d) => s + d.amount_cents, 0);
        return (
          <div key={`${trend.category_id ?? "none"}-${trend.category_account_id ?? "all"}`} className="rounded-xl bg-muted/50 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: trend.category_color }} />
              <span className="truncate text-sm font-medium">{trend.category_name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{accountName(trend.category_account_id)}</span>
              <span className="nums blurable ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatCents(total, currency)}</span>
            </div>
            <ResponsiveContainer width="100%" height={84}>
              <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tickFormatter={periodTick} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis hide />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<ChartTooltip currency={currency} labelFormatter={periodLabel} />} />
                <Bar dataKey="value" name={trend.category_name} fill={trend.category_color} radius={[2, 2, 0, 0]} maxBarSize={22} />
                {rows.length >= TREND_MIN_POINTS && (
                  <Line dataKey="average" name={curveName} stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} type="monotone" isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
