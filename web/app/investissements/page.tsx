"use client";

import { useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Wand2, Coins, CalendarDays, DownloadCloud, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InvestmentRow } from "@/components/investments/investment-row";
import { KpiStat } from "@/components/dashboard/kpi-stat";
import { AccountsOverview } from "@/components/investments/accounts-overview";
import { TopPositions } from "@/components/investments/top-positions";
import { AllocationDonut, type AllocationHolding } from "@/components/investments/allocation-donut";
import { NetworthArea } from "@/components/charts/networth-area";
import { DividendCalendar } from "@/components/investments/dividend-calendar";
import { DividendSectorDonut } from "@/components/investments/dividend-sector-donut";
import { DividendPositionsTable } from "@/components/investments/dividend-positions-table";
import { IbkrSyncDialog } from "@/components/investments/ibkr-sync-dialog";
import { useInvestmentAccounts, useInvestmentTotalSeries, useRefreshPrices, useResolveTickers, useBaseCurrency, useIbkrStatus, type InvestmentAccount, type NetWorthPoint } from "@/lib/api/hooks";
import { monthChange, portfolioTotals, topPositions } from "@/lib/investments";
import { LONG_TERM_GROUP } from "@/lib/asset-types";
import { formatCents, formatMonthLabel } from "@/lib/format";

