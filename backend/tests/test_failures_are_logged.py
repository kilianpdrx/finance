"""Failures must leave a trace.

Eleven code paths used to end in `except Exception: pass`. Each one was a place
where something could go wrong and produce no evidence at all — which is exactly
how the dead-logging bug survived for months. These tests pin the two that carry
real user-visible consequences, plus the helper that replaced three copies of the
same silently-discarded conversion.
"""
import json
import logging
from datetime import date

import pytest
from httpx import AsyncClient

import services.market_data as md

CSV = "Date;Libelle;Montant\n2026-05-08;CAFE COMPASS;-2,70\n"
MAPPING = json.dumps({"date": "Date", "description": "Libelle", "amount": "Montant"})


def _form(account_id: int, **extra):
    return {
        "account_id": str(account_id),
        "column_mapping": MAPPING,
        "date_format": "%Y-%m-%d",
        "delimiter": ";",
        "encoding": "utf-8",
        **extra,
    }


async def test_unreadable_category_overrides_is_logged(
    client: AsyncClient, seed_data: dict, caplog
):
    """The user picks categories in the review step; if that payload can't be
    parsed the import continues *without them*. Silently, before."""
    profile, acc = seed_data["profile"], seed_data["account_courant"]

    with caplog.at_level(logging.WARNING, logger="routers.upload"):
        r = await client.post(
            "/api/upload/confirm",
            headers={"X-Profile-Id": str(profile.id)},
            files={"file": ("courant.csv", CSV, "text/csv")},
            data=_form(acc.id, category_overrides="{not json"),
        )

    assert r.status_code == 200          # l'import aboutit quand même
    assert any("category_overrides" in rec.message for rec in caplog.records), caplog.text


async def test_unreadable_force_hashes_is_logged(
    client: AsyncClient, seed_data: dict, caplog
):
    """Rows the user explicitly forced would silently fall back to being treated
    as duplicates and skipped."""
    profile, acc = seed_data["profile"], seed_data["account_courant"]

    with caplog.at_level(logging.WARNING, logger="routers.upload"):
        r = await client.post(
            "/api/upload/confirm",
            headers={"X-Profile-Id": str(profile.id)},
            files={"file": ("courant.csv", CSV, "text/csv")},
            data=_form(acc.id, force_import_hashes="[[[")
        )

    assert r.status_code == 200
    assert any("force_import_hashes" in rec.message for rec in caplog.records), caplog.text


def test_epoch_to_date_survives_whatever_yahoo_sends():
    """Dividend dates arrive as epoch seconds and are regularly absent, null or
    nonsense. A bad one means *that date* is unknown — it must not take down the
    surrounding dividend record."""
    assert md._epoch_to_date(1735689600, "exDividendDate", "AAPL") == date(2025, 1, 1)

    for junk in (None, 0, "", "nope", 10**18, -(10**18), object()):
        assert md._epoch_to_date(junk, "exDividendDate", "AAPL") is None


def test_epoch_to_date_logs_only_real_junk(caplog):
    """An absent value is normal and must stay quiet; an unusable one is worth a
    line, so an empty ex-date is explainable rather than mysterious."""
    with caplog.at_level(logging.DEBUG, logger="services.market_data"):
        md._epoch_to_date(None, "exDividendDate", "AAPL")
        md._epoch_to_date(0, "exDividendDate", "AAPL")
    assert caplog.records == []

    with caplog.at_level(logging.DEBUG, logger="services.market_data"):
        md._epoch_to_date("nope", "exDividendDate", "AAPL")
    assert any("exDividendDate" in r.message and "AAPL" in r.message for r in caplog.records)


def test_no_blanket_exception_swallowing_remains():
    """A grep-as-a-test.

    Only *blanket* catches are banned: `except Exception: pass` and bare
    `except: pass` hide anything at all, including bugs. Narrow catches of named,
    expected exceptions are fine and are used deliberately — `os.kill` raising
    `ProcessLookupError` on an already-dead process IS the desired outcome, and
    logging it would be pure noise.
    """
    import pathlib
    import re

    backend = pathlib.Path(__file__).resolve().parent.parent
    blanket = re.compile(r"except\s*(Exception[^\n]*)?:\s*\n\s*pass\b")
    offenders = []
    for py in backend.rglob("*.py"):
        if "tests" in py.parts or "__pycache__" in py.parts:
            continue
        if blanket.search(py.read_text(encoding="utf-8")):
            offenders.append(str(py.relative_to(backend)))
    assert offenders == [], f"blanket swallowing reintroduced in: {offenders}"
