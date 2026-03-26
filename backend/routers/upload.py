import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, File, UploadFile, Form, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Transaction, BankProfile
from schemas import DetectResponse, ConfirmResponse, BankProfileOut, BankProfileCreate
from services.bank_detector import detect_bank
from services.csv_parser import parse_csv
from services.categorizer import categorize
from services.transfer_detector import detect_internal_transfers

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_profile_from_mapping(column_mapping: dict, date_format: str, encoding: str, delimiter: str):
    """Build a temporary BankProfile-like object from custom mapping."""
    class TempProfile:
        def __init__(self):
            self.id = None
            self.name = "Personnalisé"
            self.column_mapping = column_mapping
            self.date_format = date_format
            self.encoding = encoding
            self.delimiter = delimiter
            self.detection_fingerprint = None
    return TempProfile()


def _extract_raw_preview(file_bytes: bytes):
    """Extract raw CSV headers and first 5 rows for the column mapping UI."""
    import io as _io
    import csv as _csv

    raw_headers: list[str] = []
    raw_preview: list[list[str]] = []

    for delim in [";", ",", "\t", "|"]:
        try:
            # Try UTF-8 BOM first, then plain UTF-8
            for enc in ["utf-8-sig", "utf-8", "latin-1"]:
                try:
                    text = file_bytes.decode(enc, errors="replace")
                    reader = _csv.reader(_io.StringIO(text), delimiter=delim)
                    rows = list(reader)
                    if rows and len(rows[0]) >= 2:
                        raw_headers = [h.strip().lstrip("\ufeff") for h in rows[0]]
                        raw_preview = rows[1:6]
                        return raw_headers, raw_preview
                except Exception:
                    continue
        except Exception:
            continue

    return raw_headers, raw_preview


