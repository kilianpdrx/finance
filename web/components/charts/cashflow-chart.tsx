"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import type { CashFlowMonth } from "@/lib/api/hooks";
import { ChartTooltip } from "./chart-tooltip";
import { formatCentsCompact, formatMonthLabel } from "@/lib/format";

export function CashflowChart({ data, currency }: { data: CashFlowMonth[]; currency: string }) {
  const rows = data.map((d) => ({
    month: d.month,
    Revenus: d.income_cents,
    Dépenses: d.expenses_cents,
    Net: d.net_cents,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickFormatter={(m) => formatMonthLabel(m)}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatCentsCompact(v, currency)}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={<ChartTooltip currency={currency} labelFormatter={(m) => formatMonthLabel(m, { withYear: true })} />}
        />
        <Bar dataKey="Revenus" fill="var(--positive)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="Dépenses" fill="var(--negative)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Line dataKey="Net" stroke="var(--info)" strokeWidth={2} dot={false} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
