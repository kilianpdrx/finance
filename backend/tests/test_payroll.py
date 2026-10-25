"""Salaire & impôts (services/payroll, routers/payroll.py).

Every payslip here is INVENTED and drawn by the test itself with reportlab —
a Zurich « Lohnabrechnung » and a French « bulletin de paie » — then read
back like a user's PDF. Nothing is saved before the review; a line the user
classifies once is classified on the next payslips; the salary deposit is
found in the bank, never written."""
import io
import json
from datetime import date

import pytest
from httpx import AsyncClient
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import func, select

from models import (
    Account, AccountType, Document, Employer, PayrollSituation, Payslip, PayslipLabelRule, PayslipLine, Transaction,
)
from services.payroll import reading, vocab

CH_ROWS = [
    ("Monatslohn", "", "", "8'500.00"),
    ("Bonus", "", "", "500.00"),
    ("Bruttolohn", "", "", "9'000.00"),
    ("AHV/IV/EO", "9'000.00", "5.30%", "-477.00"),
    ("ALV", "9'000.00", "1.10%", "-99.00"),
    ("NBU", "9'000.00", "0.95%", "-85.50"),
    ("BVG / Pensionskasse", "", "", "-412.35"),
    ("Kantinenabzug", "", "", "-120.00"),
    ("Quellensteuer A0N", "9'000.00", "10.56%", "-950.40"),
    ("Nettolohn", "", "", "6'855.75"),
    ("Spesen Pauschal", "", "", "150.00"),
    ("Auszahlung", "", "", "7'005.75"),
]


def ch_payslip(month: str = "September 2026", pay_day: str = "25.09.2026", rows=CH_ROWS) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 10)
    y = 800
    for text in ("Beispiel AG, Bahnhofstrasse 1, 8001 Zürich", f"Lohnabrechnung {month}",
                 "Erika Muster, AHV-Nr. 756.0000.0000.00", f"Auszahlungsdatum {pay_day}"):
        c.drawString(50, y, text)
        y -= 16
    y -= 10
    for label, base, rate, amount in rows:
        c.drawString(50, y, label)
        if base:
            c.drawRightString(330, y, base)
        if rate:
            c.drawRightString(400, y, rate)
        c.drawRightString(520, y, amount)
        y -= 14
    c.save()
    return buf.getvalue()


def fr_payslip() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 8)
    c.drawString(40, 810, "EXEMPLE SAS - 1 rue de la Paix 75002 Paris")
    c.drawString(40, 795, "BULLETIN DE PAIE   Période du 01/09/2026 au 30/09/2026   Paiement le 30/09/2026")
    y = 770
    for x, t in ((40, "Éléments de paie"), (250, "Base"), (300, "Taux"), (345, "À payer"), (400, "À déduire"),
                 (455, "Taux"), (500, "Part employeur")):
        c.drawString(x, y, t)
    y -= 14
    rows = [
        ("Salaire de base", "151,67", "23,0764", "3 500,00", "", "", ""),
        ("SALAIRE BRUT", "", "", "3 500,00", "", "", ""),
        ("Sécurité sociale - Maladie", "3 500,00", "", "", "", "7,0000", "245,00"),
        ("Retraite Sécurité sociale plafonnée", "3 500,00", "6,9000", "", "241,50", "8,5500", "299,25"),
        ("Retraite complémentaire T1", "3 500,00", "4,0100", "", "140,35", "6,0100", "210,35"),
        ("CSG déductible de l'impôt sur le revenu", "3 439,75", "6,8000", "", "233,90", "", ""),
        ("CSG/CRDS non déductible de l'impôt sur le revenu", "3 439,75", "2,9000", "", "99,75", "", ""),
        ("Total des cotisations et contributions", "", "", "", "715,50", "", "754,60"),
        ("Net à payer avant impôt sur le revenu", "", "", "2 784,50", "", "", ""),
        ("Impôt sur le revenu prélevé à la source", "2 884,25", "7,40 %", "", "213,43", "", ""),
        ("Net payé", "", "", "2 571,07", "", "", ""),
        ("Montant net social", "", "", "2 784,50", "", "", ""),
        ("Net imposable", "", "", "2 884,25", "", "", ""),
    ]
    for label, base, rate, gain, deduct, rate2, employer in rows:
        c.drawString(40, y, label)
        for x, v in ((285, base), (330, rate), (385, gain), (440, deduct), (490, rate2), (560, employer)):
            if v:
                c.drawRightString(x, y, v)
        y -= 12
    c.save()
    return buf.getvalue()


