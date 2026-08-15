import pytest


@pytest.mark.asyncio
async def test_download_backup(client, seed_data):
    res = await client.get("/api/system/backup")
    assert res.status_code == 200
    assert res.headers["content-type"] in ("application/x-sqlite3", "application/octet-stream")
    assert "finance-backup-" in res.headers.get("content-disposition", "")


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
    assert "docker compose down" in body["detail"]
