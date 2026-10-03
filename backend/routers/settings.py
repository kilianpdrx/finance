from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Setting
from services.base_currency import ALLOWED_CURRENCIES, get_base_currency

router = APIRouter()


@router.get("")
async def get_all_settings(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Setting).where(Setting.profile_id == pid))
    settings = {s.key: s.value for s in result.scalars()}
    # Always answer with the currency the profile actually reports in, even
    # before one is stored, so no client has to guess a fallback.
    settings.setdefault("base_currency", await get_base_currency(db, pid))
    return settings


@router.get("/{key}")
async def get_setting(key: str, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    result = await db.execute(select(Setting).where(Setting.key == key, Setting.profile_id == pid))
    setting = result.scalar_one_or_none()
    if not setting:
        if key == "base_currency":
            return {"key": key, "value": await get_base_currency(db, pid)}
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")
    return {"key": setting.key, "value": setting.value}


@router.put("/{key}")
async def update_setting(key: str, body: dict, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    value = body.get("value")
    if value is None:
        raise HTTPException(status_code=422, detail="Missing 'value' field")
    if key == "base_currency":
        value = str(value).strip().upper()
        if value not in ALLOWED_CURRENCIES:
            raise HTTPException(
                status_code=400,
                detail=f"Devise « {value} » inconnue. Utilisez un code ISO à 3 lettres (ex. EUR, CHF, USD).",
            )
    result = await db.execute(select(Setting).where(Setting.key == key, Setting.profile_id == pid))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = str(value)
    else:
        db.add(Setting(key=key, value=str(value), profile_id=pid))
    await db.commit()
    return {"key": key, "value": str(value)}
