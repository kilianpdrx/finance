"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Inbox, ChevronRight, CornerDownRight, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RuleDialog } from "@/components/settings/rule-dialog";
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
  type SpendingTrend, type RecurringTransaction, type CategoryBreakdown, type Transaction,
} from "@/lib/api/hooks";
import { api, unwrap } from "@/lib/api/client";
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
  const [flow, setFlow] = useState<"depenses" | "revenus">("depenses");
  const income = flow === "revenus";
  const scopeIds = sel === "all" ? courantIds : [sel];
  const q = { ...query, account_ids: scopeIds.length ? scopeIds.join(",") : undefined, income };

  const { data: categories = [] } = useCategories();
  // fixe → 0, variable → 1, everything else (income, unknown) → 2. Categories are
  // grouped by this rank, then by amount within each group.
  const sectionRank = useMemo(() => {
    const typeOf = new Map(categories.map((c) => [c.id, c.expense_type] as const));
    return (id: number | null) => {
      const t = id == null ? null : typeOf.get(id);
      return t === "fixed" ? 0 : t === "variable" ? 1 : 2;
    };
  }, [categories]);

  const byCategory = useByCategory(q);
  const rolled = useMemo(() => {
    const groups = rollupCategories(byCategory.data ?? []);
    return [...groups].sort((a, b) => sectionRank(a.id) - sectionRank(b.id) || b.total_cents - a.total_cents);
  }, [byCategory.data, sectionRank]);
  const rolledDonut: CategoryBreakdown[] = rolled.map((g) => ({
    category_id: g.id, category_name: g.name, parent_id: null,
    total_cents: g.total_cents, count: g.count, percentage: g.percentage,
  }));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Click a category name → its 20 biggest transactions in a table below.
  const [detailCat, setDetailCat] = useState<{ name: string; ids: number[] } | null>(null);
  const openDetail = (g: RollupGroup) => {
    const ids = [g.id, ...g.children.map((c) => c.category_id)].filter((x): x is number => x != null);
    if (ids.length) setDetailCat({ name: g.name, ids });
  };
  const detailQuery = useQuery({
    queryKey: ["cat-top-txns", detailCat?.ids, q.date_from, q.date_to, income],
    enabled: detailCat != null,
    queryFn: async () => {
      const results = await Promise.all(
        (detailCat?.ids ?? []).map((cid) =>
          unwrap(api.GET("/api/transactions", {
            params: { query: {
              category_id: cid, is_debit: !income, is_internal_transfer: false,
              date_from: q.date_from ?? undefined, date_to: q.date_to ?? undefined, limit: 1000,
            } },
          })) as Promise<Transaction[]>,
        ),
      );
      return results.flat().sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 20);
    },
  });

  const trends = useSpendingTrends(q);
  const recurring = useRecurring(q.account_ids);
  const uncovered = useRecurringUncovered(q.account_ids);
  const [rulePrefill, setRulePrefill] = useState<{ description: string; categoryId: number | null } | null>(null);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CourantTabs accounts={accounts} value={sel} onChange={setSel} />
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {([["depenses", "Dépenses"], ["revenus", "Revenus"]] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFlow(val)}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                flow === val
                  ? val === "revenus"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-brand/15 text-brand"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
            <Card><EmptyState icon={Inbox} title={income ? "Aucun revenu sur la période" : "Aucune dépense sur la période"} /></Card>
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
                            <TableRow>
                              <TableCell className="font-medium">
                                <span className="flex items-center gap-1.5">
                                  {hasChildren
                                    ? <button onClick={() => toggle(g.id ?? -1)} className="shrink-0 text-muted-foreground" aria-label="Développer">
                                        <ChevronRight className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                      </button>
                                    : <span className="w-3.5 shrink-0" />}
                                  <button onClick={() => openDetail(g)} className="text-left hover:text-brand hover:underline">{g.name}</button>
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

              {/* Top-20 transactions for the clicked category */}
              {detailCat && (
                <Card className="overflow-hidden p-0">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <p className="text-sm font-semibold">
                      20 plus grosses {income ? "entrées" : "dépenses"} — <span className="text-brand">{detailCat.name}</span>
                    </p>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setDetailCat(null)} aria-label="Fermer">
                      <X className="size-4" />
                    </Button>
                  </div>
                  {detailQuery.isLoading ? (
                    <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                  ) : !detailQuery.data?.length ? (
                    <EmptyState icon={Inbox} title="Aucune transaction" />
                  ) : (
                    <Table>
                      <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-24">Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {detailQuery.data.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="nums whitespace-nowrap text-xs text-muted-foreground">{format(new Date(t.date), "dd MMM yy", { locale: fr })}</TableCell>
                            <TableCell className="max-w-0"><span className="line-clamp-1" title={t.description}>{t.description}</span></TableCell>
                            <TableCell className="nums blurable text-right font-semibold">{formatCents(t.amount_cents, currency)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
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

      <RuleDialog open={rulePrefill !== null} onOpenChange={(v) => !v && setRulePrefill(null)} accounts={accounts} prefill={rulePrefill} />
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
