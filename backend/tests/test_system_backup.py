import sqlite3

import pytest


@pytest.mark.asyncio
async def test_download_backup(client, seed_data, tmp_path, monkeypatch):
    """Streams the database file.

    `DB_PATH` is pointed at a temp file: the endpoint reads the module-level path
    directly (not the test session), so without this the test only passes on a
    machine that happens to have a real backend/data/finance.db — and 444s on a
    fresh clone or in CI.
    """
    from routers import system

    db_file = tmp_path / "finance.db"
    sqlite3.connect(db_file).close()  # a genuine (empty) SQLite file
    monkeypatch.setattr(system, "DB_PATH", db_file)

    res = await client.get("/api/system/backup")
    assert res.status_code == 200
    assert res.headers["content-type"] in ("application/x-sqlite3", "application/octet-stream")
    assert "finance-backup-" in res.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_download_backup_without_database(client, tmp_path, monkeypatch):
    """No database yet → a clear error rather than an empty download."""
    from routers import system

    monkeypatch.setattr(system, "DB_PATH", tmp_path / "does-not-exist.db")
    res = await client.get("/api/system/backup")
    assert res.status_code == 444


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
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
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