def blank_pdf() -> bytes:
    """A scan: a page with a picture and no text."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.rect(50, 50, 400, 600, fill=1)
    c.save()
    return buf.getvalue()


# ── Reading ─────────────────────────────────────────────────────────────────

def test_numbers_are_told_apart():
    def shape(text):
        return [(t.kind, t.value, t.negative) for t in reading.tokens(text)]

    assert shape("AHV/IV/EO   9'000.00   5.30%   -477.00") == [("money", 900000, False), ("rate", 530, False),
                                                              ("money", 47700, True)]
    assert shape("Retraite   3 500,00   6,9000   241,50") == [("money", 350000, False), ("rate", 690, False),
                                                           ("money", 24150, False)]
    assert shape("Impôt   2 884,25   7,40 %   213,43")[1] == ("rate", 740, False)
    assert shape("Abzug  85.50-") == [("money", 8550, True)]
    assert shape("Datum 30.09.2026") == []                     # a date is not an amount
    assert shape("AHV-Nr. 756.1234.5678.97") == []             # nor a social security number
    assert shape("8001 Zürich, Tel. 044 123 45 67") == []


def test_the_month_and_the_pay_date():
    assert reading.find_period("Lohnabrechnung März 2026\nAuszahlung") == "2026-03"
    assert reading.find_period("Période du 01/02/2026 au 28/02/2026") == "2026-02"
    assert reading.find_period("Firma\nMonat: 11.2026") == "2026-11"
    assert reading.find_period("Rien qui ressemble à un mois") is None
    assert reading.find_pay_date("Auszahlungsdatum 25.09.2026") == date(2026, 9, 25)
    assert reading.find_pay_date("Paiement le 30/09/2026") == date(2026, 9, 30)


def test_a_zurich_payslip_is_read_line_by_line():
    p = reading.read(ch_payslip(), "ch_zh")
    kinds = {ln.label: ln.kind for ln in p.lines}
    assert p.period == "2026-09" and p.pay_date == date(2026, 9, 25)
    assert kinds == {"Monatslohn": "gross", "Bonus": "gross", "AHV/IV/EO": "social", "ALV": "social", "NBU": "social",
                     "BVG / Pensionskasse": "pension", "Kantinenabzug": None, "Quellensteuer A0N": "tax",
                     "Spesen Pauschal": "addition"}
    tax = next(ln for ln in p.lines if ln.kind == "tax")
    assert (tax.base_cents, tax.rate_bp, tax.amount_cents) == (900000, 1056, 95040)
    f = p.figures
    assert (f["gross_cents"], f["employee_contributions_cents"], f["withholding_cents"], f["net_paid_cents"]) == \
        (900000, 47700 + 9900 + 8550 + 41235, 95040, 700575)
    # The canteen line nobody classified is exactly what the net misses.
    assert p.checks == {"no_text": False, "no_amount": False, "unclassified": 1, "net_mismatch_cents": 12000,
                        "period_missing": False}
    # Classified once (a rule of the employer), the payslip adds up.
    q = reading.read(ch_payslip(), "ch_zh", {"kantinenabzug": "deduction"})
    assert q.checks["unclassified"] == 0 and q.checks["net_mismatch_cents"] == 0


HELD_BACK_ROWS = [r for r in CH_ROWS if r[0] != "Auszahlung"] + [
    ("Total Rückbehalt kumulierte Lohnarten", "", "", "-310.00"),
    ("Auszahlung", "", "", "6'695.75"),
]


def test_pay_held_back_until_the_end_of_the_contract():
    """« Rückbehalt »: earned, kept off this month's payout, owed later — never a total."""
    assert vocab.known_kind("ch_zh", "Total Rückbehalt kumulierte Lohnarten") == vocab.RETAINED
    assert vocab.known_kind("ch_zh", "Auszahlung Rückbehalt") == vocab.RELEASED
    assert vocab.known_kind("ch_zh", "Auszahlung") == vocab.PAYOUT_TOTAL
    p = reading.read(ch_payslip(rows=HELD_BACK_ROWS), "ch_zh", {"kantinenabzug": "deduction"})
    held = next(ln for ln in p.lines if ln.kind == vocab.RETAINED)
    assert (held.label, held.amount_cents) == ("Total Rückbehalt kumulierte Lohnarten", 31000)
    # The payout is lower by exactly what is held back.
    assert p.figures["net_paid_cents"] == 669575 and p.checks["net_mismatch_cents"] == 0