@router.post("/detect")
async def detect(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    file_bytes = await file.read()
    filename = file.filename or ""
    logger.info("Detect request for file: %s (%d bytes)", filename, len(file_bytes))

    raw_headers, raw_preview = _extract_raw_preview(file_bytes)
    logger.info("Raw headers extracted: %s", raw_headers)

    profile = await detect_bank(file_bytes, filename, db)

    if profile:
        try:
            transactions = parse_csv(file_bytes, profile)
            preview = [
                {
                    "date": str(t.date),
                    "description": t.description,
                    "amount_cents": t.amount_cents,
                    "is_debit": t.is_debit,
                    "balance_after_cents": t.balance_after_cents,
                }
                for t in transactions[:20]
            ]
            profile_out = BankProfileOut.model_validate(profile)
        except Exception as e:
            logger.error("parse_csv failed for detected profile '%s': %s", profile.name, e)
            preview = []
            profile_out = BankProfileOut.model_validate(profile)
    else:
        preview = []
        profile_out = None

    return {
        "profile": profile_out,
        "preview": preview,
        "filename": filename,
        "raw_headers": raw_headers,
        "raw_preview": raw_preview,
        "detected": profile is not None,
    }


@router.post("/parse-preview")
async def parse_preview(
    file: UploadFile = File(...),
    profile_id: Optional[int] = Form(None),
    column_mapping: Optional[str] = Form(None),
    date_format: Optional[str] = Form(None),
    encoding: Optional[str] = Form(None),
    delimiter: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Parse CSV and return all transactions with auto-assigned categories for review."""
    file_bytes = await file.read()
    logger.info("parse-preview: file=%s profile_id=%s", file.filename, profile_id)

    if profile_id:
        result = await db.execute(select(BankProfile).where(BankProfile.id == profile_id))
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Profil bancaire introuvable")
    elif column_mapping:
        try:
            mapping_dict = json.loads(column_mapping)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"column_mapping JSON invalide: {e}")
        profile = _build_profile_from_mapping(
            mapping_dict,
            date_format or "%d/%m/%Y",
            encoding or "utf-8",
            delimiter or ";",
        )
    else:
        profile = await detect_bank(file_bytes, file.filename or "", db)
        if not profile:
            raise HTTPException(
                status_code=400,
                detail="Aucun profil bancaire détecté. Veuillez configurer la correspondance des colonnes.",
            )

    try:
        transactions = parse_csv(file_bytes, profile)
    except Exception as e:
        logger.error("parse_csv error: %s", e)
        raise HTTPException(status_code=422, detail=str(e))

    if not transactions:
        logger.warning("parse_csv returned 0 transactions — check column mapping and date format")

    # Check which hashes already exist
    all_hashes = [t.import_hash for t in transactions]
    existing_result = await db.execute(
        select(Transaction.import_hash).where(Transaction.import_hash.in_(all_hashes))
    )
    existing_hashes = {row[0] for row in existing_result}

    from models import Category as CatModel
    cats_result = await db.execute(select(CatModel))
    cat_map = {c.id: {"name": c.name, "color": c.color} for c in cats_result.scalars()}

    result_rows = []
    for t in transactions:
        is_duplicate = t.import_hash in existing_hashes
        cat_id = t.category_id
        if cat_id is None and not is_duplicate:
            cat_id = await categorize(t.model_dump(), db)
        result_rows.append({
            "date": str(t.date),
            "description": t.description,
            "amount_cents": t.amount_cents,
            "is_debit": t.is_debit,
            "balance_after_cents": t.balance_after_cents,
            "import_hash": t.import_hash,
            "category_id": cat_id,
            "category_name": cat_map.get(cat_id, {}).get("name") if cat_id else None,
            "is_duplicate": is_duplicate,
        })

    return {
        "transactions": result_rows,
        "total": len(result_rows),
        "duplicates": sum(1 for r in result_rows if r["is_duplicate"]),
    }


@router.post("/save-profile", response_model=BankProfileOut, status_code=201)
async def save_profile(
    payload: BankProfileCreate,
    db: AsyncSession = Depends(get_db),
):
    """Save a new bank profile from the column mapping UI."""
    # Check for duplicate name
    existing = await db.execute(select(BankProfile).where(BankProfile.name == payload.name))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Un profil nommé '{payload.name}' existe déjà.",
        )
    profile = BankProfile(**payload.model_dump())
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    logger.info("Saved new bank profile: %s (id=%s)", profile.name, profile.id)
    return profile


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm(
    file: UploadFile = File(...),
    account_id: int = Form(...),
    profile_id: Optional[int] = Form(None),
    column_mapping: Optional[str] = Form(None),
    date_format: Optional[str] = Form(None),
    encoding: Optional[str] = Form(None),
    delimiter: Optional[str] = Form(None),
    category_overrides: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    file_bytes = await file.read()
    logger.info("confirm: file=%s account_id=%s profile_id=%s", file.filename, account_id, profile_id)

    overrides: dict = {}
    if category_overrides:
        try:
            overrides = json.loads(category_overrides)
        except Exception:
            pass

    if profile_id:
        result = await db.execute(select(BankProfile).where(BankProfile.id == profile_id))
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Profil bancaire introuvable")
    elif column_mapping:
        try:
            mapping_dict = json.loads(column_mapping)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"column_mapping JSON invalide: {e}")
        profile = _build_profile_from_mapping(
            mapping_dict,
            date_format or "%d/%m/%Y",
            encoding or "utf-8",
            delimiter or ";",
        )
    else:
        profile = await detect_bank(file_bytes, file.filename or "", db)
        if not profile:
            raise HTTPException(
                status_code=400,
                detail="Aucun profil bancaire détecté. Veuillez spécifier un profil ou configurer la correspondance des colonnes.",
            )

    try:
        transactions = parse_csv(file_bytes, profile)
    except Exception as e:
        logger.error("parse_csv error during confirm: %s", e)
        raise HTTPException(status_code=422, detail=str(e))

    all_hashes = [t.import_hash for t in transactions]
    existing_result = await db.execute(
        select(Transaction.import_hash).where(Transaction.import_hash.in_(all_hashes))
    )
    existing_hashes = {row[0] for row in existing_result}

    imported = 0
    skipped = 0

    for t in transactions:
        if t.import_hash in existing_hashes:
            skipped += 1
            continue

        if t.import_hash in overrides:
            cat_id = overrides[t.import_hash]
        elif t.category_id is None:
            txn_dict = t.model_dump()
            txn_dict['account_id'] = account_id
            cat_id = await categorize(txn_dict, db)
        else:
            cat_id = t.category_id

        txn = Transaction(
            account_id=account_id,
            date=t.date,
            description=t.description,
            amount_cents=t.amount_cents,
            currency=t.currency,
            category_id=cat_id,
            is_debit=t.is_debit,
            balance_after_cents=t.balance_after_cents,
            import_hash=t.import_hash,
        )
        db.add(txn)
        existing_hashes.add(t.import_hash)
        imported += 1

    await db.commit()
    logger.info("Import complete: %d imported, %d skipped (duplicates)", imported, skipped)

    # Detect internal transfers after importing
    await detect_internal_transfers(db)

    return ConfirmResponse(imported=imported, skipped=skipped, total=imported + skipped)
