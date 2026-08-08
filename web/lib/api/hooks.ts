"use client";

import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";
import { useDateRangeStore, useSelectedAccountsStore } from "../stores";
import { deriveCurrency } from "../format";

// ── Types (re-exported from generated schema) ─────────────────────────────────
export type Account = components["schemas"]["AccountOut"];
export type AccountCreate = components["schemas"]["AccountCreate"];
export type AccountUpdate = components["schemas"]["AccountUpdate"];
export type Transaction = components["schemas"]["TransactionOut"];
export type TransactionCreate = components["schemas"]["TransactionCreateManual"];
export type TransactionUpdate = components["schemas"]["TransactionUpdate"];
export type Category = components["schemas"]["CategoryOut"];
export type CategoryCreate = components["schemas"]["CategoryCreate"];
export type CategoryUpdate = components["schemas"]["CategoryUpdate"];
export type CategoryRule = components["schemas"]["CategoryRuleOut"];
export type CategoryRuleCreate = components["schemas"]["CategoryRuleCreate"];
export type RuleCondition = components["schemas"]["RuleCondition"];
export type AnalyticsSummary = components["schemas"]["AnalyticsSummary"];
export type CashFlowMonth = components["schemas"]["CashFlowMonth"];
export type CategoryBreakdown = components["schemas"]["CategoryBreakdown"];
export type RecurringTransaction = components["schemas"]["RecurringTransaction"];
export type BudgetFullResponse = components["schemas"]["BudgetFullResponse"];
export type BudgetTableRow = components["schemas"]["BudgetTableRow"];
export type BankProfile = components["schemas"]["BankProfileOut"];
export type Snapshot = components["schemas"]["AccountBalanceSnapshotOut"];
export interface ImportBatch {
  id: number;
  account_id: number;
  account_name: string | null;
  filename: string | null;
  transaction_count: number;
  created_at: string;
}

export type NetWorthPoint = { month: string; total: number } & Record<string, number | string>;
export interface SpendingTrend {
  category_id: number | null;
  category_name: string;
  category_color: string;
  category_account_id: number | null;
  series: { month: string; amount_cents: number }[];
}
export interface HoldingOut {
  id: number;
  account_id: number;
  ticker: string;
  isin: string | null;
  name: string;
  quantity: number;
  cost_basis_cents: number;
  currency: string;
  asset_type: string;
  added_date: string | null;
  notes: string | null;
  price_locked: boolean;
  current_price_cents: number | null;
  current_value_cents: number | null;
  gain_cents: number | null;
  gain_pct: number | null;
  price_currency: string | null;
  price_fetched_at: string | null;
  value_in_account_ccy_cents: number | null;
  price_status: "ok" | "fallback" | "mismatch" | "missing";
  // Dividend fields
  dividend_yield: number | null;
  yield_on_cost: number | null;
  est_annual_income_cents: number | null;
  ex_dividend_date: string | null;
  payout_ratio: number | null;
  dividend_growth_rate: number | null;
  frequency: string | null;
  sector: string | null;
  industry: string | null;
  dividend_date: string | null;
}
export interface InvestmentAccount {
  id: number;
  name: string;
  bank_name: string;
  currency: string;
  color: string;
  current_value_cents: number | null;
  first_value_cents: number | null;
  total_contributions_cents: number;
  money_added_cents: number;
  pct_from_start: number | null;
  pct_from_last_month: number | null;
  change_from_start_cents: number | null;
  change_from_last_month_cents: number | null;
  perf_pct_from_start: number | null;
  perf_pct_from_last_month: number | null;
  perf_from_start_cents: number | null;
  perf_from_last_month_cents: number | null;
  monthly: { id: number; date: string; month: string; amount_cents: number; contribution_cents: number; currency: string; notes: string | null }[];
  has_holdings: boolean;
  holdings: HoldingOut[];
  holdings_value_cents: number | null;
  holdings_cost_basis_cents: number | null;
  holdings_gain_cents: number | null;
  holdings_gain_pct: number | null;
  allocation_by_type: Record<string, number> | null;
  est_annual_div_cents: number | null;
  avg_dividend_yield: number | null;
}
export interface InvestmentSeriesPoint {
  month: string;
  total_cents: number;
  [accountName: string]: unknown;
}

