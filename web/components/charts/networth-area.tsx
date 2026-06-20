"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import type { NetWorthPoint } from "@/lib/api/hooks";
import { ChartTooltip } from "./chart-tooltip";
import { formatCentsCompact, formatMonthLabel } from "@/lib/format";

export function NetworthArea({ data, currency }: { data: NetWorthPoint[]; currency: string }) {
  const rows = data.map((d) => ({ month: d.month, total: Number(d.total) }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickFormatter={(m) => formatMonthLabel(m)}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={["auto", "auto"]}
          tickFormatter={(v) => formatCentsCompact(v, currency)}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          content={
            <ChartTooltip
              currency={currency}
              labelFormatter={(m) => formatMonthLabel(m, { withYear: true })}
            />
          }
        />
        <Area
          dataKey="total"
          name="Patrimoine"
          stroke="var(--brand)"
          strokeWidth={2.5}
          fill="url(#nw-fill)"
          type="monotone"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