def test_a_label_may_start_with_a_number_and_the_gross_is_its_lines():
    """« 25%-Überzeit-Zuschlag » keeps its percentage in the label (it was a
    row with no label, dropped); with no « Bruttolohn » printed, the gross is
    the sum of the gross lines."""
    rows = [("Monatslohn", "", "", "8'500.00"), ("25%-Überzeit-Zuschlag auf Bruttolohn", "", "", "7.05"),
            ("AHV/IV/EO", "8'507.05", "5.30%", "-450.87"), ("Auszahlung", "", "", "8'056.18")]
    p = reading.read(ch_payslip(rows=rows), "ch_zh", {"uberzeit zuschlag auf bruttolohn": "gross"})
    extra = next(ln for ln in p.lines if ln.key == "uberzeit zuschlag auf bruttolohn")
    assert (extra.label, extra.kind, extra.amount_cents, extra.rate_bp) == ("25%-Überzeit-Zuschlag auf Bruttolohn", "gross", 705, None)
    assert vocab.GROSS_TOTAL not in p.totals
    assert p.figures["gross_cents"] == 850705 and p.checks["net_mismatch_cents"] == 0


def test_a_french_payslip_is_read_by_its_columns():
    p = reading.read(fr_payslip(), "fr")
    lines = {ln.label: ln for ln in p.lines}
    assert (p.period, p.pay_date) == ("2026-09", date(2026, 9, 30))
    assert lines["Salaire de base"].kind == "gross" and lines["Salaire de base"].amount_cents == 350000
    # « CSG déductible de l'impôt sur le revenu » is a contribution, not the tax.
    assert lines["CSG déductible de l'impôt sur le revenu"].kind == "social"
    retraite = lines["Retraite Sécurité sociale plafonnée"]
    assert (retraite.base_cents, retraite.rate_bp, retraite.amount_cents, retraite.employer_cents) == (350000, 690, 24150, 29925)
    assert lines["Sécurité sociale - Maladie"].amount_cents == 0          # the employer's alone
    f = p.figures
    assert (f["gross_cents"], f["employee_contributions_cents"], f["employer_contributions_cents"]) == (350000, 71550, 75460)
    assert (f["withholding_cents"], f["withholding_rate_bp"], f["taxable_cents"], f["net_paid_cents"]) == \
        (21343, 740, 288425, 257107)
    assert p.checks["net_mismatch_cents"] == 0 and p.checks["unclassified"] == 0


def test_what_is_not_a_payslip_pdf():
    with pytest.raises(reading.ReadError, match="pas un PDF"):
        reading.read(b"GIF89a....", "ch_zh")
    with pytest.raises(reading.ReadError, match="trop volumineux"):
        reading.read(b"%PDF-1.7" + b"0" * reading.MAX_BYTES, "ch_zh")
    with pytest.raises(reading.ReadError, match="ne peut pas être lu"):
        reading.read(b"%PDF-1.7 broken", "ch_zh")
    assert reading.read(blank_pdf(), "ch_zh").checks == {"no_text": True}


