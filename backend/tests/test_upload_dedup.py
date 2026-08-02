"""Regression: duplicate detection must recognise rows imported by older
versions, which stored the LEGACY no-account import_hash (csv_parser._compute_hash),
even though the current code recomputes account-scoped hashes."""
import json
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import Transaction
from services.csv_parser import _compute_hash

pytestmark = pytest.mark.asyncio

CSV = "Date;Libelle;Montant\n2026-05-08;CAFE COMPASS;-2,70\n"
MAPPING = json.dumps({"date": "Date", "description": "Libelle", "amount": "Montant"})


async def _seed_legacy_row(db: AsyncSession, profile_id: int, account_id: int):
    """Insert a transaction the way an OLD import would: legacy (no-account) hash."""
    legacy = _compute_hash("2026-05-08", "CAFE COMPASS", 270, True)
    db.add(Transaction(
        profile_id=profile_id, account_id=account_id, date=date(2026, 5, 8),
        description="CAFE COMPASS", amount_cents=270, currency="EUR",
        is_debit=True, import_hash=legacy,
    ))
    await db.commit()
    return legacy


def _form(account_id: int):
    return {
        "account_id": str(account_id),
        "column_mapping": MAPPING,
        "date_format": "%Y-%m-%d",
        "delimiter": ";",
        "encoding": "utf-8",
    }


async def test_preview_flags_legacy_hash_duplicate(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    profile, acc = seed_data["profile"], seed_data["account_courant"]
    await _seed_legacy_row(db_session, profile.id, acc.id)

    r = await client.post("/api/upload/parse-preview",
                          headers={"X-Profile-Id": str(profile.id)},
                          files={"file": ("courant.csv", CSV, "text/csv")},
                          data=_form(acc.id))
    assert r.status_code == 200
    body = r.json()
    assert body["duplicates"] == 1
    assert body["transactions"][0]["is_duplicate"] is True


async def test_confirm_skips_legacy_hash_duplicate(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    profile, acc = seed_data["profile"], seed_data["account_courant"]
    await _seed_legacy_row(db_session, profile.id, acc.id)

    r = await client.post("/api/upload/confirm",
                          headers={"X-Profile-Id": str(profile.id)},
                          files={"file": ("courant.csv", CSV, "text/csv")},
                          data=_form(acc.id))
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped"] == 1


async def test_reimport_after_import_dedups(client: AsyncClient, seed_data: dict):
    """Import once, then re-import the same file — the second run skips everything
    (guards the normal, current-format round-trip)."""
    profile, acc = seed_data["profile"], seed_data["account_courant"]
    hdr = {"X-Profile-Id": str(profile.id)}

    first = await client.post("/api/upload/confirm", headers=hdr,
                              files={"file": ("courant.csv", CSV, "text/csv")}, data=_form(acc.id))
    assert first.json()["imported"] == 1

    second = await client.post("/api/upload/confirm", headers=hdr,
                               files={"file": ("courant.csv", CSV, "text/csv")}, data=_form(acc.id))
    assert second.json() == {"imported": 0, "skipped": 1, "total": 1, "categorized": 0}
