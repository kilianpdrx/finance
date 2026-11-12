"""The desktop app's backend entry point (desktop_server.py): it only ever
listens on 127.0.0.1 (invariant 5) and refuses to start without the data folder
Electron chose."""
import os

import pytest

import desktop_server


def test_there_is_no_host_option():
    with pytest.raises(SystemExit):
        desktop_server.parse_args(["--port", "8123", "--host", "0.0.0.0"])


@pytest.mark.parametrize("argv", [[], ["--port", "-1"], ["--port", "70000"], ["--port", "abc"]])
def test_a_valid_port_is_required(argv):
    with pytest.raises(SystemExit):
        desktop_server.parse_args(argv)


def test_refuses_to_start_without_a_data_folder(monkeypatch):
    """Without it `database` falls back to a folder inside the application —
    read-only once installed, replaced by the next update."""
    monkeypatch.delenv("FINANCE_DATA_DIR", raising=False)
    with pytest.raises(SystemExit) as exc:
        desktop_server.data_dir_or_exit()
    assert "FINANCE_DATA_DIR" in str(exc.value.code)


def test_serves_on_loopback_only_and_keeps_the_app_logging(monkeypatch, capsys):
    import socket
    import threading
    import uvicorn

    seen = {}

    class FakeServer:
        def __init__(self, config):
            seen["config"] = config

        def run(self, sockets=None):
            seen["sockets"] = sockets

    monkeypatch.setenv("FINANCE_DESKTOP", "0")       # restored after the test
    monkeypatch.setenv("FINANCE_APP_PORTS", "23456")  # the interface's, from Electron
    monkeypatch.setattr(uvicorn, "Server", FakeServer)
    started = []
    monkeypatch.setattr(threading, "Thread", lambda *a, **k: started.append(k) or type("T", (), {"start": lambda s: None})())

    desktop_server.main(["--port", "0"])

    config, (sock,) = seen["config"], seen["sockets"]
    try:
        host, port = sock.getsockname()
        assert (host, sock.family, sock.type) == ("127.0.0.1", socket.AF_INET, socket.SOCK_STREAM)
        assert port > 0 and config.port == port
        # Listening already, before the app has started: a request waits in the
        # queue instead of being dropped (macOS drops a connection to a port only
        # bound, and the caller waits for the system to try again).
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        # Electron reads the port it got from the first line on stdout.
        assert capsys.readouterr().out.splitlines()[0] == f"FINANCE_BACKEND_PORT={port}"
        assert os.environ["FINANCE_APP_PORTS"] == f"23456,{port}"
    finally:
        sock.close()
    assert config.host == "127.0.0.1"
    assert config.log_config is None             # main's logging setup stays in place
    assert config.timeout_graceful_shutdown == desktop_server.GRACEFUL_SHUTDOWN_S
    assert os.environ["FINANCE_DESKTOP"] == "1"
    assert started == []                          # stdin is watched only when asked

    desktop_server.main(["--port", "0", "--watch-stdin"])
    seen["sockets"][0].close()
    assert len(started) == 1


def test_the_port_is_taken_before_the_app_starts(monkeypatch):
    """The socket is bound before `main` is imported (seconds of migrations and
    seeding): nothing can take the port in between, and a port already taken is
    a clear exit, not a failure after the whole startup."""
    import socket

    taken = socket.socket()
    taken.bind(("127.0.0.1", 0))
    taken.listen()
    try:
        with pytest.raises(SystemExit) as exc:
            desktop_server.bind_or_exit(taken.getsockname()[1])
        assert "n'a pas pu être pris" in str(exc.value.code)
    finally:
        taken.close()
