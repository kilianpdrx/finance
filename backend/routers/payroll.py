"""Salaire & impôts: situations, employers, payslips read from PDFs.

Reading a PDF saves nothing (`POST /read`): the user checks the proposal, then
saves it with the file again (`POST /payslips`) — a review left unsaved leaves
no trace. Everything is scoped to the active profile; a write that names an
employer, an account or a payslip checks it belongs to that profile.

Nothing here logs a label, an amount, a file name or a document's text.
"""
import calendar
import json
from datetime import date
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import current_profile_id
from models import Document, Employer, ExchangeRate, PayrollSituation, Payslip, PayslipLabelRule, PayslipLine
from ownership import require_account
from schemas import (
    EmployerIn, EmployerOut, PayrollFxOut, PayrollSituationIn, PayrollSituationOut, PayslipIn, PayslipLabelRuleOut,
    PayslipOut, PayslipReadOut,
)
from services import fx
from services.payroll import matching, packs, reading, vocab

router = APIRouter()

MAX_FILES = 60          # a few years of payslips in one drop


def _situation_out(s: PayrollSituation) -> PayrollSituationOut:
    return PayrollSituationOut(id=s.id, from_year=s.from_year, pack=s.pack, params=s.params or {},
                               summary=packs.summary(s.pack, s.params or {}))


async def _situations(db: AsyncSession, pid: int) -> list[PayrollSituation]:
    return list((await db.execute(select(PayrollSituation).where(PayrollSituation.profile_id == pid)
                                  .order_by(PayrollSituation.from_year))).scalars())


def _in_force(situations: list[PayrollSituation], year: int) -> Optional[PayrollSituation]:
    """The latest situation that started that year or before; else the first one
    (a payslip older than every situation still needs a vocabulary)."""
    before = [s for s in situations if s.from_year <= year]
    return before[-1] if before else (situations[0] if situations else None)


async def _employer(db: AsyncSession, pid: int, employer_id: int) -> Employer:
    e = await db.get(Employer, employer_id)
    if e is None or e.profile_id != pid:
        raise HTTPException(404, "Employeur introuvable")
    return e


# ── Situations ──────────────────────────────────────────────────────────────

@router.get("/packs")
async def list_packs():
    """The situations the app knows, with their settings: the form is built from this."""
    return packs.describe()


