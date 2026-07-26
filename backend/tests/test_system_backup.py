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
