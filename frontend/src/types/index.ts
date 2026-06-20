export interface Account {
  id: number
  name: string
  bank_name: string
  account_type: 'courant' | 'épargne' | 'investissement' | 'crédit'
  currency: string
  color: string
  is_active: boolean
  created_at: string
}

export interface Transaction {
  id: number
  account_id: number
  date: string
  description: string
  amount_cents: number
  amount_display: string
  currency: string
  category_id: number | null
  subcategory: string | null
  is_debit: boolean
  balance_after_cents: number | null
  notes: string | null
  is_manually_reviewed: boolean
  is_internal_transfer: boolean
  account_name: string | null
  import_hash: string
  import_batch_id: number | null
  created_at: string
}

export interface ImportBatch {
  id: number
  account_id: number
  account_name: string | null
  filename: string | null
  transaction_count: number
  created_at: string
}

export interface Category {
  id: number
  name: string
  parent_id: number | null
  color: string
  icon: string
  is_income: boolean
  expense_type: 'fixed' | 'variable' | null
  is_investment: boolean
  account_id: number | null
}

export interface CategoryRule {
  id: number
  conditions: Array<{field: string, operator: string, value: string}>
  category_id: number
  priority: number
  is_active: boolean
  account_id: number | null
  logic_operator: 'AND' | 'OR'
}

export interface BankProfile {
  id: number
  name: string
  column_mapping: Record<string, string>
  date_format: string
  encoding: string
  delimiter: string
  detection_fingerprint: Record<string, unknown> | null
}

export interface BudgetTableCell {
  month: string
  actual_cents: number
  expected_cents: number
}

export interface BudgetTableRow {
  category_id: number | null
  category_name: string
  category_color: string
  is_investment: boolean
  cells: BudgetTableCell[]
  total_actual_cents: number
  total_expected_cents: number
}

export interface BudgetTableResponse {
  months: string[]
  rows: BudgetTableRow[]
  column_totals_actual: number[]
  column_totals_expected: number[]
}

export interface AnalyticsSummary {
  total_income_cents: number
  total_expenses_cents: number
  net_cash_flow_cents: number
  net_worth_cents: number
  total_income_display: string
  total_expenses_display: string
  net_cash_flow_display: string
  net_worth_display: string
  last_transaction_date: string | null
}

export interface CashFlowMonth {
  month: string
  income_cents: number
  expenses_cents: number
  net_cents: number
}

export interface CategoryBreakdown {
  category_id: number | null
  category_name: string
  total_cents: number
  count: number
  percentage: number
}

export interface RecurringTransaction {
  description: string
  occurrences: number
  avg_amount_cents: number
  last_date: string
  category_id: number | null
}

export interface MLStatus {
  trained: boolean
  last_trained: string | null
  sample_count: number | null
  accuracy: number | null
}

export interface DetectResponse {
  profile: BankProfile | null
  preview: Array<{
    date: string
    description: string
    amount_cents: number
    is_debit: boolean
    balance_after_cents: number | null
  }>
  filename: string
  raw_headers: string[]
  raw_preview: string[][]
  detected: boolean
}

export interface ParsePreviewTransaction {
  date: string
  description: string
  amount_cents: number
  is_debit: boolean
  balance_after_cents: number | null
  import_hash: string
  category_id: number | null
  category_name: string | null
  is_duplicate: boolean
  categorization_source: 'rule' | 'ml' | null
}

export interface ParsePreviewResponse {
  transactions: ParsePreviewTransaction[]
  total: number
  duplicates: number
}

export interface ConfirmResponse {
  imported: number
  skipped: number
  total: number
}

export interface TransactionMeta {
  available_months: string[]
  available_banks: string[]
}

export interface AccountBalanceSnapshot {
  id: number
  account_id: number
  date: string
  amount_cents: number
  contribution_cents: number
  currency: string
  notes: string | null
  created_at: string
}

export interface ComputedBalance {
  account_id: number
  balance_cents: number
  snapshot_date: string | null
  snapshot_amount_cents: number | null
  transactions_since_snapshot_cents: number | null
}

export interface BudgetSectionRow {
  section: string
  section_label: string
  rows: BudgetTableRow[]
  section_totals: BudgetTableRow
}

export interface BudgetFullResponse {
  months: string[]
  sections: BudgetSectionRow[]
  reste_row: BudgetTableRow
  grand_total_row: BudgetTableRow
  account_id: number | null
}
