import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, File, UploadFile, Form, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from dependencies import current_profile_id
from models import Transaction, BankProfile, Account, ImportBatch
from schemas import DetectResponse, ConfirmResponse, BankProfileOut, BankProfileCreate
from services.bank_detector import detect_bank, guess_columns, guess_confidence
from services.csv_parser import parse_csv
from services.categorizer import categorize, categorize_batch
from services.transfer_detector import detect_internal_transfers
from utils import generate_import_hash

logger = logging.getLogger(__name__)

router = APIRouter()

SQLITE_VAR_LIMIT = 900  # SQLite max variable number is 999; stay safely below


async def _find_existing_hashes(db: AsyncSession, all_hashes: list, pid: int) -> set:
    """Query existing import_hashes (within the profile) in chunks."""
    existing: set = set()
    for i in range(0, len(all_hashes), SQLITE_VAR_LIMIT):
        chunk = all_hashes[i:i + SQLITE_VAR_LIMIT]
        result = await db.execute(
            select(Transaction.import_hash).where(
                Transaction.import_hash.in_(chunk), Transaction.profile_id == pid
            )
        )
        existing.update(row[0] for row in result)
    return existing


def _acct_hashes(transactions: list, account_id: int) -> list[str]:
    """Recompute account-scoped import hashes (so identical txns in different
    accounts/profiles don't collide on the global import_hash UNIQUE), including
    the debit/credit direction so opposite-sign same-amount rows stay distinct."""
    return [generate_import_hash(str(t.date), t.description, t.amount_cents, account_id, t.is_debit) for t in transactions]


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

    # Detect encoding: try strict first, fall back to latin-1
    import chardet as _chardet
    detected_enc = _chardet.detect(file_bytes).get("encoding") or "utf-8"

    encodings_to_try = []
    # Prioritize detected encoding
    if detected_enc.lower().replace("-", "") not in ("utf8", "ascii"):
        encodings_to_try.append(detected_enc)
    encodings_to_try.extend(["utf-8-sig", "utf-8", "latin-1", "windows-1252"])

    for delim in [";", ",", "\t", "|"]:
        for enc in encodings_to_try:
            try:
                # Use strict for utf-8 so it falls through to latin-1 on bad bytes
                err_mode = "strict" if enc.lower().startswith("utf") else "replace"
                text = file_bytes.decode(enc, errors=err_mode)
                reader = _csv.reader(_io.StringIO(text), delimiter=delim)
                rows = list(reader)
                if rows and len(rows[0]) >= 2:
                    raw_headers = [h.strip().lstrip("\ufeff") for h in rows[0]]
                    raw_preview = rows[1:6]
                    return raw_headers, raw_preview
            except Exception:
                continue

    return raw_headers, raw_preview


