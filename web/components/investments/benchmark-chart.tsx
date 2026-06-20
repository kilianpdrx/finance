"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useBenchmarks, useBenchmarkHistory, useHoldingHistory, type BenchmarkPoint } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const PERIODS = [
  { value: "3mo", label: "3M" },
  { value: "6mo", label: "6M" },
  { value: "1y", label: "1A" },
  { value: "2y", label: "2A" },
  { value: "5y", label: "5A" },
];

const BENCH_COLORS: Record<string, string> = {
  sp500: "#ef4444",
  msci_world: "#3b82f6",
  cac40: "#f59e0b",
  stoxx600: "#8b5cf6",
  nasdaq: "#10b981",
};

interface Props {
  accountName: string;
  accountColor: string;
  holdings: { ticker: string; quantity: number; cost_basis_cents: number; current_value_cents: number | null }[];
}

export function BenchmarkChart({ accountName, accountColor, holdings }: Props) {
  const [period, setPeriod] = useState("1y");
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>(["sp500", "msci_world"]);
  const { data: benchmarkList = [] } = useBenchmarks();

  const mainTicker = holdings.length > 0 ? holdings.reduce((a, b) =>
    (b.current_value_cents ?? 0) > (a.current_value_cents ?? 0) ? b : a
  ).ticker : null;

  const bench1 = useBenchmarkHistory(selectedBenchmarks[0] ?? null, period);
  const bench2 = useBenchmarkHistory(selectedBenchmarks[1] ?? null, period);
  const bench3 = useBenchmarkHistory(selectedBenchmarks[2] ?? null, period);

  const benchQueries = [bench1, bench2, bench3].slice(0, selectedBenchmarks.length);
  const isLoading = benchQueries.some((q) => q.isLoading);

  const toggleBenchmark = (key: string) => {
    setSelectedBenchmarks((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev.length < 3 ? [...prev, key] : prev
    );
  };

  const dateMap: Record<string, Record<string, number>> = {};
  for (let i = 0; i < selectedBenchmarks.length; i++) {
    const benchData = benchQueries[i]?.data;
    if (!benchData?.data) continue;
    for (const pt of benchData.data) {
      if (!dateMap[pt.date]) dateMap[pt.date] = {};
      dateMap[pt.date][selectedBenchmarks[i]] = pt.pct;
    }
  }

  const chartData = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                period === p.value
                  ? "bg-brand text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mx-2 h-4 w-px bg-border" />
        <div className="flex flex-wrap items-center gap-1.5">
          {benchmarkList.map((b) => (
            <button
              key={b.key}
              onClick={() => toggleBenchmark(b.key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                selectedBenchmarks.includes(b.key)
                  ? "border-transparent text-white"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              style={selectedBenchmarks.includes(b.key) ? { backgroundColor: BENCH_COLORS[b.key] ?? "#6b7280" } : undefined}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[260px] w-full rounded-lg" />
      ) : chartData.length === 0 ? (
        <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          Sélectionnez un ou plusieurs indices
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => {
                const dt = new Date(d + "T00:00:00");
                return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
              }}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              contentStyle={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(d) =>
                new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
              }
              formatter={(value: number, name: string) => {
                const benchInfo = benchmarkList.find((b) => b.key === name);
                const label = benchInfo?.name ?? name;
                return [`${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, label];
              }}
            />
            <Legend
              formatter={(value: string) => {
                const benchInfo = benchmarkList.find((b) => b.key === value);
                return benchInfo?.name ?? value;
              }}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            {selectedBenchmarks.map((key) => (
              <Line
                key={key}
                dataKey={key}
                name={key}
                stroke={BENCH_COLORS[key] ?? "#6b7280"}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
