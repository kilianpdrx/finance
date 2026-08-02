"""CSV accents/BOM fix, the comprehensive report endpoints, and chart rendering."""
from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import Category, Transaction

BOM = b"\xef\xbb\xbf"


async def _seed_accented_txn(db: AsyncSession, seed_data: dict):
    pid = seed_data["profile"].id
    acc = seed_data["account_courant"]
    cat = Category(profile_id=pid, name="Santé", color="#ef4444")
    db.add(cat)
    await db.flush()
    db.add(Transaction(profile_id=pid, account_id=acc.id, date=date(2026, 5, 1),
                       description="Café crème à Genève", amount_cents=500, currency="EUR",
                       is_debit=True, category_id=cat.id, import_hash="export_accent_1"))
    await db.commit()


async def test_transactions_csv_keeps_accents_with_bom(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _seed_accented_txn(db_session, seed_data)
    res = await client.get("/api/transactions/export", headers={"X-Profile-Id": str(seed_data['profile'].id)})
    assert res.status_code == 200
    assert "charset=utf-8" in res.headers["content-type"]
    assert res.content.startswith(BOM)  # Excel needs the BOM to detect UTF-8
    text = res.content.decode("utf-8-sig")
    assert "Catégorie" in text          # accented header
    assert "Santé" in text              # accented category, NOT stripped to "Sante"
    assert "Café crème à Genève" in text


async def test_system_csv_has_bom(client: AsyncClient, seed_data: dict):
    res = await client.get("/api/system/export/transactions.csv", headers={"X-Profile-Id": str(seed_data['profile'].id)})
    assert res.status_code == 200
    assert res.content.startswith(BOM)


async def test_report_pdf_endpoint(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _seed_accented_txn(db_session, seed_data)
    res = await client.get(
        "/api/system/export/report.pdf?date_from=2026-01-01&date_to=2026-06-30&include_investments=false",
        headers={"X-Profile-Id": str(seed_data['profile'].id)},
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content[:5] == b"%PDF-"
    assert len(res.content) > 2000


async def test_report_xlsx_endpoint(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    await _seed_accented_txn(db_session, seed_data)
    res = await client.get(
        "/api/system/export/report.xlsx?date_from=2026-01-01&date_to=2026-06-30&include_investments=true",
        headers={"X-Profile-Id": str(seed_data['profile'].id)},
    )
    assert res.status_code == 200
    assert "spreadsheetml" in res.headers["content-type"]
    assert res.content[:2] == b"PK"  # xlsx is a zip
    assert len(res.content) > 2000


def test_charts_render_png_and_font_registered():
    from services import report_charts as rc
    reg, bold = rc.register_pdf_fonts()
    assert (reg, bold) == ("DejaVuSans", "DejaVuSans-Bold")
    from reportlab.pdfbase import pdfmetrics
    assert "DejaVuSans" in pdfmetrics.getRegisteredFontNames()

    months = ["2026-01", "2026-02", "2026-03"]
    for png in (
        rc.networth_area(months, [1000, 2000, 3000], "EUR"),
        rc.cashflow_bars(months, [300, 320, 310], [250, 270, 260], [50, 50, 50], "EUR"),
        rc.donut(["A", "B"], [100, 200], "EUR"),
        rc.category_trends([{"name": "X", "months": months, "values_cents": [10, 20, 30]}], "EUR"),
        rc.dividend_stacked(months, [{"name": "Tech", "values_cents": [1, 2, 3]}], "EUR"),
    ):
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
