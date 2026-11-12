import sqlite3

import pytest


@pytest.mark.asyncio
async def test_download_backup(client, seed_data, tmp_path, monkeypatch):
    """The download is a consistent COPY, made with SQLite's backup function —
    not the live file, which a write could catch half-done — and the copy does
    not stay behind.

    `DB_PATH` is pointed at a temp file: the endpoint reads the module-level path
    directly (not the test session), so without this the test only passes on a
    machine that happens to have a real backend/data/finance.db.
    """
    from routers import system

    db_file = tmp_path / "finance.db"
    con = sqlite3.connect(db_file)
    con.execute("PRAGMA journal_mode=WAL")            # like the app's database
    con.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT)")
    con.executemany("INSERT INTO t (label) VALUES (?)", [(f"ligne {i}",) for i in range(500)])
    con.commit()                                     # left in the -wal file, not checkpointed
    monkeypatch.setattr(system, "DB_PATH", db_file)

    res = await client.get("/api/system/backup")
    con.close()
    assert res.status_code == 200
    assert res.headers["content-type"] in ("application/x-sqlite3", "application/octet-stream")
    assert "finance-backup-" in res.headers.get("content-disposition", "")

    downloaded = tmp_path / "downloaded.sqlite"
    downloaded.write_bytes(res.content)
    check = sqlite3.connect(downloaded)
    assert check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert check.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 500     # what was still in the -wal file too
    check.close()
    assert not list(tmp_path.glob("finance.backup-*"))                      # the temporary copy is gone


@pytest.mark.asyncio
async def test_download_backup_without_database(client, tmp_path, monkeypatch):
    """No database yet → a clear error rather than an empty download."""
    from routers import system

    monkeypatch.setattr(system, "DB_PATH", tmp_path / "does-not-exist.db")
    res = await client.get("/api/system/backup")
    assert res.status_code == 404 and res.json()["detail"] == "Base de données introuvable"


@pytest.mark.asyncio
async def test_export_transactions_csv(client, seed_data):
    pid = seed_data["profile"].id
    res = await client.get("/api/system/export/transactions.csv", headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "Date;Compte;Banque;Catégorie" in res.text


@pytest.mark.asyncio
async def test_restore_backup_validation(client):
    # Submit invalid non-SQLite file
    invalid_file = ("test.txt", b"This is not a SQLite database", "text/plain")
    res = await client.post("/api/system/restore", files={"file": invalid_file})
    assert res.status_code == 400
    assert "Fichier invalide" in res.json()["detail"]


def test_prune_keeps_only_newest_pre_restore_snapshots(tmp_path, monkeypatch):
    """Each restore copies the whole DB aside; without pruning those full copies
    accumulate next to the live database forever."""
    from routers import system

    monkeypatch.setattr(system, "DB_PATH", tmp_path / "finance.db")
    names = [f"finance.pre-restore-2026081{i}-120000.db" for i in range(1, 7)]
    for n in names:
        (tmp_path / n).write_bytes(b"x")

    system._prune_pre_restore_snapshots(keep=3)

    left = sorted(p.name for p in tmp_path.glob("finance.pre-restore-*.db"))
    assert left == names[-3:], "should keep the 3 newest (timestamped names sort chronologically)"


def test_is_app_process_rejects_unrelated_pid(monkeypatch):
    """The Quit button must never signal a process that isn't ours, even if it
    happens to hold port 3000/8000."""
    import subprocess as sp
    from routers import system

    class _R:
        def __init__(self, out): self.stdout = out

    monkeypatch.setattr(sp, "run", lambda *a, **k: _R("/usr/bin/postgres -D /data\n"))
    assert system._is_app_process(4242) is False

    monkeypatch.setattr(sp, "run", lambda *a, **k: _R("python -m uvicorn main:app --port 8000\n"))
    assert system._is_app_process(4242) is True


@pytest.mark.asyncio
async def test_shutdown_refuses_inside_container(client, monkeypatch):
    """In Docker, killing PID 1 just triggers `restart: unless-stopped` and the app
    comes straight back — so the button must explain instead of pretending."""
    from routers import system

    monkeypatch.setattr(system, "_in_container", lambda: True)
    res = await client.post("/api/system/shutdown")
    assert res.status_code == 200
    body = res.json()
    assert body["stopping"] is False
    assert body["reason"] == "container"
    assert "Arreter" in body["detail"]


@pytest.mark.asyncio
async def test_shutdown_refuses_in_the_desktop_app(client, monkeypatch):
    """In the desktop app Electron owns both servers. The port-killing path would
    hit whatever else holds 3000/8000 (a dev server) and pull the backend out from
    under the window — so it refuses, and nothing is signalled."""
    import threading
    from routers import system

    monkeypatch.setenv("FINANCE_DESKTOP", "1")
    monkeypatch.setattr(threading, "Thread", lambda *a, **k: pytest.fail("the shutdown worker must not start"))
    res = await client.post("/api/system/shutdown")
    assert res.status_code == 200
    body = res.json()
    assert body["stopping"] is False
    assert body["reason"] == "desktop"
    assert "fenêtre" in body["detail"]
    assert system._is_desktop() is True


@pytest.mark.asyncio
async def test_version_says_whether_this_is_the_desktop_app(client, monkeypatch):
    """The UI hides « Quitter » and words the update advice from this."""
    monkeypatch.delenv("FINANCE_DESKTOP", raising=False)
    assert (await client.get("/api/system/version")).json()["is_desktop"] is False
    monkeypatch.setenv("FINANCE_DESKTOP", "1")
    assert (await client.get("/api/system/version")).json()["is_desktop"] is True


def _sqlite_file(path, rows, page_size=4096, wal=False):
    con = sqlite3.connect(path)
    con.execute(f"PRAGMA page_size={page_size}")
    if wal:
        con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT)")
    con.executemany("INSERT INTO t (label) VALUES (?)", [(r,) for r in rows])
    con.commit()
    return con


