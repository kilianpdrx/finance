"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
import { ChartTooltip } from "./chart-tooltip";
import { CHART_PALETTE } from "./spending-donut";
import { ACCOUNT_TYPE_LABELS } from "@/components/accounts/account-dialog";
import { formatCentsCompact } from "@/lib/format";

/** Wealth split by account type (values already in base currency, cents). */
export function PatrimoineDonut({ byType, currency, size = 176 }: { byType: Record<string, number>; currency: string; size?: number }) {
  const slices = useMemo(
    () =>
      Object.entries(byType)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([type, value]) => ({ name: ACCOUNT_TYPE_LABELS[type] ?? type, value })),
    [byType],
  );

  const total = slices.reduce((s, r) => s + r.value, 0);

  if (slices.length === 0) return null;

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
