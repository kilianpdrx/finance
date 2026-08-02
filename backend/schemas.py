from __future__ import annotations
import datetime as _dt
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


CURRENCY_SYMBOLS = {
    "EUR": "€", "CHF": "CHF", "USD": "$", "GBP": "£", "JPY": "¥", "CAD": "CA$",
}


DEFAULT_MODULES = ["banking", "budgeting", "investments", "goals", "loans"]

class ProfileCreate(BaseModel):
    name: str
    color: str = "#6366f1"
    enabled_modules: List[str] = DEFAULT_MODULES

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    enabled_modules: Optional[List[str]] = None

class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    color: str
    is_default: bool
    enabled_modules: List[str] = DEFAULT_MODULES


def cents_to_display(cents: int, currency: str = "EUR") -> str:
    """Convert integer cents to French-formatted string: 1234567 -> '12 345,67 €'"""
    negative = cents < 0
    abs_cents = abs(cents)
    euros = abs_cents // 100
    centimes = abs_cents % 100
    euros_str = f"{euros:,}".replace(",", "\u00a0")  # non-breaking space
    sym = CURRENCY_SYMBOLS.get(currency.upper(), currency) if currency else "€"
    result = f"{euros_str},{centimes:02d} {sym}"
    return f"-{result}" if negative else result


# ── Loan Details ─────────────────────────────────────────────────────────────

class LoanDetailsBase(BaseModel):
    principal_cents: Optional[int] = None
    interest_rate_pct: Optional[float] = None
    monthly_payment_cents: Optional[int] = None
    term_months: Optional[int] = None
    start_date: Optional[date] = None

class LoanDetailsCreate(LoanDetailsBase):
    pass

class LoanDetailsUpdate(LoanDetailsBase):
    pass

