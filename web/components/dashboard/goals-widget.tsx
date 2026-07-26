"use client";

import Link from "next/link";
import { Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useGoals } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

/** The three biggest savings goals (by target amount), with live progress. */
export function GoalsWidget({ currency }: { currency: string }) {
  const { data: goals = [] } = useGoals();
  const top = [...goals].sort((a, b) => b.target_amount_cents - a.target_amount_cents).slice(0, 3);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Objectifs</CardTitle>
        <Link href="/objectifs" className="text-xs text-muted-foreground hover:text-foreground">Tout voir</Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {top.length === 0 ? (
          <EmptyState icon={Target} title="Aucun objectif" />
        ) : (
          top.map((g) => {
            const pct = Math.min(100, Math.max(0, g.progress_pct));
            return (
              <div key={g.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{g.name}</span>
                  <span className="nums blurable shrink-0 text-xs text-muted-foreground">
                    {formatCents(g.current_amount_cents, currency)} / {formatCents(g.target_amount_cents, currency)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: g.color }} />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
