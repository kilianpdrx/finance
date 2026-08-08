"use client";

import { Fragment, useMemo, useState } from "react";
import { Inbox, ChevronRight, CornerDownRight, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateRuleDialog } from "@/components/analytics/create-rule-dialog";
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
  useAnalyticsContext, useByCategory, useSpendingTrends, useRecurring, useRecurringUncovered, useCategories,
  useByCategoryPerAccount, useCashFlowPerAccount,
  type SpendingTrend, type RecurringTransaction, type CategoryBreakdown,
} from "@/lib/api/hooks";
import { formatCents, formatPercent } from "@/lib/format";

interface RollupGroup {
  id: number | null;
  name: string;
  total_cents: number;
  count: number;
  percentage: number;
  own_cents: number;
  children: CategoryBreakdown[];
}

/** Fold subcategory spending into the parent (single level). */
function rollupCategories(data: CategoryBreakdown[]): RollupGroup[] {
  const childrenOf = new Map<number, CategoryBreakdown[]>();
  for (const d of data) if (d.parent_id != null) {
    (childrenOf.get(d.parent_id) ?? childrenOf.set(d.parent_id, []).get(d.parent_id)!).push(d);
  }
  const topPresent = new Set(data.filter((d) => d.parent_id == null).map((d) => d.category_id));
  const groups: RollupGroup[] = [];
  for (const d of data) {
    if (d.parent_id != null && topPresent.has(d.parent_id)) continue; // folded into its parent
    const kids = d.category_id != null ? childrenOf.get(d.category_id) ?? [] : [];
    const total = d.total_cents + kids.reduce((s, k) => s + k.total_cents, 0);
    groups.push({
      id: d.category_id, name: d.category_name, total_cents: total,
      count: d.count + kids.reduce((s, k) => s + k.count, 0),
      percentage: 0, own_cents: d.total_cents, children: kids,
    });
  }
  groups.sort((a, b) => b.total_cents - a.total_cents);
  const grand = groups.reduce((s, g) => s + g.total_cents, 0) || 1;
  return groups.map((g) => ({ ...g, percentage: Math.round((g.total_cents / grand) * 1000) / 10 }));
}