export interface AnalyticsQuery {
  date_from?: string | null;
  date_to?: string | null;
  account_ids?: string | null;
  income?: boolean;   // by-category / spending-trends: true = revenus, false = dépenses
}

export interface TransactionFilters {
  account_id?: number | null;
  category_id?: number | null;
  uncategorized?: boolean | null;
  categorized?: boolean | null;
  date_from?: string | null;
  date_to?: string | null;
  search?: string | null;
  is_debit?: boolean | null;
  is_internal_transfer?: boolean | null;
  bank_name?: string | null;
  month?: string | null;
  import_batch_id?: number | null;
  limit?: number;
  offset?: number;
}

// ── Shared analytics context ──────────────────────────────────────────────────
export function useAnalyticsContext() {
  const { dateFrom, dateTo } = useDateRangeStore();
  const { selectedAccountIds } = useSelectedAccountsStore();
  const { data: accounts = [] } = useAccounts();
  const baseCurrency = useBaseCurrency();

  const query: AnalyticsQuery = {
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    account_ids: selectedAccountIds ? selectedAccountIds.join(",") : undefined,
  };
  return { query, currency: baseCurrency, accounts, selectedAccountIds };
}

// ── Queries ───────────────────────────────────────────────────────────────────
export function useAccounts() {
  return useQuery({ queryKey: ["accounts"], queryFn: () => unwrap(api.GET("/api/accounts")), staleTime: 60_000 });
}
export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => unwrap(api.GET("/api/categories")), staleTime: 60_000 });
}
export function useSummary(query: AnalyticsQuery) {
  return useQuery({ queryKey: ["analytics", "summary", query], queryFn: () => unwrap(api.GET("/api/analytics/summary", { params: { query } })) });
}
export function useCashFlow(query: AnalyticsQuery) {
  return useQuery({ queryKey: ["analytics", "cash-flow", query], queryFn: () => unwrap(api.GET("/api/analytics/cash-flow", { params: { query } })) });
}
export function useByCategory(query: AnalyticsQuery) {
  return useQuery({ queryKey: ["analytics", "by-category", query], queryFn: () => unwrap(api.GET("/api/analytics/by-category", { params: { query } })) });
}
export function useNetWorth(query: AnalyticsQuery) {
  return useQuery({ queryKey: ["analytics", "net-worth", query], queryFn: () => unwrap(api.GET("/api/analytics/net-worth", { params: { query } })) as Promise<NetWorthPoint[]> });
}

/** By-category breakdown fetched once per account (for the per-account donut row).
 *  Reuses the existing /by-category endpoint; one parallel query per account id. */
export function useByCategoryPerAccount(query: AnalyticsQuery, accountIds: number[]) {
  const results = useQueries({
    queries: accountIds.map((id) => ({
      queryKey: ["analytics", "by-category", { ...query, account_ids: String(id) }],
      queryFn: () => unwrap(api.GET("/api/analytics/by-category", { params: { query: { ...query, account_ids: String(id) } } })) as Promise<CategoryBreakdown[]>,
    })),
  });
  return accountIds.map((id, i) => ({ accountId: id, data: results[i]?.data ?? [], isLoading: results[i]?.isLoading ?? false }));
}

