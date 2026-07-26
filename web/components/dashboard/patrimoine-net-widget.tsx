"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/format";

/** Net worth with vs. without loan debt. All values update whenever a loan
 *  changes because they come from /analytics/summary (invalidated on loan edits). */
export function PatrimoineNetWidget({
  netWorthCents,
  exclLoansCents,
  totalLoansCents,
  currency,
}: {
  netWorthCents: number;
  exclLoansCents: number;
  totalLoansCents: number;
  currency: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Patrimoine net</CardTitle>
        <CardDescription>Avec et sans emprunts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">Net (emprunts déduits)</p>
          <p className="nums blurable text-2xl font-bold text-brand">{formatCents(netWorthCents, currency)}</p>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Hors emprunts</span>
          <span className="nums blurable font-medium">{formatCents(exclLoansCents, currency)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Dettes</span>
          <span className="nums blurable font-medium text-destructive">
            {totalLoansCents > 0 ? formatCents(-totalLoansCents, currency) : formatCents(0, currency)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