def test_label_keys_survive_the_month():
    assert vocab.normalize_label("13. Monatslohn") == vocab.normalize_label("Monatslohn") == "monatslohn"
    assert vocab.normalize_label("Impôt à la source") == "impot a la source"


# ── Through the API ─────────────────────────────────────────────────────────

@pytest.fixture
async def zurich(client: AsyncClient, db_session, seed_data):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    chf = Account(profile_id=pid, name="UBS Privatkonto", bank_name="UBS", account_type=AccountType.courant, currency="CHF")
    db_session.add(chf)
    await db_session.commit()
    res = await client.post("/api/payroll/situations", headers=h,
                            json={"from_year": 2026, "pack": "ch_zh", "params": {"regime": "source", "tariff": "a0n"}})
    assert res.status_code == 200, res.text
    employer = (await client.post("/api/payroll/employers", headers=h,
                                  json={"name": "Beispiel AG", "currency": "CHF", "account_id": chf.id})).json()
    return {"h": h, "pid": pid, "account": chf, "employer": employer}


async def _read(client, w, *pdfs, employer=True):
    params = {"pack": "ch_zh", **({"employer_id": w["employer"]["id"]} if employer else {})}
    files = [("files", (f"fiche-{i}.pdf", data, "application/pdf")) for i, data in enumerate(pdfs)]
    res = await client.post("/api/payroll/read", headers=w["h"], params=params, files=files)
    assert res.status_code == 200, res.text
    return res.json()


def _checked(proposal: dict, employer_id: int, **over) -> dict:
    """What the review sends once the user has checked it: the canteen line classified."""
    lines = [{k: ln[k] for k in ("label", "amount_cents", "base_cents", "rate_bp", "employer_cents")}
             | {"kind": ln["kind"] or "deduction"} for ln in proposal["lines"]]
    figures = {k: v for k, v in proposal["figures"].items() if k not in ("computed_net_cents", "printed_net")}
    return {"employer_id": employer_id, "period": proposal["period"], "pay_date": proposal["pay_date"],
            "lines": lines, **figures, **over}


async def _save(client, w, body: dict, pdf: bytes = None):
    files = {"file": ("fiche.pdf", pdf, "application/pdf")} if pdf is not None else None
    return await client.post("/api/payroll/payslips", headers=w["h"], data={"data": json.dumps(body)}, files=files)


async def test_a_situation_is_checked_against_its_pack(client: AsyncClient, zurich):
    h = zurich["h"]
    situations = (await client.get("/api/payroll/situations", headers=h)).json()
    assert situations[0]["params"]["tariff"] == "A0N"
    assert situations[0]["summary"] == "Zurich · impôt à la source · A0N"
    bad = await client.post("/api/payroll/situations", headers=h,
                            json={"from_year": 2027, "pack": "ch_zh", "params": {"regime": "source", "tariff": "zz"}})
    assert bad.status_code == 400 and "A0N" in bad.json()["detail"]
    assert (await client.post("/api/payroll/situations", headers=h,
                              json={"from_year": 2027, "pack": "xx", "params": {}})).status_code == 400
    # Moving to France in 2027: a second row; the same year again replaces it.
    for children in (1, 2):
        moved = await client.post("/api/payroll/situations", headers=h, json={
            "from_year": 2027, "pack": "fr", "params": {"household": "couple", "children": children}})
        assert moved.status_code == 200
    assert [(s["from_year"], s["summary"]) for s in (await client.get("/api/payroll/situations", headers=h)).json()] == \
        [(2026, "Zurich · impôt à la source · A0N"), (2027, "France · couple · 2 enfants")]
    packs = {p["id"]: p for p in (await client.get("/api/payroll/packs", headers=h)).json()}
    assert packs["ch_zh"]["currency"] == "CHF" and "month" in packs["ch_zh"]["widgets"]


