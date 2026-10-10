"""The monthly budget plan of one account: envelopes, what they realised, how
they evolve, and the unusual expenses worth asking about.

All the arithmetic is in `services/budget_plan.py`; this file loads, checks and
shapes. Everything is scoped to the active profile AND to one account."""
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import current_profile_id
from models import Account, AccountType, BudgetEnvelope, BudgetEnvelopeAmount, BudgetEnvelopeCategory
from schemas import (
    BudgetEvolutionOut, BudgetPlanIn, BudgetPlanOut, EnvelopeAmountIn, EnvelopeOut, EvolutionCell, EvolutionRow,
    UnplannedSuggestion,
)
from services import budget_plan as bp

router = APIRouter()

_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


async def _account(db: AsyncSession, pid: int, account_id: int) -> Account:
    account = (await db.execute(
        select(Account).where(Account.id == account_id, Account.profile_id == pid)
    )).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if account.account_type != AccountType.courant:
        raise HTTPException(status_code=400, detail="Le plan de budget se fait sur un compte courant.")
    return account


def _month(month: Optional[str]) -> str:
    if month is None:
        return bp.current_month()
    if not _MONTH.match(month):
        raise HTTPException(status_code=422, detail="Mois attendu au format AAAA-MM.")
    return month


def _envelope_out(e: bp.Envelope, sums: bp.AccountSums, month: str, past: list[str]) -> EnvelopeOut:
    amount = bp.amount_in_force(e.amounts, month) or 0
    extra = e.planned_extra(sums, month)
    usual, average, last = bp.history_stats(e, sums, past)
    out = EnvelopeOut(
        id=e.id, name=e.name, kind=e.kind, category_ids=e.category_ids,
        amount_cents=amount, planned_extra_cents=extra, target_cents=amount + extra,
        realised_cents=e.realised(sums, month),
        typical_cents=usual, average_cents=average, last_month_cents=last,
    )
    if e.kind == bp.UNPLANNED:
        out.ytd_provision_cents, out.ytd_realised_cents = bp.provision_year_to_date(e, sums, month)
    return out


async def _plan_out(db: AsyncSession, pid: int, account: Account, month: str,
                    envelopes: list[bp.Envelope], exists: bool) -> BudgetPlanOut:
    """One month of a plan — the saved one, or a proposal that is not saved."""
    categories = await bp.profile_categories(db, pid)
    past = bp.history_months(month, await bp.first_month_of(db, pid, account.id))
    # Far enough back for a typical month AND for the provision since January.
    first = min([*past, f"{month[:4]}-01", month])
    sums = await bp.load_sums(db, pid, account.id, first, month)
    income_ids = {cid for cid, c in categories.items() if c.is_income}
    out = bp.outside(sums, envelopes, income_ids, month)
    return BudgetPlanOut(
        account_id=account.id, currency=account.currency or "EUR", month=month, exists=exists,
        envelopes=[_envelope_out(e, sums, month, past) for e in envelopes],
        outside_spent_cents=out.spent, outside_received_cents=out.received, outside_category_ids=out.category_ids,
        unplanned_cents=sums.unplanned.get(month, 0),
    )