export default function InvestissementsPage() {
  const { data: accounts = [], isLoading } = useInvestmentAccounts();
  const { data: series = [] } = useInvestmentTotalSeries();
  const refreshPrices = useRefreshPrices();
  const resolveTickers = useResolveTickers();
  const baseCurrency = useBaseCurrency();
  const { data: ibkrStatus } = useIbkrStatus();
  const [ibkrOpen, setIbkrOpen] = useState(false);
  const [tab, setTab] = useState("synthese");
  // The account opened from the Synthèse table: its row starts unfolded.
  const [openAccountId, setOpenAccountId] = useState<number | null>(null);
  const openAccount = (acc: InvestmentAccount) => {
    setOpenAccountId(acc.id);
    setTab(acc.has_holdings ? "live" : "long-terme");
  };

  const totals = portfolioTotals(accounts);
  const lastMonth = monthChange(series);
  const positions = topPositions(accounts);
  // Amounts are summed as they are: a total only means something when every
  // account is in the currency it is shown in.
  const mixedCurrencies = accounts.some((a) => a.currency !== baseCurrency);

  const liveAccounts = accounts.filter((a) => a.has_holdings);
  const longTermAccounts = accounts.filter((a) => !a.has_holdings);
  const allHoldings = accounts.flatMap((a) => a.holdings ?? []);

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
  // Long-term (snapshot) accounts have no holdings: their content is unknown,
  // so they form a slice of their own rather than being lumped into "Autre".
  for (const acc of longTermAccounts) {
    const val = acc.current_value_cents ?? 0;
    if (val <= 0) continue;
    globalAllocation[LONG_TERM_GROUP] = (globalAllocation[LONG_TERM_GROUP] ?? 0) + val;
    globalHoldings.push({ asset_type: LONG_TERM_GROUP, name: acc.name, ticker: acc.bank_name ?? "", value_cents: val });
  }

  const chartData: NetWorthPoint[] = series.map((s) => ({ month: s.month, total: s.total_cents }));

  const totalEstDivCents = totals.dividendsCents;
  const avgYield = totals.avgYield;
  const showChart = chartData.length >= 2;
  const showAllocation = Object.keys(globalAllocation).length > 1;

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
    <Tabs value={tab} onValueChange={setTab} className="space-y-5">
      <TabsList>
        <TabsTrigger value="synthese">Synthèse</TabsTrigger>
        <TabsTrigger value="dividendes">Dividendes</TabsTrigger>
        <TabsTrigger value="long-terme">Long terme ({longTermAccounts.length})</TabsTrigger>
        <TabsTrigger value="live">Live ({liveAccounts.length})</TabsTrigger>
      </TabsList>

      {/* ── Synthèse ──────────────────────────────────────────────────────── */}
      <TabsContent value="synthese" className="space-y-5">
        {/* The four figures, read like the dashboard's. */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiStat label="Valeur totale" valueCents={totals.valueCents} currency={baseCurrency} icon={Wallet} accent="brand"
            hint={`${accounts.length} compte${accounts.length > 1 ? "s" : ""}`} />
          <KpiStat label="Plus-value" valueCents={totals.gainCents} currency={baseCurrency} signed
            icon={totals.gainCents < 0 ? TrendingDown : TrendingUp} accent={totals.gainCents < 0 ? "negative" : "positive"}
            deltaPercent={totals.gainPct} hint="sur le capital investi" />
          {/* A change in value, not a performance: what was paid in is part of it.
              Said on the card, with the accounts it could be computed on. */}
          <KpiStat
            label={lastMonth ? `Variation ${formatMonthLabel(lastMonth.from)} → ${formatMonthLabel(lastMonth.to)}` : "Variation sur un mois"}
            valueCents={lastMonth?.cents ?? 0} currency={baseCurrency} signed
            icon={CalendarDays} accent="neutral" deltaPercent={lastMonth?.pct}
            hint={lastMonth
              ? "versements compris" + (lastMonth.accounts < accounts.length ? ` · ${lastMonth.accounts} compte${lastMonth.accounts > 1 ? "s" : ""} sur ${accounts.length}` : "")
              : "pas encore deux mois d'historique"} />
          <KpiStat label="Dividendes estimés / an" valueCents={totals.dividendsCents} currency={baseCurrency} icon={Coins} accent="positive"
            hint={avgYield != null && avgYield > 0 ? `rendement moyen ${avgYield.toFixed(2).replace(".", ",")} %` : "aucune position à dividende"} />
        </div>
        {mixedCurrencies && (
          <p className="text-xs text-warning">
            Certains comptes ne sont pas en {baseCurrency} : ces totaux additionnent leurs montants sans les convertir.
          </p>
        )}

        {(showChart || showAllocation) && (
          <div className="grid gap-5 lg:grid-cols-3">
            {showChart && (
              <Card className={showAllocation ? "lg:col-span-2" : "lg:col-span-3"}>
                <CardHeader><CardTitle>Évolution</CardTitle></CardHeader>
                <CardContent className="pt-2"><NetworthArea data={chartData} currency={baseCurrency} height={300} /></CardContent>
              </Card>
            )}
            {showAllocation && (
              <Card className={showChart ? undefined : "lg:col-span-3"}>
                <CardHeader><CardTitle>Allocation</CardTitle></CardHeader>
                <CardContent>
                  <AllocationDonut allocation={globalAllocation} currency={baseCurrency} holdings={globalHoldings} compact={showChart} showDividends={false} />
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Par compte</CardTitle>
            <p className="text-xs text-muted-foreground">
              Plus-value : par rapport au prix d&apos;achat pour un compte live, depuis le premier relevé (hors versements) pour un compte long terme.
            </p>
          </CardHeader>
          <CardContent className="px-0 pb-1"><AccountsOverview accounts={accounts} totalCents={totals.valueCents} onOpen={openAccount} /></CardContent>
        </Card>

        {positions.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Principales positions</CardTitle></CardHeader>
            <CardContent className="px-0 pb-1"><TopPositions positions={positions} totalCents={totals.valueCents} /></CardContent>
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

        {/* All dividend-paying positions */}
        <Card>
          <CardHeader><CardTitle>Positions versant un dividende</CardTitle></CardHeader>
          <CardContent><DividendPositionsTable holdings={allHoldings} currency={baseCurrency} /></CardContent>
        </Card>
      </TabsContent>

      {/* ── Long terme (snapshot-based) ──────────────────────────────────── */}
      <TabsContent value="long-terme" className="space-y-2">
        {longTermAccounts.length === 0 ? (
          <Card><EmptyState icon={TrendingUp} title="Aucun compte long terme" description="Les comptes à relevés manuels (PER, assurance-vie, crypto en garde…) apparaîtront ici." /></Card>
        ) : (
          longTermAccounts.map((acc) => <InvestmentRow key={acc.id} acc={acc} defaultExpanded={acc.id === openAccountId} />)
        )}
      </TabsContent>

      {/* ── Live (Yahoo-priced holdings) ─────────────────────────────────── */}
      <TabsContent value="live" className="space-y-2">
        <div className="flex items-center justify-end gap-2">
          {ibkrStatus?.configured && (
            <Button variant="outline" size="sm" onClick={() => setIbkrOpen(true)} title="Récupérer les positions depuis IBKR">
              <DownloadCloud className="mr-1.5 size-3.5" />
              Synchroniser IBKR
            </Button>
          )}
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
        {ibkrStatus?.account_id != null && (
          <IbkrSyncDialog open={ibkrOpen} onOpenChange={setIbkrOpen} accountId={ibkrStatus.account_id} />
        )}
        {liveAccounts.length === 0 ? (
          <Card><EmptyState icon={TrendingUp} title="Aucun compte live" description="Importez un CSV de positions (PEA, IBKR) pour suivre des cours en direct." /></Card>
        ) : (
          liveAccounts.map((acc) => <InvestmentRow key={acc.id} acc={acc} defaultExpanded={acc.id === openAccountId} />)
        )}
      </TabsContent>
    </Tabs>
  );
}
