from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import current_profile_id
from models import Account, AccountType, LoanExtraPayment
from schemas import LoanExtraPaymentCreate, LoanExtraPaymentOut
from services.loans import compute_amortization

router = APIRouter()


async def _extra_payments(db: AsyncSession, account_id: int) -> list[LoanExtraPayment]:
    return (await db.execute(
        select(LoanExtraPayment)
        .where(LoanExtraPayment.account_id == account_id)
        .order_by(LoanExtraPayment.date)
    )).scalars().all()


def _amortization(loan_details, extras, include_schedule: bool = False) -> dict:
    ld = loan_details
    return compute_amortization(
        principal_cents=getattr(ld, "principal_cents", None),
        annual_rate_pct=getattr(ld, "interest_rate_pct", None),
        term_months=getattr(ld, "term_months", None),
        start_date=getattr(ld, "start_date", None),
        monthly_payment_cents=getattr(ld, "monthly_payment_cents", None),
        extra_payments=[(e.date, e.amount_cents) for e in extras],
        include_schedule=include_schedule,
    )


async def _require_loan(db: AsyncSession, account_id: int, pid: int) -> Account:
    acc = (await db.execute(
        select(Account).options(selectinload(Account.loan_details))
        .where(Account.id == account_id, Account.profile_id == pid)
    )).scalar_one_or_none()
    if not acc or acc.account_type != AccountType.emprunt:
        raise HTTPException(404, "Emprunt introuvable")
    return acc


@router.get("")
async def list_loans(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    accs = (await db.execute(
        select(Account).options(selectinload(Account.loan_details))
        .where(
            Account.is_active == True,  # noqa: E712
            Account.account_type == AccountType.emprunt,
            Account.profile_id == pid,
        )
        .order_by(Account.name)
    )).scalars().all()

    out = []
    for acc in accs:
        extras = await _extra_payments(db, acc.id)
        amort = _amortization(acc.loan_details, extras)
        row = {
            "id": acc.id,
            "name": acc.name,
            "bank_name": acc.bank_name,
            "currency": acc.currency or "EUR",
            "color": acc.color,
        }
        row.update({k: v for k, v in amort.items() if k != "schedule"})
        row["extra_payments"] = [
            LoanExtraPaymentOut.model_validate(e).model_dump(mode="json") for e in extras
        ]
        out.append(row)
    return out


@router.get("/{account_id}/schedule")
async def loan_schedule(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    acc = await _require_loan(db, account_id, pid)
    extras = await _extra_payments(db, account_id)
    amort = _amortization(acc.loan_details, extras, include_schedule=True)
    return {"account_id": account_id, "currency": acc.currency or "EUR", **amort}


@router.get("/{account_id}/payments", response_model=List[LoanExtraPaymentOut])
async def list_extra_payments(account_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    await _require_loan(db, account_id, pid)
    return await _extra_payments(db, account_id)


@router.post("/{account_id}/payments", response_model=LoanExtraPaymentOut, status_code=201)
async def add_extra_payment(
    account_id: int, payload: LoanExtraPaymentCreate,
    db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id),
):
    await _require_loan(db, account_id, pid)
    pay = LoanExtraPayment(account_id=account_id, profile_id=pid, **payload.model_dump())
    db.add(pay)
    await db.commit()
    await db.refresh(pay)
    return pay


@router.delete("/{account_id}/payments/{payment_id}", status_code=204)
async def delete_extra_payment(
    account_id: int, payment_id: int,
    db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id),
):
    pay = (await db.execute(
        select(LoanExtraPayment).where(
            LoanExtraPayment.id == payment_id,
            LoanExtraPayment.account_id == account_id,
            LoanExtraPayment.profile_id == pid,
        )
    )).scalar_one_or_none()
    if not pay:
        raise HTTPException(404, "Paiement introuvable")
    await db.delete(pay)
    await db.commit()