@router.get("", response_model=BudgetPlanOut)
async def get_plan(
    account_id: int,
    month: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """The account's plan read against one month (the current one by default)."""
    account = await _account(db, pid, account_id)
    envelopes = await bp.load_envelopes(db, pid, account.id)
    return await _plan_out(db, pid, account, _month(month), envelopes, exists=bool(envelopes))


@router.get("/proposal", response_model=BudgetPlanOut)
async def get_proposal(
    account_id: int,
    month: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """A first split to start from, with amounts read from the account's
    history. Nothing is saved: the editor shows it, the user changes it."""
    account = await _account(db, pid, account_id)
    month = _month(month)
    categories = await bp.profile_categories(db, pid)
    past = bp.history_months(month, await bp.first_month_of(db, pid, account.id))
    sums = await bp.load_sums(db, pid, account.id, min([*past, month]), month)
    unusual = await bp.unusual_expenses(db, pid, account.id, month, bp.HISTORY_MONTHS + 1, categories)
    envelopes = bp.propose(categories, account.id, sums, past, month, unusual)
    return await _plan_out(db, pid, account, month, envelopes, exists=False)


@router.get("/evolution", response_model=BudgetEvolutionOut)
async def get_evolution(
    account_id: int,
    months: int = Query(default=6, ge=2, le=24),
    month: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """The plan month by month: one row per envelope, then what it does not
    cover, then what was left. A cell has a target only for the months the
    envelope had an amount — earlier ones show what happened, uncompared."""
    account = await _account(db, pid, account_id)
    last = _month(month)
    span = bp.months_until(last, months)
    envelopes = await bp.load_envelopes(db, pid, account.id)
    categories = await bp.profile_categories(db, pid)
    income_ids = {cid for cid, c in categories.items() if c.is_income}
    sums = await bp.load_sums(db, pid, account.id, span[0], last)

    rows: list[EvolutionRow] = []
    for e in envelopes:
        rows.append(EvolutionRow(
            key="unplanned" if e.kind == bp.UNPLANNED else f"envelope-{e.id}", name=e.name, kind=e.kind,
            reference_cents=bp.amount_in_force(e.amounts, last),
            cells=[EvolutionCell(month=m, realised_cents=e.realised(sums, m), target_cents=e.target(sums, m)) for m in span],
        ))
    if not any(e.kind == bp.UNPLANNED for e in envelopes) and any(sums.unplanned.get(m, 0) for m in span):
        # Marked expenses without a provision still have to show somewhere.
        rows.append(EvolutionRow(
            key="unplanned", name=bp.PROPOSAL_NAMES[bp.UNPLANNED], kind=bp.UNPLANNED, reference_cents=None,
            cells=[EvolutionCell(month=m, realised_cents=sums.unplanned.get(m, 0), target_cents=None) for m in span],
        ))
    outs = {m: bp.outside(sums, envelopes, income_ids, m) for m in span}
    for key, name, attr in (("outside_spent", "Hors enveloppes", "spent"), ("outside_received", "Revenus hors enveloppes", "received")):
        if any(getattr(outs[m], attr) for m in span):
            rows.append(EvolutionRow(
                key=key, name=name, kind="outside", reference_cents=None,
                cells=[EvolutionCell(month=m, realised_cents=getattr(outs[m], attr), target_cents=None) for m in span],
            ))
    left = {m: bp.remainder(sums, envelopes, income_ids, m) for m in span}
    rows.append(EvolutionRow(
        key="remainder", name="Reste du mois", kind="remainder", reference_cents=left[last][1],
        cells=[EvolutionCell(month=m, realised_cents=left[m][0], target_cents=left[m][1]) for m in span],
    ))
    return BudgetEvolutionOut(
        account_id=account.id, currency=account.currency or "EUR", months=span, current_month=last, rows=rows,
    )


@router.get("/suggestions", response_model=List[UnplannedSuggestion])
async def get_suggestions(
    account_id: int,
    months: int = Query(default=2, ge=1, le=13),
    month: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Expenses of the last `months` months worth asking « imprévu ? » about.
    Only a suggestion: marking is the user's click (`is_unplanned` on the
    transaction), and so is "c'est normal"."""
    account = await _account(db, pid, account_id)
    categories = await bp.profile_categories(db, pid)
    envelope_of = {c: e.name for e in await bp.load_envelopes(db, pid, account.id) for c in e.category_ids}
    found = await bp.unusual_expenses(db, pid, account.id, _month(month), months, categories)
    return [
        UnplannedSuggestion(
            id=c.id, date=c.date, description=c.description, amount_cents=c.amount_cents,
            category_id=c.category_id, typical_cents=c.typical_cents, envelope_name=envelope_of.get(c.category_id),
        )
        for c in found
    ]


# ── Writing the plan ────────────────────────────────────────────────────────

def _check_plan(payload: BudgetPlanIn, categories: dict, account: Account, owned_ids: set[int],
                draft: bool = False) -> None:
    """Refuse a plan that would count a category twice, or on the wrong side.
    A `draft` is the editor's work in progress: a name still being typed is fine."""
    if sum(e.kind == bp.UNPLANNED for e in payload.envelopes) > 1:
        raise HTTPException(status_code=400, detail="Une seule enveloppe « Imprévus » par compte.")
    eligible = bp.eligible_categories(categories, account.id)
    seen: set[int] = set()
    for e in payload.envelopes:
        if not e.name.strip() and not draft:
            raise HTTPException(status_code=400, detail="Chaque enveloppe doit avoir un nom.")
        if e.id is not None and e.id not in owned_ids:
            raise HTTPException(status_code=404, detail="Enveloppe introuvable")
        if e.kind == bp.UNPLANNED and e.category_ids:
            raise HTTPException(status_code=400, detail="L'enveloppe « Imprévus » ne contient pas de catégories : elle reçoit les dépenses que vous marquez.")
        for category_id in e.category_ids:
            category = categories.get(category_id)
            if category is None:
                raise HTTPException(status_code=404, detail="Catégorie introuvable")
            if category_id not in eligible:
                reason = (
                    "est réservée à un autre compte" if category.account_id not in (None, account.id)
                    else "regroupe des sous-catégories : choisissez-les une par une"
                )
                raise HTTPException(status_code=400, detail=f"« {category.name} » {reason}.")
            if category_id in seen:
                raise HTTPException(status_code=400, detail=f"« {category.name} » est dans deux enveloppes.")
            seen.add(category_id)
            if bool(category.is_income) != (e.kind == bp.INCOME):
                side = "de revenus" if category.is_income else "de dépenses"
                raise HTTPException(status_code=400, detail=f"« {category.name} » est une catégorie {side} : elle ne va pas dans cette enveloppe.")


async def _set_amount(db: AsyncSession, pid: int, envelope_id: int, month: str, amount_cents: int) -> None:
    """Plan `amount_cents` from `month` on. Earlier months keep their amount."""
    row = (await db.execute(select(BudgetEnvelopeAmount).where(
        BudgetEnvelopeAmount.envelope_id == envelope_id, BudgetEnvelopeAmount.effective_from == month,
        BudgetEnvelopeAmount.profile_id == pid,
    ))).scalar_one_or_none()
    if row is None:
        db.add(BudgetEnvelopeAmount(profile_id=pid, envelope_id=envelope_id, effective_from=month, amount_cents=amount_cents))
    else:
        row.amount_cents = amount_cents


@router.post("/preview", response_model=BudgetPlanOut)
async def preview_plan(
    payload: BudgetPlanIn,
    account_id: int,
    month: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """What a plan being edited would read like — above all each envelope's
    typical month for the categories it currently holds, so the amount can be
    chosen knowingly. Saves nothing."""
    account = await _account(db, pid, account_id)
    month = _month(month)
    categories = await bp.profile_categories(db, pid)
    owned = set((await db.execute(select(BudgetEnvelope.id).where(
        BudgetEnvelope.profile_id == pid, BudgetEnvelope.account_id == account.id))).scalars())
    _check_plan(payload, categories, account, owned, draft=True)
    envelopes = [bp.Envelope(e.id, e.name, e.kind, sorted(e.category_ids), [(month, e.amount_cents)]) for e in payload.envelopes]
    return await _plan_out(db, pid, account, month, envelopes, exists=False)


@router.put("", response_model=BudgetPlanOut)
async def save_plan(
    payload: BudgetPlanIn,
    account_id: int,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Save the account's whole plan, as the editor shows it: envelopes left
    out are deleted, the others updated in place. An amount that changed is
    planned from the current month on — past months keep what was planned."""
    account = await _account(db, pid, account_id)
    month = bp.current_month()
    categories = await bp.profile_categories(db, pid)
    existing = {
        row.id: row for row in (await db.execute(select(BudgetEnvelope).where(
            BudgetEnvelope.profile_id == pid, BudgetEnvelope.account_id == account.id,
        ))).scalars()
    }
    _check_plan(payload, categories, account, set(existing))
    in_force = {e.id: bp.amount_in_force(e.amounts, month) for e in await bp.load_envelopes(db, pid, account.id)}

    # Memberships are rewritten whole; they hang off envelopes, so they go first.
    await db.execute(delete(BudgetEnvelopeCategory).where(
        BudgetEnvelopeCategory.profile_id == pid, BudgetEnvelopeCategory.account_id == account.id))
    removed = set(existing) - {e.id for e in payload.envelopes if e.id is not None}
    if removed:
        await db.execute(delete(BudgetEnvelopeAmount).where(
            BudgetEnvelopeAmount.profile_id == pid, BudgetEnvelopeAmount.envelope_id.in_(removed)))
        await db.execute(delete(BudgetEnvelope).where(
            BudgetEnvelope.profile_id == pid, BudgetEnvelope.id.in_(removed)))

    for position, e in enumerate(payload.envelopes):
        row = existing.get(e.id) if e.id is not None else None
        if row is None:
            row = BudgetEnvelope(profile_id=pid, account_id=account.id)
            db.add(row)
        row.name, row.kind, row.position = e.name.strip(), e.kind, position
        await db.flush()
        for category_id in e.category_ids:
            db.add(BudgetEnvelopeCategory(
                profile_id=pid, envelope_id=row.id, category_id=category_id, account_id=account.id))
        if in_force.get(row.id) != e.amount_cents:
            await _set_amount(db, pid, row.id, month, e.amount_cents)
    await db.commit()

    envelopes = await bp.load_envelopes(db, pid, account.id)
    return await _plan_out(db, pid, account, month, envelopes, exists=bool(envelopes))


@router.put("/envelopes/{envelope_id}/amount", status_code=204)
async def set_envelope_amount(
    envelope_id: int,
    payload: EnvelopeAmountIn,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Change one envelope's monthly amount, from the current month on."""
    envelope = (await db.execute(select(BudgetEnvelope).where(
        BudgetEnvelope.id == envelope_id, BudgetEnvelope.profile_id == pid,
    ))).scalar_one_or_none()
    if envelope is None:
        raise HTTPException(status_code=404, detail="Enveloppe introuvable")
    await _set_amount(db, pid, envelope.id, bp.current_month(), payload.amount_cents)
    await db.commit()
