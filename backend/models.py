import enum
from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, Float, String, Boolean, Date, DateTime,
    ForeignKey, Enum, JSON, UniqueConstraint, Index
)
from sqlalchemy.orm import relationship
from database import Base


class AccountType(str, enum.Enum):
    courant = "courant"
    epargne = "épargne"
    investissement = "investissement"
    credit = "crédit"


class MatchType(str, enum.Enum):
    contains = "contains"
    startswith = "startswith"
    regex = "regex"


class Profile(Base):
    """A user profile (e.g. "Moi", "Maman"). All user data is scoped to one profile."""
    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    color = Column(String, default="#6366f1")
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    name = Column(String, nullable=False)
    bank_name = Column(String, nullable=False)
    account_type = Column(Enum(AccountType), nullable=False, default=AccountType.courant)
    currency = Column(String, default="EUR")
    color = Column(String, default="#6366f1")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("Transaction", back_populates="account")
    snapshots = relationship("AccountBalanceSnapshot", back_populates="account", order_by="AccountBalanceSnapshot.date")


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    filename = Column(String, nullable=True)
    transaction_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account")
    transactions = relationship("Transaction", back_populates="import_batch")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    date = Column(Date, nullable=False)
    description = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String, default="EUR")
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    subcategory = Column(String, nullable=True)
    is_debit = Column(Boolean, nullable=False)
    balance_after_cents = Column(Integer, nullable=True)
    notes = Column(String, nullable=True)
    is_manually_reviewed = Column(Boolean, default=False)
    is_internal_transfer = Column(Boolean, default=False)
    transfer_pair_id = Column(Integer, ForeignKey("transactions.id"), nullable=True)
    import_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)
    import_hash = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")
    import_batch = relationship("ImportBatch", back_populates="transactions")

    __table_args__ = (
        UniqueConstraint("import_hash", name="uq_import_hash"),
        Index("ix_transactions_date", "date"),
        Index("ix_transactions_account_date", "account_id", "date"),
        Index("ix_transactions_category", "category_id"),
    )


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    name = Column(String, nullable=False)
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    color = Column(String, default="#94a3b8")
    icon = Column(String, default="tag")
    is_income = Column(Boolean, default=False)
    expense_type = Column(String, nullable=True)  # "fixed" | "variable" | None (for income categories)
    is_investment = Column(Boolean, default=False)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # null = all accounts

    children = relationship("Category", back_populates="parent")
    account = relationship("Account", foreign_keys=[account_id])
    parent = relationship("Category", back_populates="children", remote_side=[id])
    transactions = relationship("Transaction", back_populates="category")
    rules = relationship("CategoryRule", back_populates="category")


class CategoryRule(Base):
    __tablename__ = "category_rules"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    # [{"field": "description"|"amount", "operator": "contains"|">"|etc, "value": "Achat"}, ...]
    conditions = Column(JSON, nullable=False, default=list)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    priority = Column(Integer, default=100)
    is_active = Column(Boolean, default=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # null = all accounts
    logic_operator = Column(String, default="AND")  # "AND" or "OR"

    category = relationship("Category", back_populates="rules")
    account = relationship("Account", foreign_keys=[account_id])


class BankProfile(Base):
    __tablename__ = "bank_profiles"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    name = Column(String, nullable=False)
    column_mapping = Column(JSON, nullable=False)
    date_format = Column(String, nullable=False, default="%d/%m/%Y")
    encoding = Column(String, default="utf-8")
    delimiter = Column(String, default=";")
    detection_fingerprint = Column(JSON, nullable=True)



class AccountBalanceSnapshot(Base):
    __tablename__ = "account_balance_snapshots"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    date = Column(Date, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    contribution_cents = Column(Integer, nullable=True, default=0)
    currency = Column(String, default="EUR")
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account", back_populates="snapshots")


class BudgetEntry(Base):
    __tablename__ = "budget_entries"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    month = Column(String, nullable=False)  # "YYYY-MM"
    expected_amount_cents = Column(Integer, nullable=False, default=0)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)

    category = relationship("Category")

    __table_args__ = (UniqueConstraint("category_id", "month", "account_id", name="uq_budget_entry"),)


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id = Column(Integer, primary_key=True)
    base_currency = Column(String, nullable=False)
    target_currency = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    rate = Column(Float, nullable=False)
    fetched_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("base_currency", "target_currency", "date", name="uq_exchange_rate"),
        Index("ix_exchange_rate_lookup", "base_currency", "target_currency", "date"),
    )


