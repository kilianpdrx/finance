"""Build an Excel workbook and a PDF report (financial summary + budget table)
from the same data the analytics endpoints already compute."""
import io

from sqlalchemy.ext.asyncio import AsyncSession

from schemas import cents_to_display


async def gather_report_data(db: AsyncSession, pid: int, year: int):
    """Reuse the analytics route handlers directly (they are plain async funcs).
    Returns (AnalyticsSummary, BudgetFullResponse)."""
    from routers.analytics import summary as _summary, budget_full as _budget_full
    summ = await _summary(db=db, pid=pid)
    budget = await _budget_full(year=year, account_id=None, account_ids=None, db=db, pid=pid)
    return summ, budget


def _eur(cents: int) -> float:
    return round((cents or 0) / 100.0, 2)


def _cell_value(c) -> int:
    """Mirror the UI's displayed cell value: realized + manual adjustment, plus a
    planned forecast while it is still unrealized."""
    planned_active = c.planned_cents != 0 and not c.planned_matched and c.actual_cents == 0
    return c.actual_cents + c.expected_cents + (c.planned_cents if planned_active else 0)


def _total_value(c) -> int:
    # Section-total cells already fold active planned amounts into expected.
    return c.actual_cents + c.expected_cents


def _summary_rows(summ):
    return [
        ("Patrimoine net", summ.net_worth_cents),
        ("Patrimoine hors emprunts", summ.net_worth_excl_loans_cents),
        ("Emprunts (restant dû)", summ.total_loans_cents),
        ("Revenus (période)", summ.total_income_cents),
        ("Dépenses (période)", summ.total_expenses_cents),
        ("Flux net (période)", summ.net_cash_flow_cents),
    ]


# ── Excel ─────────────────────────────────────────────────────────────────────

def build_xlsx(summ, budget, base_ccy: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    bold = Font(bold=True)
    wb = Workbook()

    ws = wb.active
    ws.title = "Résumé"
    ws["A1"] = "Résumé financier"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = f"Devise de base : {base_ccy}"
    r = 4
    for label, cents in _summary_rows(summ):
        ws.cell(row=r, column=1, value=label).font = bold
        ws.cell(row=r, column=2, value=_eur(cents))
        r += 1
    if summ.net_worth_by_currency:
        r += 1
        ws.cell(row=r, column=1, value="Patrimoine par devise").font = bold
        r += 1
        for col, head in enumerate(("Devise", "Montant natif", f"Converti ({base_ccy})"), start=1):
            ws.cell(row=r, column=col, value=head).font = bold
        r += 1
        for c in summ.net_worth_by_currency:
            ws.cell(row=r, column=1, value=c.currency)
            ws.cell(row=r, column=2, value=_eur(c.native_cents))
            ws.cell(row=r, column=3, value=_eur(c.converted_cents))
            r += 1
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["C"].width = 16

    ws2 = wb.create_sheet("Budget")
    ws2.append(["Catégorie", *budget.months, "Total"])
    for cell in ws2[1]:
        cell.font = bold
    for section in budget.sections:
        ws2.append([section.section_label])
        ws2.cell(row=ws2.max_row, column=1).font = bold
        for row in section.rows:
            total = sum(_cell_value(c) for c in row.cells)
            ws2.append([row.category_name, *[_eur(_cell_value(c)) for c in row.cells], _eur(total)])
        tot = section.section_totals
        total = sum(_total_value(c) for c in tot.cells)
        ws2.append([tot.category_name, *[_eur(_total_value(c)) for c in tot.cells], _eur(total)])
        for cell in ws2[ws2.max_row]:
            cell.font = bold
    ws2.column_dimensions["A"].width = 26

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── PDF ───────────────────────────────────────────────────────────────────────

def _fmt_num(cents: int) -> str:
    return f"{round((cents or 0) / 100):,}".replace(",", " ")  # thin-space thousands


def _short_month(m: str) -> str:
    return f"{m[5:7]}/{m[2:4]}"  # "2026-03" -> "03/26"


def build_pdf(summ, budget, base_ccy: str, year: int) -> bytes:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4), title="Rapport financier",
        leftMargin=1 * cm, rightMargin=1 * cm, topMargin=1 * cm, bottomMargin=1 * cm,
    )
    styles = getSampleStyleSheet()
    elems = [
        Paragraph(f"Rapport financier — {year}", styles["Title"]),
        Paragraph(f"Devise de base : {base_ccy}", styles["Normal"]),
        Spacer(1, 0.4 * cm),
    ]

    summary_data = [[label, cents_to_display(cents, base_ccy)] for label, cents in _summary_rows(summ)]
    st = Table(summary_data, colWidths=[6 * cm, 5 * cm], hAlign="LEFT")
    st.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elems += [st, Spacer(1, 0.6 * cm), Paragraph("Budget", styles["Heading2"])]

    header = ["Catégorie", *[_short_month(m) for m in budget.months], "Total"]
    data = [header]
    cmds = [
        ("FONTSIZE", (0, 0), (-1, -1), 6),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
    ]
    ridx = 1
    for section in budget.sections:
        data.append([section.section_label, *[""] * (len(budget.months) + 1)])
        cmds += [
            ("SPAN", (0, ridx), (-1, ridx)),
            ("FONTNAME", (0, ridx), (-1, ridx), "Helvetica-Bold"),
            ("BACKGROUND", (0, ridx), (-1, ridx), colors.HexColor("#f3f4f6")),
        ]
        ridx += 1
        for row in section.rows:
            total = sum(_cell_value(c) for c in row.cells)
            data.append([row.category_name, *[_fmt_num(_cell_value(c)) for c in row.cells], _fmt_num(total)])
            ridx += 1
        tot = section.section_totals
        total = sum(_total_value(c) for c in tot.cells)
        data.append([tot.category_name, *[_fmt_num(_total_value(c)) for c in tot.cells], _fmt_num(total)])
        cmds.append(("FONTNAME", (0, ridx), (-1, ridx), "Helvetica-Bold"))
        ridx += 1

    n = len(budget.months)
    month_w = (27.7 - 3.2 - 1.8) / max(1, n)
    col_widths = [3.2 * cm, *[month_w * cm] * n, 1.8 * cm]
    bt = Table(data, colWidths=col_widths, repeatRows=1)
    bt.setStyle(TableStyle(cmds))
    elems.append(bt)

    doc.build(elems)
    return buf.getvalue()
