"use client";

import { RefreshCw, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { InvestmentRow } from "@/components/investments/investment-row";
import { PctBadge } from "@/components/investments/pct-badge";
import { AllocationDonut } from "@/components/investments/allocation-donut";
import { NetworthArea } from "@/components/charts/networth-area";
import { useInvestmentAccounts, useInvestmentTotalSeries, useRefreshPrices, useBaseCurrency, type NetWorthPoint } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

export default function InvestissementsPage() {
  const { data: accounts = [], isLoading } = useInvestmentAccounts();
  const { data: series = [] } = useInvestmentTotalSeries();
  const refreshPrices = useRefreshPrices();
  const baseCurrency = useBaseCurrency();

  const totalCurrent = accounts.reduce((s, a) => s + (a.current_value_cents ?? 0), 0);
  const totalPerfCents = accounts.reduce((s, a) => s + (a.perf_from_start_cents ?? 0), 0);
  const totalFirst = accounts.reduce((s, a) => s + (a.first_value_cents ?? 0), 0);
  const totalPerfPct = totalFirst !== 0 ? Math.round((totalPerfCents / Math.abs(totalFirst)) * 1000) / 10 : null;

  const hasAnyHoldings = accounts.some((a) => a.has_holdings);

  const globalAllocation: Record<string, number> = {};
  for (const acc of accounts) {
    if (acc.allocation_by_type) {
      for (const [type, val] of Object.entries(acc.allocation_by_type)) {
        globalAllocation[type] = (globalAllocation[type] ?? 0) + val;
      }
    }
  }

  const chartData: NetWorthPoint[] = series.map((s) => ({ month: s.month, total: s.total_cents }));

  const handleRefresh = () => {
    refreshPrices.mutate(undefined, {
      onSuccess: (data) => toast.success(`${data.refreshed} prix actualisés`),
      onError: () => toast.error("Erreur lors de l'actualisation"),
    });
  };

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Total investi : <span className="nums blurable font-semibold text-brand">{formatCents(totalCurrent, baseCurrency)}</span>
          {totalPerfPct != null && <PctBadge value={totalPerfPct} amountCents={totalPerfCents} currency={baseCurrency} />}
        </p>
        {hasAnyHoldings && (
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshPrices.isPending}>
            <RefreshCw className={`mr-1.5 size-3.5 ${refreshPrices.isPending ? "animate-spin" : ""}`} />
            Actualiser les prix
          </Button>
        )}
      </div>

      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon={TrendingUp} title="Aucun compte d'investissement" description="Créez un compte de type « Investissement » dans la page Comptes." />
        </Card>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => <InvestmentRow key={acc.id} acc={acc} />)}
        </div>
      )}

      {Object.keys(globalAllocation).length > 1 && (
        <Card>
          <CardHeader><CardTitle>Allocation globale</CardTitle></CardHeader>
          <CardContent><AllocationDonut allocation={globalAllocation} currency={baseCurrency} /></CardContent>
        </Card>
      )}

      {chartData.length >= 2 && (
        <Card>
          <CardHeader><CardTitle>Évolution globale des investissements</CardTitle></CardHeader>
          <CardContent className="pt-2"><NetworthArea data={chartData} currency={baseCurrency} /></CardContent>
        </Card>
      )}
    </div>
  );
}
