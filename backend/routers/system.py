import os
import signal
import subprocess
import threading
import time
import logging

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter()

# Ports used by the app: frontend (Next.js dev 3000) and backend (8000).
_APP_PORTS = (3000, 8000)


# Only processes whose command line looks like this app's own servers may be
# signalled. Without this check a stray dev server (or anything else) that happens
# to hold port 3000/8000 would be SIGKILLed by the Quit button.
_OWN_PROCESS_MARKERS = ("uvicorn", "main:app", "next", "node")


def _is_app_process(pid: int) -> bool:
    """True when `pid`'s command line identifies it as this app's frontend/backend."""
    try:
        out = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True, text=True, timeout=5,
        )
    except Exception:
        return False
    cmd = out.stdout.strip().lower()
    if not cmd:
        return False
    return any(marker in cmd for marker in _OWN_PROCESS_MARKERS)


def _pids_on_port(port: int) -> set[int]:
    """PIDs listening on `port` that are recognisably ours (see _is_app_process)."""
    try:
        out = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}"],
            capture_output=True, text=True, timeout=5,
        )
    except Exception:
        return set()
    pids = set()
    for line in out.stdout.split():
        try:
            pid = int(line)
        except ValueError:
            continue
        if _is_app_process(pid):
            pids.add(pid)
        else:
            logger.info("Shutdown: leaving unrelated process %s on a shared port alone", pid)
    return pids


def _shutdown_worker() -> None:
    """Free all app ports, then terminate the backend (and its reloader parent)."""
    time.sleep(0.4)  # let the HTTP response flush to the client first

    targets: set[int] = set()
    for port in _APP_PORTS:
        targets |= _pids_on_port(port)

    # Under `uvicorn --reload`, this process is the worker; its parent is the
    # reloader that would otherwise respawn it. Kill both so port 8000 frees.
    targets.add(os.getppid())
    targets.add(os.getpid())

    # Graceful first.
    for pid in targets:
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass

    time.sleep(1.5)

    # Force-kill anything of ours still holding a port.
    remaining: set[int] = set()
    for port in _APP_PORTS:
        remaining |= _pids_on_port(port)
    remaining.add(os.getpid())
    remaining.discard(0)
    for pid in remaining:
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


@router.post("/shutdown")
async def shutdown():
    """Stop both servers cleanly and free ports 3000/8000.

    Spawns a background thread so this request can return before the process
    is killed; the client uses the response to show a "stopped" state.
    """
    logger.info("Shutdown requested via API — stopping servers and freeing ports.")
    threading.Thread(target=_shutdown_worker, daemon=True).start()
    return {"stopping": True, "ports": list(_APP_PORTS)}


# ── Backup & Restore & Export ──────────────────────────────────────────────────

import io
import csv
import asyncio
from datetime import datetime, date as _date
from pathlib import Path
from fastapi import Depends, HTTPException, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, DB_PATH, engine
from dependencies import current_profile_id
from models import Transaction, Account, Category
from utils import csv_safe_cell

# Upper bound on an uploaded restore file (defensive: avoids reading an
# unbounded upload fully into memory).
MAX_RESTORE_BYTES = 200 * 1024 * 1024  # 200 MB

# Each restore snapshots the database it replaces. Keep a few for safety, but
# don't let full DB copies pile up next to the live file forever.
PRE_RESTORE_KEEP = 3


def _prune_pre_restore_snapshots(keep: int = PRE_RESTORE_KEEP) -> None:
    """Delete all but the newest `keep` finance.pre-restore-*.db snapshots.

    The filenames are timestamped (…-YYYYmmdd-HHMMSS.db), so sorting by name is
    chronological. Best-effort: a failure here must never fail the restore."""
    try:
        snaps = sorted(DB_PATH.parent.glob("finance.pre-restore-*.db"))
        for old in snaps[:-keep] if keep > 0 else snaps:
            old.unlink(missing_ok=True)
            logger.info("Pruned old pre-restore snapshot %s", old.name)
    except Exception as e:
        logger.warning("Could not prune pre-restore snapshots: %s", e)