def _labels(path):
    con = sqlite3.connect(path)
    try:
        return [r[0] for r in con.execute("SELECT label FROM t ORDER BY id")]
    finally:
        con.close()


@pytest.fixture
def live_db(tmp_path, monkeypatch):
    """The restore endpoint works on the module-level DB_PATH / engine: point both
    at a temp file, and keep Alembic away from the suite's own data folder."""
    from sqlalchemy.ext.asyncio import create_async_engine
    import database
    from routers import system

    db_file = tmp_path / "finance.db"
    monkeypatch.setattr(system, "DB_PATH", db_file)
    monkeypatch.setattr(system, "engine", create_async_engine(f"sqlite+aiosqlite:///{db_file}"))
    synced = []

    async def _sync():
        synced.append(True)
    monkeypatch.setattr(database, "sync_schema", _sync)
    return db_file, synced


@pytest.mark.asyncio
async def test_restore_copies_the_backup_into_the_database(client, live_db, tmp_path):
    """The backup is copied INTO the live file (SQLite's backup function), never
    renamed over it: Windows refuses to replace a file SQLite holds open. The
    current data — what still sits in its -wal file included — is kept aside
    first, and the staging file does not stay behind."""
    db_file, synced = live_db
    live = _sqlite_file(db_file, ["avant 1", "avant 2"], wal=True)   # left in the -wal file
    backup = tmp_path / "sauvegarde.sqlite"
    _sqlite_file(backup, ["restauré 1", "restauré 2", "restauré 3"], page_size=8192).close()
    live.close()

    res = await client.post("/api/system/restore",
                            files={"file": ("sauvegarde.sqlite", backup.read_bytes(), "application/x-sqlite3")})

    assert res.status_code == 200, res.text
    assert _labels(db_file) == ["restauré 1", "restauré 2", "restauré 3"]
    snapshots = list(tmp_path.glob("finance.pre-restore-*.db"))
    assert len(snapshots) == 1 and _labels(snapshots[0]) == ["avant 1", "avant 2"]
    assert not list(tmp_path.glob("finance.db.restore.tmp*"))
    assert synced == [True]


@pytest.mark.asyncio
async def test_restore_works_while_another_connection_holds_the_database(client, live_db, tmp_path):
    """A connection that stays open (another request, a background job) does not
    stop the restore, and reads the restored data afterwards — the file it holds
    is the same file, rewritten."""
    db_file, _ = live_db
    holder = _sqlite_file(db_file, ["avant"], wal=True)
    backup = tmp_path / "sauvegarde.sqlite"
    _sqlite_file(backup, ["restauré"]).close()

    res = await client.post("/api/system/restore",
                            files={"file": ("sauvegarde.sqlite", backup.read_bytes(), "application/x-sqlite3")})

    assert res.status_code == 200, res.text
    assert [r[0] for r in holder.execute("SELECT label FROM t")] == ["restauré"]
    holder.close()


@pytest.mark.asyncio
async def test_restore_of_another_page_size_while_the_database_is_held(client, live_db, tmp_path):
    """While a connection holds it, the live database stays in WAL mode, and a
    WAL database refuses a backup whose page size differs from its own
    (SQLITE_READONLY): the restore answered 500. The staged copy is brought to
    the live page size first."""
    db_file, _ = live_db
    holder = _sqlite_file(db_file, ["avant"], wal=True)               # 4096
    backup = tmp_path / "sauvegarde.sqlite"
    _sqlite_file(backup, ["restauré 1", "restauré 2"], page_size=8192).close()

    res = await client.post("/api/system/restore",
                            files={"file": ("sauvegarde.sqlite", backup.read_bytes(), "application/x-sqlite3")})

    assert res.status_code == 200, res.text
    assert [r[0] for r in holder.execute("SELECT label FROM t ORDER BY id")] == ["restauré 1", "restauré 2"]
    assert holder.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    holder.close()
    assert not list(tmp_path.glob("finance.db.restore.tmp*"))