/** Cash-flow fetched once per account (for the per-account flux charts). */
export function useCashFlowPerAccount(query: AnalyticsQuery, accountIds: number[]) {
  const results = useQueries({
    queries: accountIds.map((id) => ({
      queryKey: ["analytics", "cash-flow", { ...query, account_ids: String(id) }],
      queryFn: () => unwrap(api.GET("/api/analytics/cash-flow", { params: { query: { ...query, account_ids: String(id) } } })) as Promise<CashFlowMonth[]>,
    })),
  });
  return accountIds.map((id, i) => ({ accountId: id, data: results[i]?.data ?? [], isLoading: results[i]?.isLoading ?? false }));
}
export function useSpendingTrends(query: AnalyticsQuery) {
  return useQuery({ queryKey: ["analytics", "spending-trends", query], queryFn: () => unwrap(api.GET("/api/analytics/spending-trends", { params: { query } })) as Promise<SpendingTrend[]> });
}
export function useRecurring(accountIds?: string | null) {
  return useQuery({ queryKey: ["analytics", "recurring", accountIds], queryFn: () => unwrap(api.GET("/api/analytics/recurring", { params: { query: { account_ids: accountIds ?? undefined } } })) });
}
export function useRecurringUncovered(accountIds?: string | null) {
  return useQuery({ queryKey: ["analytics", "recurring-uncovered", accountIds], queryFn: () => unwrap(api.GET("/api/analytics/recurring-uncovered", { params: { query: { account_ids: accountIds ?? undefined } } })) as Promise<RecurringTransaction[]> });
}
export function useBudgetFull(year: number | undefined, accountIds?: string | null) {
  return useQuery({
    queryKey: ["budget-full", year, accountIds],
    queryFn: () => unwrap(api.GET("/api/analytics/budget-full", { params: { query: { year, account_ids: accountIds ?? undefined } } })),
  });
}
export function useTransactions(filters: TransactionFilters) {
  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return useQuery({ queryKey: ["transactions", filters], queryFn: () => unwrap(api.GET("/api/transactions", { params: { query } })) });
}
export function useTransactionMeta() {
  return useQuery({ queryKey: ["transactions", "meta"], queryFn: () => unwrap(api.GET("/api/transactions/meta")), staleTime: 60_000 });
}
export function useTransactionCount(filters: TransactionFilters) {
  // Same filters as the list, minus pagination, for a real total count.
  const { limit: _l, offset: _o, ...rest } = filters;
  const query = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return useQuery({
    queryKey: ["transactions", "count", rest],
    queryFn: () => unwrap(api.GET("/api/transactions/count", { params: { query } })) as Promise<{ total: number }>,
  });
}
export interface TransactionStats { total: number; categorized: number; uncategorized: number; transfers: number; }
export function useTransactionStats(filters: TransactionFilters) {
  // Base filters only — the categorized/uncategorized/transfer toggles are the
  // dimensions being counted, so they're excluded to keep counts stable.
  const { limit: _l, offset: _o, category_id: _c, uncategorized: _u, categorized: _cz, is_internal_transfer: _t, ...rest } = filters;
  const query = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return useQuery({
    queryKey: ["transactions", "stats", rest],
    queryFn: () => unwrap(api.GET("/api/transactions/stats", { params: { query } })) as Promise<TransactionStats>,
  });
}
export function useImportBatches() {
  return useQuery({ queryKey: ["transactions", "batches"], queryFn: () => unwrap(api.GET("/api/transactions/batches")) as Promise<ImportBatch[]> });
}
export function useAllRules() {
  return useQuery({ queryKey: ["rules"], queryFn: () => unwrap(api.GET("/api/categories/rules/all")) });
}
export function useBankProfiles() {

  return useQuery({ queryKey: ["bank-profiles"], queryFn: () => unwrap(api.GET("/api/bank-profiles")) });
}
export function useSnapshots(accountId: number | null) {
  return useQuery({
    queryKey: ["snapshots", accountId],
    enabled: accountId != null,
    queryFn: () => unwrap(api.GET("/api/accounts/{account_id}/snapshots", { params: { path: { account_id: accountId! } } })),
  });
}
export function useInvestmentAccounts() {
  return useQuery({ queryKey: ["investments", "accounts"], queryFn: () => unwrap(api.GET("/api/investments/accounts")) as Promise<InvestmentAccount[]> });
}
export function useInvestmentTotalSeries() {
  return useQuery({ queryKey: ["investments", "total-series"], queryFn: () => unwrap(api.GET("/api/investments/total-series")) as Promise<InvestmentSeriesPoint[]> });
}

