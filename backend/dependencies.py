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

    Falls back to the default profile when the header is absent or invalid, so
    the app keeps working for clients that don't send it yet.
    """
    if x_profile_id is not None:
        prof = await db.get(Profile, x_profile_id)
        if prof:
            return prof.id
    default = (await db.execute(
        select(Profile).where(Profile.is_default == True).limit(1)  # noqa: E712
    )).scalar_one_or_none()
    if not default:
        default = (await db.execute(select(Profile).order_by(Profile.id).limit(1))).scalar_one_or_none()
    if not default:
        raise HTTPException(500, "No profile configured")
    return default.id
