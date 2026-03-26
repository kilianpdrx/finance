from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import BankProfile
from schemas import BankProfileBase, BankProfileCreate, BankProfileUpdate, BankProfileOut

router = APIRouter()


@router.get("", response_model=List[BankProfileOut])
async def list_bank_profiles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BankProfile).order_by(BankProfile.name))
    return result.scalars().all()


@router.get("/{profile_id}", response_model=BankProfileOut)
async def get_bank_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BankProfile).where(BankProfile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Bank profile not found")
    return profile


@router.post("", response_model=BankProfileOut, status_code=201)
async def create_bank_profile(payload: BankProfileCreate, db: AsyncSession = Depends(get_db)):
    profile = BankProfile(**payload.model_dump())
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


@router.put("/{profile_id}", response_model=BankProfileOut)
async def update_bank_profile(profile_id: int, payload: BankProfileUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BankProfile).where(BankProfile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Bank profile not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(profile, field, value)
    await db.commit()
    await db.refresh(profile)
    return profile


@router.delete("/{profile_id}", status_code=204)
async def delete_bank_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BankProfile).where(BankProfile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Bank profile not found")
    await db.delete(profile)
    await db.commit()
