"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip } from "./chart-tooltip";
import { formatCentsCompact } from "@/lib/format";
import {
  movingAverage, periodLabel, periodTick, trendCurveName, trendWindow, TREND_MIN_POINTS,
  type TotalPoint, type TrendGranularity,
} from "@/lib/trends";

/** All categories together: one bar per period, and — day by day — the running
 *  total as a line on its own axis. The line is what answers "is there a moment
 *  of the month when I spend more": it climbs where the money goes.
 *
 *  The dashed curve is the trend: a moving average of the bars, on the bars'
 *  own axis, so it reads at the same scale as what it smooths. */
export function TrendTotalChart({ data, granularity, income, currency }: {
  data: TotalPoint[];
  granularity: TrendGranularity;
  income: boolean;
  currency: string;
}) {
  const barName = granularity === "day" ? "Total du jour" : "Total du mois";
  const curveName = trendCurveName(granularity);
  const average = movingAverage(data.map((d) => d.total), trendWindow(granularity));
  const showCurve = data.length >= TREND_MIN_POINTS;
  const rows = data.map((d, i) => ({ period: d.period, [barName]: d.total, [curveName]: average[i], Cumul: d.cumulative }));
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
        {showCurve && (
          <Line yAxisId="total" dataKey={curveName} stroke="var(--foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} type="monotone" isAnimationActive={false} />
        )}
        {granularity === "day" && (
          <Line yAxisId="cumul" dataKey="Cumul" stroke="var(--info)" strokeWidth={2} dot={false} type="stepAfter" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
