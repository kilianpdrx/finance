"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
import type { CategoryBreakdown } from "@/lib/api/hooks";
import { ChartTooltip } from "./chart-tooltip";
import { formatCentsCompact } from "@/lib/format";

export const CHART_PALETTE = [
  "oklch(0.7 0.15 162)",
  "oklch(0.62 0.16 256)",
  "oklch(0.77 0.16 70)",
  "oklch(0.65 0.2 16)",
  "oklch(0.68 0.13 300)",
  "oklch(0.72 0.13 200)",
  "oklch(0.6 0.05 264)",
];

export function SpendingDonut({ data, currency, size = 176 }: { data: CategoryBreakdown[]; currency: string; size?: number }) {
  const slices = useMemo(() => {
    const top = data.slice(0, 6);
    const restTotal = data.slice(6).reduce((s, d) => s + d.total_cents, 0);
    const rows = top.map((d) => ({ name: d.category_name, value: d.total_cents }));
    if (restTotal > 0) rows.push({ name: "Autres", value: restTotal });
    return rows;
  }, [data]);

  const total = slices.reduce((s, r) => s + r.value, 0);

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative shrink-0" style={{ height: size, width: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={Math.round(size * 0.31)}
              outerRadius={Math.round(size * 0.44)}
              paddingAngle={2}
              stroke="none"
            >
              {slices.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted-foreground">Total</span>
          <span className="nums blurable text-lg font-semibold">{formatCentsCompact(total, currency)}</span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.name}</span>
            <span className="nums blurable shrink-0 font-medium">{formatCentsCompact(s.value, currency)}</span>
            <span className="nums w-10 shrink-0 text-right text-xs text-muted-foreground">
              {total ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
