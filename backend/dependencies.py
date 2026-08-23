"""Shared FastAPI dependencies — chiefly the active-profile resolver."""
from typing import Optional
from fastapi import Header, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Profile


async def current_profile_id(
    x_profile_id: Optional[int] = Header(None, alias="X-Profile-Id"),
    db: AsyncSession = Depends(get_db),
) -> int:
    """Resolve the active profile from the X-Profile-Id header.

    An absent header falls back to the default profile (so clients that don't send
    it yet keep working). A header that names a *non-existent* profile is rejected
    with 404 — it's the only data-isolation boundary, so it must fail closed rather
    than silently serving another profile's data.
    """
    if x_profile_id is not None:
        prof = await db.get(Profile, x_profile_id)
        if prof:
            return prof.id
        raise HTTPException(404, "Profil introuvable")
    default = (await db.execute(
        select(Profile).where(Profile.is_default == True).limit(1)  # noqa: E712
    )).scalar_one_or_none()
    if not default:
        default = (await db.execute(select(Profile).order_by(Profile.id).limit(1))).scalar_one_or_none()
    if not default:
        raise HTTPException(500, "No profile configured")
    return default.id
