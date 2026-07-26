"use client";

import Link from "next/link";
import { BadgeMinus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useLoans } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

/** The two biggest loans (by outstanding balance), with repayment progress. */
export function LoansWidget() {
  const { data: loans = [] } = useLoans();
  const top = [...loans].sort((a, b) => b.remaining_cents - a.remaining_cents).slice(0, 2);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Emprunts</CardTitle>
        <Link href="/emprunts" className="text-xs text-muted-foreground hover:text-foreground">Tout voir</Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {top.length === 0 ? (
          <EmptyState icon={BadgeMinus} title="Aucun emprunt" />
        ) : (
          top.map((l) => {
            const pct = Math.min(100, Math.max(0, l.progress_pct));
            return (
              <div key={l.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{l.name}</span>
                  <span className="nums blurable shrink-0 text-xs font-semibold text-destructive">
                    {formatCents(-l.remaining_cents, l.currency)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-right text-[11px] text-muted-foreground">{Math.round(pct)}% remboursé</p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
