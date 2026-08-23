"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDividendCalendar, type DividendCalendarMonth } from "@/lib/api/hooks";
import { formatCents, formatCentsCompact } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

const SECTOR_COLORS: Record<string, string> = {
  Technology: "#6366f1",
  "Financial Services": "#22c55e",
  Healthcare: "#ef4444",
  "Consumer Cyclical": "#f59e0b",
  "Consumer Defensive": "#14b8a6",
  Industrials: "#8b5cf6",
  Energy: "#ec4899",
  Utilities: "#06b6d4",
  "Real Estate": "#f97316",
  "Communication Services": "#a855f7",
  "Basic Materials": "#84cc16",
  Autre: "#94a3b8",
};

function sectorColor(sector: string) {
  return SECTOR_COLORS[sector] ?? SECTOR_COLORS["Autre"];
}

export function DividendCalendar({ currency }: { currency: string }) {
  const { data, isLoading } = useDividendCalendar(12);

  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (!data || data.monthly.length === 0) return null;

  // Build stacked bar data: each month gets a key per sector
  const sectors = new Set<string>();
  const chartData = data.monthly.map((m: DividendCalendarMonth) => {
    const row: Record<string, unknown> = { month: formatMonth(m.month) };
    const bySector: Record<string, number> = {};
    for (const item of m.items) {
      const s = item.sector || "Autre";
      sectors.add(s);
      bySector[s] = (bySector[s] ?? 0) + item.amount_cents;
    }
    for (const [s, v] of Object.entries(bySector)) {
      row[s] = v;
    }
    row._total = m.total_cents;
    return row;
  });

  const sortedSectors = [...sectors].sort((a, b) => {
    const aTotal = data.monthly.reduce((s, m) => s + m.items.filter((i) => (i.sector || "Autre") === a).reduce((ss, i) => ss + i.amount_cents, 0), 0);
    const bTotal = data.monthly.reduce((s, m) => s + m.items.filter((i) => (i.sector || "Autre") === b).reduce((ss, i) => ss + i.amount_cents, 0), 0);
    return bTotal - aTotal;
  });

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v: number) => formatCentsCompact(v, currency)} tick={{ fontSize: 11 }} width={60} />
          <Tooltip
            content={({ payload, label }) => {
              if (!payload || payload.length === 0) return null;
              const total = payload.reduce((s, p) => s + ((p.value as number) ?? 0), 0);
              return (
                <div className="rounded-lg border border-border bg-popover p-2.5 text-xs shadow-lg">
                  <p className="mb-1.5 font-semibold">{label}</p>
                  {payload.map((p) => (
                    <div key={p.dataKey as string} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.dataKey as string}
                      </span>
                      <span className="nums font-medium">{formatCents((p.value as number) ?? 0, currency, { decimals: 0 })}</span>
                    </div>
                  ))}
                  <div className="mt-1.5 border-t border-border pt-1.5 text-right font-semibold">
                    {formatCents(total, currency, { decimals: 0 })}
                  </div>
                </div>
              );
            }}
          />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {sortedSectors.map((s) => (
            <Bar key={s} dataKey={s} stackId="a" fill={sectorColor(s)} radius={sortedSectors.indexOf(s) === 0 ? [3, 3, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatMonth(ym: string) {
  const [y, m] = ym.split("-");
  const labels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  return `${labels[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}
