"use client";

import { Landmark, TrendingUp, TrendingDown, Scale, PieChart as PieIcon, Inbox } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { KpiStat } from "@/components/dashboard/kpi-stat";
import { SpendingDonut } from "@/components/charts/spending-donut";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { NetworthArea } from "@/components/charts/networth-area";
import {
  useAnalyticsContext,
  useSummary,
  useCashFlow,
  useByCategory,
  useNetWorth,
} from "@/lib/api/hooks";

const fade = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] } }),
};

export default function DashboardPage() {
  const { query, currency, accounts } = useAnalyticsContext();
  const summary = useSummary(query);
  const cashFlow = useCashFlow(query);
  const byCategory = useByCategory(query);
  const netWorth = useNetWorth(query);

  const loading = summary.isLoading || cashFlow.isLoading || byCategory.isLoading || netWorth.isLoading;

  if (loading) return <DashboardSkeleton />;

  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Inbox}
          title="Aucun compte pour le moment"
          description="Importez un relevé bancaire CSV pour commencer à suivre vos finances."
          action={
            <Button asChild>
              <Link href="/importer">Importer un relevé</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const s = summary.data;
  const nw = netWorth.data ?? [];
  const nwDelta =
    nw.length >= 2
      ? ((Number(nw[nw.length - 1].total) - Number(nw[nw.length - 2].total)) / Math.abs(Number(nw[nw.length - 2].total) || 1)) * 100
      : null;

  const kpis = [
    { label: "Patrimoine", valueCents: s?.net_worth_cents ?? 0, icon: Landmark, accent: "brand" as const, deltaPercent: nwDelta, hint: "vs mois précédent" },
    { label: "Revenus", valueCents: s?.total_income_cents ?? 0, icon: TrendingUp, accent: "positive" as const, hint: "sur la période" },
    { label: "Dépenses", valueCents: s?.total_expenses_cents ?? 0, icon: TrendingDown, accent: "negative" as const, hint: "sur la période" },
    {
      label: "Flux net",
      valueCents: s?.net_cash_flow_cents ?? 0,
      icon: Scale,
      accent: (s && s.net_cash_flow_cents >= 0 ? "positive" : "negative") as "positive" | "negative",
      signed: true,
      hint: "épargne nette",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div key={k.label} variants={fade} initial="hidden" animate="show" custom={i}>
            <KpiStat currency={currency} {...k} />
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
        <motion.div className="h-full lg:col-span-2" variants={fade} initial="hidden" animate="show" custom={4}>
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Évolution du patrimoine</CardTitle>
              <CardDescription>Solde net cumulé par mois</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col pt-2">
              {nw.length ? (
                <div className="min-h-[280px] flex-1">
                  <NetworthArea data={nw} currency={currency} height="100%" />
                </div>
              ) : (
                <EmptyState icon={Inbox} title="Pas encore de données" />
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div className="h-full" variants={fade} initial="hidden" animate="show" custom={5}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Répartition des dépenses</CardTitle>
              <CardDescription>Par catégorie</CardDescription>
            </CardHeader>
            <CardContent>
              {byCategory.data?.length ? (
                <SpendingDonut data={byCategory.data} currency={currency} />
              ) : (
                <EmptyState icon={PieIcon} title="Aucune dépense" />
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={fade} initial="hidden" animate="show" custom={6}>
        <Card>
          <CardHeader>
            <CardTitle>Revenus & dépenses</CardTitle>
            <CardDescription>Flux mensuels et solde net</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {cashFlow.data?.length ? (
              <CashflowChart data={cashFlow.data} currency={currency} />
            ) : (
              <EmptyState icon={Inbox} title="Pas encore de données" />
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-start justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-9 rounded-xl" />
            </div>
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-[260px] w-full rounded-xl" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mx-auto mt-6 size-44 rounded-full" />
        </Card>
      </div>
      <Card className="p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-[260px] w-full rounded-xl" />
      </Card>
    </div>
  );
}