async def test_reading_saves_nothing_and_a_checked_payslip_is_saved_with_its_pdf(client: AsyncClient, db_session, zurich):
    pdf = ch_payslip()
    proposal, = await _read(client, zurich, pdf)
    assert proposal["error"] is None and proposal["period"] == "2026-09"
    assert proposal["checks"]["unclassified"] == 1
    assert (await db_session.execute(select(func.count(Document.id)))).scalar() == 0      # read, not kept

    res = await _save(client, zurich, _checked(proposal, zurich["employer"]["id"]), pdf)
    assert res.status_code == 201, res.text
    saved = res.json()
    assert (saved["source"], saved["currency"], saved["net_paid_cents"]) == ("pdf", "CHF", 700575)
    assert [ln["kind"] for ln in saved["lines"]].count("deduction") == 1

    # The PDF is served back, as a PDF.
    doc = await client.get(f"/api/payroll/documents/{saved['document_id']}", headers=zurich["h"])
    assert doc.status_code == 200 and doc.content == pdf
    assert doc.headers["content-type"] == "application/pdf" and doc.headers["x-content-type-options"] == "nosniff"

    # The same file again: flagged when read, refused when saved.
    again, = await _read(client, zurich, pdf)
    assert again["duplicate_payslip_id"] == saved["id"]
    assert (await _save(client, zurich, _checked(again, zurich["employer"]["id"]), pdf)).status_code == 409


async def test_a_line_classified_once_is_classified_on_the_next_payslips(client: AsyncClient, zurich):
    eid = zurich["employer"]["id"]
    september, = await _read(client, zurich, ch_payslip())
    assert (await _save(client, zurich, _checked(september, eid), ch_payslip())).status_code == 201
    rules = (await client.get("/api/payroll/label-rules", headers=zurich["h"])).json()
    assert rules == [{"employer_id": eid, "label_key": "kantinenabzug", "kind": "deduction"}]

    october_pdf = ch_payslip("Oktober 2026", "24.10.2026")
    october, = await _read(client, zurich, october_pdf)
    assert october["period"] == "2026-10"
    assert {ln["label"]: ln["kind"] for ln in october["lines"]}["Kantinenabzug"] == "deduction"
    assert october["checks"]["unclassified"] == 0 and october["checks"]["net_mismatch_cents"] == 0
    # Without the employer, no rule applies: still « à classer ».
    anonymous, = await _read(client, zurich, october_pdf, employer=False)
    assert anonymous["checks"]["unclassified"] == 1


async def test_held_back_pay_is_saved_as_its_own_kind(client: AsyncClient, zurich):
    proposal, = await _read(client, zurich, ch_payslip(rows=HELD_BACK_ROWS))
    assert proposal["checks"]["unclassified"] == 1        # the canteen, as before
    assert (await _save(client, zurich, _checked(proposal, zurich["employer"]["id"]))).status_code == 201
    slip, = (await client.get("/api/payroll/payslips", headers=zurich["h"])).json()
    assert [(ln["kind"], ln["amount_cents"]) for ln in slip["lines"] if ln["kind"] == "retained"] == [("retained", 31000)]
    assert slip["net_paid_cents"] == 669575

    # Classified « autre retenue » before the vocabulary knew it: each line says what the
    # vocabulary would give it, so the board can point it out. A total is no line's type.
    body = _checked(proposal, zurich["employer"]["id"])
    body["lines"] = [ln | ({"kind": "deduction"} if ln["label"].startswith("Total Rück") else {}) for ln in body["lines"]]
    body["lines"].append({"label": "Bruttolohn", "kind": "info", "amount_cents": 900000})
    assert (await client.put(f"/api/payroll/payslips/{slip['id']}", headers=zurich["h"], json=body)).status_code == 200
    slip, = (await client.get("/api/payroll/payslips", headers=zurich["h"])).json()
    vocab_kinds = {ln["label"]: (ln["kind"], ln["vocab_kind"]) for ln in slip["lines"]}
    assert vocab_kinds["Total Rückbehalt kumulierte Lohnarten"] == ("deduction", "retained")
    assert vocab_kinds["Kantinenabzug"] == ("deduction", None) and vocab_kinds["AHV/IV/EO"] == ("social", "social")
    assert vocab_kinds["Bruttolohn"] == ("info", None)


