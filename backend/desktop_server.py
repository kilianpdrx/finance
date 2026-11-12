"""Entry point of the desktop app's backend (frozen by PyInstaller, see
finance-backend.spec). Electron starts it, reads the port it took, waits for
/api/health and opens the interface pointed at it (desktop/main.js).

    finance-backend --port 0 --watch-stdin     # FINANCE_DATA_DIR set by Electron

There is deliberately no host option: the app has no login (invariant 5), so the
API only ever listens on 127.0.0.1.

The port is taken FIRST, before the app is even imported: its startup (migrations,
seeding, backfills) takes seconds, tens of them on a first launch, and uvicorn
binds only after it. A port Electron had probed free could be taken by another
program in between. With `--port 0` the system picks a free one, and the first
line on stdout says which (PORT_LINE), once it is ours.

With --watch-stdin (Electron passes it), the server stops when the pipe on its
stdin closes, i.e. when Electron goes away — quit, crash, killed: an orphaned
backend would keep the database open and the port taken until the computer
restarts. Opt-in, because a stdin that is /dev/null would stop it at once.
"""
import argparse
import os
import socket
import sys
import threading

HOST = "127.0.0.1"
PORT_LINE = "FINANCE_BACKEND_PORT="
# Requests still running when asked to stop get this long (seconds). Electron
# kills the process after 5 s (STOP_GRACE_MS in desktop/main.js): finish first.
GRACEFUL_SHUTDOWN_S = 3
BACKLOG = 2048  # uvicorn's own default


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="finance-backend", description="Finance — serveur de l'application de bureau.")
    parser.add_argument("--port", type=int, required=True,
                        help="port d'écoute sur 127.0.0.1 (0 : un port libre, choisi par le système)")
    parser.add_argument("--watch-stdin", action="store_true",
                        help="s'arrêter quand l'entrée standard se ferme (l'application est partie)")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("--port doit être compris entre 0 et 65535")
    return args


def data_dir_or_exit() -> str:
    """The data folder Electron chose. Without it `database.py` would fall back to
    a folder inside the application itself — read-only once installed (and on
    macOS, possibly a translocated copy), and wiped by the next update."""
    data_dir = os.environ.get("FINANCE_DATA_DIR", "").strip()
    if not data_dir:
        sys.exit("FINANCE_DATA_DIR manquant : le dossier des données doit être indiqué par l'application.")
    return data_dir


def bind_or_exit(port: int) -> socket.socket:
    """A socket on 127.0.0.1:`port` (0: any free port), LISTENING already: a
    request made while the app starts waits in the queue and is answered as soon
    as uvicorn serves. Only bound, it made macOS drop the connection attempts,
    and every check of Electron's waited for the system to try again (up to a
    second each time)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name != "nt":
            # As uvicorn does: rebind a port a previous run left in TIME_WAIT. Not
            # on Windows, where it would let a socket share a port already in use.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((HOST, port))
        sock.listen(BACKLOG)
    except OSError as e:
        sock.close()
        sys.exit(f"Le port {port} n'a pas pu être pris sur {HOST} : {e}")
    return sock


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
    sock = bind_or_exit(args.port)
    port = sock.getsockname()[1]
    os.environ["FINANCE_DESKTOP"] = "1"
    # The ports /shutdown and the diagnostics report: Electron gives the
    # interface's, this is the other one (read when `main` is imported).
    ports = [p for p in os.environ.get("FINANCE_APP_PORTS", "").split(",") if p.strip()]
    os.environ["FINANCE_APP_PORTS"] = ",".join([*ports, str(port)])
    print(f"{PORT_LINE}{port}", flush=True)

    # Imported only now: `database` reads FINANCE_DATA_DIR and `main` configures
    # logging at import.
    import uvicorn
    from main import app

    config = uvicorn.Config(
        app,
        host=HOST,
        port=port,
        # `main` already sent uvicorn's loggers to the app's log file; uvicorn's
        # own dictConfig would take them back.
        log_config=None,
        # Explicit implementations: nothing for PyInstaller to discover at runtime.
        loop="asyncio",
        http="h11",
        ws="none",
        lifespan="on",
        backlog=BACKLOG,
        # Without it uvicorn waits for running requests with no limit, and a
        # stuck one kept the backend (and the database) alive after Electron left.
        timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_S,
    )
    server = uvicorn.Server(config)
    if args.watch_stdin and sys.stdin is not None:
        threading.Thread(target=_stop_when_stdin_closes, args=(server,), daemon=True).start()
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