@router.get("/backup")
async def download_backup(db: AsyncSession = Depends(get_db)):
    """Checkpoint SQLite WAL log and stream data/finance.db as a backup file."""
    if not DB_PATH.exists():
        raise HTTPException(status_code=444, detail="Base de données introuvable")

    try:
        # Flush pending WAL log pages to main database file
        await db.execute(text("PRAGMA wal_checkpoint(TRUNCATE);"))
    except Exception as e:
        logger.warning("WAL checkpoint during backup warning: %s", e)

    filename = f"finance-backup-{datetime.now().strftime('%Y-%m-%d')}.sqlite"
    return FileResponse(
        path=str(DB_PATH),
        filename=filename,
        media_type="application/x-sqlite3",
    )


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Restore database from an uploaded SQLite backup file.

    Hardened flow: read with a size cap, validate the magic header AND a full
    ``PRAGMA integrity_check`` on the uploaded file in a temp location, keep a
    timestamped copy of the current DB, then atomically swap the new one in.
    """
    import sqlite3
    import shutil

    # 1. Read with a size cap (chunked, so an oversized upload can't exhaust memory).
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf += chunk
        if len(buf) > MAX_RESTORE_BYTES:
            raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 200 Mo).")
    content = bytes(buf)
    if not content.startswith(b"SQLite format 3\x00"):
        raise HTTPException(
            status_code=400,
            detail="Fichier invalide : il ne s'agit pas d'un fichier de base de données SQLite valide.",
        )

    # 2. Stage to a temp file and run a full integrity check (read-only) before
    #    we touch the live database.
    tmp_path = DB_PATH.with_name(DB_PATH.name + ".restore.tmp")

    def _rm_tmp() -> None:
        # Opening the temp DB for the integrity check may spawn -wal/-shm sidecars;
        # remove the temp file and any sidecars so nothing is left behind.
        for suffix in ("", "-wal", "-shm"):
            Path(f"{tmp_path}{suffix}").unlink(missing_ok=True)

    try:
        with open(tmp_path, "wb") as f:
            f.write(content)
        con = sqlite3.connect(f"file:{tmp_path}?mode=ro", uri=True)
        try:
            result = con.execute("PRAGMA integrity_check").fetchone()
        finally:
            con.close()
        if not result or result[0] != "ok":
            raise HTTPException(status_code=400, detail="La sauvegarde est corrompue (échec du contrôle d'intégrité).")
    except HTTPException:
        _rm_tmp()
        raise
    except Exception as e:
        _rm_tmp()
        logger.error("Restore validation failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Fichier SQLite illisible : {e}")

    # 3. Flush & dispose the active pool, snapshot the current DB, then atomically swap.
    try:
        await db.execute(text("PRAGMA wal_checkpoint(TRUNCATE);"))
    except Exception:
        pass
    await engine.dispose()

    try:
        if DB_PATH.exists():
            prev = DB_PATH.with_name(f"finance.pre-restore-{datetime.now():%Y%m%d-%H%M%S}.db")
            shutil.copy2(DB_PATH, prev)
            logger.info("Saved pre-restore snapshot to %s", prev.name)
            _prune_pre_restore_snapshots()
        # Drop the temp file's integrity-check sidecars before swapping it in.
        for suffix in ("-wal", "-shm"):
            Path(f"{tmp_path}{suffix}").unlink(missing_ok=True)
        os.replace(tmp_path, DB_PATH)  # atomic on the same filesystem
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{DB_PATH}{suffix}")
            if sidecar.exists():
                sidecar.unlink()
    except Exception as e:
        _rm_tmp()
        logger.error("Failed to swap in restored database: %s", e)
        raise HTTPException(status_code=500, detail=f"Erreur lors du remplacement : {e}")

    # 4. Reconcile schema/Alembic bookkeeping for the restored DB (best-effort).
    try:
        from database import sync_schema
        await sync_schema()
    except Exception as e:
        logger.warning("Schema sync post-restore warning: %s", e)

    return {"success": True, "message": "Base de données restaurée avec succès."}


@router.get("/export/transactions.csv")
async def export_transactions_csv(
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Export all transactions for the active profile into a clean CSV file."""
    stmt = (
        select(
            Transaction,
            Account.name.label("account_name"),
            Account.bank_name.label("bank_name"),
            Category.name.label("category_name"),
        )
        .outerjoin(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(Transaction.profile_id == pid)
        .order_by(Transaction.date.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")

    # Header
    writer.writerow([
        "Date",
        "Compte",
        "Banque",
        "Catégorie",
        "Description",
        "Montant (€)",
        "Type",
        "Import Hash",
        "Notes",
    ])

    for row in rows:
        t: Transaction = row[0]
        acc_name = row[1] or ""
        bank_name = row[2] or ""
        cat_name = row[3] or "Non catégorisé"

        amount_eur = (t.amount_cents / 100.0) if t.amount_cents is not None else 0.0
        row_type = "Débit (Dépense)" if t.is_debit else "Crédit (Revenu)"
        if t.is_internal_transfer:
            row_type = "Virement interne"

        writer.writerow([
            str(t.date),
            csv_safe_cell(acc_name),
            csv_safe_cell(bank_name),
            csv_safe_cell(cat_name),
            csv_safe_cell(t.description),
            f"{amount_eur:.2f}".replace(".", ","),
            row_type,
            t.import_hash or "",
            csv_safe_cell(t.notes or ""),
        ])

    # UTF-8 BOM so Excel detects the encoding and renders accents correctly.
    csv_content = "﻿" + output.getvalue()
    filename = f"export-transactions-{datetime.now().strftime('%Y-%m-%d')}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _report_range(date_from, date_to):
    """Default to a trailing 12-month window when no range is given."""
    dt = date_to or _date.today()
    df = date_from or _date(dt.year - 1, dt.month, 1)
    return df, dt


@router.get("/export/report.xlsx")
async def export_report_xlsx(
    date_from: _date | None = None,
    date_to: _date | None = None,
    include_investments: bool = True,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Comprehensive multi-sheet Excel report over the chosen period."""
    from services.report import gather_report_data, build_xlsx
    df, dt = _report_range(date_from, date_to)
    data = await gather_report_data(db, pid, date_from=df, date_to=dt, include_investments=include_investments)
    content = build_xlsx(data, data["base_ccy"])
    filename = f"rapport-{datetime.now().strftime('%Y-%m-%d')}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/report.pdf")
async def export_report_pdf(
    date_from: _date | None = None,
    date_to: _date | None = None,
    include_investments: bool = True,
    db: AsyncSession = Depends(get_db),
    pid: int = Depends(current_profile_id),
):
    """Comprehensive PDF report (KPIs, charts, spending, budget, investments) over the chosen period."""
    from services.report import gather_report_data, build_pdf
    df, dt = _report_range(date_from, date_to)
    data = await gather_report_data(db, pid, date_from=df, date_to=dt, include_investments=include_investments)
    content = build_pdf(data, data["base_ccy"])
    filename = f"rapport-{datetime.now().strftime('%Y-%m-%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

