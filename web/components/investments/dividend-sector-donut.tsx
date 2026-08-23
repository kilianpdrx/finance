"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useDividendCalendar } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#a855f7", "#84cc16"];

export function DividendSectorDonut({ currency }: { currency: string }) {
  const { data, isLoading } = useDividendCalendar(12);

  if (isLoading) return <Skeleton className="h-56 rounded-2xl" />;
  if (!data || data.by_sector.length === 0) return null;

  const total = data.by_sector.reduce((s, x) => s + x.est_annual_cents, 0);
  if (total <= 0) return null;

  const sectors = data.by_sector.map((s, i) => ({
    name: s.sector,
    value: s.est_annual_cents,
    color: PALETTE[i % PALETTE.length],
    pct: Math.round((s.est_annual_cents / total) * 1000) / 10,
  }));

  return (
    <div className="flex items-center gap-6">
      <div className="h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={sectors} dataKey="value" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} strokeWidth={0}>
              {sectors.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        {sectors.map((s) => (
          <div key={s.name} className="flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-muted-foreground">{s.name}</span>
            <span className="nums ml-auto font-medium">{formatCents(s.value, currency, { decimals: 0 })}/an</span>
            <span className="nums text-xs text-muted-foreground">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
