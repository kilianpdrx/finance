from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Profile
from schemas import ProfileCreate, ProfileUpdate, ProfileOut

router = APIRouter()

# Tables that carry a profile_id and must be purged when a profile is deleted.
# Ordered so child rows are removed before the accounts they reference (FKs are
# enforced). `loan_details` has no profile_id — it's purged separately by account.
_SCOPED_TABLES = [
    "transactions", "import_batches", "holdings", "account_balance_snapshots",
    "budget_entries", "planned_expenses", "category_rules", "categories",
    "goal_contributions", "goals", "loan_extra_payments", "bank_profiles",
    "settings", "accounts",
]


@router.get("", response_model=List[ProfileOut])
async def list_profiles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).order_by(Profile.is_default.desc(), Profile.id))
    return result.scalars().all()


@router.post("", response_model=ProfileOut, status_code=201)
async def create_profile(body: ProfileCreate, db: AsyncSession = Depends(get_db)):
    p = Profile(
        name=body.name.strip() or "Profil",
        color=body.color,
        is_default=False,
        enabled_modules=body.enabled_modules,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p



@router.put("/{profile_id}", response_model=ProfileOut)
async def update_profile(profile_id: int, body: ProfileUpdate, db: AsyncSession = Depends(get_db)):
    p = await db.get(Profile, profile_id)
    if not p:
        raise HTTPException(404, "Profile not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(p, field, val)
    await db.commit()
    await db.refresh(p)
    return p


@router.delete("/{profile_id}", status_code=204)
async def delete_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    p = await db.get(Profile, profile_id)
    if not p:
        raise HTTPException(404, "Profile not found")
    count = (await db.execute(select(func.count(Profile.id)))).scalar()
    if p.is_default or count <= 1:
        raise HTTPException(400, "Impossible de supprimer le profil par défaut")
    # loan_details has no profile_id (it hangs off an account); purge it first so
    # the later `DELETE FROM accounts` doesn't hit a foreign-key violation.
    await db.execute(text(
        "DELETE FROM loan_details WHERE account_id IN "
        "(SELECT id FROM accounts WHERE profile_id = :p)"
    ), {"p": profile_id})
    # Purge all data owned by this profile, then the profile itself.
    for table in _SCOPED_TABLES:
        await db.execute(text(f"DELETE FROM {table} WHERE profile_id = :p"), {"p": profile_id})
    await db.delete(p)
    await db.commit()
