"use client";

import { formatCents } from "@/lib/format";

interface Row {
  name?: string;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
}

/** Shared themed tooltip for Recharts — reads surface tokens, no hardcoded hex.
 *  `valueFormatter` defaults to money in `currency` (values are integer cents). */
export function ChartTooltip({
  active,
  payload,
  label,
  currency = "EUR",
  labelFormatter,
}: {
  active?: boolean;
  payload?: Row[];
  label?: string;
  currency?: string;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card-surface min-w-[9rem] px-3 py-2 text-xs shadow-lg">
      {label != null && (
        <p className="mb-1.5 font-semibold text-foreground">{labelFormatter ? labelFormatter(label) : label}</p>
      )}
      <div className="space-y-1">
        {payload.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: row.color }} />
            <span className="flex-1 text-muted-foreground">{row.name}</span>
            <span className="nums font-medium text-foreground">{formatCents(Number(row.value ?? 0), currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