async def test_one_payslip_per_employer_and_month(client: AsyncClient, zurich):
    eid = zurich["employer"]["id"]
    proposal, = await _read(client, zurich, ch_payslip())
    assert (await _save(client, zurich, _checked(proposal, eid))).status_code == 201       # typed, no PDF
    twice = await _save(client, zurich, _checked(proposal, eid))
    assert twice.status_code == 409 and "déjà une fiche de paie pour 2026-09" in twice.json()["detail"]
    replaced = await _save(client, zurich, _checked(proposal, eid, replace=True, net_paid_cents=700000))
    assert replaced.status_code == 201
    slips = (await client.get("/api/payroll/payslips", headers=zurich["h"])).json()
    assert [(s["period"], s["net_paid_cents"], s["source"]) for s in slips] == [("2026-09", 700000, "manual")]
    assert (await _save(client, zurich, _checked(proposal, eid, period="2026-13"))).status_code == 400


async def test_the_salary_deposit_is_found_and_never_written(client: AsyncClient, db_session, zurich):
    w, pid, account = zurich, zurich["pid"], zurich["account"]
    eid = w["employer"]["id"]

    def deposit(day: date, cents: int, n: int, label: str = "LOHN BEISPIEL AG"):
        return Transaction(profile_id=pid, account_id=account.id, date=day, description=label, amount_cents=cents,
                           is_debit=False, currency="CHF", import_hash=f"pay-{n}")

    db_session.add_all([
        deposit(date(2026, 9, 25), 700575, 1),                     # September: the exact net
        deposit(date(2026, 10, 24), 699000, 2),                    # October: 15.75 short
        deposit(date(2026, 10, 24), 120000, 3, "TWINT"),           # not a salary
    ])
    await db_session.commit()
    for month, day in (("September 2026", "25.09.2026"), ("Oktober 2026", "24.10.2026"), ("November 2026", "25.11.2026")):
        pdf = ch_payslip(month, day)
        proposal, = await _read(client, w, pdf)
        assert (await _save(client, w, _checked(proposal, eid), pdf)).status_code == 201

    slips = {s["period"]: s["deposit"] for s in (await client.get("/api/payroll/payslips", headers=w["h"])).json()}
    assert (slips["2026-09"]["status"], slips["2026-09"]["amount_cents"]) == ("paid", 700575)
    assert (slips["2026-10"]["status"], slips["2026-10"]["difference_cents"]) == ("gap", -1575)
    assert slips["2026-11"]["status"] == "missing"
    rows = (await db_session.execute(select(Transaction).where(Transaction.profile_id == pid))).scalars().all()
    assert all(t.category_id is None for t in rows)                # nothing classified, nothing linked

    # A word of the label narrows it; an employer without an account says so.
    await client.put(f"/api/payroll/employers/{eid}", headers=w["h"],
                     json={"name": "Beispiel AG", "currency": "CHF", "account_id": account.id, "label_hint": "salaire"})
    slips = {s["period"]: s["deposit"] for s in (await client.get("/api/payroll/payslips", headers=w["h"])).json()}
    assert slips["2026-09"]["status"] == "missing"
    await client.put(f"/api/payroll/employers/{eid}", headers=w["h"], json={"name": "Beispiel AG", "currency": "CHF"})
    assert {s["deposit"]["status"] for s in (await client.get("/api/payroll/payslips", headers=w["h"])).json()} == {"no_account"}


