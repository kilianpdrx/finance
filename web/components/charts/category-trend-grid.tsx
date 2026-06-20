"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import type { SpendingTrend, Account } from "@/lib/api/hooks";
import { ChartTooltip } from "./chart-tooltip";
import { formatCents } from "@/lib/format";

/** Grid of per-category mini line charts — monthly evolution of *every* category. */
export function CategoryTrendGrid({ data, currency, accounts }: { data: SpendingTrend[]; currency: string; accounts: Account[] }) {
  const accountName = (id: number | null) => (id == null ? "Tous" : accounts.find((a) => a.id === id)?.name ?? "?");

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((trend) => {
        const rows = trend.series.map((s) => ({ month: s.month, value: s.amount_cents }));
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
              <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis hide />
                <Tooltip content={<ChartTooltip currency={currency} />} />
                <Line type="monotone" dataKey="value" name={trend.category_name} stroke={trend.category_color} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