export default function AnalysesPage() {
  const { query, currency, accounts } = useAnalyticsContext();
  const courant = accounts.filter((a) => a.account_type === "courant");
  const courantIds = courant.map((a) => a.id);

  const [sel, setSel] = useState<CourantSelection>("all");
  const scopeIds = sel === "all" ? courantIds : [sel];
  const q = { ...query, account_ids: scopeIds.length ? scopeIds.join(",") : undefined };

  const byCategory = useByCategory(q);
  const rolled = useMemo(() => rollupCategories(byCategory.data ?? []), [byCategory.data]);
  const rolledDonut: CategoryBreakdown[] = rolled.map((g) => ({
    category_id: g.id, category_name: g.name, parent_id: null,
    total_cents: g.total_cents, count: g.count, percentage: g.percentage,
  }));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const trends = useSpendingTrends(q);
  const recurring = useRecurring(q.account_ids);
  const uncovered = useRecurringUncovered(q.account_ids);
  const [rulePrefill, setRulePrefill] = useState<{ description: string; categoryId: number | null } | null>(null);
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
          <TabsTrigger value="uncovered">Sans règle</TabsTrigger>
        </TabsList>

        {/* ── Catégories ──────────────────────────────────────────────── */}
        <TabsContent value="categories" className="space-y-4">
          {byCategory.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : !byCategory.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Aucune dépense sur la période" /></Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card><CardContent className="flex items-center justify-center py-8"><SpendingDonut data={rolledDonut} currency={currency} size={260} /></CardContent></Card>
                <Card className="overflow-hidden p-0">
                  <Table>
                    <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Catégorie</TableHead><TableHead className="text-right">Nb</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rolled.map((g) => {
                        const isOpen = expanded.has(g.id ?? -1);
                        const hasChildren = g.children.length > 0;
                        return (
                          <Fragment key={g.id ?? g.name}>
                            <TableRow className={hasChildren ? "cursor-pointer" : ""} onClick={() => hasChildren && toggle(g.id ?? -1)}>
                              <TableCell className="font-medium">
                                <span className="flex items-center gap-1.5">
                                  {hasChildren
                                    ? <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                    : <span className="w-3.5 shrink-0" />}
                                  {g.name}
                                  {hasChildren && <span className="text-xs text-muted-foreground">({g.children.length})</span>}
                                </span>
                              </TableCell>
                              <TableCell className="nums text-right text-muted-foreground">{g.count}</TableCell>
                              <TableCell className="nums blurable text-right font-semibold">{formatCents(g.total_cents, currency)}</TableCell>
                              <TableCell className="nums text-right text-muted-foreground">{formatPercent(g.percentage)}</TableCell>
                            </TableRow>
                            {isOpen && g.own_cents > 0 && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell className="py-1.5 pl-9 text-sm text-muted-foreground"><span className="flex items-center gap-1.5"><CornerDownRight className="size-3 opacity-60" /> {g.name} (propre)</span></TableCell>
                                <TableCell className="nums py-1.5 text-right text-xs text-muted-foreground">—</TableCell>
                                <TableCell className="nums blurable py-1.5 text-right text-sm">{formatCents(g.own_cents, currency)}</TableCell>
                                <TableCell />
                              </TableRow>
                            )}
                            {isOpen && g.children.map((ch) => (
                              <TableRow key={ch.category_id} className="hover:bg-transparent">
                                <TableCell className="py-1.5 pl-9 text-sm"><span className="flex items-center gap-1.5"><CornerDownRight className="size-3 text-muted-foreground/60" /> {ch.category_name}</span></TableCell>
                                <TableCell className="nums py-1.5 text-right text-xs text-muted-foreground">{ch.count}</TableCell>
                                <TableCell className="nums blurable py-1.5 text-right text-sm">{formatCents(ch.total_cents, currency)}</TableCell>
                                <TableCell />
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      })}
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
            <RecurringTable rows={recurring.data} currency={currency} catName={catName}
              onCreateRule={(r) => setRulePrefill({ description: r.description, categoryId: r.category_id })} />
          )}
        </TabsContent>

        {/* ── Sans règle (recurring expenses no rule matches) ─────────── */}
        <TabsContent value="uncovered" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Dépenses récurrentes qu&apos;aucune règle automatique ne couvre — créez une règle pour les classer à l&apos;avenir.
          </p>
          {uncovered.isLoading ? <Card className="p-4"><Skeleton className="h-64 w-full" /></Card> : !uncovered.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Toutes les dépenses récurrentes sont couvertes par une règle 🎉" /></Card>
          ) : (
            <RecurringTable rows={uncovered.data} currency={currency} catName={catName}
              onCreateRule={(r) => setRulePrefill({ description: r.description, categoryId: r.category_id })} />
          )}
        </TabsContent>

      </Tabs>

      <CreateRuleDialog open={rulePrefill !== null} onOpenChange={(v) => !v && setRulePrefill(null)} prefill={rulePrefill} />
    </div>
  );
}

function RecurringTable({ rows, currency, catName, onCreateRule }: {
  rows: RecurringTransaction[]; currency: string; catName: (id: number | null) => string;
  onCreateRule: (r: RecurringTransaction) => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Description</TableHead><TableHead>Catégorie</TableHead><TableHead className="text-right">Occurrences</TableHead><TableHead className="text-right">Montant moyen</TableHead><TableHead className="text-right">Dernière</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className="group">
              <TableCell className="max-w-xs"><span className="line-clamp-1 font-medium">{r.description}</span></TableCell>
              <TableCell className="text-muted-foreground">{catName(r.category_id)}</TableCell>
              <TableCell className="nums text-right">{r.occurrences}×</TableCell>
              <TableCell className="nums blurable text-right font-semibold">{formatCents(r.avg_amount_cents, currency)}</TableCell>
              <TableCell className="nums text-right text-muted-foreground">{r.last_date}</TableCell>
              <TableCell className="pr-2 text-right">
                <Button variant="ghost" size="sm" className="gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Créer une règle depuis cette transaction" onClick={() => onCreateRule(r)}>
                  <Wand2 className="size-3.5" /> Règle
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