async def test_another_profile_never_reaches_this_one(client: AsyncClient, db_session, zurich, extra_profile):
    other = {"X-Profile-Id": str(extra_profile.id)}
    pdf = ch_payslip()
    proposal, = await _read(client, zurich, pdf)
    saved = (await _save(client, zurich, _checked(proposal, zurich["employer"]["id"]), pdf)).json()
    assert (await client.get(f"/api/payroll/documents/{saved['document_id']}", headers=other)).status_code == 404
    assert (await client.get("/api/payroll/payslips", headers=other)).json() == []
    stranger = await client.post("/api/payroll/payslips", headers=other,
                                 data={"data": json.dumps(_checked(proposal, zurich["employer"]["id"]))})
    assert stranger.status_code == 404
    borrowed = await client.post("/api/payroll/employers", headers=other,
                                 json={"name": "X", "currency": "CHF", "account_id": zurich["account"].id})
    assert borrowed.status_code == 404
    assert (await client.delete(f"/api/payroll/payslips/{saved['id']}", headers=other)).status_code == 404


async def test_deleting_takes_lines_documents_and_rules_along(client: AsyncClient, db_session, zurich):
    w = zurich
    pdf = ch_payslip()
    proposal, = await _read(client, w, pdf)
    saved = (await _save(client, w, _checked(proposal, w["employer"]["id"]), pdf)).json()

    # An employer with payslips is not deleted; its payslip is, with its lines and PDF.
    assert (await client.delete(f"/api/payroll/employers/{w['employer']['id']}", headers=w["h"])).status_code == 409
    assert (await client.delete(f"/api/payroll/payslips/{saved['id']}", headers=w["h"])).status_code == 204
    for model in (Payslip, PayslipLine, Document):
        assert (await db_session.execute(select(func.count(model.id)))).scalar() == 0

    # Closing then deleting the account detaches the employer, payslips kept.
    proposal, = await _read(client, w, pdf)
    await _save(client, w, _checked(proposal, w["employer"]["id"]), pdf)
    await client.delete(f"/api/accounts/{w['account'].id}", headers=w["h"])
    gone = await client.delete(f"/api/accounts/{w['account'].id}", params={"permanent": "true"}, headers=w["h"])
    assert gone.status_code == 204, gone.text
    employer = (await client.get("/api/payroll/employers", headers=w["h"])).json()[0]
    assert (employer["account_id"], employer["payslip_count"]) == (None, 1)


async def test_deleting_a_profile_takes_its_payroll(client: AsyncClient, db_session, seed_data, extra_profile):
    pid = extra_profile.id
    account = Account(profile_id=pid, name="Konto", bank_name="ZKB", account_type=AccountType.courant, currency="CHF")
    db_session.add(account)
    await db_session.commit()
    w = {"h": {"X-Profile-Id": str(pid)}}
    await client.post("/api/payroll/situations", headers=w["h"], json={"from_year": 2026, "pack": "ch_zh", "params": {}})
    w["employer"] = (await client.post("/api/payroll/employers", headers=w["h"],
                                       json={"name": "Muster GmbH", "currency": "CHF", "account_id": account.id})).json()
    proposal, = await _read(client, w, ch_payslip())
    assert (await _save(client, w, _checked(proposal, w["employer"]["id"]), ch_payslip())).status_code == 201

    assert (await client.delete(f"/api/profiles/{pid}")).status_code == 204
    for model in (PayrollSituation, Employer, Payslip, PayslipLine, PayslipLabelRule, Document):
        assert (await db_session.execute(select(func.count(model.id)))).scalar() == 0


async def test_unreadable_files_come_back_with_a_reason(client: AsyncClient, zurich):
    results = await _read(client, zurich, b"not a pdf", blank_pdf(), ch_payslip())
    assert [r["error"] for r in results][:1] == ["Ce fichier n'est pas un PDF."]
    assert results[1]["error"] is None and results[1]["checks"] == {"no_text": True}
    assert results[2]["period"] == "2026-09"
    assert (await _save(client, zurich, _checked(results[2], zurich["employer"]["id"]), b"not a pdf")).status_code == 400
