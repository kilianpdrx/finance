import type {
  Account, Transaction, Category, CategoryRule, BankProfile,
  AnalyticsSummary, CashFlowMonth, CategoryBreakdown, RecurringTransaction,
  MLStatus, DetectResponse, ConfirmResponse, ExchangeRate, BudgetTableResponse,
  TransactionMeta, ParsePreviewResponse, AccountBalanceSnapshot, ComputedBalance,
  BudgetFullResponse,
} from '../types'

const BASE = '/api'

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export const accounts = {
  list: () => fetchJSON<Account[]>(`${BASE}/accounts`),
  get: (id: number) => fetchJSON<Account>(`${BASE}/accounts/${id}`),
  create: (data: Omit<Account, 'id' | 'is_active' | 'created_at'>) =>
    fetchJSON<Account>(`${BASE}/accounts`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Account>) =>
    fetchJSON<Account>(`${BASE}/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetch(`${BASE}/accounts/${id}`, { method: 'DELETE' }),
}

// ── Transactions ──────────────────────────────────────────────────────────────

export interface TransactionFilters {
  account_id?: number
  category_id?: number
  date_from?: string
  date_to?: string
  search?: string
  is_debit?: boolean
  is_internal_transfer?: boolean
  bank_name?: string
  month?: string
  limit?: number
  offset?: number
}

export const transactions = {
  list: (filters: TransactionFilters = {}) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    })
    return fetchJSON<Transaction[]>(`${BASE}/transactions?${params}`)
  },
  meta: () => fetchJSON<TransactionMeta>(`${BASE}/transactions/meta`),
  get: (id: number) => fetchJSON<Transaction>(`${BASE}/transactions/${id}`),
  create: (data: Partial<Transaction>) => 
    fetchJSON<Transaction>(`${BASE}/transactions`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Transaction>) =>
    fetchJSON<Transaction>(`${BASE}/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetch(`${BASE}/transactions/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids: number[]) =>
    fetch(`${BASE}/transactions/bulk-delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }),
  bulkUpdateCategory: (ids: number[], categoryId: number | null) =>
    fetchJSON<{ updated: number }>(`${BASE}/transactions/bulk-update-category`, {
      method: 'POST', body: JSON.stringify({ ids, category_id: categoryId }),
    }),
  detectTransfers: (maxDays = 3) =>
    fetchJSON<{ detected_pairs: number }>(`${BASE}/transactions/detect-transfers?max_days=${maxDays}`, { method: 'POST' }),
  exportUrl: (filters: TransactionFilters = {}) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    })
    return `${BASE}/transactions/export?${params}`
  },
}

// ── Categories ────────────────────────────────────────────────────────────────

