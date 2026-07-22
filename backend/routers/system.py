import os
import signal
import subprocess
import threading
import time
import logging

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter()

# Ports used by the app: frontend (Next.js dev 3000 / legacy Vite 5173) and backend (8000).
_APP_PORTS = (3000, 5173, 8000)


def _pids_on_port(port: int) -> set[int]:
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
            pids.add(int(line))
        except ValueError:
            pass
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

    # Force-kill anything still holding a port.
    remaining: set[int] = set()
    for port in _APP_PORTS:
        remaining |= _pids_on_port(port)
    remaining.add(os.getpid())
    for pid in remaining:
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


@router.post("/shutdown")
async def shutdown():
    """Stop both servers cleanly and free ports 3000/5173/8000.

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
from datetime import datetime
from pathlib import Path
from fastapi import Depends, HTTPException, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, DB_PATH, engine
from dependencies import current_profile_id
from models import Transaction, Account, Category


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
    """Restore database from an uploaded SQLite backup file."""
    # 1. Header validation
    header = await file.read(16)
    if not header.startswith(b"SQLite format 3\x00"):
        raise HTTPException(
            status_code=400,
            detail="Fichier invalide : il ne s'agit pas d'un fichier de base de données SQLite valide.",
        )
    await file.seek(0)

    # 2. Flush & dispose active connection pool
    try:
        await db.execute(text("PRAGMA wal_checkpoint(TRUNCATE);"))
    except Exception:
        pass
    await engine.dispose()

    # 3. Write uploaded file to DB_PATH
    try:
        content = await file.read()
        with open(DB_PATH, "wb") as f:
            f.write(content)

        # Cleanup stale WAL/SHM files
        wal_file = Path(f"{DB_PATH}-wal")
        shm_file = Path(f"{DB_PATH}-shm")
        if wal_file.exists():
            wal_file.unlink()
        if shm_file.exists():
            shm_file.unlink()
    except Exception as e:
        logger.error("Failed to restore database file: %s", e)
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'écriture du fichier : {e}")

    # 4. Run Alembic upgrade to ensure schema consistency
    try:
        from alembic.config import Config
        from alembic import command
        alembic_ini = Path(__file__).parent.parent / "alembic.ini"
        if alembic_ini.exists():
            alembic_cfg = Config(str(alembic_ini))
            await asyncio.to_thread(command.upgrade, alembic_cfg, "head")
    except Exception as e:
        logger.warning("Alembic upgrade post-restore warning: %s", e)

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
            acc_name,
            bank_name,
            cat_name,
            t.description,
            f"{amount_eur:.2f}".replace(".", ","),
            row_type,
            t.import_hash or "",
            t.notes or "",
        ])

    csv_content = output.getvalue()
    filename = f"export-transactions-{datetime.now().strftime('%Y-%m-%d')}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