@router.post("/detect")
async def detect(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    file_bytes = await file.read()
    filename = file.filename or ""
    logger.info("Detect request for file: %s (%d bytes)", filename, len(file_bytes))

    raw_headers, raw_preview = _extract_raw_preview(file_bytes)
    logger.info("Raw headers extracted: %s", raw_headers)

    profile = await detect_bank(file_bytes, filename, db, pid)

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

    # When no saved profile matched, offer a best-effort column mapping so the
    # manual-mapping UI can pre-select the likely field for each column.
    column_guesses = guess_columns(raw_headers) if (profile is None and raw_headers) else {}

    return {
        "profile": profile_out,
        "preview": preview,
        "filename": filename,
        "raw_headers": raw_headers,
        "raw_preview": raw_preview,
        "detected": profile is not None,
        "column_guesses": column_guesses,
        "confidence": guess_confidence(column_guesses),
    }


@router.post("/parse-preview")
async def parse_preview(
    file: UploadFile = File(...),
    profile_id: Optional[int] = Form(None),
    account_id: Optional[int] = Form(None),
    column_mapping: Optional[str] = Form(None),
    date_format: Optional[str] = Form(None),
    encoding: Optional[str] = Form(None),
    delimiter: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Parse CSV and return all transactions with auto-assigned categories for review."""
    file_bytes = await file.read()
    logger.info("parse-preview: file=%s profile_id=%s", file.filename, profile_id)

    if profile_id:
        result = await db.execute(select(BankProfile).where(BankProfile.id == profile_id, BankProfile.profile_id == pid))
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
        profile = await detect_bank(file_bytes, file.filename or "", db, pid)
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

    # Account-scoped hashes when the destination account is known (matches confirm).
    hashes = _acct_hashes(transactions, account_id) if account_id is not None else [t.import_hash for t in transactions]
    existing_hashes = await _find_existing_hashes(db, hashes, pid)

    from models import Category as CatModel
    cats_result = await db.execute(select(CatModel).where(CatModel.profile_id == pid))
    cat_map = {c.id: {"name": c.name, "color": c.color} for c in cats_result.scalars()}

    # Batch categorize uncategorized transactions to avoid N+1 queries
    uncat_txns = []
    for t, h in zip(transactions, hashes):
        if t.category_id is None and h not in existing_hashes:
            uncat_txns.append(t.model_dump())

    categorized_pairs = await categorize_batch(uncat_txns, db, pid)
    cat_iter = iter(categorized_pairs)

    result_rows = []
    seen_hashes: set = set()  # Track intra-file duplicates
    for t, h in zip(transactions, hashes):
        is_duplicate = h in existing_hashes or h in seen_hashes
        seen_hashes.add(h)
        cat_id = t.category_id
        cat_source = None
        if cat_id is None and not is_duplicate:
            cat_id, cat_source = next(cat_iter, (None, None))
        result_rows.append({
            "date": str(t.date),
            "description": t.description,
            "amount_cents": t.amount_cents,
            "is_debit": t.is_debit,
            "balance_after_cents": t.balance_after_cents,
            "import_hash": h,
            "category_id": cat_id,
            "category_name": cat_map.get(cat_id, {}).get("name") if cat_id else None,
            "is_duplicate": is_duplicate,
            "categorization_source": cat_source,
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
    pid: int = Depends(current_profile_id),
):
    """Save or update a bank profile from the column mapping UI."""
    existing = await db.execute(select(BankProfile).where(BankProfile.name == payload.name, BankProfile.profile_id == pid))
    profile = existing.scalar_one_or_none()
    if profile:
        # Update existing profile
        for field, value in payload.model_dump().items():
            if field != "name":
                setattr(profile, field, value)
        await db.commit()
        await db.refresh(profile)
        logger.info("Updated bank profile: %s (id=%s)", profile.name, profile.id)
    else:
        profile = BankProfile(**payload.model_dump(), profile_id=pid)
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
    force_import_hashes: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    file_bytes = await file.read()
    logger.info("confirm: file=%s account_id=%s profile_id=%s", file.filename, account_id, profile_id)

    overrides: dict = {}
    if category_overrides:
        try:
            overrides = json.loads(category_overrides)
        except Exception:
            pass

    force_hashes: set = set()
    if force_import_hashes:
        try:
            force_hashes = set(json.loads(force_import_hashes))
        except Exception:
            pass

    if profile_id:
        result = await db.execute(select(BankProfile).where(BankProfile.id == profile_id, BankProfile.profile_id == pid))
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
        profile = await detect_bank(file_bytes, file.filename or "", db, pid)
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

    # Determine the account's currency (scoped to the active profile).
    acc_result = await db.execute(select(Account).where(Account.id == account_id, Account.profile_id == pid))
    acc_obj = acc_result.scalar_one_or_none()
    if not acc_obj:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    account_currency = acc_obj.currency or "EUR"

    # Account-scoped hashes so identical txns across profiles/accounts never collide.
    hashes = _acct_hashes(transactions, account_id)
    existing_hashes = await _find_existing_hashes(db, hashes, pid)

    # Create import batch
    batch = ImportBatch(
        account_id=account_id,
        profile_id=pid,
        filename=file.filename,
        transaction_count=0,
    )
    db.add(batch)
    await db.flush()  # get batch.id

    imported = 0
    skipped = 0
    categorized = 0

    import hashlib as _hl
    import time as _time

    # Pre-categorize all uncategorized items in batch
    uncat_txns = []
    for t, h in zip(transactions, hashes):
        if (h not in existing_hashes or h in force_hashes) and h not in overrides and t.category_id is None:
            txn_dict = t.model_dump()
            txn_dict['account_id'] = account_id
            uncat_txns.append(txn_dict)

    categorized_pairs = await categorize_batch(uncat_txns, db, pid)
    cat_iter = iter(categorized_pairs)

    for t, h in zip(transactions, hashes):
        is_forced_dup = h in existing_hashes and h in force_hashes
        if h in existing_hashes and h not in force_hashes:
            skipped += 1
            continue

        if h in overrides:
            cat_id = overrides[h]
        elif t.category_id is None:
            cat_tuple = next(cat_iter, (None, None))
            cat_id = cat_tuple[0]
        else:
            cat_id = t.category_id


        # For force-imported duplicates, generate a unique hash
        final_hash = h
        if is_forced_dup:
            final_hash = _hl.sha256(f"{h}|force|{_time.time_ns()}".encode()).hexdigest()

        txn = Transaction(
            account_id=account_id,
            profile_id=pid,
            date=t.date,
            description=t.description,
            amount_cents=t.amount_cents,
            currency=account_currency,
            category_id=cat_id,
            is_debit=t.is_debit,
            balance_after_cents=t.balance_after_cents,
            import_batch_id=batch.id,
            import_hash=final_hash,
        )
        db.add(txn)
        existing_hashes.add(final_hash)
        imported += 1
        if cat_id is not None:
            categorized += 1

    batch.transaction_count = imported
    if imported == 0:
        await db.delete(batch)
    await db.commit()
    logger.info("Import complete: %d imported, %d skipped (duplicates)", imported, skipped)

    # Detect internal transfers after importing (scoped to the profile)
    await detect_internal_transfers(db, pid)

    return ConfirmResponse(imported=imported, skipped=skipped, total=imported + skipped, categorized=categorized)
