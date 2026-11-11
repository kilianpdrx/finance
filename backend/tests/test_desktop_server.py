"""The desktop app's backend entry point (desktop_server.py): it only ever
listens on 127.0.0.1 (invariant 5) and refuses to start without the data folder
Electron chose."""
import os

import pytest

import desktop_server


def test_there_is_no_host_option():
    with pytest.raises(SystemExit):
        desktop_server.parse_args(["--port", "8123", "--host", "0.0.0.0"])


@pytest.mark.parametrize("argv", [[], ["--port", "0"], ["--port", "70000"], ["--port", "abc"]])
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


def test_serves_on_loopback_only_and_keeps_the_app_logging(monkeypatch):
    import threading
    import uvicorn

    seen = {}

    class FakeServer:
        def __init__(self, config):
            seen["config"] = config

        def run(self):
            seen["ran"] = True

    monkeypatch.setenv("FINANCE_DESKTOP", "0")       # restored after the test
    monkeypatch.setattr(uvicorn, "Server", FakeServer)
    started = []
    monkeypatch.setattr(threading, "Thread", lambda *a, **k: started.append(k) or type("T", (), {"start": lambda s: None})())

    desktop_server.main(["--port", "8123"])

    config = seen["config"]
    assert (config.host, config.port, seen["ran"]) == ("127.0.0.1", 8123, True)
    assert config.log_config is None             # main's logging setup stays in place
    assert os.environ["FINANCE_DESKTOP"] == "1"
    assert started == []                          # stdin is watched only when asked

    desktop_server.main(["--port", "8123", "--watch-stdin"])
    assert len(started) == 1
