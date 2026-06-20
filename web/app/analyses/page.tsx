"use client";

import { Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { SpendingDonut } from "@/components/charts/spending-donut";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { NetworthArea } from "@/components/charts/networth-area";
import { CategoryTrendGrid } from "@/components/charts/category-trend-grid";
import { MonthlyDistribution } from "@/components/charts/monthly-distribution";
import {
  useAnalyticsContext, useByCategory, useCashFlow, useNetWorth, useSpendingTrends, useRecurring, useCategories,
} from "@/lib/api/hooks";
import { formatCents, formatPercent } from "@/lib/format";

export default function AnalysesPage() {
  const { query, currency, accounts } = useAnalyticsContext();
  const byCategory = useByCategory(query);
  const cashFlow = useCashFlow(query);
  const netWorth = useNetWorth(query);
  const trends = useSpendingTrends(query);
  const recurring = useRecurring(query.account_ids);
  const { data: categories = [] } = useCategories();

  const catName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <Tabs defaultValue="categories">
      <TabsList>
        <TabsTrigger value="categories">Catégories</TabsTrigger>
        <TabsTrigger value="trends">Tendances</TabsTrigger>
        <TabsTrigger value="distribution">Répartition mensuelle</TabsTrigger>
        <TabsTrigger value="cashflow">Flux de trésorerie</TabsTrigger>
        <TabsTrigger value="networth">Patrimoine</TabsTrigger>
        <TabsTrigger value="recurring">Récurrents</TabsTrigger>
      </TabsList>

      <TabsContent value="categories">
        {byCategory.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : !byCategory.data?.length ? (
          <Card><EmptyState icon={Inbox} title="Aucune dépense sur la période" /></Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card><CardContent><SpendingDonut data={byCategory.data} currency={currency} /></CardContent></Card>
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
        )}
      </TabsContent>

      <TabsContent value="trends">
        {trends.isLoading ? <Skeleton className="h-80 w-full rounded-2xl" /> : trends.data?.length
          ? <CategoryTrendGrid data={trends.data} currency={currency} accounts={accounts} />
          : <Card><EmptyState icon={Inbox} title="Pas de données" /></Card>}
      </TabsContent>

      <TabsContent value="distribution">
        {trends.isLoading ? <Skeleton className="h-80 w-full rounded-2xl" /> : trends.data?.length
          ? <MonthlyDistribution data={trends.data} currency={currency} />
          : <Card><EmptyState icon={Inbox} title="Pas de données" /></Card>}
      </TabsContent>

      <TabsContent value="cashflow">
        <Card><CardContent>{cashFlow.isLoading ? <Skeleton className="h-72 w-full" /> : cashFlow.data?.length ? <CashflowChart data={cashFlow.data} currency={currency} /> : <EmptyState icon={Inbox} title="Pas de données" />}</CardContent></Card>
      </TabsContent>

      <TabsContent value="networth">
        <Card><CardContent>{netWorth.isLoading ? <Skeleton className="h-72 w-full" /> : netWorth.data?.length ? <NetworthArea data={netWorth.data} currency={currency} /> : <EmptyState icon={Inbox} title="Pas de données" />}</CardContent></Card>
      </TabsContent>

      <TabsContent value="recurring">
        <Card className="overflow-hidden p-0">
          {recurring.isLoading ? <div className="p-4"><Skeleton className="h-64 w-full" /></div> : !recurring.data?.length ? (
            <EmptyState icon={Inbox} title="Aucune transaction récurrente détectée" />
          ) : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Description</TableHead><TableHead>Catégorie</TableHead><TableHead className="text-right">Occurrences</TableHead><TableHead className="text-right">Montant moyen</TableHead><TableHead className="text-right">Dernière</TableHead></TableRow></TableHeader>
              <TableBody>
                {recurring.data.map((r, i) => (
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
          )}
        </Card>
      </TabsContent>
    </Tabs>
  );
}
