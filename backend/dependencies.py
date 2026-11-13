"""Shared FastAPI dependencies — chiefly the active-profile resolver."""
from typing import Optional
from fastapi import Header, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Profile
from services.profile_pin import require_unlocked


async def current_profile_id(
    x_profile_id: Optional[int] = Header(None, alias="X-Profile-Id"),
    x_profile_unlock: Optional[str] = Header(None, alias="X-Profile-Unlock"),
    db: AsyncSession = Depends(get_db),
) -> int:
    """Resolve the active profile from the X-Profile-Id header.

    An absent header falls back to the default profile (so clients that don't send
    it yet keep working). A header that names a *non-existent* profile is rejected
    with 404 — it's the only data-isolation boundary, so it must fail closed rather
    than silently serving another profile's data.

    A profile with a PIN also needs `X-Profile-Unlock`, a token from
    `POST /profiles/{id}/unlock`: without one the answer is 401 with
    `X-Profile-Locked: <id>`, the default-profile fallback included.
    """
    if x_profile_id is not None:
        prof = await db.get(Profile, x_profile_id)
        if not prof:
            raise HTTPException(404, "Profil introuvable")
    else:
        prof = (await db.execute(
            select(Profile).where(Profile.is_default == True).limit(1)  # noqa: E712
        )).scalar_one_or_none()
        if not prof:
            prof = (await db.execute(select(Profile).order_by(Profile.id).limit(1))).scalar_one_or_none()
        if not prof:
            raise HTTPException(500, "No profile configured")
    require_unlocked(prof, x_profile_unlock)
    return prof.id
