"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { SpendingDonut } from "@/components/charts/spending-donut";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { CategoryTrendGrid } from "@/components/charts/category-trend-grid";
import { MonthlyDistribution } from "@/components/charts/monthly-distribution";
import { CourantTabs, type CourantSelection } from "@/components/analytics/courant-tabs";
import {
  useAnalyticsContext, useByCategory, useSpendingTrends, useRecurring, useCategories,
  useByCategoryPerAccount, useCashFlowPerAccount,
  type SpendingTrend, type RecurringTransaction,
} from "@/lib/api/hooks";
import { formatCents, formatPercent } from "@/lib/format";

export default function AnalysesPage() {
  const { query, currency, accounts } = useAnalyticsContext();
  const courant = accounts.filter((a) => a.account_type === "courant");
  const courantIds = courant.map((a) => a.id);

  const [sel, setSel] = useState<CourantSelection>("all");
  const scopeIds = sel === "all" ? courantIds : [sel];
  const q = { ...query, account_ids: scopeIds.length ? scopeIds.join(",") : undefined };

  const byCategory = useByCategory(q);
  const trends = useSpendingTrends(q);
  const recurring = useRecurring(q.account_ids);
  const { data: categories = [] } = useCategories();
  const perAccountCats = useByCategoryPerAccount(q, scopeIds);
  const perAccountFlux = useCashFlowPerAccount(q, scopeIds);

  const accName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `Compte ${id}`;
  const catName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? "—";
  const catAccountId = (id: number | null) => categories.find((c) => c.id === id)?.account_id ?? null;

  // Global vs account-specific category split (shared by Tendances / Mensuelle).
  const globalTrends = (trends.data ?? []).filter((t: SpendingTrend) => t.category_account_id == null);
  const specificTrends = (trends.data ?? []).filter((t: SpendingTrend) => t.category_account_id != null);
  const globalRecurring = (recurring.data ?? []).filter((r: RecurringTransaction) => catAccountId(r.category_id) == null);
  const specificRecurring = (recurring.data ?? []).filter((r: RecurringTransaction) => catAccountId(r.category_id) != null);

  const showPerAccount = scopeIds.length > 1;

  return (
    <div className="space-y-4">
      <CourantTabs accounts={accounts} value={sel} onChange={setSel} />

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Catégories</TabsTrigger>
          <TabsTrigger value="trends">Tendances</TabsTrigger>
          <TabsTrigger value="distribution">Répartition mensuelle</TabsTrigger>
          <TabsTrigger value="cashflow">Flux de trésorerie</TabsTrigger>
          <TabsTrigger value="recurring">Récurrents</TabsTrigger>
        </TabsList>

        {/* ── Catégories ──────────────────────────────────────────────── */}
        <TabsContent value="categories" className="space-y-4">
          {byCategory.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : !byCategory.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Aucune dépense sur la période" /></Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card><CardContent className="flex items-center justify-center py-8"><SpendingDonut data={byCategory.data} currency={currency} size={260} /></CardContent></Card>
                <Card className="overflow-hidden p-0">
                  <Table>
                    <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Catégorie</TableHead><TableHead className="text-right">Nb</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {byCategory.data.map((c) => (
                        <TableRow key={c.category_id ?? c.category_name}>
                          <TableCell className="font-medium">{c.category_name}</TableCell>
                          <TableCell className="nums text-right text-muted-foreground">{c.count}</TableCell>
                          <TableCell className="nums blurable text-right font-semibold">{formatCents(c.total_cents, currency)}</TableCell>
                          <TableCell className="nums text-right text-muted-foreground">{formatPercent(c.percentage)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>

              {/* Per-account breakdown row (only when several accounts are in scope) */}
              {showPerAccount && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Par compte courant</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {perAccountCats.map(({ accountId, data, isLoading }) => (
                      <Card key={accountId}>
                        <CardHeader><CardTitle className="text-sm">{accName(accountId)}</CardTitle></CardHeader>
                        <CardContent className="flex items-center justify-center pb-6">
                          {isLoading ? <Skeleton className="size-40 rounded-full" /> : data.length ? (
                            <SpendingDonut data={data} currency={currency} size={150} />
                          ) : <p className="py-8 text-sm text-muted-foreground">Aucune dépense</p>}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Tendances ───────────────────────────────────────────────── */}
        <TabsContent value="trends" className="space-y-5">
          {trends.isLoading ? <Skeleton className="h-80 w-full rounded-2xl" /> : !trends.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Pas de données" /></Card>
          ) : (
            <CategoryTrendGrid data={trends.data} currency={currency} accounts={accounts} />
          )}
        </TabsContent>

        {/* ── Répartition mensuelle ───────────────────────────────────── */}
        <TabsContent value="distribution" className="space-y-5">
          {trends.isLoading ? <Skeleton className="h-80 w-full rounded-2xl" /> : !trends.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Pas de données" /></Card>
          ) : (
            <MonthlyDistribution data={trends.data} currency={currency} />
          )}
        </TabsContent>

        {/* ── Flux de trésorerie (one chart per current account) ──────── */}
        <TabsContent value="cashflow" className="space-y-4">
          {perAccountFlux.every((f) => f.isLoading) ? (
            <Skeleton className="h-72 w-full rounded-2xl" />
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {perAccountFlux.map(({ accountId, data, isLoading }) => (
                <Card key={accountId}>
                  <CardHeader><CardTitle>{accName(accountId)}</CardTitle></CardHeader>
                  <CardContent>
                    {isLoading ? <Skeleton className="h-72 w-full" /> : data.length ? (
                      <CashflowChart data={data} currency={currency} />
                    ) : <EmptyState icon={Inbox} title="Pas de données" />}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Récurrents ────────────────────────────────────────────── */}
        <TabsContent value="recurring" className="space-y-5">
          {recurring.isLoading ? <Card className="p-4"><Skeleton className="h-64 w-full" /></Card> : !recurring.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Aucune transaction récurrente détectée" /></Card>
          ) : (
            <RecurringTable rows={recurring.data} currency={currency} catName={catName} />
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}

function RecurringTable({ rows, currency, catName }: { rows: RecurringTransaction[]; currency: string; catName: (id: number | null) => string }) {
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Description</TableHead><TableHead>Catégorie</TableHead><TableHead className="text-right">Occurrences</TableHead><TableHead className="text-right">Montant moyen</TableHead><TableHead className="text-right">Dernière</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="max-w-xs"><span className="line-clamp-1 font-medium">{r.description}</span></TableCell>
              <TableCell className="text-muted-foreground">{catName(r.category_id)}</TableCell>
              <TableCell className="nums text-right">{r.occurrences}×</TableCell>
              <TableCell className="nums blurable text-right font-semibold">{formatCents(r.avg_amount_cents, currency)}</TableCell>
              <TableCell className="nums text-right text-muted-foreground">{r.last_date}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
