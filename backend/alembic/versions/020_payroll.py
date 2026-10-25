"""Salaire & impôts: situations, employers, payslips and their documents

Revision ID: 020_payroll
Revises: 019_budget_lines_notes
Create Date: 2026-10-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "020_payroll"
down_revision: Union[str, None] = "019_budget_lines_notes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent throughout: init_db()'s create_all already builds all of this
    # on a fresh database. Parents before children.
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "payroll_situations" not in tables:
        op.create_table(
            "payroll_situations",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("from_year", sa.Integer(), nullable=False),
            sa.Column("pack", sa.String(), nullable=False),
            sa.Column("params", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("profile_id", "from_year", name="uq_payroll_situation_year"),
        )
    if "employers" not in tables:
        op.create_table(
            "employers",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("currency", sa.String(), nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=True),
            sa.Column("label_hint", sa.String(), nullable=True),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if "documents" not in tables:
        op.create_table(
            "documents",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("filename", sa.String(), nullable=False),
            sa.Column("sha256", sa.String(), nullable=False),
            sa.Column("size", sa.Integer(), nullable=False),
            sa.Column("content", sa.LargeBinary(), nullable=False),
            sa.Column("uploaded_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("profile_id", "sha256", name="uq_document_profile_hash"),
        )
    if "payslips" not in tables:
        op.create_table(
            "payslips",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("employer_id", sa.Integer(), nullable=False),
            sa.Column("period", sa.String(), nullable=False),
            sa.Column("pay_date", sa.Date(), nullable=True),
            sa.Column("currency", sa.String(), nullable=False),
            sa.Column("gross_cents", sa.Integer(), nullable=False),
            sa.Column("employee_contributions_cents", sa.Integer(), nullable=False),
            sa.Column("employer_contributions_cents", sa.Integer(), nullable=True),
            sa.Column("taxable_cents", sa.Integer(), nullable=True),
            sa.Column("withholding_cents", sa.Integer(), nullable=False),
            sa.Column("withholding_rate_bp", sa.Integer(), nullable=True),
            sa.Column("net_paid_cents", sa.Integer(), nullable=False),
            sa.Column("source", sa.String(), nullable=False),
            sa.Column("document_id", sa.Integer(), nullable=True),
            sa.Column("note", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["employer_id"], ["employers.id"]),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("employer_id", "period", name="uq_payslip_employer_period"),
        )
    if "payslip_lines" not in tables:
        op.create_table(
            "payslip_lines",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("payslip_id", sa.Integer(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("label", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("base_cents", sa.Integer(), nullable=True),
            sa.Column("rate_bp", sa.Integer(), nullable=True),
            sa.Column("amount_cents", sa.Integer(), nullable=False),
            sa.Column("employer_cents", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["payslip_id"], ["payslips.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if "payslip_label_rules" not in tables:
        op.create_table(
            "payslip_label_rules",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("profile_id", sa.Integer(), nullable=True),
            sa.Column("employer_id", sa.Integer(), nullable=False),
            sa.Column("label_key", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["employer_id"], ["employers.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("employer_id", "label_key", name="uq_payslip_rule_employer_label"),
        )


def downgrade() -> None:
    for table in ("payslip_label_rules", "payslip_lines", "payslips", "documents", "employers", "payroll_situations"):
        op.drop_table(table)
