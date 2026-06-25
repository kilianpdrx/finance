"use client";

import { RefreshCw, TrendingUp, Wand2, Coins, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InvestmentRow } from "@/components/investments/investment-row";
import { PctBadge } from "@/components/investments/pct-badge";
import { AllocationDonut, type AllocationHolding } from "@/components/investments/allocation-donut";
import { NetworthArea } from "@/components/charts/networth-area";
import { DividendCalendar } from "@/components/investments/dividend-calendar";
import { DividendSectorDonut } from "@/components/investments/dividend-sector-donut";
import { useInvestmentAccounts, useInvestmentTotalSeries, useRefreshPrices, useResolveTickers, useBaseCurrency, type NetWorthPoint } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

export default function InvestissementsPage() {
  const { data: accounts = [], isLoading } = useInvestmentAccounts();
  const { data: series = [] } = useInvestmentTotalSeries();
  const refreshPrices = useRefreshPrices();
  const resolveTickers = useResolveTickers();
  const baseCurrency = useBaseCurrency();

  const totalCurrent = accounts.reduce((s, a) => s + (a.current_value_cents ?? 0), 0);
  const totalPerfCents = accounts.reduce((s, a) => s + (a.perf_from_start_cents ?? 0), 0);
  const totalFirst = accounts.reduce((s, a) => s + (a.first_value_cents ?? 0), 0);
  const totalPerfPct = totalFirst !== 0 ? Math.round((totalPerfCents / Math.abs(totalFirst)) * 1000) / 10 : null;

  const liveAccounts = accounts.filter((a) => a.has_holdings);
  const longTermAccounts = accounts.filter((a) => !a.has_holdings);

  const globalAllocation: Record<string, number> = {};
  const globalHoldings: AllocationHolding[] = [];
  for (const acc of accounts) {
    if (acc.allocation_by_type) {
      for (const [type, val] of Object.entries(acc.allocation_by_type)) {
        globalAllocation[type] = (globalAllocation[type] ?? 0) + val;
      }
    }
    for (const h of acc.holdings ?? []) {
      globalHoldings.push({
        asset_type: h.asset_type,
        name: h.name,
        ticker: h.ticker,
        value_cents: h.value_in_account_ccy_cents ?? h.current_value_cents ?? 0,
        est_annual_income_cents: h.est_annual_income_cents,
        dividend_yield: h.dividend_yield,
      });
    }
  }
  // Long-term (snapshot) accounts have no holdings → group them as "Autre".
  for (const acc of longTermAccounts) {
    const val = acc.current_value_cents ?? 0;
    if (val <= 0) continue;
    globalAllocation["other"] = (globalAllocation["other"] ?? 0) + val;
    globalHoldings.push({ asset_type: "other", name: acc.name, ticker: acc.bank_name ?? "", value_cents: val });
  }

  const chartData: NetWorthPoint[] = series.map((s) => ({ month: s.month, total: s.total_cents }));

  // Aggregate dividend KPIs across all accounts
  const totalEstDivCents = accounts.reduce((s, a) => s + (a.est_annual_div_cents ?? 0), 0);
  const divWeightedNum = accounts.reduce((s, a) => {
    const dy = a.avg_dividend_yield ?? 0;
    const v = a.current_value_cents ?? 0;
    return s + dy * v;
  }, 0);
  const divWeightedDen = accounts.reduce((s, a) => s + (a.current_value_cents ?? 0), 0);
  const avgYield = divWeightedDen > 0 ? Math.round((divWeightedNum / divWeightedDen) * 100) / 100 : null;

  const handleRefresh = () => {
    refreshPrices.mutate(undefined, {
      onSuccess: (data) => toast.success(`${data.refreshed} prix actualisés`),
      onError: () => toast.error("Erreur lors de l'actualisation"),
    });
  };

  const handleResolve = () => {
    resolveTickers.mutate(undefined, {
      onSuccess: (data) => toast.success(data.resolved > 0 ? `${data.resolved} ticker(s) corrigé(s)` : "Aucun ticker à corriger"),
      onError: () => toast.error("Erreur lors de la résolution"),
    });
  };

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState icon={TrendingUp} title="Aucun compte d'investissement" description="Créez un compte de type « Investissement » dans la page Comptes." />
      </Card>
    );
  }

  return (
    <Tabs defaultValue="synthese" className="space-y-5">
      <TabsList>
        <TabsTrigger value="synthese">Synthèse</TabsTrigger>
        <TabsTrigger value="dividendes">Dividendes</TabsTrigger>
        <TabsTrigger value="long-terme">Long terme ({longTermAccounts.length})</TabsTrigger>
        <TabsTrigger value="live">Live ({liveAccounts.length})</TabsTrigger>
      </TabsList>

      {/* ── Synthèse ──────────────────────────────────────────────────────── */}
      <TabsContent value="synthese" className="space-y-5">
        <div className="flex items-center justify-between">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Total investi : <span className="nums blurable font-semibold text-brand">{formatCents(totalCurrent, baseCurrency)}</span>
            {totalPerfPct != null && <PctBadge value={totalPerfPct} amountCents={totalPerfCents} currency={baseCurrency} />}
          </p>
        </div>

        {/* Dividend KPI cards */}
        {totalEstDivCents > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10">
                  <Coins className="size-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Revenus Est. Dividendes / an</p>
                  <p className="nums blurable text-lg font-semibold text-emerald-500">{formatCents(totalEstDivCents, baseCurrency)}</p>
                </div>
              </CardContent>
            </Card>
            {avgYield != null && avgYield > 0 && (
              <Card>
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-brand/10">
                    <TrendingUp className="size-5 text-brand" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Rendement Moyen Pondéré</p>
                    <p className="nums text-lg font-semibold text-brand">{avgYield.toFixed(2)}%</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {Object.keys(globalAllocation).length > 1 && (
          <Card>
            <CardHeader><CardTitle>Allocation globale</CardTitle></CardHeader>
            <CardContent><AllocationDonut allocation={globalAllocation} currency={baseCurrency} holdings={globalHoldings} /></CardContent>
          </Card>
        )}

        {chartData.length >= 2 && (
          <Card>
            <CardHeader><CardTitle>Évolution globale des investissements</CardTitle></CardHeader>
            <CardContent className="pt-2"><NetworthArea data={chartData} currency={baseCurrency} /></CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ── Dividendes ──────────────────────────────────────────────────── */}
      <TabsContent value="dividendes" className="space-y-5">
        {/* KPI cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <Coins className="size-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Revenus Annuels Estimés</p>
                <p className="nums blurable text-lg font-semibold text-emerald-500">{formatCents(totalEstDivCents, baseCurrency)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex size-10 items-center justify-center rounded-xl bg-brand/10">
                <CalendarDays className="size-5 text-brand" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Revenus Mensuels Estimés</p>
                <p className="nums blurable text-lg font-semibold text-brand">{formatCents(Math.round(totalEstDivCents / 12), baseCurrency)}</p>
              </div>
            </CardContent>
          </Card>
          {avgYield != null && avgYield > 0 && (
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-brand/10">
                  <TrendingUp className="size-5 text-brand" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Rendement Moyen Pondéré</p>
                  <p className="nums text-lg font-semibold text-brand">{avgYield.toFixed(2)}%</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 12-month projection bar chart */}
        <Card>
          <CardHeader><CardTitle>Projection des revenus sur 12 mois</CardTitle></CardHeader>
          <CardContent><DividendCalendar currency={baseCurrency} /></CardContent>
        </Card>

        {/* Sector breakdown */}
        <Card>
          <CardHeader><CardTitle>Répartition par secteur</CardTitle></CardHeader>
          <CardContent><DividendSectorDonut currency={baseCurrency} /></CardContent>
        </Card>
      </TabsContent>

      {/* ── Long terme (snapshot-based) ──────────────────────────────────── */}
      <TabsContent value="long-terme" className="space-y-2">
        {longTermAccounts.length === 0 ? (
          <Card><EmptyState icon={TrendingUp} title="Aucun compte long terme" description="Les comptes à relevés manuels (PER, assurance-vie, crypto en garde…) apparaîtront ici." /></Card>
        ) : (
          longTermAccounts.map((acc) => <InvestmentRow key={acc.id} acc={acc} />)
        )}
      </TabsContent>

      {/* ── Live (Yahoo-priced holdings) ─────────────────────────────────── */}
      <TabsContent value="live" className="space-y-2">
        <div className="flex items-center justify-end gap-2">
          {liveAccounts.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleResolve} disabled={resolveTickers.isPending} title="Corriger les tickers introuvables via OpenFIGI">
                <Wand2 className={`mr-1.5 size-3.5 ${resolveTickers.isPending ? "animate-pulse" : ""}`} />
                Corriger les tickers
              </Button>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshPrices.isPending}>
                <RefreshCw className={`mr-1.5 size-3.5 ${refreshPrices.isPending ? "animate-spin" : ""}`} />
                Actualiser les prix
              </Button>
            </>
          )}
        </div>
        {liveAccounts.length === 0 ? (
          <Card><EmptyState icon={TrendingUp} title="Aucun compte live" description="Importez un CSV de positions (PEA, IBKR) pour suivre des cours en direct." /></Card>
        ) : (
          liveAccounts.map((acc) => <InvestmentRow key={acc.id} acc={acc} />)
        )}
      </TabsContent>
    </Tabs>
  );
}
