import enum
from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, String, Boolean, Date, DateTime,
    ForeignKey, Enum, JSON, UniqueConstraint
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


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    bank_name = Column(String, nullable=False)
    account_type = Column(Enum(AccountType), nullable=False, default=AccountType.courant)
    currency = Column(String, default="EUR")
    color = Column(String, default="#6366f1")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("Transaction", back_populates="account")
    snapshots = relationship("AccountBalanceSnapshot", back_populates="account", order_by="AccountBalanceSnapshot.date")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True)
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
    import_hash = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")

    __table_args__ = (UniqueConstraint("import_hash", name="uq_import_hash"),)


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    color = Column(String, default="#94a3b8")
    icon = Column(String, default="tag")
    is_income = Column(Boolean, default=False)
    expense_type = Column(String, nullable=True)  # "fixed" | "variable" | None (for income categories)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # null = all accounts

    children = relationship("Category", back_populates="parent")
    account = relationship("Account", foreign_keys=[account_id])
    parent = relationship("Category", back_populates="children", remote_side=[id])
    transactions = relationship("Transaction", back_populates="category")
    rules = relationship("CategoryRule", back_populates="category")


class CategoryRule(Base):
    __tablename__ = "category_rules"

    id = Column(Integer, primary_key=True)
    # [{"field": "description"|"amount", "operator": "contains"|">"|etc, "value": "Achat"}, ...]
    conditions = Column(JSON, nullable=False, default=list)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    priority = Column(Integer, default=100)
    is_active = Column(Boolean, default=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # null = all accounts

    category = relationship("Category", back_populates="rules")
    account = relationship("Account", foreign_keys=[account_id])


class BankProfile(Base):
    __tablename__ = "bank_profiles"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    column_mapping = Column(JSON, nullable=False)
    date_format = Column(String, nullable=False, default="%d/%m/%Y")
    encoding = Column(String, default="utf-8")
    delimiter = Column(String, default=";")
    detection_fingerprint = Column(JSON, nullable=True)


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id = Column(Integer, primary_key=True)
    currency_code = Column(String, nullable=False, unique=True)  # e.g. "CHF", "USD"
    # rate stored as integer: 10000 = 1.0000 EUR per unit of foreign currency
    # e.g. CHF at 0.9700 EUR = 9700
    rate_ten_thousandths = Column(Integer, nullable=False, default=10000)
    updated_at = Column(DateTime, default=datetime.utcnow)


class AccountBalanceSnapshot(Base):
    __tablename__ = "account_balance_snapshots"

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    date = Column(Date, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String, default="EUR")
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account", back_populates="snapshots")


class BudgetEntry(Base):
    __tablename__ = "budget_entries"

    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    month = Column(String, nullable=False)  # "YYYY-MM"
    expected_amount_cents = Column(Integer, nullable=False, default=0)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)

    category = relationship("Category")

    __table_args__ = (UniqueConstraint("category_id", "month", "account_id", name="uq_budget_entry"),)
