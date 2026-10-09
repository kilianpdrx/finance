"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Inbox, ChevronRight, CornerDownRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SortHeader, type SortState } from "@/components/ui/sort-header";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { SpendingDonut } from "@/components/charts/spending-donut";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { CategoryTrendGrid } from "@/components/charts/category-trend-grid";
import { TrendTotalChart } from "@/components/charts/trend-total-chart";
import { trendGranularity, totalSeries, trendCurveName, TREND_MIN_POINTS } from "@/lib/trends";
import { MonthlyDistribution } from "@/components/charts/monthly-distribution";
import { CourantTabs, type CourantSelection } from "@/components/analytics/courant-tabs";
import { toast } from "sonner";
import { CategorySelect } from "@/components/transactions/category-select";
import {
  useAnalyticsContext, useByCategory, useSpendingTrends, useCategories,
  useByCategoryPerAccount, useCashFlowPerAccount, useTransactionMutations,
  type SpendingTrend, type CategoryBreakdown, type Transaction, type Category,
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

/** Fold subcategory spending into its parent namespace (single level). Uses the
 *  categories list to resolve the parent even when the parent itself has no direct
 *  spending (grouping-only parents hold ~0, so they don't appear in the breakdown). */
function rollupCategories(data: CategoryBreakdown[], cats: Category[]): RollupGroup[] {
  const byCat = new Map(cats.map((c) => [c.id, c]));
  const keyOf = (d: CategoryBreakdown): number | null =>
    d.category_id == null ? null : byCat.get(d.category_id)?.parent_id ?? d.category_id;

  const groups = new Map<number | string, RollupGroup>();
  for (const d of data) {
    const k = keyOf(d);
    const mapKey = k ?? "none";
    let g = groups.get(mapKey);
    if (!g) {
      const parentCat = k != null ? byCat.get(k) : null;
      g = { id: k, name: parentCat?.name ?? d.category_name, total_cents: 0, count: 0, percentage: 0, own_cents: 0, children: [] };
      groups.set(mapKey, g);
    }
    g.total_cents += d.total_cents;
    g.count += d.count;
    if (d.category_id === k) g.own_cents += d.total_cents; // the namespace's / leaf's own row
    else g.children.push(d);
  }
  const arr = [...groups.values()].sort((a, b) => b.total_cents - a.total_cents);
  const grand = arr.reduce((s, g) => s + g.total_cents, 0) || 1;
  return arr.map((g) => ({ ...g, percentage: Math.round((g.total_cents / grand) * 1000) / 10 }));
}

/** Fold per-category trend series into the parent namespace (single level). */
function rollupTrends(trends: SpendingTrend[], cats: Category[]): SpendingTrend[] {
  const byCat = new Map(cats.map((c) => [c.id, c]));
  const groups = new Map<number | string, SpendingTrend>();
  const order: (number | string)[] = [];
  for (const t of trends) {
    const cat = t.category_id != null ? byCat.get(t.category_id) : null;
    const parent = cat?.parent_id != null ? byCat.get(cat.parent_id) : null;
    const key = parent ? parent.id : t.category_id ?? "none";
    let g = groups.get(key);
    if (!g) {
      g = {
        category_id: parent ? parent.id : t.category_id,
        category_name: parent ? parent.name : t.category_name,
        category_color: parent ? parent.color : t.category_color,
        category_account_id: parent ? parent.account_id ?? null : t.category_account_id,
        series: t.series.map((s) => ({ ...s })),
      };
      groups.set(key, g);
      order.push(key);
    } else {
      const idx = new Map(g.series.map((s, i) => [s.period, i] as const));
      for (const s of t.series) {
        const i = idx.get(s.period);
        if (i != null) g.series[i] = { period: s.period, amount_cents: g.series[i].amount_cents + s.amount_cents };
        else { idx.set(s.period, g.series.length); g.series.push({ ...s }); }
      }
    }
  }
  for (const g of groups.values()) g.series.sort((a, b) => a.period.localeCompare(b.period));
  return order.map((k) => groups.get(k)!);
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
    const groups = rollupCategories(byCategory.data ?? [], categories);
    return [...groups].sort((a, b) => sectionRank(a.id) - sectionRank(b.id) || b.total_cents - a.total_cents);
  }, [byCategory.data, categories, sectionRank]);
  const rolledDonut: CategoryBreakdown[] = rolled.map((g) => ({
    category_id: g.id, category_name: g.name, parent_id: null,
    total_cents: g.total_cents, count: g.count, percentage: g.percentage,
  }));
  const toBreakdown = (data: CategoryBreakdown[]): CategoryBreakdown[] =>
    rollupCategories(data, categories).map((g) => ({
      category_id: g.id, category_name: g.name, parent_id: null,
      total_cents: g.total_cents, count: g.count, percentage: g.percentage,
    }));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Click a category name → its 20 biggest transactions in a table below, each
  // with a category picker. `id: null` is « Non catégorisé »: the one group where
  // that picker matters most, since it is the list of what is left to classify.
  const [detailCat, setDetailCat] = useState<{ name: string; id: number | null } | null>(null);
  // The backend expands a parent (namespace) to its sub-categories, so the
  // group's own id is enough.
  const openDetail = (g: RollupGroup) => setDetailCat({ name: g.name, id: g.id });
  const detailQuery = useQuery({
    // Under "transactions" so a category change made from this table refreshes it.
    queryKey: ["transactions", "category-top", detailCat?.id ?? "none", sel, q.date_from, q.date_to, income],
    enabled: detailCat != null,
    queryFn: async () => {
      const rows = (await unwrap(api.GET("/api/transactions", {
        params: { query: {
          category_id: detailCat?.id ?? undefined,
          uncategorized: detailCat?.id == null ? true : undefined,
          account_id: sel === "all" ? undefined : sel,
          is_debit: !income, is_internal_transfer: false,
          date_from: q.date_from ?? undefined, date_to: q.date_to ?? undefined, limit: 1000,
        } },
      }))) as Transaction[];
      return [...rows].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 20);
    },
  });
  const txnMutations = useTransactionMutations();
  const accountNames = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.name])) as Record<number, string>, [accounts]);

  const [tab, setTab] = useState("categories");
  // Monthly series feed « Répartition mensuelle », and « Tendances » on long
  // ranges. On a short range (about two months or less) Tendances switches to one
  // bar per day: a single monthly bar says nothing about when the money went.
  const trends = useSpendingTrends(q);
  const rolledTrends = useMemo(() => rollupTrends(trends.data ?? [], categories), [trends.data, categories]);
  const granularity = trendGranularity(q.date_from, q.date_to);
  const dailyTrends = useSpendingTrends({ ...q, granularity: "day" }, granularity === "day" && tab === "trends");
  const tabTrends = granularity === "day" ? dailyTrends : trends;
  const rolledTabTrends = useMemo(() => rollupTrends(tabTrends.data ?? [], categories), [tabTrends.data, categories]);
  const totals = useMemo(() => totalSeries(rolledTabTrends), [rolledTabTrends]);
  const perAccountCats = useByCategoryPerAccount(q, scopeIds);
  const perAccountFlux = useCashFlowPerAccount(q, scopeIds);

  const accName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `Compte ${id}`;
  const catAccountId = (id: number | null) => categories.find((c) => c.id === id)?.account_id ?? null;
  const catColor = (id: number | null) => categories.find((c) => c.id === id)?.color ?? "#94a3b8";

  // Small tinted badge describing a category's type (Revenu / Fixe / Variable).
  const typeBadge = (id: number | null) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return null;
    if (c.is_income) return <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-600 dark:text-emerald-400">Revenu</span>;
    if (c.expense_type === "fixed") return <span className="rounded bg-indigo-500/15 px-1 text-[10px] text-indigo-600 dark:text-indigo-400">Fixe</span>;
    if (c.expense_type === "variable") return <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-600 dark:text-amber-400">Variable</span>;
    return null;
  };

  // Column sort for the categories table. `null` = default fixe/variable grouping.
  type SortCol = "name" | "count" | "total" | "pct";
  const [sort, setSort] = useState<SortState<SortCol> | null>(null);
  const sortedRolled = useMemo(() => {
    if (!sort) return rolled;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (g: RollupGroup) =>
      sort.col === "name" ? g.name.toLowerCase() : sort.col === "count" ? g.count : sort.col === "total" ? g.total_cents : g.percentage;
    return [...rolled].sort((a, b) => {
      const va = val(a), vb = val(b);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [rolled, sort]);
  const showPerAccount = scopeIds.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CourantTabs accounts={accounts} value={sel} onChange={setSel} />
        {/* Every tab follows this toggle except the cash-flow one, which shows
            income and expenses side by side by nature. */}
        <div className={`inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm ${tab === "cashflow" ? "invisible" : ""}`} aria-hidden={tab === "cashflow"}>
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="categories">Catégories</TabsTrigger>
          <TabsTrigger value="trends">Tendances</TabsTrigger>
          <TabsTrigger value="distribution">Répartition mensuelle</TabsTrigger>
          <TabsTrigger value="cashflow">Flux de trésorerie</TabsTrigger>
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
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>
                          <SortHeader col="name" sort={sort} onSort={setSort} first="asc">Catégorie</SortHeader>
                        </TableHead>
                        <TableHead className="text-right">
                          <SortHeader col="count" sort={sort} onSort={setSort}>Nb</SortHeader>
                        </TableHead>
                        <TableHead className="text-right">
                          <SortHeader col="total" sort={sort} onSort={setSort}>Total</SortHeader>
                        </TableHead>
                        <TableHead className="text-right">
                          <SortHeader col="pct" sort={sort} onSort={setSort}>%</SortHeader>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRolled.map((g) => {
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
                                  <span className="size-2 shrink-0 rounded-full" style={{ background: catColor(g.id) }} />
                                  <button onClick={() => openDetail(g)} className="text-left hover:text-brand hover:underline" title="Voir les 20 plus grosses transactions">{g.name}</button>
                                  {g.id != null && typeBadge(g.id)}
                                  {g.id != null && <span className="text-[10px] text-muted-foreground">· {catAccountId(g.id) == null ? "Global" : accName(catAccountId(g.id)!)}</span>}
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
                                <TableCell className="py-1.5 pl-9 text-sm"><span className="flex items-center gap-1.5"><CornerDownRight className="size-3 text-muted-foreground/60" /><span className="size-2 shrink-0 rounded-full" style={{ background: catColor(ch.category_id) }} /> {ch.category_name} {typeBadge(ch.category_id)}</span></TableCell>
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
                            <SpendingDonut data={toBreakdown(data)} currency={currency} size={150} />
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
                      <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-20">Date</TableHead><TableHead className="w-full">Description</TableHead><TableHead className="w-52">Catégorie</TableHead><TableHead className="w-28 text-right">Montant</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {detailQuery.data.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="nums whitespace-nowrap text-xs text-muted-foreground">{format(new Date(t.date), "dd MMM yy", { locale: fr })}</TableCell>
                            <TableCell className="w-full max-w-0"><span className="line-clamp-1" title={t.description}>{t.description}</span></TableCell>
                            <TableCell>
                              <CategorySelect
                                value={t.category_id}
                                categories={categories}
                                accountId={t.account_id}
                                accountNames={accountNames}
                                showNamespace
                                className="h-8 border-transparent bg-transparent text-xs shadow-none hover:border-border"
                                onChange={(cid) => txnMutations.update.mutate({ id: t.id, body: { category_id: cid } }, { onSuccess: () => toast.success("Catégorie mise à jour") })}
                              />
                            </TableCell>
                            {/* A raw transaction amount is in its account's currency, not the base one. */}
                            <TableCell className="nums blurable text-right font-semibold">{formatCents(t.amount_cents, t.currency)}</TableCell>
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
          {tabTrends.isLoading ? <Skeleton className="h-80 w-full rounded-2xl" /> : !tabTrends.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Pas de données" /></Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{income ? "Total des revenus" : "Total des dépenses"}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {granularity === "day"
                      ? "Par jour, toutes catégories confondues."
                      : "Par mois, toutes catégories confondues. Choisissez une période de deux mois ou moins pour le détail par jour."}
                  </p>
                  {/* What each line is: they share a chart but not a meaning. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                    {totals.length >= TREND_MIN_POINTS && (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="w-5 border-t-2 border-dashed border-foreground" />
                        Tendance : {trendCurveName(granularity).toLowerCase()}
                      </span>
                    )}
                    {granularity === "day" && (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="w-5 border-t-2 border-info" />
                        Cumul depuis le début de la période (échelle de droite)
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <TrendTotalChart data={totals} granularity={granularity} income={income} currency={currency} />
                </CardContent>
              </Card>
              <CategoryTrendGrid data={rolledTabTrends} currency={currency} accounts={accounts} granularity={granularity} />
            </>
          )}
        </TabsContent>

        {/* ── Répartition mensuelle ───────────────────────────────────── */}
        <TabsContent value="distribution" className="space-y-5">
          {trends.isLoading ? <Skeleton className="h-80 w-full rounded-2xl" /> : !trends.data?.length ? (
            <Card><EmptyState icon={Inbox} title="Pas de données" /></Card>
          ) : (
            <MonthlyDistribution data={rolledTrends} currency={currency} />
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

      </Tabs>

    </div>
  );
}
