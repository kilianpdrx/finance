from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from database import get_db
from models import ExchangeRate
from schemas import ExchangeRateCreate, ExchangeRateUpdate, ExchangeRateOut

router = APIRouter()


@router.get("/exchange-rates", response_model=List[ExchangeRateOut])
async def list_exchange_rates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExchangeRate).order_by(ExchangeRate.currency_code))
    return result.scalars().all()


@router.post("/exchange-rates", response_model=ExchangeRateOut, status_code=201)
async def create_exchange_rate(payload: ExchangeRateCreate, db: AsyncSession = Depends(get_db)):
    # Check if already exists
    existing = await db.execute(
        select(ExchangeRate).where(ExchangeRate.currency_code == payload.currency_code.upper())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Exchange rate for this currency already exists")
    rate = ExchangeRate(
        currency_code=payload.currency_code.upper(),
        rate_ten_thousandths=payload.rate_ten_thousandths,
    )
    db.add(rate)
    await db.commit()
    await db.refresh(rate)
    return rate


@router.put("/exchange-rates/{currency_code}", response_model=ExchangeRateOut)
async def update_exchange_rate(
    currency_code: str,
    payload: ExchangeRateUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExchangeRate).where(ExchangeRate.currency_code == currency_code.upper())
    )
    rate = result.scalar_one_or_none()
    if not rate:
        raise HTTPException(status_code=404, detail="Exchange rate not found")
    if payload.rate_ten_thousandths is not None:
        rate.rate_ten_thousandths = payload.rate_ten_thousandths
    rate.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(rate)
    return rate


@router.delete("/exchange-rates/{currency_code}", status_code=204)
async def delete_exchange_rate(currency_code: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExchangeRate).where(ExchangeRate.currency_code == currency_code.upper())
    )
    rate = result.scalar_one_or_none()
    if not rate:
        raise HTTPException(status_code=404, detail="Exchange rate not found")
    await db.delete(rate)
    await db.commit()
