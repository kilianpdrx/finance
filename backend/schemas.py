from __future__ import annotations
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


def cents_to_display(cents: int) -> str:
    """Convert integer cents to French-formatted string: 1234567 -> '12 345,67 €'"""
    negative = cents < 0
    abs_cents = abs(cents)
    euros = abs_cents // 100
    centimes = abs_cents % 100
    euros_str = f"{euros:,}".replace(",", "\u00a0")  # non-breaking space
    result = f"{euros_str},{centimes:02d} €"
    return f"-{result}" if negative else result


# ── Account ──────────────────────────────────────────────────────────────────

class AccountBase(BaseModel):
    name: str
    bank_name: str
    account_type: str = "courant"
    currency: str = "EUR"
    color: str = "#6366f1"

class AccountCreate(AccountBase):
    pass

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    bank_name: Optional[str] = None
    account_type: Optional[str] = None
    currency: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


# ── AccountBalanceSnapshot ────────────────────────────────────────────────────

class AccountBalanceSnapshotCreate(BaseModel):
    date: date
    amount_cents: int
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
    category_id: Optional[int] = None
    subcategory: Optional[str] = None
    notes: Optional[str] = None
    is_manually_reviewed: Optional[bool] = None
    is_internal_transfer: Optional[bool] = None

class TransactionOut(TransactionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_manually_reviewed: bool = False
    is_internal_transfer: bool = False
    import_hash: str
    created_at: datetime
    amount_display: Optional[str] = None
    account_name: Optional[str] = None

    @classmethod
    def from_orm_with_display(cls, obj) -> "TransactionOut":
        out = cls.model_validate(obj)
        out.amount_display = cents_to_display(obj.amount_cents)
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

class CategoryRuleCreate(CategoryRuleBase):
    pass

class CategoryRuleUpdate(BaseModel):
    conditions: Optional[List[RuleCondition]] = None
    category_id: Optional[int] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None
    account_id: Optional[int] = None

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

class AnalyticsSummary(BaseModel):
    total_income_cents: int
    total_expenses_cents: int
    net_cash_flow_cents: int
    net_worth_cents: int
    total_income_display: str
    total_expenses_display: str
    net_cash_flow_display: str
    net_worth_display: str
    last_transaction_date: Optional[str] = None

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


# ── ExchangeRate ──────────────────────────────────────────────────────────────

class ExchangeRateBase(BaseModel):
    currency_code: str
    rate_ten_thousandths: int  # 10000 = 1.0000 EUR

class ExchangeRateCreate(ExchangeRateBase):
    pass

class ExchangeRateUpdate(BaseModel):
    rate_ten_thousandths: Optional[int] = None

class ExchangeRateOut(ExchangeRateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    updated_at: datetime


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

class BudgetTableRow(BaseModel):
    category_id: Optional[int]
    category_name: str
    category_color: str
    cells: List[BudgetTableCell]
    total_actual_cents: int
    total_expected_cents: int

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


# ── ML ────────────────────────────────────────────────────────────────────────

class MLStatus(BaseModel):
    trained: bool
    last_trained: Optional[str]
    sample_count: Optional[int]
    accuracy: Optional[float]

class MLTrainResponse(BaseModel):
    accuracy: float
    sample_count: int