export interface DividendCalendarItem {
  ticker: string;
  name: string;
  amount_cents: number;
  currency: string;
  sector: string | null;
}
export interface DividendCalendarMonth {
  month: string;
  total_cents: number;
  items: DividendCalendarItem[];
}
export interface DividendCalendarResponse {
  monthly: DividendCalendarMonth[];
  by_sector: { sector: string; est_annual_cents: number }[];
}
export function useDividendCalendar(months = 12) {
  return useQuery({
    queryKey: ["investments", "dividend-calendar", months],
    queryFn: async () => {
      const res = await fetch(`/api/investments/dividend-calendar?months=${months}`);
      if (!res.ok) throw new Error("Failed to fetch dividend calendar");
      return res.json() as Promise<DividendCalendarResponse>;
    },
  });
}
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json() as Promise<Record<string, string>>;
    },
    staleTime: 300_000,
  });
}
export function useBaseCurrency() {
  const { data } = useSettings();
  return data?.base_currency ?? "CHF";
}

// ── Mutations ─────────────────────────────────────────────────────────────────
function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function useAccountMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate("accounts", "analytics", "investments", "snapshots", "loans");
  return {
    create: useMutation({ mutationFn: (body: AccountCreate) => unwrap(api.POST("/api/accounts", { body })), onSuccess }),
    update: useMutation({ mutationFn: ({ id, body }: { id: number; body: AccountUpdate }) => unwrap(api.PUT("/api/accounts/{account_id}", { params: { path: { account_id: id } }, body })), onSuccess }),
    remove: useMutation({ mutationFn: (id: number) => api.DELETE("/api/accounts/{account_id}", { params: { path: { account_id: id } } }), onSuccess }),
  };
}

export function useTransactionMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate("transactions", "analytics", "budget-full");
  return {
    create: useMutation({ mutationFn: (body: TransactionCreate) => unwrap(api.POST("/api/transactions", { body })), onSuccess }),
    update: useMutation({ mutationFn: ({ id, body }: { id: number; body: TransactionUpdate }) => unwrap(api.PUT("/api/transactions/{transaction_id}", { params: { path: { transaction_id: id } }, body })), onSuccess }),
    remove: useMutation({ mutationFn: (id: number) => api.DELETE("/api/transactions/{transaction_id}", { params: { path: { transaction_id: id } } }), onSuccess }),
    bulkDelete: useMutation({ mutationFn: (ids: number[]) => unwrap(api.POST("/api/transactions/bulk-delete", { body: { ids } })), onSuccess }),
    bulkCategory: useMutation({ mutationFn: ({ ids, category_id }: { ids: number[]; category_id: number | null }) => unwrap(api.POST("/api/transactions/bulk-update-category", { body: { ids, category_id } })), onSuccess }),
    bulkReviewed: useMutation({ mutationFn: ({ ids, value }: { ids: number[]; value: boolean }) => unwrap(api.POST("/api/transactions/bulk-update-reviewed", { body: { ids, is_manually_reviewed: value } })), onSuccess }),
    bulkTransfer: useMutation({ mutationFn: ({ ids, value }: { ids: number[]; value: boolean }) => unwrap(api.POST("/api/transactions/bulk-update-transfer", { body: { ids, is_internal_transfer: value } })), onSuccess }),
    detectTransfers: useMutation({ mutationFn: () => unwrap(api.POST("/api/transactions/detect-transfers", { params: { query: { max_days: 3 } } })), onSuccess }),
  };
}

export function useCategoryMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate("categories", "transactions", "analytics", "budget-full", "rules");
  return {
    create: useMutation({ mutationFn: (body: CategoryCreate) => unwrap(api.POST("/api/categories", { body })), onSuccess }),
    update: useMutation({ mutationFn: ({ id, body }: { id: number; body: CategoryUpdate }) => unwrap(api.PUT("/api/categories/{category_id}", { params: { path: { category_id: id } }, body })), onSuccess }),
    remove: useMutation({ mutationFn: ({ id, replaceWithId }: { id: number; replaceWithId?: number }) => api.DELETE("/api/categories/{category_id}", { params: { path: { category_id: id }, query: { replace_with_id: replaceWithId } } }), onSuccess }),
    rescan: useMutation({ mutationFn: () => unwrap(api.POST("/api/categories/rescan")), onSuccess }),
    seedDefaults: useMutation({ mutationFn: () => unwrap(api.POST("/api/categories/seed-defaults")), onSuccess }),
  };
}

