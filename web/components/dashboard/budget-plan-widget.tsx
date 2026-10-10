"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnvelopeBar } from "@/components/budget/plan/envelope-bar";
import { api, unwrap } from "@/lib/api/client";
import { useAccounts } from "@/lib/api/hooks";
import { monthPace, type BudgetPlan } from "@/lib/budget-plan";
import { formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** « Budget du mois »: the plan's bars, for a glance during the month. A plan
 *  is per account, so each account that has one gets its own tab. Renders
 *  nothing until a plan exists — the Budget page is where one is created. */
export function BudgetPlanWidget() {
  const { data: accounts = [] } = useAccounts();
  const courant = accounts.filter((a) => a.account_type === "courant");
  const plans = useQueries({
    queries: courant.map((a) => ({
      // Same key as `useBudgetPlan`, so the two share one request.
      queryKey: ["budget-plan", "plan", a.id, null],
      queryFn: () => unwrap(api.GET("/api/budget-plan", { params: { query: { account_id: a.id } } })) as Promise<BudgetPlan>,
    })),
  });
  const planned = courant
    .map((account, i) => ({ account, plan: plans[i]?.data }))
    .filter((x): x is { account: (typeof courant)[number]; plan: BudgetPlan } => Boolean(x.plan?.exists));
  const [pickedId, setPickedId] = useState<number | null>(null);

  if (planned.length === 0) return null;
  const { account, plan } = planned.find((x) => x.account.id === pickedId) ?? planned[0];
  const pace = monthPace(plan.month, new Date());

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>Budget du mois <span className="text-sm font-normal capitalize text-muted-foreground">· {formatMonthLabel(plan.month, { withYear: true })}</span></CardTitle>
        <div className="flex items-center gap-3">
          {planned.length > 1 && (
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs">
              {planned.map((x) => (
                <button key={x.account.id} type="button" aria-pressed={x.account.id === account.id} onClick={() => setPickedId(x.account.id)}
                  className={cn("rounded-md px-2.5 py-1 font-medium transition-colors", x.account.id === account.id ? "bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground")}>
                  {x.account.name}
                </button>
              ))}
            </div>
          )}
          <Link href={`/budget?vue=plan&compte=${account.id}`} className="text-xs text-muted-foreground hover:text-foreground">Voir le plan</Link>
        </div>
      </CardHeader>
      <CardContent>
        <ul aria-label="Budget du mois" className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {plan.envelopes.map((e) => (
            <li key={e.id} className="min-w-0 space-y-1.5">
              <p className="truncate text-sm font-medium">{e.name}</p>
              <EnvelopeBar kind={e.kind} realised={e.realised_cents} target={e.target_cents} pace={pace} currency={plan.currency} compact />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