export const categories = {
  list: () => fetchJSON<Category[]>(`${BASE}/categories`),
  create: (data: Omit<Category, 'id'>) =>
    fetchJSON<Category>(`${BASE}/categories`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Category>) =>
    fetchJSON<Category>(`${BASE}/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number, replaceWithId?: number) => {
    const url = replaceWithId
      ? `${BASE}/categories/${id}?replace_with_id=${replaceWithId}`
      : `${BASE}/categories/${id}`
    return fetch(url, { method: 'DELETE' })
  },
  rescan: () =>
    fetchJSON<{ updated: number; total: number }>(`${BASE}/categories/rescan`, { method: 'POST' }),

  listAllRules: () => fetchJSON<CategoryRule[]>(`${BASE}/categories/rules/all`),
  listRules: (categoryId: number) =>
    fetchJSON<CategoryRule[]>(`${BASE}/categories/${categoryId}/rules`),
  createRule: (categoryId: number, data: Omit<CategoryRule, 'id'>) =>
    fetchJSON<CategoryRule>(`${BASE}/categories/${categoryId}/rules`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRule: (ruleId: number, data: Partial<CategoryRule>) =>
    fetchJSON<CategoryRule>(`${BASE}/categories/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteRule: (ruleId: number) =>
    fetch(`${BASE}/categories/rules/${ruleId}`, { method: 'DELETE' }),
  previewRule: (conditions: Array<{field: string, operator: string, value: string}>, accountId?: number) =>
    fetchJSON<Transaction[]>(`${BASE}/categories/rules/preview`, {
      method: 'POST',
      body: JSON.stringify({ conditions, account_id: accountId ?? null }),
    }),
}

// ── Upload ────────────────────────────────────────────────────────────────────

async function extractApiError(r: Response): Promise<string> {
  try {
    const text = await r.text()
    try {
      const json = JSON.parse(text)
      return json.detail || text
    } catch {
      return text || `Erreur ${r.status}`
    }
  } catch {
    return `Erreur ${r.status}`
  }
}

export const upload = {
  detect: async (file: File): Promise<DetectResponse> => {
    const form = new FormData()
    form.append('file', file)
    console.log('[upload.detect] Sending file:', file.name, file.size, 'bytes')
    const r = await fetch(`${BASE}/upload/detect`, { method: 'POST', body: form })
    if (!r.ok) {
      const msg = await extractApiError(r)
      console.error('[upload.detect] Error:', msg)
      throw new Error(msg)
    }
    const data = await r.json() as DetectResponse
    console.log('[upload.detect] Response: detected=', data.detected, 'headers=', data.raw_headers?.length)
    return data
  },
  parsePreview: async (
    file: File,
    profileId?: number,
    columnMapping?: Record<string, string>,
    dateFormat?: string,
    encoding?: string,
    delimiter?: string,
  ): Promise<ParsePreviewResponse> => {
    const form = new FormData()
    form.append('file', file)
    if (profileId !== undefined) form.append('profile_id', String(profileId))
    if (columnMapping) form.append('column_mapping', JSON.stringify(columnMapping))
    if (dateFormat) form.append('date_format', dateFormat)
    if (encoding) form.append('encoding', encoding)
    if (delimiter) form.append('delimiter', delimiter)
    console.log('[upload.parsePreview] profileId=', profileId, 'mapping=', columnMapping)
    const r = await fetch(`${BASE}/upload/parse-preview`, { method: 'POST', body: form })
    if (!r.ok) {
      const msg = await extractApiError(r)
      console.error('[upload.parsePreview] Error:', msg)
      throw new Error(msg)
    }
    const data = await r.json() as ParsePreviewResponse
    console.log('[upload.parsePreview] Got', data.total, 'transactions,', data.duplicates, 'duplicates')
    return data
  },
  confirm: async (
    file: File,
    accountId: number,
    profileId?: number,
    columnMapping?: Record<string, string>,
    dateFormat?: string,
    encoding?: string,
    delimiter?: string,
    categoryOverrides?: Record<string, number | null>,
  ): Promise<ConfirmResponse> => {
    const form = new FormData()
    form.append('file', file)
    form.append('account_id', String(accountId))
    if (profileId !== undefined) form.append('profile_id', String(profileId))
    if (columnMapping) form.append('column_mapping', JSON.stringify(columnMapping))
    if (dateFormat) form.append('date_format', dateFormat)
    if (encoding) form.append('encoding', encoding)
    if (delimiter) form.append('delimiter', delimiter)
    if (categoryOverrides) form.append('category_overrides', JSON.stringify(categoryOverrides))
    console.log('[upload.confirm] accountId=', accountId, 'profileId=', profileId)
    const r = await fetch(`${BASE}/upload/confirm`, { method: 'POST', body: form })
    if (!r.ok) {
      const msg = await extractApiError(r)
      console.error('[upload.confirm] Error:', msg)
      throw new Error(msg)
    }
    return r.json() as Promise<ConfirmResponse>
  },
  saveProfile: (data: Omit<BankProfile, 'id'>) =>
    fetchJSON<BankProfile>(`${BASE}/upload/save-profile`, { method: 'POST', body: JSON.stringify(data) }),
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface DateRange {
  date_from?: string
  date_to?: string
  account_ids?: number[]
}

export const analytics = {
  summary: (range: DateRange = {}) => {
    const params = new URLSearchParams()
    if (range.date_from) params.set('date_from', range.date_from)
    if (range.date_to) params.set('date_to', range.date_to)
    if (range.account_ids) params.set('account_ids', range.account_ids.join(','))
    return fetchJSON<AnalyticsSummary>(`${BASE}/analytics/summary?${params}`)
  },
  byCategory: (range: DateRange = {}) => {
    const params = new URLSearchParams()
    if (range.date_from) params.set('date_from', range.date_from)
    if (range.date_to) params.set('date_to', range.date_to)
    if (range.account_ids) params.set('account_ids', range.account_ids.join(','))
    return fetchJSON<CategoryBreakdown[]>(`${BASE}/analytics/by-category?${params}`)
  },
  cashFlow: (range: DateRange = {}) => {
    const params = new URLSearchParams()
    if (range.date_from) params.set('date_from', range.date_from)
    if (range.date_to) params.set('date_to', range.date_to)
    if (range.account_ids) params.set('account_ids', range.account_ids.join(','))
    return fetchJSON<CashFlowMonth[]>(`${BASE}/analytics/cash-flow?${params}`)
  },
  netWorth: (range: DateRange = {}) => {
    const params = new URLSearchParams()
    if (range.date_from) params.set('date_from', range.date_from)
    if (range.date_to) params.set('date_to', range.date_to)
    if (range.account_ids) params.set('account_ids', range.account_ids.join(','))
    return fetchJSON<Record<string, unknown>[]>(`${BASE}/analytics/net-worth?${params}`)
  },
  recurring: (accountIds?: number[]) => {
    const params = new URLSearchParams()
    if (accountIds) params.set('account_ids', accountIds.join(','))
    return fetchJSON<RecurringTransaction[]>(`${BASE}/analytics/recurring?${params}`)
  },
  budget: (months = 13) =>
    fetchJSON<BudgetTableResponse>(`${BASE}/analytics/budget?months=${months}`),
  upsertBudget: (categoryId: number | null, month: string, expectedCents: number, accountId?: number) => {
    const params = new URLSearchParams()
    if (categoryId !== null) params.set('category_id', String(categoryId))
    params.set('month', month)
    params.set('expected_amount_cents', String(expectedCents))
    if (accountId !== undefined) params.set('account_id', String(accountId))
    return fetchJSON<{ ok: boolean }>(`${BASE}/analytics/budget?${params}`, { method: 'PUT' })
  },
  budgetFull: (year?: number, accountId?: number) => {
    const params = new URLSearchParams()
    if (year) params.set('year', String(year))
    if (accountId) params.set('account_id', String(accountId))
    return fetchJSON<BudgetFullResponse>(`${BASE}/analytics/budget-full?${params}`)
  },
}

// ── ML ────────────────────────────────────────────────────────────────────────

export const ml = {
  status: () => fetchJSON<MLStatus>(`${BASE}/ml/status`),
  train: () => fetchJSON<{ accuracy: number; sample_count: number }>(`${BASE}/ml/train`, { method: 'POST' }),
}

// ── Bank Profiles ──────────────────────────────────────────────────────────────

export const bankProfiles = {
  list: () => fetchJSON<BankProfile[]>(`${BASE}/bank-profiles`),
  create: (data: Omit<BankProfile, 'id'>) =>
    fetchJSON<BankProfile>(`${BASE}/bank-profiles`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<BankProfile>) =>
    fetchJSON<BankProfile>(`${BASE}/bank-profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetch(`${BASE}/bank-profiles/${id}`, { method: 'DELETE' }),
}

// ── Account Balance Snapshots ─────────────────────────────────────────────────

export const snapshots = {
  list: (accountId: number) =>
    fetchJSON<AccountBalanceSnapshot[]>(`${BASE}/accounts/${accountId}/snapshots`),
  create: (accountId: number, data: { date: string; amount_cents: number; currency: string; notes?: string }) =>
    fetchJSON<AccountBalanceSnapshot>(`${BASE}/accounts/${accountId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (accountId: number, snapshotId: number) =>
    fetch(`${BASE}/accounts/${accountId}/snapshots/${snapshotId}`, { method: 'DELETE' }),
  computedBalance: (accountId: number) =>
    fetchJSON<ComputedBalance>(`${BASE}/accounts/${accountId}/computed-balance`),
}

// ── Settings (Exchange Rates) ─────────────────────────────────────────────────

export const settingsApi = {
  listExchangeRates: () => fetchJSON<ExchangeRate[]>(`${BASE}/settings/exchange-rates`),
  createExchangeRate: (data: { currency_code: string; rate_ten_thousandths: number }) =>
    fetchJSON<ExchangeRate>(`${BASE}/settings/exchange-rates`, { method: 'POST', body: JSON.stringify(data) }),
  updateExchangeRate: (currencyCode: string, rateTenThousandths: number) =>
    fetchJSON<ExchangeRate>(`${BASE}/settings/exchange-rates/${currencyCode}`, {
      method: 'PUT',
      body: JSON.stringify({ rate_ten_thousandths: rateTenThousandths }),
    }),
  deleteExchangeRate: (currencyCode: string) =>
    fetch(`${BASE}/settings/exchange-rates/${currencyCode}`, { method: 'DELETE' }),
}
