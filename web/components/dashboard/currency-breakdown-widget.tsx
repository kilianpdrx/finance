"use client";

import { Coins } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { formatCents } from "@/lib/format";
import type { AnalyticsSummary } from "@/lib/api/hooks";

/** Net worth split by the native currency each account is held in, before
 *  conversion. Renders nothing unless holdings span more than one currency. */
export function CurrencyBreakdownWidget({ summary }: { summary: AnalyticsSummary | undefined }) {
  const rows = summary?.net_worth_by_currency ?? [];
  const base = summary?.base_currency ?? "EUR";
  if (rows.length <= 1) return null;

  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.converted_cents)));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="size-4 text-muted-foreground" /> Patrimoine par devise</CardTitle>
        <CardDescription>Montants d&apos;origine, convertis en {base}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.currency} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{r.currency}</span>
              <span className="nums blurable font-semibold">{formatCents(r.native_cents, r.currency)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${(Math.abs(r.converted_cents) / maxAbs) * 100}%` }} />
            </div>
            {r.currency !== base && (
              <p className="text-right text-xs text-muted-foreground">≈ {formatCents(r.converted_cents, base)}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
