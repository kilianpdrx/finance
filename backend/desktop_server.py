"""Entry point of the desktop app's backend (frozen by PyInstaller, see
finance-backend.spec). Electron starts it, waits for /api/health, then starts the
interface pointed at it (desktop/main.js).

    finance-backend --port 51234 --watch-stdin     # FINANCE_DATA_DIR set by Electron

There is deliberately no host option: the app has no login (invariant 5), so the
API only ever listens on 127.0.0.1. The port is Electron's choice.

With --watch-stdin (Electron passes it), the server stops when the pipe on its
stdin closes, i.e. when Electron goes away — quit, crash, killed: an orphaned
backend would keep the database open and the port taken until the computer
restarts. Opt-in, because a stdin that is /dev/null would stop it at once.
"""
import argparse
import os
import sys
import threading

HOST = "127.0.0.1"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="finance-backend", description="Finance — serveur de l'application de bureau.")
    parser.add_argument("--port", type=int, required=True, help="port d'écoute sur 127.0.0.1")
    parser.add_argument("--watch-stdin", action="store_true",
                        help="s'arrêter quand l'entrée standard se ferme (l'application est partie)")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port doit être compris entre 1 et 65535")
    return args


def data_dir_or_exit() -> str:
    """The data folder Electron chose. Without it `database.py` would fall back to
    a folder inside the application itself — read-only once installed (and on
    macOS, possibly a translocated copy), and wiped by the next update."""
    data_dir = os.environ.get("FINANCE_DATA_DIR", "").strip()
    if not data_dir:
        sys.exit("FINANCE_DATA_DIR manquant : le dossier des données doit être indiqué par l'application.")
    return data_dir


def _stop_when_stdin_closes(server) -> None:
    try:
        while sys.stdin.buffer.read(65536):
            pass
    except (OSError, ValueError):
        pass  # the pipe broke: same meaning as closed
    server.should_exit = True


def main(argv: list[str] | None = None) -> None:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    data_dir_or_exit()
    os.environ["FINANCE_DESKTOP"] = "1"

    # Imported only now: `database` reads FINANCE_DATA_DIR and `main` configures
    # logging at import.
    import uvicorn
    from main import app

    config = uvicorn.Config(
        app,
        host=HOST,
        port=args.port,
        # `main` already sent uvicorn's loggers to the app's log file; uvicorn's
        # own dictConfig would take them back.
        log_config=None,
        # Explicit implementations: nothing for PyInstaller to discover at runtime.
        loop="asyncio",
        http="h11",
        ws="none",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    if args.watch_stdin and sys.stdin is not None:
        threading.Thread(target=_stop_when_stdin_closes, args=(server,), daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
