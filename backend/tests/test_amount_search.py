"""The Transactions search box finds a label OR an amount.

Typing an amount is how one looks for "that payment of 23,40": the precision
typed is the precision searched, and a sign restricts the direction.
"""
from datetime import date

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import Transaction
from utils import parse_amount_query

pytestmark = pytest.mark.asyncio


# ── Reading the text ────────────────────────────────────────────────────────
@pytest.mark.parametrize("text, lo, hi", [
    ("23", 2300, 2399),          # whole amount: any cents
    ("23,4", 2340, 2349),        # one decimal: the ten cents it starts
    ("23,40", 2340, 2340),       # two decimals: exact
    ("23.40", 2340, 2340),       # point or comma
    ("23,", 2300, 2399),
    ("1 850", 185000, 185099),   # grouped thousands
    ("1'850,5", 185050, 185059),
    ("0,99", 99, 99),
])
async def test_precision_typed_is_precision_searched(text, lo, hi):
    q = parse_amount_query(text)
    assert (q.lo_cents, q.hi_cents) == (lo, hi)


async def test_sign_restricts_the_direction():
    assert parse_amount_query("23,40").is_debit is None
    assert parse_amount_query("-23,40").is_debit is True
    assert parse_amount_query("−23,40 €").is_debit is True     # copied from the table (U+2212)
    assert parse_amount_query("+23,40").is_debit is False


async def test_only_a_bare_whole_number_may_also_be_a_label():
    """ "5106" can be a reference inside a label; "23,40", "-23" or "23 €" cannot."""
    assert parse_amount_query("5106").amount_only is False
    for text in ("23,40", "23,", "-23", "23 €", "12 CHF"):
        assert parse_amount_query(text).amount_only is True, text


@pytest.mark.parametrize("text", ["", "   ", "abc", "FRANPRIX 5106", "23,400", "1.850.000", "12345678901", None])
async def test_what_is_not_an_amount(text):
    assert parse_amount_query(text) is None


# ── Searching ───────────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def priced(db_session: AsyncSession, seed_data: dict):
    pid, acc = seed_data["profile"].id, seed_data["account_courant"]
    rows = [
        ("groceries", "CARTE FRANPRIX 5106 PARIS", 2340, True, {}),
        ("refund", "REMBOURSEMENT FRANPRIX", 2340, False, {}),
        ("bakery", "BOULANGERIE DU COIN", 2345, True, {}),
        ("cinema", "CINEMA 23 RUE DES ARTS", 1150, True, {}),
        ("abroad", "CARTE DINER LONDON", 6120, True, {"original_amount_cents": 5200, "original_currency": "GBP"}),
        ("rent", "PRLV LOYER", 185000, True, {}),
    ]
    out = {}
    for i, (key, label, cents, is_debit, extra) in enumerate(rows):
        t = Transaction(profile_id=pid, account_id=acc.id, date=date(2026, 9, 1 + i), amount_cents=cents,
                        is_debit=is_debit, currency="EUR", description=label, import_hash=f"amt_{key}", **extra)
        out[key] = t
        db_session.add(t)
    await db_session.commit()
    return out


async def _found(client: AsyncClient, seed_data: dict, search: str) -> set:
    res = await client.get("/api/transactions", headers={"X-Profile-Id": str(seed_data["profile"].id)},
                           params={"search": search})
    assert res.status_code == 200, res.text
    return {t["description"] for t in res.json()}


async def test_exact_amount(client: AsyncClient, seed_data: dict, priced: dict):
    assert await _found(client, seed_data, "23,40") == {"CARTE FRANPRIX 5106 PARIS", "REMBOURSEMENT FRANPRIX"}
    assert await _found(client, seed_data, "23.40 €") == {"CARTE FRANPRIX 5106 PARIS", "REMBOURSEMENT FRANPRIX"}


async def test_sign_keeps_one_direction(client: AsyncClient, seed_data: dict, priced: dict):
    assert await _found(client, seed_data, "-23,40") == {"CARTE FRANPRIX 5106 PARIS"}
    assert await _found(client, seed_data, "+23,40") == {"REMBOURSEMENT FRANPRIX"}


async def test_partial_amount_narrows_as_you_type(client: AsyncClient, seed_data: dict, priced: dict):
    assert await _found(client, seed_data, "23,4") == {
        "CARTE FRANPRIX 5106 PARIS", "REMBOURSEMENT FRANPRIX", "BOULANGERIE DU COIN"}
    assert await _found(client, seed_data, "23,45") == {"BOULANGERIE DU COIN"}


async def test_whole_number_searches_labels_and_amounts(client: AsyncClient, seed_data: dict, priced: dict):
    """ "23": the three amounts of 23,xx AND the label that contains "23"."""
    assert await _found(client, seed_data, "23") == {
        "CARTE FRANPRIX 5106 PARIS", "REMBOURSEMENT FRANPRIX", "BOULANGERIE DU COIN", "CINEMA 23 RUE DES ARTS"}
    # A reference number stays findable.
    assert await _found(client, seed_data, "5106") == {"CARTE FRANPRIX 5106 PARIS"}
    assert await _found(client, seed_data, "1 850") == {"PRLV LOYER"}


async def test_amount_charged_abroad_is_found_too(client: AsyncClient, seed_data: dict, priced: dict):
    assert await _found(client, seed_data, "52,00") == {"CARTE DINER LONDON"}     # the GBP amount
    assert await _found(client, seed_data, "61,20") == {"CARTE DINER LONDON"}     # what the account was charged


async def test_text_search_is_unchanged(client: AsyncClient, seed_data: dict, priced: dict):
    assert await _found(client, seed_data, "franprix") == {"CARTE FRANPRIX 5106 PARIS", "REMBOURSEMENT FRANPRIX"}
    assert await _found(client, seed_data, "99,99") == set()


async def test_count_and_stats_follow_the_same_search(client: AsyncClient, seed_data: dict, priced: dict):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    assert (await client.get("/api/transactions/count", headers=h, params={"search": "23,40"})).json()["total"] == 2
    assert (await client.get("/api/transactions/stats", headers=h, params={"search": "-23,40"})).json()["total"] == 1
    ids = (await client.get("/api/transactions/ids", headers=h, params={"search": "23,45"})).json()["ids"]
    assert ids == [priced["bakery"].id]


async def test_amount_search_is_profile_scoped(client: AsyncClient, seed_data: dict, priced: dict, extra_profile):
    res = await client.get("/api/transactions", headers={"X-Profile-Id": str(extra_profile.id)}, params={"search": "23,40"})
    assert res.json() == []