export function useRuleMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate("rules", "categories");
  return {
    create: useMutation({ mutationFn: ({ categoryId, body }: { categoryId: number; body: CategoryRuleCreate }) => unwrap(api.POST("/api/categories/{category_id}/rules", { params: { path: { category_id: categoryId } }, body })), onSuccess }),
    update: useMutation({ mutationFn: ({ ruleId, body }: { ruleId: number; body: components["schemas"]["CategoryRuleUpdate"] }) => unwrap(api.PUT("/api/categories/rules/{rule_id}", { params: { path: { rule_id: ruleId } }, body })), onSuccess }),
    remove: useMutation({ mutationFn: (ruleId: number) => api.DELETE("/api/categories/rules/{rule_id}", { params: { path: { rule_id: ruleId } } }), onSuccess }),
    merge: useMutation({ mutationFn: ({ ruleIds, logicOperator }: { ruleIds: number[]; logicOperator: string }) => unwrap(api.POST("/api/categories/rules/merge", { body: { rule_ids: ruleIds, logic_operator: logicOperator } })), onSuccess }),
  };
}


export function useSnapshotMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate("snapshots", "accounts", "analytics", "investments");
  return {
    create: useMutation({ mutationFn: ({ accountId, body }: { accountId: number; body: components["schemas"]["AccountBalanceSnapshotCreate"] }) => unwrap(api.POST("/api/accounts/{account_id}/snapshots", { params: { path: { account_id: accountId } }, body })), onSuccess }),
    remove: useMutation({ mutationFn: ({ accountId, snapshotId }: { accountId: number; snapshotId: number }) => api.DELETE("/api/accounts/{account_id}/snapshots/{snapshot_id}", { params: { path: { account_id: accountId, snapshot_id: snapshotId } } }), onSuccess }),
  };
}

export function useBudgetMutation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (q: { category_id: number; month: string; expected_amount_cents: number; account_id?: number | null }) =>
      unwrap(api.PUT("/api/analytics/budget", { params: { query: q } })),
    onSuccess: () => invalidate("budget-full", "analytics"),
  });
}

// ── Planned expenses (budget forecast layer) ──────────────────────────────────
export interface RecurringPlan {
  category_id: number;
  start_month: string;
  amount_cents: number;
  account_id?: number | null;
  every_n_months: number;
  end_mode: "year" | "count" | "until";
  count?: number | null;
  end_month?: string | null;
}

export function usePlannedExpenseMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["budget-full"] });
  return {
    create: useMutation({
      mutationFn: (body: { category_id: number; month: string; amount_cents: number; account_id?: number | null }) =>
        mutateJson("/api/planned-expenses", "POST", body),
      onSuccess: invalidate,
    }),
    createRecurring: useMutation({
      mutationFn: (body: RecurringPlan) => mutateJson("/api/planned-expenses/recurring", "POST", body),
      onSuccess: invalidate,
    }),
    confirm: useMutation({
      mutationFn: (id: number) => mutateJson(`/api/planned-expenses/${id}`, "PATCH", { matched: true }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => mutateJson(`/api/planned-expenses/${id}`, "DELETE"),
      onSuccess: invalidate,
    }),
  };
}

export function useBankProfileMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate("bank-profiles");
  return {
    create: useMutation({
      mutationFn: (body: Partial<BankProfile>) =>
        unwrap(api.POST("/api/bank-profiles", { body: body as any })),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: number; body: Partial<BankProfile> }) =>
        unwrap(api.PUT("/api/bank-profiles/{profile_id}", { params: { path: { profile_id: id } }, body: body as BankProfile })),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.DELETE("/api/bank-profiles/{profile_id}", { params: { path: { profile_id: id } } }), onSuccess }),
  };
}

export function useSystemMutations() {
  const invalidate = useInvalidate();
  return {
    restore: useMutation({
      mutationFn: async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/system/restore", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: "Erreur de restauration" }));
          throw new Error(err.detail || "Erreur lors de la restauration");
        }
        return res.json();
      },
      onSuccess: () => {
        invalidate();
      },
    }),
  };
}

