"""Broker holdings import.

Parses untrusted files and turns them into money, but had no tests. The number
helpers matter most: a mis-parsed quantity or price silently misstates a
portfolio's value.
"""
import pytest

from services.holdings_csv_parser import (
    detect_holdings_format,
    parse_bourso_holdings,
    _decode,
    _parse_number,
    _parse_french_number,
    _parse_smart_number,
)


# ── Encoding ────────────────────────────────────────────────────────────────
def test_decode_handles_bom_and_latin1():
    assert _decode("Société".encode("utf-8-sig")) == "Société"
    assert _decode("Société".encode("latin-1")) == "Société"
    # Undecodable bytes must not raise — the import should degrade, not crash.
    assert isinstance(_decode(b"\xff\xfe\x00bad"), str)


# ── Number parsing ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw, expected", [
    ("1234.56", 1234.56),
    ("1,234.56", 1234.56),   # english thousands separator is stripped
    ("", 0.0),
    ("-", 0.0),
    ("  42 ", 42.0),
])
def test_parse_number_english(raw, expected):
    assert _parse_number(raw) == expected


@pytest.mark.parametrize("raw, expected", [
    ("1234,56", 1234.56),
    ("1 234,56", 1234.56),     # narrow/regular space thousands
    ("1\xa0234,56", 1234.56),  # NBSP
    ("", 0.0),
    ("-", 0.0),
])
def test_parse_french_number(raw, expected):
    assert _parse_french_number(raw) == expected


@pytest.mark.parametrize("raw, expected", [
    ("1,234.56", 1234.56),   # en: comma thousands, dot decimal
    ("1.234,56", 1234.56),   # fr/de: dot thousands, comma decimal
    ("12,50", 12.50),        # fr decimal comma
    ("1234.56", 1234.56),
    ("", 0.0),
    ("-", 0.0),
    ("n/a", 0.0),            # junk degrades to 0 rather than raising
])
def test_parse_smart_number(raw, expected):
    assert _parse_smart_number(raw) == expected


@pytest.mark.parametrize("junk", ["n/a", "abc", "12,34,56"])
def test_number_parsers_never_raise_on_junk(junk):
    """A malformed broker export must not take the whole import down with an
    unhandled ValueError — the user should see the row, not a 500."""
    for fn in (_parse_number, _parse_french_number, _parse_smart_number):
        try:
            fn(junk)
        except Exception as e:  # noqa: BLE001 - that's the point of the test
            pytest.fail(f"{fn.__name__}({junk!r}) raised {type(e).__name__}: {e}")


# ── Format detection ────────────────────────────────────────────────────────
def test_detect_formats():
    bourso = b"name;isin;quantity;buyingPrice;lastPrice\n"
    assert detect_holdings_format(bourso) == "bourso"

    ibkr = b'"Transaction History","Header","Symbol","Quantity"\n'
    assert detect_holdings_format(ibkr) == "ibkr"

    assert detect_holdings_format(b"date;montant;libelle\n") is None


# ── Boursorama parsing ──────────────────────────────────────────────────────
def test_parse_bourso_extracts_positions():
    csv = (
        "name;isin;quantity;buyingPrice;lastPrice\n"
        "AMUNDI MSCI WORLD;LU1681043599;12,5;350,20;402,10\n"
        "AIR LIQUIDE;FR0000120073;4;150,00;168,55\n"
    ).encode("utf-8")
    rows = parse_bourso_holdings(csv)

    assert len(rows) == 2
    first = rows[0]
    assert first.isin == "LU1681043599"
    assert first.quantity == 12.5
    # Money stays in integer cents.
    assert isinstance(first.cost_basis_cents, int)
    assert first.cost_basis_cents == round(12.5 * 350.20 * 100)


def test_parse_bourso_tolerates_a_broken_row():
    """One unreadable line must not lose the whole file."""
    csv = (
        "name;isin;quantity;buyingPrice;lastPrice\n"
        "GOOD;LU1681043599;2;100,00;110,00\n"
        ";;;;\n"
        "ALSO GOOD;FR0000120073;1;50,00;55,00\n"
    ).encode("utf-8")
    rows = parse_bourso_holdings(csv)
    assert len(rows) >= 2
    assert {r.isin for r in rows} >= {"LU1681043599", "FR0000120073"}
