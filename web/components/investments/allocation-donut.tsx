"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#14b8a6"];

const TYPE_LABELS: Record<string, string> = {
  stock: "Actions",
  etf: "ETFs",
  crypto: "Crypto",
  bond: "Obligations",
  fund: "Fonds",
  other: "Autre",
};

export interface AllocationHolding {
  asset_type: string;
  name: string;
  ticker: string;
  value_cents: number;
  est_annual_income_cents?: number | null;
  dividend_yield?: number | null;
}

export function AllocationDonut({
  allocation,
  currency,
  holdings,
}: {
  allocation: Record<string, number>;
  currency?: string;
  holdings?: AllocationHolding[];
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const data = Object.entries(allocation)
    .filter(([, v]) => v > 0)
    .map(([type, value]) => ({ type, name: TYPE_LABELS[type] ?? type, value }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) return null;

  const total = data.reduce((s, x) => s + x.value, 0);
  const clickable = !!holdings && holdings.length > 0;
  const toggle = (type: string) => setSelected((s) => (s === type ? null : type));

  const detail = selected && holdings ? holdings.filter((h) => h.asset_type === selected).sort((a, b) => b.value_cents - a.value_cents) : [];
  const detailTotal = detail.reduce((s, h) => s + h.value_cents, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Pie + legend — fixed; selecting a slice never moves this block. */}
      <div className="flex items-center gap-6">
        <div className="h-56 w-56 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="92%"
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
                onClick={clickable ? (_, i) => toggle(data[i].type) : undefined}
                cursor={clickable ? "pointer" : undefined}
              >
                {data.map((d, i) => (
                  <Cell key={i} tabIndex={-1} style={{ outline: "none" }} fill={PALETTE[i % PALETTE.length]} opacity={selected && selected !== d.type ? 0.3 : 1} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {data.map((d, i) => {
            const pct = total > 0 ? Math.round((d.value / total) * 1000) / 10 : 0;
            return (
              <button
                key={d.type}
                type="button"
                onClick={clickable ? () => toggle(d.type) : undefined}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  clickable && "cursor-pointer hover:opacity-80",
                  selected === d.type && "font-semibold",
                )}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="nums font-medium">{pct}%</span>
              </button>
            );
          })}
          {clickable && <p className="pt-1 text-[11px] text-muted-foreground/70">Cliquez un segment pour le détail</p>}
        </div>
      </div>

      {/* Detail list — expands downward below the pie. */}
      {clickable && selected && detail.length > 0 && (
        <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold">{TYPE_LABELS[selected] ?? selected} · {detail.length}</p>
          <ul className="space-y-1.5">
            {detail.map((h) => {
              const pct = detailTotal > 0 ? Math.round((h.value_cents / detailTotal) * 1000) / 10 : 0;
              return (
                <li key={`${h.ticker}-${h.name}`} className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-semibold">{h.ticker.toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.name}</span>
                  <span className="nums blurable text-muted-foreground">{formatCents(h.value_cents, currency)}</span>
                  <span className="nums w-10 shrink-0 text-right font-medium">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Dividend income breakdown */}
      {clickable && holdings && holdings.some((h) => (h.est_annual_income_cents ?? 0) > 0) && (
        <div className="min-w-0 border-t border-border/50 pt-4">
          <p className="mb-2 text-sm font-semibold">Revenus dividendes estimés (top 10)</p>
          <ul className="space-y-1.5">
            {holdings
              .filter((h) => (h.est_annual_income_cents ?? 0) > 0)
              .sort((a, b) => (b.est_annual_income_cents ?? 0) - (a.est_annual_income_cents ?? 0))
              .slice(0, 10)
              .map((h) => (
                <li key={`div-${h.ticker}-${h.name}`} className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-semibold">{h.ticker.toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.name}</span>
                  <span className="nums blurable text-emerald-500 font-medium">
                    {formatCents(h.est_annual_income_cents ?? 0, currency, { decimals: 0 })}/an
                  </span>
                  {h.dividend_yield != null && (
                    <span className="nums w-14 shrink-0 text-right text-muted-foreground">{h.dividend_yield.toFixed(2)}%</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