export function useHoldingMutations() {

  const invalidate = useInvalidate();
  const onSuccess = () => invalidate("investments");
  return {
    create: useMutation({
      mutationFn: async ({ accountId, body }: { accountId: number; body: { ticker: string; name: string; quantity: number; cost_basis_cents: number; currency?: string; asset_type?: string; added_date?: string | null; notes?: string | null } }) => {
        const res = await fetch(`/api/investments/accounts/${accountId}/holdings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to create holding");
        return res.json();
      },
      onSuccess,
    }),
    update: useMutation({
      mutationFn: async ({ holdingId, body }: { holdingId: number; body: Record<string, unknown> }) => {
        const res = await fetch(`/api/investments/holdings/${holdingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to update holding");
        return res.json();
      },
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: async (holdingId: number) => {
        const res = await fetch(`/api/investments/holdings/${holdingId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete holding");
        return res.json();
      },
      onSuccess,
    }),
  };
}

// ── Holdings Import ──────────────────────────────────────────────────────────
export interface ParsedHoldingPreview {
  ticker: string;
  name: string;
  quantity: number;
  cost_basis_cents: number;
  currency: string;
  asset_type: string;
  last_price_cents: number | null;
  isin: string | null;
  is_duplicate: boolean;
  existing_holding_id: number | null;
  existing_quantity: number | null;
  existing_cost_basis_cents: number | null;
}
export interface HoldingsImportPreviewResponse {
  format: string;
  holdings: ParsedHoldingPreview[];
  total: number;
  duplicates: number;
}
export interface HoldingImportItem {
  ticker: string;
  name: string;
  quantity: number;
  cost_basis_cents: number;
  currency: string;
  asset_type: string;
  last_price_cents: number | null;
  isin: string | null;
  duplicate_action: "skip" | "replace" | "merge";
}
export interface HoldingsImportConfirmResponse {
  created: number;
  updated: number;
  skipped: number;
}

export async function holdingsImportPreview(file: File, accountId: number): Promise<HoldingsImportPreviewResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/investments/import/preview?account_id=${accountId}`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Erreur lors de l'aperçu");
  }
  return res.json();
}

export async function holdingsImportConfirm(body: { account_id: number; holdings: HoldingImportItem[] }): Promise<HoldingsImportConfirmResponse> {
  const res = await fetch("/api/investments/import/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Erreur lors de l'import");
  return res.json();
}

// ── Holding History ──────────────────────────────────────────────────────────
export interface HistoryPoint {
  date: string;
  close: number;
}
export interface HistoryResponse {
  ticker: string;
  period: string;
  data: HistoryPoint[];
}

export function useHoldingHistory(ticker: string | null, period: string = "1y") {
  return useQuery({
    queryKey: ["holding-history", ticker, period],
    enabled: !!ticker,
    staleTime: 3600_000,
    queryFn: async () => {
      const res = await fetch(`/api/investments/history/${encodeURIComponent(ticker!)}?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json() as Promise<HistoryResponse>;
    },
  });
}

// ── Benchmark comparison ────────────────────────────────────────────────────
export interface BenchmarkInfo {
  key: string;
  ticker: string;
  name: string;
}
export interface BenchmarkPoint {
  date: string;
  pct: number;
}
export interface BenchmarkResponse {
  key: string;
  name: string;
  data: BenchmarkPoint[];
}

export function useBenchmarks() {
  return useQuery({
    queryKey: ["benchmarks"],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch("/api/investments/benchmarks");
      if (!res.ok) throw new Error("Failed to fetch benchmarks");
      return res.json() as Promise<BenchmarkInfo[]>;
    },
  });
}

export function useBenchmarkHistory(key: string | null, period: string = "1y") {
  return useQuery({
    queryKey: ["benchmark-history", key, period],
    enabled: !!key,
    staleTime: 3600_000,
    queryFn: async () => {
      const res = await fetch(`/api/investments/benchmark/${encodeURIComponent(key!)}?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch benchmark");
      return res.json() as Promise<BenchmarkResponse>;
    },
  });
}

export interface PortfolioPerformance {
  account_id: number;
  name: string;
  data: BenchmarkPoint[];
}

export function usePortfolioPerformance(accountId: number | null, period: string = "1y") {
  return useQuery({
    queryKey: ["portfolio-performance", accountId, period],
    enabled: accountId != null,
    staleTime: 3600_000,
    queryFn: async () => {
      const res = await fetch(`/api/investments/accounts/${accountId}/performance?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch portfolio performance");
      return res.json() as Promise<PortfolioPerformance>;
    },
  });
}

export function useRefreshPrices() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/investments/refresh-prices", { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh prices");
      return res.json();
    },
    onSuccess: () => invalidate("investments"),
  });
}

export interface Profile {
  id: number;
  name: string;
  color: string;
  is_default: boolean;
  enabled_modules?: string[];
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/profiles");
      if (!res.ok) throw new Error("Failed to fetch profiles");
      return res.json() as Promise<Profile[]>;
    },
  });
}

export function useActiveProfile() {
  const { data: profiles = [] } = useProfiles();
  if (typeof window === "undefined") return null;
  const storeStr = localStorage.getItem("finance-active-profile");
  let activeId: number | null = null;
  if (storeStr) {
    try {
      const parsed = JSON.parse(storeStr);
      activeId = parsed?.state?.activeProfileId ?? null;
    } catch {}
  }
  if (activeId != null) {
    const found = profiles.find((p) => p.id === activeId);
    if (found) return found;
  }
  return profiles.find((p) => p.is_default) ?? profiles[0] ?? null;
}

export function useProfileMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ["profiles"] });
  return {
    create: useMutation({
      mutationFn: async (body: { name: string; color?: string; enabled_modules?: string[] }) => {
        const res = await fetch("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error("Failed to create profile");
        return res.json() as Promise<Profile>;
      },
      onSuccess,
    }),
    update: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: { name?: string; color?: string; enabled_modules?: string[] } }) => {
        const res = await fetch(`/api/profiles/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error("Failed to update profile");
        return res.json() as Promise<Profile>;
      },
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => {
        const res = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete profile");
      },
      onSuccess,
    }),
  };
}

export interface IbkrStatus {
  configured: boolean;
  auto_sync: boolean;
  account_id: number | null;
  last_sync: string | null;
  last_status: string | null;
  min_interval_seconds: number;
}

export function useIbkrStatus() {
  return useQuery({
    queryKey: ["investments", "ibkr-status"],
    queryFn: async () => {
      const res = await fetch("/api/investments/ibkr/status");
      if (!res.ok) throw new Error("Failed to fetch IBKR status");
      return res.json() as Promise<IbkrStatus>;
    },
  });
}

// Fetches IBKR positions and returns a preview to feed HoldingsImportReview.
// Confirm reuses the existing holdingsImportConfirm.
export function useIbkrSyncPreview() {
  return useMutation({
    mutationFn: async (accountId?: number): Promise<HoldingsImportPreviewResponse> => {
      const qs = accountId ? `?account_id=${accountId}` : "";
      const res = await fetch(`/api/investments/ibkr/sync-preview${qs}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Échec de la synchronisation IBKR");
      }
      return res.json();
    },
  });
}

export function useResolveTickers() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/investments/resolve-tickers", { method: "POST" });
      if (!res.ok) throw new Error("Failed to resolve tickers");
      return res.json() as Promise<{ resolved: number }>;
    },
    onSuccess: () => invalidate("investments"),
  });
}

export function useSettingMutation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await fetch(`/api/settings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Failed to update setting");
      return res.json();
    },
    onSuccess: () => invalidate("settings", "analytics", "budget-full", "investments"),
  });
}

// ── Shared JSON fetch helper (throws backend `detail` on error) ───────────────
async function mutateJson(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail ?? "Requête échouée");
  }
  return res.status === 204 ? null : res.json();
}

// ── Goals ───────────────────────────────────────────────────────────────────
export interface Goal {
  id: number;
  name: string;
  target_amount_cents: number;
  current_amount_cents: number;
  progress_pct: number;
  deadline: string | null;
  color: string;
  icon: string;
  linked_account_id: number | null;
  is_linked: boolean;
  linked_account_name: string | null;
  monthly_needed_cents: number | null;
  projected_months: number | null;
  projected_date: string | null;
}
export interface GoalContribution {
  id: number;
  goal_id: number;
  date: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
}
export interface GoalCreate {
  name: string;
  target_amount_cents: number;
  deadline?: string | null;
  color?: string;
  icon?: string;
  linked_account_id?: number | null;
  initial_amount_cents?: number;
}
export interface GoalUpdate {
  name?: string;
  target_amount_cents?: number;
  deadline?: string | null;
  color?: string;
  icon?: string;
  linked_account_id?: number | null;
}

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: async () => {
      const res = await fetch("/api/goals");
      if (!res.ok) throw new Error("Failed to fetch goals");
      return res.json() as Promise<Goal[]>;
    },
  });
}

export function useGoalMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["goals"] });
    qc.invalidateQueries({ queryKey: ["analytics"] });
  };
  return {
    create: useMutation({ mutationFn: (body: GoalCreate) => mutateJson("/api/goals", "POST", body), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, body }: { id: number; body: GoalUpdate }) => mutateJson(`/api/goals/${id}`, "PUT", body), onSuccess: invalidate }),
    delete: useMutation({ mutationFn: (id: number) => mutateJson(`/api/goals/${id}`, "DELETE"), onSuccess: invalidate }),
  };
}

