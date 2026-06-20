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