class Setting(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    key = Column(String, nullable=False)
    value = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint("profile_id", "key", name="uq_setting_profile_key"),)


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    ticker = Column(String, nullable=False)
    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    cost_basis_cents = Column(Integer, nullable=False)
    currency = Column(String, default="USD")
    asset_type = Column(String, default="stock")
    added_date = Column(Date, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Broker-provided reference (from CSV import): used to validate the live Yahoo
    # symbol and as a fallback price when no correct live quote is available.
    isin = Column(String, nullable=True)
    ref_price_cents = Column(Integer, nullable=True)
    ref_price_date = Column(Date, nullable=True)

    account = relationship("Account")

    __table_args__ = (
        UniqueConstraint("account_id", "ticker", name="uq_holding_account_ticker"),
    )


class PriceCache(Base):
    __tablename__ = "price_cache"

    id = Column(Integer, primary_key=True)
    ticker = Column(String, unique=True, nullable=False)
    price_cents = Column(Integer, nullable=False)
    currency = Column(String, nullable=False)
    fetched_at = Column(DateTime, nullable=False)
    # "live" = real yfinance/crypto quote; "ref" = broker fallback price.
    source = Column(String, default="live")


class DividendCache(Base):
    """Cached dividend data fetched from yfinance for each ticker."""
    __tablename__ = "dividend_cache"

    id = Column(Integer, primary_key=True)
    ticker = Column(String, unique=True, nullable=False)
    yield_pct = Column(Float, nullable=True)           # e.g. 2.5 for 2.5%
    annual_rate = Column(Float, nullable=True)          # e.g. 1.20 for $1.20/share
    currency = Column(String, nullable=True)            # dividend currency
    ex_date = Column(Date, nullable=True)               # next ex-dividend date
    frequency = Column(String, nullable=True)           # "monthly", "quarterly", "semi-annual", "annual"
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    payout_ratio = Column(Float, nullable=True)         # e.g. 0.45 for 45%
    five_year_avg_yield = Column(Float, nullable=True)  # e.g. 2.3 for 2.3%
    growth_rate_5y = Column(Float, nullable=True)       # 5-year CAGR, e.g. 8.5 for 8.5%
    last_dividend_value = Column(Float, nullable=True)  # last payment per share
    last_dividend_date = Column(Date, nullable=True)
    dividend_date = Column(Date, nullable=True)         # next payment date
    sector = Column(String, nullable=True)
    industry = Column(String, nullable=True)


class DividendHistory(Base):
    """Historical dividend payments per ticker (shared market data)."""
    __tablename__ = "dividend_history"

    id = Column(Integer, primary_key=True)
    ticker = Column(String, nullable=False, index=True)
    payment_date = Column(Date, nullable=False)
    amount = Column(Float, nullable=False)              # per-share amount in stock currency


class IsinTicker(Base):
    """Persistent ISIN→Yahoo-symbol lookup ("big slow memory").

    Resolved once (from the seed map or a validated Yahoo search) and reused
    across restarts so we never re-run the expensive ISIN search for a known ISIN.
    Stores no prices — only the symbol resolution.
    """
    __tablename__ = "isin_ticker"

    id = Column(Integer, primary_key=True)
    isin = Column(String, unique=True, nullable=False)
    ticker = Column(String, nullable=False)
    name = Column(String, nullable=True)
    currency = Column(String, nullable=True)
    source = Column(String, default="seed")  # "seed" | "resolved"
    updated_at = Column(DateTime, default=datetime.utcnow)