@router.get("/situations", response_model=List[PayrollSituationOut])
async def list_situations(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    return [_situation_out(s) for s in await _situations(db, pid)]


@router.post("/situations", response_model=PayrollSituationOut)
async def save_situation(body: PayrollSituationIn, db: AsyncSession = Depends(get_db),
                         pid: int = Depends(current_profile_id)):
    """The situation from `from_year` on — replacing the one that started that year, if any."""
    try:
        params = packs.clean_params(body.pack, body.params)
    except ValueError as e:
        raise HTTPException(400, str(e))
    row = (await db.execute(select(PayrollSituation).where(
        PayrollSituation.profile_id == pid, PayrollSituation.from_year == body.from_year))).scalar_one_or_none()
    if row is None:
        row = PayrollSituation(profile_id=pid, from_year=body.from_year)
        db.add(row)
    row.pack, row.params = body.pack, params
    await db.commit()
    await db.refresh(row)
    return _situation_out(row)


@router.delete("/situations/{situation_id}", status_code=204)
async def delete_situation(situation_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    row = await db.get(PayrollSituation, situation_id)
    if row is None or row.profile_id != pid:
        raise HTTPException(404, "Situation introuvable")
    await db.delete(row)
    await db.commit()


# ── Employers ───────────────────────────────────────────────────────────────

async def _employer_out(db: AsyncSession, e: Employer) -> EmployerOut:
    count = (await db.execute(select(func.count(Payslip.id)).where(Payslip.employer_id == e.id))).scalar()
    return EmployerOut(id=e.id, name=e.name, currency=e.currency, account_id=e.account_id,
                       label_hint=e.label_hint, payslip_count=count or 0)


def _clean_employer(body: EmployerIn) -> tuple[str, str, Optional[str]]:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Donnez un nom à l'employeur.")
    currency = body.currency.strip().upper()
    if len(currency) != 3 or not currency.isalpha():
        raise HTTPException(400, "Devise attendue sous la forme CHF, EUR…")
    return name[:80], currency, (body.label_hint or "").strip()[:40] or None


@router.get("/employers", response_model=List[EmployerOut])
async def list_employers(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    rows = (await db.execute(select(Employer).where(Employer.profile_id == pid).order_by(Employer.name))).scalars()
    return [await _employer_out(db, e) for e in rows]


@router.post("/employers", response_model=EmployerOut, status_code=201)
async def create_employer(body: EmployerIn, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    name, currency, hint = _clean_employer(body)
    await require_account(db, pid, body.account_id)
    e = Employer(profile_id=pid, name=name, currency=currency, account_id=body.account_id, label_hint=hint)
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return await _employer_out(db, e)


@router.put("/employers/{employer_id}", response_model=EmployerOut)
async def update_employer(employer_id: int, body: EmployerIn, db: AsyncSession = Depends(get_db),
                          pid: int = Depends(current_profile_id)):
    e = await _employer(db, pid, employer_id)
    name, currency, hint = _clean_employer(body)
    await require_account(db, pid, body.account_id)
    if currency != e.currency and (await _employer_out(db, e)).payslip_count:
        raise HTTPException(409, "Cet employeur a des fiches de paie : sa devise ne change plus.")
    e.name, e.currency, e.account_id, e.label_hint = name, currency, body.account_id, hint
    await db.commit()
    return await _employer_out(db, e)


@router.delete("/employers/{employer_id}", status_code=204)
async def delete_employer(employer_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    e = await _employer(db, pid, employer_id)
    if (await _employer_out(db, e)).payslip_count:
        raise HTTPException(409, "Cet employeur a des fiches de paie : supprimez-les d'abord.")
    await db.execute(delete(PayslipLabelRule).where(PayslipLabelRule.employer_id == e.id))
    await db.delete(e)
    await db.commit()


# ── Reading a PDF ───────────────────────────────────────────────────────────

@router.get("/label-rules", response_model=List[PayslipLabelRuleOut])
async def list_label_rules(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """The lines the user classified, per employer: the review re-applies them
    when the employer of a payslip is changed."""
    rows = (await db.execute(select(PayslipLabelRule).where(PayslipLabelRule.profile_id == pid))).scalars()
    return [PayslipLabelRuleOut(employer_id=r.employer_id, label_key=r.label_key, kind=r.kind) for r in rows]


async def _rules(db: AsyncSession, pid: int, employer_id: Optional[int]) -> dict:
    if employer_id is None:
        return {}
    rows = (await db.execute(select(PayslipLabelRule).where(
        PayslipLabelRule.profile_id == pid, PayslipLabelRule.employer_id == employer_id))).scalars()
    return {r.label_key: r.kind for r in rows}


@router.post("/read", response_model=List[PayslipReadOut])
async def read_payslips(
    files: List[UploadFile] = File(...),
    pack: str = Query(..., description="La situation dont le vocabulaire lit les fiches"),
    employer_id: Optional[int] = Query(None, description="L'employeur à retenir quand la fiche n'imprime aucun nom connu"),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Read payslip PDFs into proposals. Saves NOTHING — not even the files.

    Each file's employer is the one whose name it prints, among this profile's;
    else `employer_id`, else none (the review asks). Its classifications read
    the lines: a second employer's payslip is never read with the first one's."""
    if pack not in packs.PACKS:
        raise HTTPException(400, "Situation inconnue.")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"{MAX_FILES} fichiers au plus à la fois.")
    if employer_id is not None:
        await _employer(db, pid, employer_id)
    names = {e.id: e.name for e in (await db.execute(select(Employer).where(Employer.profile_id == pid))).scalars()}
    rules: dict[Optional[int], dict] = {}
    out = []
    for f in files:
        data = await f.read(reading.MAX_BYTES + 1)
        digest = reading.sha256(data)
        duplicate = (await db.execute(select(Payslip.id).join(Document, Payslip.document_id == Document.id).where(
            Document.profile_id == pid, Document.sha256 == digest))).scalars().first()
        base = {"filename": f.filename or "fiche.pdf", "sha256": digest, "duplicate_payslip_id": duplicate,
                "employer_id": None, "pack": pack, "lines": [], "totals": {}, "figures": None, "checks": {},
                "period": None, "pay_date": None, "error": None}
        try:
            text = reading.text_of(data)
        except reading.ReadError as e:
            out.append(PayslipReadOut(**{**base, "error": str(e)}))
            continue
        employer = reading.find_employer(text, names) or employer_id
        if employer not in rules:
            rules[employer] = await _rules(db, pid, employer)
        p = reading.propose(text, pack, rules[employer])
        out.append(PayslipReadOut(**{
            **base, "employer_id": employer, "period": p.period, "pay_date": p.pay_date, "totals": p.totals,
            "figures": p.figures or None, "checks": p.checks, "lines": [vars(ln) for ln in p.lines],
        }))
    return out


# ── Payslips ────────────────────────────────────────────────────────────────

def _check_period(period: str) -> None:
    if len(period) != 7 or period[4] != "-" or not period[:4].isdigit() or not period[5:].isdigit() \
            or not 1 <= int(period[5:]) <= 12:
        raise HTTPException(400, "Mois attendu au format AAAA-MM.")


async def _remember(db: AsyncSession, pid: int, employer_id: int, pack: Optional[str], body: PayslipIn) -> None:
    """A kind the user chose that the vocabulary would not give is remembered
    for this employer; choosing the vocabulary's kind again forgets it."""
    existing = {r.label_key: r for r in (await db.execute(select(PayslipLabelRule).where(
        PayslipLabelRule.profile_id == pid, PayslipLabelRule.employer_id == employer_id))).scalars()}
    for line in body.lines:
        key = vocab.normalize_label(line.label)
        if not key:
            continue
        known = vocab.known_kind(pack, line.label) if pack else None
        rule = existing.get(key)
        if known == line.kind:
            if rule is not None:
                await db.delete(rule)
                existing.pop(key)
        elif rule is None:
            existing[key] = PayslipLabelRule(profile_id=pid, employer_id=employer_id, label_key=key, kind=line.kind)
            db.add(existing[key])
        else:
            rule.kind = line.kind


def _write_lines(p: Payslip, pid: int, body: PayslipIn, db: AsyncSession) -> None:
    for position, line in enumerate(body.lines):
        db.add(PayslipLine(profile_id=pid, payslip_id=p.id, position=position, label=line.label.strip()[:120],
                           kind=line.kind, base_cents=line.base_cents, rate_bp=line.rate_bp,
                           amount_cents=line.amount_cents, employer_cents=line.employer_cents))


def _set_figures(p: Payslip, body: PayslipIn) -> None:
    for name in ("gross_cents", "employee_contributions_cents", "employer_contributions_cents", "taxable_cents",
                 "withholding_cents", "withholding_rate_bp", "net_paid_cents"):
        setattr(p, name, getattr(body, name))
    p.pay_date = body.pay_date
    p.note = (body.note or "").strip()[:500] or None


async def _drop(db: AsyncSession, p: Payslip) -> None:
    """A payslip, its lines, and its PDF when no other payslip uses it."""
    document_id = p.document_id
    await db.execute(delete(PayslipLine).where(PayslipLine.payslip_id == p.id))
    await db.delete(p)
    await db.flush()
    if document_id is not None:
        used = (await db.execute(select(Payslip.id).where(Payslip.document_id == document_id))).scalars().first()
        if used is None:
            await db.execute(delete(Document).where(Document.id == document_id))


async def _payslips_out(db: AsyncSession, pid: int, rows: list[Payslip]) -> list[PayslipOut]:
    employers = {e.id: e for e in (await db.execute(select(Employer).where(Employer.profile_id == pid))).scalars()}
    lines: dict[int, list] = {}
    if rows:
        for ln in (await db.execute(select(PayslipLine).where(
                PayslipLine.payslip_id.in_([p.id for p in rows])).order_by(PayslipLine.position))).scalars():
            lines.setdefault(ln.payslip_id, []).append(ln)
    deposits = await matching.deposits(db, pid, rows, employers)
    situations = await _situations(db, pid)

    def vocab_kind(p: Payslip, label: str) -> Optional[str]:
        situation = _in_force(situations, int(p.period[:4]))
        kind = vocab.known_kind(situation.pack, label) if situation else None
        return kind if kind in vocab.KINDS else None          # a total is not a line's type

    return [PayslipOut(
        id=p.id, employer_id=p.employer_id, period=p.period, pay_date=p.pay_date, currency=p.currency,
        gross_cents=p.gross_cents, employee_contributions_cents=p.employee_contributions_cents,
        employer_contributions_cents=p.employer_contributions_cents, taxable_cents=p.taxable_cents,
        withholding_cents=p.withholding_cents, withholding_rate_bp=p.withholding_rate_bp,
        net_paid_cents=p.net_paid_cents, source=p.source, document_id=p.document_id, note=p.note,
        lines=[{"id": ln.id, "label": ln.label, "kind": ln.kind, "amount_cents": ln.amount_cents,
                "base_cents": ln.base_cents, "rate_bp": ln.rate_bp, "employer_cents": ln.employer_cents,
                "vocab_kind": vocab_kind(p, ln.label)}
               for ln in lines.get(p.id, [])],
        deposit=deposits[p.id],
    ) for p in rows]


@router.get("/payslips", response_model=List[PayslipOut])
async def list_payslips(db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    """Every payslip, oldest first, each with the deposit it was paid by."""
    rows = list((await db.execute(select(Payslip).where(Payslip.profile_id == pid)
                                  .order_by(Payslip.period, Payslip.employer_id))).scalars())
    return await _payslips_out(db, pid, rows)


def _month_end(period: str) -> date:
    """The day a month's payslip is converted at: its last day, today for the
    current month — as analytics converts its months."""
    y, m = int(period[:4]), int(period[5:7])
    return min(date(y, m, calendar.monthrange(y, m)[1]), date.today())


@router.get("/fx", response_model=PayrollFxOut)
async def payslip_rates(to: str = Query(..., pattern="^[A-Z]{3}$"), db: AsyncSession = Depends(get_db),
                        pid: int = Depends(current_profile_id)):
    """The rate of each currency and month the profile's payslips are in, to `to`:
    so payslips paid in several currencies add up in one. A month without a rate
    has `rate: null` — the page leaves those payslips out of its totals and says
    so, it never adds them unconverted."""
    pairs = (await db.execute(select(Payslip.currency, Payslip.period).distinct()
                              .where(Payslip.profile_id == pid, Payslip.currency != to))).all()
    # Stored rates start with the accounts' history (startup backfill); payslips can
    # go back years before it. Fetch what is missing in ONE request per currency —
    # not one per month, where a single failure left every other month without a rate.
    for currency in {c for c, _ in pairs}:
        months = sorted(p for c, p in pairs if c == currency)
        first = _month_end(months[0])
        stored = (await db.execute(select(func.min(ExchangeRate.date)).where(
            ExchangeRate.base_currency == currency, ExchangeRate.target_currency == to))).scalar()
        if stored is None or stored > first:
            await fx.backfill_range(db, currency, to, first.replace(day=1), stored or _month_end(months[-1]))
    cache = fx.RateCache()
    return PayrollFxOut(to=to, rates=[
        {"currency": currency, "period": period, "rate": await cache.rate(db, currency, to, _month_end(period))}
        for currency, period in sorted(pairs)
    ])


@router.post("/payslips", response_model=PayslipOut, status_code=201)
async def create_payslip(
    data: str = Form(..., description="Le PayslipIn vérifié, en JSON"),
    file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Save a payslip the user checked — with its PDF when it was read from one."""
    try:
        body = PayslipIn.model_validate(json.loads(data))
    except (ValueError, ValidationError):
        raise HTTPException(422, "Fiche de paie illisible : vérifiez les montants saisis.") from None
    _check_period(body.period)
    employer = await _employer(db, pid, body.employer_id)

    document = None
    if file is not None:
        content = await file.read(reading.MAX_BYTES + 1)
        if len(content) > reading.MAX_BYTES:
            raise HTTPException(400, "Fichier trop volumineux (5 Mo au plus).")
        if not reading.is_pdf(content):
            raise HTTPException(400, "Ce fichier n'est pas un PDF.")
        digest = reading.sha256(content)
        if (await db.execute(select(Document.id).where(Document.profile_id == pid, Document.sha256 == digest))).first():
            raise HTTPException(409, "Ce PDF est déjà enregistré.")
        document = Document(profile_id=pid, kind="payslip", filename=(file.filename or "fiche.pdf")[:200],
                            sha256=digest, size=len(content), content=content)

    existing = (await db.execute(select(Payslip).where(
        Payslip.employer_id == employer.id, Payslip.period == body.period))).scalar_one_or_none()
    if existing is not None:
        if not body.replace:
            raise HTTPException(409, f"{employer.name} a déjà une fiche de paie pour {body.period}.")
        await _drop(db, existing)

    if document is not None:
        db.add(document)
        await db.flush()
    p = Payslip(profile_id=pid, employer_id=employer.id, period=body.period, currency=employer.currency,
                source="pdf" if document is not None else "manual",
                document_id=document.id if document is not None else None)
    _set_figures(p, body)
    db.add(p)
    await db.flush()
    _write_lines(p, pid, body, db)
    situation = _in_force(await _situations(db, pid), int(body.period[:4]))
    await _remember(db, pid, employer.id, situation.pack if situation else None, body)
    await db.commit()
    return (await _payslips_out(db, pid, [p]))[0]


@router.put("/payslips/{payslip_id}", response_model=PayslipOut)
async def update_payslip(payslip_id: int, body: PayslipIn, db: AsyncSession = Depends(get_db),
                         pid: int = Depends(current_profile_id)):
    p = await db.get(Payslip, payslip_id)
    if p is None or p.profile_id != pid:
        raise HTTPException(404, "Fiche de paie introuvable")
    _check_period(body.period)
    employer = await _employer(db, pid, body.employer_id)
    clash = (await db.execute(select(Payslip.id).where(
        Payslip.employer_id == employer.id, Payslip.period == body.period, Payslip.id != p.id))).first()
    if clash:
        raise HTTPException(409, f"{employer.name} a déjà une fiche de paie pour {body.period}.")
    if employer.currency != p.currency:
        raise HTTPException(409, "Cette fiche est dans une autre devise que cet employeur.")
    p.employer_id, p.period = employer.id, body.period
    _set_figures(p, body)
    await db.execute(delete(PayslipLine).where(PayslipLine.payslip_id == p.id))
    _write_lines(p, pid, body, db)
    situation = _in_force(await _situations(db, pid), int(body.period[:4]))
    await _remember(db, pid, employer.id, situation.pack if situation else None, body)
    await db.commit()
    return (await _payslips_out(db, pid, [p]))[0]


@router.delete("/payslips/{payslip_id}", status_code=204)
async def delete_payslip(payslip_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    p = await db.get(Payslip, payslip_id)
    if p is None or p.profile_id != pid:
        raise HTTPException(404, "Fiche de paie introuvable")
    await _drop(db, p)
    await db.commit()


@router.get("/documents/{document_id}")
async def get_document(document_id: int, db: AsyncSession = Depends(get_db), pid: int = Depends(current_profile_id)):
    d = await db.get(Document, document_id)
    if d is None or d.profile_id != pid:
        raise HTTPException(404, "Document introuvable")
    return Response(d.content, media_type="application/pdf", headers={
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(d.filename)}",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    })
