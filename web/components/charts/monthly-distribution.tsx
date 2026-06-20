"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { SpendingTrend } from "@/lib/api/hooks";
import { ChartTooltip } from "./chart-tooltip";
import { formatCents, formatCentsCompact, formatMonthLabel } from "@/lib/format";

interface Slice { name: string; value: number; color: string }

/** Grid of monthly donuts — category breakdown of expenses for each month. */
export function MonthlyDistribution({ data, currency }: { data: SpendingTrend[]; currency: string }) {
  const months = useMemo(() => {
    const byMonth = new Map<string, Slice[]>();
    for (const trend of data) {
      for (const s of trend.series) {
        if (s.amount_cents === 0) continue;
        if (!byMonth.has(s.month)) byMonth.set(s.month, []);
        byMonth.get(s.month)!.push({ name: trend.category_name, value: s.amount_cents, color: trend.category_color });
      }
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, slices]) => ({ month, slices: slices.sort((x, y) => y.value - x.value), total: slices.reduce((s, d) => s + d.value, 0) }));
  }, [data]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {months.map(({ month, slices, total }) => (
        <div key={month} className="rounded-xl bg-muted/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">{formatMonthLabel(month, { withYear: true })}</span>
            <span className="nums blurable text-xs text-muted-foreground">{formatCentsCompact(total, currency)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-[140px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={64} paddingAngle={1} stroke="none">
                    {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip currency={currency} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="min-w-0 flex-1 space-y-0.5">
              {slices.slice(0, 6).map((s, i) => (
                <li key={i} className="flex items-center gap-1.5 text-xs">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.name}</span>
                  <span className="nums blurable shrink-0 font-medium">{formatCents(s.value, currency)}</span>
                </li>
              ))}
              {slices.length > 6 && <li className="text-xs italic text-muted-foreground">+{slices.length - 6} autres</li>}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
