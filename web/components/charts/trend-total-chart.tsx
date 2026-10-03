"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip } from "./chart-tooltip";
import { formatCentsCompact } from "@/lib/format";
import { periodLabel, periodTick, type TotalPoint, type TrendGranularity } from "@/lib/trends";

/** All categories together: one bar per period, and — day by day — the running
 *  total as a line on its own axis. The line is what answers "is there a moment
 *  of the month when I spend more": it climbs where the money goes. */
export function TrendTotalChart({ data, granularity, income, currency }: {
  data: TotalPoint[];
  granularity: TrendGranularity;
  income: boolean;
  currency: string;
}) {
  const barName = granularity === "day" ? "Total du jour" : "Total du mois";
  const rows = data.map((d) => ({ period: d.period, [barName]: d.total, Cumul: d.cumulative }));
  const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="period" tickFormatter={periodTick} tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis yAxisId="total" tickFormatter={(v) => formatCentsCompact(v, currency)} tick={axisTick} axisLine={false} tickLine={false} width={56} />
        {granularity === "day" && (
          <YAxis yAxisId="cumul" orientation="right" tickFormatter={(v) => formatCentsCompact(v, currency)} tick={axisTick} axisLine={false} tickLine={false} width={56} />
        )}
        <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<ChartTooltip currency={currency} labelFormatter={periodLabel} />} />
        <Bar yAxisId="total" dataKey={barName} fill={income ? "var(--positive)" : "var(--negative)"} radius={[3, 3, 0, 0]} maxBarSize={26} />
        {granularity === "day" && (
          <Line yAxisId="cumul" dataKey="Cumul" stroke="var(--info)" strokeWidth={2} dot={false} type="stepAfter" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