export function useGoalContributions(goalId: number | null) {
  return useQuery({
    queryKey: ["goal-contributions", goalId],
    enabled: goalId != null,
    queryFn: async () => {
      const res = await fetch(`/api/goals/${goalId}/contributions`);
      if (!res.ok) throw new Error("Failed to fetch contributions");
      return res.json() as Promise<GoalContribution[]>;
    },
  });
}

export function useGoalContributionMutations(goalId: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["goal-contributions", goalId] });
    qc.invalidateQueries({ queryKey: ["goals"] });
    qc.invalidateQueries({ queryKey: ["analytics"] });
  };
  return {
    add: useMutation({ mutationFn: (body: { date: string; amount_cents: number; note?: string | null }) => mutateJson(`/api/goals/${goalId}/contributions`, "POST", body), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (cid: number) => mutateJson(`/api/goals/${goalId}/contributions/${cid}`, "DELETE"), onSuccess: invalidate }),
  };
}

// ── Loans (amortization) ──────────────────────────────────────────────────────
export interface LoanExtraPayment {
  id: number;
  account_id: number;
  date: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
}
export interface Loan {
  id: number;
  name: string;
  bank_name: string;
  currency: string;
  color: string;
  principal_cents: number | null;
  interest_rate_pct: number | null;
  monthly_payment_cents: number;
  term_months: number | null;
  start_date: string | null;
  remaining_cents: number;
  paid_principal_cents: number;
  progress_pct: number;
  months_elapsed: number;
  months_remaining: number;
  actual_term_months: number;
  payoff_date: string | null;
  interest_total_cents: number;
  interest_paid_cents: number;
  interest_remaining_cents: number;
  extra_paid_cents: number;
  computable: boolean;
  insufficient_payment: boolean;
  extra_payments: LoanExtraPayment[];
}
export interface LoanScheduleRow {
  date: string;
  payment_cents: number;
  interest_cents: number;
  principal_cents: number;
  balance_cents: number;
}
export interface LoanSchedule extends Loan {
  account_id: number;
  schedule: LoanScheduleRow[];
}

export function useLoans() {
  return useQuery({
    queryKey: ["loans"],
    queryFn: async () => {
      const res = await fetch("/api/loans");
      if (!res.ok) throw new Error("Failed to fetch loans");
      return res.json() as Promise<Loan[]>;
    },
  });
}

export function useLoanSchedule(accountId: number | null) {
  return useQuery({
    queryKey: ["loan-schedule", accountId],
    enabled: accountId != null,
    queryFn: async () => {
      const res = await fetch(`/api/loans/${accountId}/schedule`);
      if (!res.ok) throw new Error("Failed to fetch schedule");
      return res.json() as Promise<LoanSchedule>;
    },
  });
}

export function useLoanPaymentMutations(accountId: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    ["loans", "analytics", "accounts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    qc.invalidateQueries({ queryKey: ["loan-schedule", accountId] });
  };
  return {
    add: useMutation({ mutationFn: (body: { date: string; amount_cents: number; note?: string | null }) => mutateJson(`/api/loans/${accountId}/payments`, "POST", body), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (pid: number) => mutateJson(`/api/loans/${accountId}/payments/${pid}`, "DELETE"), onSuccess: invalidate }),
  };
}
