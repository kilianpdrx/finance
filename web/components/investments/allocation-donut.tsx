"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { formatCents } from "@/lib/format";

const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#14b8a6"];

const TYPE_LABELS: Record<string, string> = {
  stock: "Actions",
  etf: "ETFs",
  crypto: "Crypto",
  bond: "Obligations",
  fund: "Fonds",
};

export function AllocationDonut({ allocation, currency }: { allocation: Record<string, number>; currency?: string }) {
  const data = Object.entries(allocation)
    .filter(([, v]) => v > 0)
    .map(([type, value]) => ({ name: TYPE_LABELS[type] ?? type, value }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) return null;

  return (
    <div className="flex items-center gap-4">
      <div className="h-32 w-32 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip
              formatter={(val: number) => formatCents(val, currency)}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5">
        {data.map((d, i) => {
          const total = data.reduce((s, x) => s + x.value, 0);
          const pct = total > 0 ? Math.round((d.value / total) * 1000) / 10 : 0;
          return (
            <div key={d.name} className="flex items-center gap-2 text-xs">
              <div className="size-2.5 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
              <span className="text-muted-foreground">{d.name}</span>
              <span className="nums font-medium">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