@pytest.mark.asyncio
async def test_version_endpoint_reports_build(client, monkeypatch):
    """Bug reports need a version to name; CI stamps APP_VERSION into the image."""
    monkeypatch.setenv("APP_VERSION", "v1.2.3")
    res = await client.get("/api/system/version")
    assert res.status_code == 200
    assert res.json()["version"] == "v1.2.3"


@pytest.mark.asyncio
async def test_version_defaults_to_dev(client, monkeypatch):
    """A source run must report 'dev', not a fabricated release number."""
    monkeypatch.delenv("APP_VERSION", raising=False)
    res = await client.get("/api/system/version")
    assert res.json()["version"] == "dev"
    assert "is_container" in res.json()


@pytest.mark.asyncio
async def test_version_says_when_the_data_is_a_copy(client, monkeypatch, tmp_path):
    """dev-data.sh leaves a `.copie` file next to the database it copied: the UI
    shows it on every page, because the copy looks exactly like the real app."""
    import routers.system as system

    monkeypatch.setattr(system, "DB_PATH", tmp_path / "finance.db")
    assert (await client.get("/api/system/version")).json()["data_copied_at"] is None

    (tmp_path / ".copie").write_text("2026-10-11T21:40\n/somewhere/data\n", encoding="utf-8")
    assert (await client.get("/api/system/version")).json()["data_copied_at"] == "2026-10-11T21:40"


def test_app_ports_follow_start_sh(monkeypatch):
    """start.sh moves a port another program holds, and says which ones it used —
    the in-app stop button must free THOSE, not 3000 and 8000 by habit."""
    import routers.system as system

    monkeypatch.delenv("FINANCE_APP_PORTS", raising=False)
    assert system._app_ports() == (3000, 8000)
    monkeypatch.setenv("FINANCE_APP_PORTS", "3001,8000")
    assert system._app_ports() == (3001, 8000)
    monkeypatch.setenv("FINANCE_APP_PORTS", "pas-un-port")
    assert system._app_ports() == (3000, 8000)


@pytest.mark.asyncio
async def test_diagnostics_has_shape_but_no_financial_content(client, seed_data, db_session):
    """The export is meant to be sent to someone else, so it must describe the
    shape of the data (counts, versions, cache freshness) and never its content."""
    from datetime import date
    from models import Transaction

    db_session.add(Transaction(
        profile_id=seed_data["profile"].id, account_id=seed_data["account_courant"].id,
        date=date(2026, 2, 3), description="LOYER APPARTEMENT RUE SECRETE",
        amount_cents=123456, is_debit=True, import_hash="diag1"))
    await db_session.commit()

    res = await client.get("/api/system/diagnostics")
    assert res.status_code == 200
    body = res.json()

    for key in ("version", "schema_revision", "row_counts", "profiles", "caches", "recent_logs"):
        assert key in body, key
    assert body["row_counts"]["transactions"] >= 1
    assert body["profiles"][0]["transactions"] >= 1

    # Nothing identifying may appear anywhere in the payload.
    blob = res.text
    for secret in ("LOYER APPARTEMENT", "RUE SECRETE", "123456",
                   seed_data["account_courant"].name, seed_data["cat_courses"].name):
        assert secret not in blob, f"diagnostics leaked {secret!r}"


@pytest.mark.asyncio
async def test_unhandled_error_returns_french_message_and_reference(test_engine):
    """A crash must be actionable: a French message plus a reference that also
    appears in the log, instead of FastAPI's bare 'Internal Server Error'.

    Uses its own client with `raise_app_exceptions=False`: Starlette's 500 handler
    builds the response and then re-raises so the server can log it, and httpx's
    default transport surfaces that re-raise instead of the response.
    """
    from httpx import AsyncClient, ASGITransport
    import main

    @main.app.get("/api/_boom_test")
    async def _boom():
        raise RuntimeError("boom")

    try:
        transport = ASGITransport(app=main.app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as ac:
            res = await ac.get("/api/_boom_test")
        assert res.status_code == 500
        body = res.json()
        assert "erreur inattendue" in body["detail"].lower()
        assert body["reference"] and body["reference"] in body["detail"]
    finally:
        main.app.router.routes = [
            r for r in main.app.router.routes
            if getattr(r, "path", None) != "/api/_boom_test"
        ]


@pytest.mark.asyncio
async def test_removed_legacy_budget_endpoint_is_gone(client, seed_data):
    """GET /analytics/budget was dead code carrying the pre-archive behaviour."""
    res = await client.get("/api/analytics/budget",
                           headers={"X-Profile-Id": str(seed_data["profile"].id)})
    assert res.status_code == 405  # only PUT remains on that path