class LoanDetailsOut(LoanDetailsBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int

# ── Account ──────────────────────────────────────────────────────────────────

class AccountBase(BaseModel):
    name: str
    bank_name: str
    account_type: str = "courant"
    currency: str = "EUR"
    color: str = "#6366f1"

class AccountCreate(AccountBase):
    loan_details: Optional[LoanDetailsCreate] = None

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    bank_name: Optional[str] = None
    account_type: Optional[str] = None
    currency: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None
    loan_details: Optional[LoanDetailsUpdate] = None


# ── AccountBalanceSnapshot ────────────────────────────────────────────────────

class AccountBalanceSnapshotCreate(BaseModel):
    date: date
    amount_cents: int
    contribution_cents: int = 0
    currency: str = "EUR"
    notes: Optional[str] = None

class AccountBalanceSnapshotOut(AccountBalanceSnapshotCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    created_at: datetime

class AccountOut(AccountBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_active: bool
    created_at: datetime
    loan_details: Optional[LoanDetailsOut] = None

# ── Goals ────────────────────────────────────────────────────────────────────

class GoalBase(BaseModel):
    name: str
    target_amount_cents: int
    deadline: Optional[date] = None
    color: str = "#6366f1"
    icon: str = "target"
    linked_account_id: Optional[int] = None

class GoalCreate(GoalBase):
    # Optional seed for a manual goal: recorded as an initial contribution.
    initial_amount_cents: int = 0

class GoalUpdate(BaseModel):
    name: Optional[str] = None
    target_amount_cents: Optional[int] = None
    deadline: Optional[date] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    linked_account_id: Optional[int] = None

class GoalOut(GoalBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    # Computed server-side (linked-account balance, or sum of contributions).
    current_amount_cents: int = 0
    progress_pct: float = 0.0
    is_linked: bool = False
    linked_account_name: Optional[str] = None
    monthly_needed_cents: Optional[int] = None  # to reach target by the deadline
    projected_months: Optional[int] = None      # at the observed pace, months to target
    projected_date: Optional[date] = None       # calendar month the target is reached


class GoalContributionCreate(BaseModel):
    date: date
    amount_cents: int  # signed: + deposit, - withdrawal
    note: Optional[str] = None

class GoalContributionOut(GoalContributionCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    goal_id: int
    created_at: datetime


# ── Loans (amortization) ──────────────────────────────────────────────────────

class LoanExtraPaymentCreate(BaseModel):
    date: date
    amount_cents: int
    note: Optional[str] = None

class LoanExtraPaymentOut(LoanExtraPaymentCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    created_at: datetime


# ── Transaction ───────────────────────────────────────────────────────────────

class TransactionBase(BaseModel):
    account_id: int
    date: date
    description: str
    amount_cents: int
    currency: str = "EUR"
    category_id: Optional[int] = None
    subcategory: Optional[str] = None
    is_debit: bool
    balance_after_cents: Optional[int] = None
    notes: Optional[str] = None

class TransactionCreate(TransactionBase):
    import_hash: str

class TransactionCreateManual(TransactionBase):
    pass

class TransactionUpdate(BaseModel):
    # Core fields — editing any of these flags the transaction as manually edited.
    account_id: Optional[int] = None
    # NB: use the aliased type — a field literally named `date` would otherwise
    # shadow the `date` type via its `= None` default (with `from __future__
    # import annotations`), making pydantic emit a null-only schema.
    date: Optional[_dt.date] = None
    description: Optional[str] = None
    amount_cents: Optional[int] = None
    currency: Optional[str] = None
    is_debit: Optional[bool] = None
    # Classification / metadata — editing these does NOT set the edited badge.
    category_id: Optional[int] = None
    subcategory: Optional[str] = None
    notes: Optional[str] = None
    is_manually_reviewed: Optional[bool] = None
    is_internal_transfer: Optional[bool] = None

class TransactionOut(TransactionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_manually_reviewed: bool = False
    is_manually_edited: bool = False
    is_internal_transfer: bool = False
    category_conflict: bool = False  # >= 2 distinct categories match via rules
    import_hash: str
    import_batch_id: Optional[int] = None
    created_at: datetime
    amount_display: Optional[str] = None
    account_name: Optional[str] = None

    @classmethod
    def from_orm_with_display(cls, obj) -> "TransactionOut":
        out = cls.model_validate(obj)
        out.amount_display = cents_to_display(obj.amount_cents, getattr(obj, 'currency', 'EUR') or 'EUR')
        # account_name set externally if needed (avoid lazy-load issues)
        return out


# ── Category ──────────────────────────────────────────────────────────────────

class CategoryBase(BaseModel):
    name: str
    parent_id: Optional[int] = None
    color: str = "#94a3b8"
    icon: str = "tag"
    is_income: bool = False
    expense_type: Optional[str] = None
    is_investment: bool = False
    account_id: Optional[int] = None

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    is_income: Optional[bool] = None
    expense_type: Optional[str] = None
    is_investment: Optional[bool] = None
    account_id: Optional[int] = None

class CategoryOut(CategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ── CategoryRule ──────────────────────────────────────────────────────────────

class RuleCondition(BaseModel):
    field: str      # "description", "amount"
    operator: str   # "contains", "startswith", "regex", "equals", ">", "<", ">=", "<="
    value: str      # Value to match against

class CategoryRuleBase(BaseModel):
    conditions: List[RuleCondition] = []
    category_id: int
    priority: int = 100
    is_active: bool = True
    account_id: Optional[int] = None
    logic_operator: str = "AND"

class CategoryRuleCreate(CategoryRuleBase):
    pass

class CategoryRuleUpdate(BaseModel):
    conditions: Optional[List[RuleCondition]] = None
    category_id: Optional[int] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None
    account_id: Optional[int] = None
    logic_operator: Optional[str] = None

class CategoryRuleOut(CategoryRuleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ── BankProfile ───────────────────────────────────────────────────────────────

class BankProfileBase(BaseModel):
    name: str
    column_mapping: dict
    date_format: str = "%d/%m/%Y"
    encoding: str = "utf-8"
    delimiter: str = ";"
    detection_fingerprint: Optional[dict] = None

class BankProfileCreate(BankProfileBase):
    pass

class BankProfileUpdate(BaseModel):
    name: Optional[str] = None
    column_mapping: Optional[dict] = None
    date_format: Optional[str] = None
    encoding: Optional[str] = None
    delimiter: Optional[str] = None
    detection_fingerprint: Optional[dict] = None

class BankProfileOut(BankProfileBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ── Analytics ─────────────────────────────────────────────────────────────────

class CurrencyBalance(BaseModel):
    currency: str
    native_cents: int      # summed balance in the account's own currency
    converted_cents: int   # the same, converted to the profile's base currency

class AnalyticsSummary(BaseModel):
    total_income_cents: int
    total_expenses_cents: int
    net_cash_flow_cents: int
    net_worth_cents: int                      # net worth WITH loan debt subtracted
    net_worth_excl_loans_cents: int = 0       # net worth if loans are ignored
    total_loans_cents: int = 0                # outstanding loan debt (positive)
    total_income_display: str
    total_expenses_display: str
    net_cash_flow_display: str
    net_worth_display: str
    net_worth_excl_loans_display: str = ""
    total_loans_display: str = ""
    last_transaction_date: Optional[str] = None
    base_currency: str = "EUR"                # the profile's reporting currency
    net_worth_by_currency: List[CurrencyBalance] = []

class CashFlowMonth(BaseModel):
    month: str
    income_cents: int
    expenses_cents: int
    net_cents: int

class CategoryBreakdown(BaseModel):
    category_id: Optional[int]
    category_name: str
    total_cents: int
    count: int
    percentage: float

class RecurringTransaction(BaseModel):
    description: str
    occurrences: int
    avg_amount_cents: int
    last_date: date
    category_id: Optional[int]



# ── BudgetEntry ───────────────────────────────────────────────────────────────

class BudgetEntryBase(BaseModel):
    category_id: int
    month: str  # "YYYY-MM"
    expected_amount_cents: int = 0
    account_id: Optional[int] = None

class BudgetEntryCreate(BudgetEntryBase):
    pass

class BudgetEntryUpdate(BaseModel):
    expected_amount_cents: Optional[int] = None

class BudgetEntryOut(BudgetEntryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class BudgetTableCell(BaseModel):
    month: str
    actual_cents: int
    expected_cents: int
    # Planned-expense layer (forecast, separate from the manual expected adjustment).
    planned_cents: int = 0
    planned_matched: bool = False
    planned_id: Optional[int] = None

class BudgetTableRow(BaseModel):
    category_id: Optional[int]
    category_name: str
    category_color: str
    is_investment: bool = False
    cells: List[BudgetTableCell]
    total_actual_cents: int
    total_expected_cents: int

class PlannedExpenseCreate(BaseModel):
    category_id: int
    month: str  # "YYYY-MM"
    amount_cents: int
    account_id: Optional[int] = None

class PlannedExpenseRecurring(BaseModel):
    category_id: int
    start_month: str  # "YYYY-MM"
    amount_cents: int
    account_id: Optional[int] = None
    every_n_months: int = 1
    end_mode: str = "year"          # "year" | "count" | "until"
    count: Optional[int] = None     # for end_mode="count"
    end_month: Optional[str] = None  # for end_mode="until"

class PlannedExpenseUpdate(BaseModel):
    amount_cents: Optional[int] = None
    matched: Optional[bool] = None

class PlannedExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    category_id: int
    account_id: Optional[int] = None
    month: str
    amount_cents: int
    matched: bool = False


class BudgetTableResponse(BaseModel):
    months: List[str]
    rows: List[BudgetTableRow]
    column_totals_actual: List[int]
    column_totals_expected: List[int]


class BudgetSectionRow(BaseModel):
    section: str  # "revenus" | "depenses_fixes" | "depenses_variables"
    section_label: str
    rows: List[BudgetTableRow]
    section_totals: BudgetTableRow


class BudgetFullResponse(BaseModel):
    months: List[str]
    sections: List[BudgetSectionRow]
    reste_row: BudgetTableRow
    grand_total_row: BudgetTableRow
    account_id: Optional[int] = None


# ── TransactionMeta ───────────────────────────────────────────────────────────

class TransactionMeta(BaseModel):
    available_months: List[str]
    available_banks: List[str]


# ── Upload ────────────────────────────────────────────────────────────────────

class DetectResponse(BaseModel):
    profile: Optional[BankProfileOut]
    preview: List[dict]
    filename: str

class ConfirmRequest(BaseModel):
    account_id: int
    profile_id: Optional[int] = None
    column_mapping: Optional[dict] = None
    date_format: Optional[str] = None
    encoding: Optional[str] = None
    delimiter: Optional[str] = None

class ConfirmResponse(BaseModel):
    imported: int
    skipped: int
    total: int
    categorized: int = 0


# ── Holdings ─────────────────────────────────────────────────────────────────

class HoldingCreate(BaseModel):
    ticker: str
    name: str
    quantity: float
    cost_basis_cents: int
    currency: str = "USD"
    asset_type: str = "stock"
    added_date: Optional[date] = None
    notes: Optional[str] = None

class HoldingUpdate(BaseModel):
    name: Optional[str] = None
    ticker: Optional[str] = None
    isin: Optional[str] = None
    quantity: Optional[float] = None
    cost_basis_cents: Optional[int] = None
    currency: Optional[str] = None
    asset_type: Optional[str] = None
    added_date: Optional[date] = None
    notes: Optional[str] = None
    price_locked: Optional[bool] = None
    ref_price_cents: Optional[int] = None

class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    ticker: str
    name: str
    quantity: float
    cost_basis_cents: int
    currency: str
    asset_type: str
    added_date: Optional[date] = None
    notes: Optional[str] = None
    price_locked: bool = False
    current_price_cents: Optional[int] = None
    current_value_cents: Optional[int] = None
    gain_cents: Optional[int] = None
    gain_pct: Optional[float] = None
    price_currency: Optional[str] = None
    price_fetched_at: Optional[str] = None


# ── Holdings Import ──────────────────────────────────────────────────────────

class ParsedHoldingPreview(BaseModel):
    ticker: str
    name: str
    quantity: float
    cost_basis_cents: int
    currency: str
    asset_type: str
    last_price_cents: Optional[int] = None
    isin: Optional[str] = None
    is_duplicate: bool = False
    existing_holding_id: Optional[int] = None
    existing_quantity: Optional[float] = None
    existing_cost_basis_cents: Optional[int] = None

class HoldingsImportPreviewResponse(BaseModel):
    format: str
    holdings: List[ParsedHoldingPreview]
    total: int
    duplicates: int

class HoldingImportItem(BaseModel):
    ticker: str
    name: str
    quantity: float
    cost_basis_cents: int
    currency: str
    asset_type: str
    last_price_cents: Optional[int] = None
    isin: Optional[str] = None
    duplicate_action: str = "skip"  # "skip" | "replace" | "merge"

class HoldingsImportConfirmRequest(BaseModel):
    account_id: int
    holdings: List[HoldingImportItem]

class HoldingsImportConfirmResponse(BaseModel):
    created: int
    updated: int
    skipped: int
