"""A payslip PDF → a proposal: its month, its lines, its figures, and what does
not add up. Nothing is saved here — the user checks the proposal first, like a
CSV import's review.

The text comes from pypdf's layout mode, which keeps a printed row on one line
of text: « AHV/IV/EO    9'000.00    5.30%    -477.00 ». A row is a label
followed by numbers; the numbers are told apart by their shape:
- an AMOUNT has exactly two decimals (Swiss 1'234.55, French 1 234,56), with a
  sign in front or a minus behind (85.50-);
- a RATE ends with % (5.30%), or has three or four decimals (6,9000 — French
  payslips print their rates without the sign);
- a date (30.09.2026) or a social security number (756.1234.5678.97) is
  neither, and is skipped.

Amounts are kept unsigned: what a line does to the pay is its `kind`.
"""
import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from pypdf import PdfReader

from services.payroll import vocab

MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 20


class ReadError(Exception):
    """A file that cannot be read as a payslip, with a French message."""


def is_pdf(data: bytes) -> bool:
    # The header may follow a few bytes of junk; readers look in the first KB.
    return b"%PDF-" in data[:1024]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pdf_text(data: bytes) -> str:
    """The text of the first pages, row by row. '' for a scan (images only)."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ReadError("Ce PDF est protégé par un mot de passe : enregistrez-en une copie sans protection.")
        return "\n".join((page.extract_text(extraction_mode="layout") or "") for page in reader.pages[:MAX_PAGES])
    except ReadError:
        raise
    except Exception:
        raise ReadError("Ce fichier ne peut pas être lu comme un PDF.") from None


# ── Numbers ──────────────────────────────────────────────────────────────────

_NUM = re.compile(r"""
    (?<![\w.,'’/-])
    (?:
        (?P<pct>\d{1,3}(?:[.,]\d{1,4})?)\s?%
      | (?P<neg>-\s?)?(?P<money>(?:\d{1,3}(?:['’   ]\d{3})+|\d+)[.,]\d{2})(?![\d%]|[.,]\d)(?P<trail>-)?
      | (?P<rate>\d{1,3}[.,]\d{3,4})(?![\d%]|[.,]\d)
    )
""", re.X)


@dataclass
class Token:
    kind: str           # money | rate
    value: int          # cents, or basis points
    start: int
    end: int
    negative: bool = False

    @property
    def center(self) -> float:
        return (self.start + self.end) / 2


def _cents(text: str) -> int:
    digits = re.sub(r"[^\d.,]", "", text)
    whole, frac = digits[:-3], digits[-2:]
    return int(re.sub(r"\D", "", whole) or 0) * 100 + int(frac)


def _bp(text: str) -> int:
    whole, _, frac = text.replace(",", ".").partition(".")
    return int(whole) * 100 + int((frac + "0000")[:4]) // 100


def tokens(line: str) -> list[Token]:
    out = []
    for m in _NUM.finditer(line):
        if m.group("pct") is not None:
            out.append(Token("rate", _bp(m.group("pct")), m.start(), m.end()))
        elif m.group("money") is not None:
            out.append(Token("money", _cents(m.group("money")), m.start(), m.end(),
                             negative=bool(m.group("neg") or m.group("trail"))))
        else:
            out.append(Token("rate", _bp(m.group("rate")), m.start(), m.end()))
    return out


# ── Month and pay date ───────────────────────────────────────────────────────

_MONTHS = {
    1: "janvier january januar gennaio jan", 2: "fevrier february februar febbraio feb fev",
    3: "mars march marz maerz marzo mar", 4: "avril april aprile apr avr", 5: "mai may maggio",
    6: "juin june juni giugno jun", 7: "juillet july juli luglio jul juil", 8: "aout august agosto aug",
    9: "septembre september settembre sept sep", 10: "octobre october oktober ottobre oct okt",
    11: "novembre november nov", 12: "decembre december dezember dicembre dec dez",
}
_MONTH_WORD = {w: n for n, words in _MONTHS.items() for w in words.split()}
_DATE = r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})"


def _plain(text: str) -> str:
    """Lower case, accents dropped — positions kept for one-byte characters."""
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def find_period(text: str) -> Optional[str]:
    """'YYYY-MM' of the month paid, or None. A period's start date first, then
    a month written out in the header, then '09/2026' after a period word."""
    plain = _plain(text)
    m = re.search(r"(periode|period|lohnperiode|abrechnungsperiode|du|vom)\s*:?\s*" + _DATE, plain)
    if m:
        return f"{m.group(4)}-{int(m.group(3)):02d}" if 1 <= int(m.group(3)) <= 12 else None
    head = "\n".join(plain.splitlines()[:25])
    for m in re.finditer(r"\b([a-z]{3,9})\.?\s+(\d{4})\b", head):
        month = _MONTH_WORD.get(m.group(1))
        if month and 2000 <= int(m.group(2)) <= 2100:
            return f"{m.group(2)}-{month:02d}"
    m = re.search(r"(monat|mois|periode|period|month|lohnperiode)\s*:?\s*(\d{1,2})[./](\d{4})\b", plain)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(3)}-{int(m.group(2)):02d}"
    return None


def find_pay_date(text: str) -> Optional[date]:
    plain = _plain(text)
    m = re.search(r"(auszahlungsdatum|auszahlung am|zahltag|valuta|ausbezahlt am|date de paiement|paiement le"
                  r"|paye le|date de versement|verse le|payment date|data di pagamento)\s*:?\s*" + _DATE, plain)
    if not m:
        return None
    try:
        return date(int(m.group(4)), int(m.group(3)), int(m.group(2)))
    except ValueError:
        return None


# ── Rows ─────────────────────────────────────────────────────────────────────

@dataclass
class Line:
    label: str
    key: str                              # normalize_label(label): what a user rule is keyed on
    kind: Optional[str]                   # None: « à classer »
    amount_cents: int
    base_cents: Optional[int] = None
    rate_bp: Optional[int] = None
    employer_cents: Optional[int] = None
    negative: bool = False                # printed with a minus: a hint for the user, not a kind


@dataclass
class Proposal:
    pack: str
    period: Optional[str]
    pay_date: Optional[date]
    lines: list[Line]
    totals: dict                          # vocab total → cents (+ "contributions_employer")
    figures: dict = field(default_factory=dict)
    checks: dict = field(default_factory=dict)


_FR_COLUMNS = (
    ("base", r"\bbase\b"),
    ("gain", r"a payer|\bgains?\b"),
    ("employee", r"a deduire|retenues?|part salari|salarie|montant"),
    ("employer", r"employeur|patronal|charges"),
)


def _fr_columns(rows: list[str]) -> Optional[dict]:
    """Where the French payslip's columns sit, from its header row: base, the
    employee's rate and amount, the employer's rate and amount. None when no
    header is found (the numbers are then read by their order)."""
    for row in rows:
        plain = _plain(row)
        if not re.search(r"\bbase\b", plain) or not re.search(r"taux|montant", plain):
            continue
        cols = {}
        for name, pattern in _FR_COLUMNS:
            m = re.search(pattern, plain)
            if m:
                cols[name] = (m.start() + m.end()) / 2
        rates = [(m.start() + m.end()) / 2 for m in re.finditer(r"taux", plain)]
        if rates:
            cols["employee_rate"] = rates[0]
        if len(rates) > 1:
            cols["employer_rate"] = rates[1]
        if "employee" in cols or "gain" in cols:
            return cols
    return None


def _numbers_fr(toks: list[Token], cols: Optional[dict]):
    """(amount, base, rate, employer amount) of a French row."""
    money = [t for t in toks if t.kind == "money"]
    rates = [t for t in toks if t.kind == "rate"]
    if cols:
        slots: dict = {}
        for t in toks:
            names = [n for n in cols if (n.endswith("rate")) == (t.kind == "rate")]
            if names:
                slots.setdefault(min(names, key=lambda n: abs(cols[n] - t.center)), t)
        # A salary line's amount sits under « À payer », a contribution's under « À déduire ».
        amount = slots.get("employee") or slots.get("gain")
        employer = slots.get("employer")
        base = slots.get("base")
        rate = slots.get("employee_rate") or slots.get("employer_rate")
        if amount is None and employer is None and money:
            amount = money[-1]
        return (amount.value if amount else 0, base.value if base else None,
                rate.value if rate else None, employer.value if employer else None)
    rate = rates[0].value if rates else None
    if len(money) >= 3:
        return money[1].value, money[0].value, rate, money[2].value
    if len(money) == 2:
        return (money[1].value, money[0].value, rate, None) if rates else (money[0].value, None, rate, money[1].value)
    return (money[0].value if money else 0), None, rate, None


def read_rows(text: str, pack: str, rules: Optional[dict] = None) -> tuple[list[Line], dict]:
    """The lines and the printed totals. `rules`: {label_key: kind}, the user's
    classifications for this employer — they win over the vocabulary, but
    never turn a total into a line."""
    rules = rules or {}
    rows = text.splitlines()
    cols = _fr_columns(rows) if pack == "fr" else None
    lines: list[Line] = []
    totals: dict = {}
    for row in rows:
        letter = re.search(r"[A-Za-zÀ-ÿ]", row)
        if not letter:
            continue
        # A number before the first letter belongs to the label: « 25%-Überzeit-Zuschlag ».
        toks = [t for t in tokens(row) if t.start > letter.start()]
        money = [t for t in toks if t.kind == "money"]
        if not money:
            continue
        label = row[:toks[0].start].strip(" \t:.-–")
        if pack == "fr":
            amount, base, rate, employer = _numbers_fr(toks, cols)
        else:
            amount = money[-1].value
            base = money[0].value if len(money) >= 2 else None
            rate = next((t.value for t in toks if t.kind == "rate"), None)
            employer = None
        known = vocab.known_kind(pack, label)
        if known in vocab.TOTALS:
            totals.setdefault(known, amount)
            if known == vocab.CONTRIBUTIONS_TOTAL and employer is not None:
                totals.setdefault("contributions_employer", employer)
            continue
        key = vocab.normalize_label(label)
        lines.append(Line(label=label, key=key, kind=rules.get(key, known), amount_cents=amount, base_cents=base,
                          rate_bp=rate, employer_cents=employer, negative=money[-1].negative))
    return lines, totals


# ── Figures and checks ───────────────────────────────────────────────────────

def figures(lines: list[Line], totals: dict) -> dict:
    """The payslip's figures: gross, contributions and tax are the sum of their
    lines when there are some — the printed totals are then what the review
    checks them against — and the printed totals otherwise. The net paid is
    the printed one. Mirrored by `draftFigures` (web/lib/payroll-review.ts)."""
    def by(*kinds):
        return sum(ln.amount_cents for ln in lines if ln.kind in kinds)

    tax_line = next((ln for ln in lines if ln.kind == vocab.TAX), None)
    contributions = by(vocab.SOCIAL, vocab.PENSION) or totals.get(vocab.CONTRIBUTIONS_TOTAL, 0)
    employer = totals.get("contributions_employer")
    if employer is None and any(ln.employer_cents for ln in lines):
        employer = sum(ln.employer_cents or 0 for ln in lines)
    gross = by(vocab.GROSS) if any(ln.kind == vocab.GROSS for ln in lines) else totals.get(vocab.GROSS_TOTAL, 0)
    tax = by(vocab.TAX)
    # After the contributions: other deductions and additions, pay held back and paid out.
    after = by(vocab.ADDITION, vocab.RELEASED) - by(vocab.DEDUCTION, vocab.RETAINED)
    computed = gross - contributions - tax + after
    printed = totals.get(vocab.PAYOUT_TOTAL)
    if printed is None and vocab.NET_BEFORE_TAX in totals:
        printed = totals[vocab.NET_BEFORE_TAX] - tax + after
    if printed is None:
        printed = totals.get(vocab.NET_TOTAL)
    return {
        "gross_cents": gross,
        "employee_contributions_cents": contributions,
        "employer_contributions_cents": employer,
        "taxable_cents": (tax_line.base_cents if tax_line and tax_line.base_cents else totals.get(vocab.TAXABLE_TOTAL)),
        "withholding_cents": tax,
        "withholding_rate_bp": tax_line.rate_bp if tax_line else None,
        "net_paid_cents": printed if printed is not None else computed,
        "computed_net_cents": computed,
        "printed_net": printed is not None,
    }


def read(data: bytes, pack: str, rules: Optional[dict] = None) -> Proposal:
    """The whole proposal for one PDF. Raises ReadError when it is not a
    readable PDF; a PDF without text comes back with `checks["no_text"]`."""
    if len(data) > MAX_BYTES:
        raise ReadError("Fichier trop volumineux (5 Mo au plus).")
    if not is_pdf(data):
        raise ReadError("Ce fichier n'est pas un PDF.")
    text = pdf_text(data)
    if not text.strip():
        return Proposal(pack, None, None, [], {}, checks={"no_text": True})
    lines, totals = read_rows(text, pack, rules)
    proposal = Proposal(pack, find_period(text), find_pay_date(text), lines, totals)
    proposal.figures = figures(lines, totals)
    proposal.checks = {
        "no_text": False,
        "no_amount": not lines and not totals,
        "unclassified": sum(1 for ln in lines if ln.kind is None),
        "net_mismatch_cents": (proposal.figures["computed_net_cents"] - proposal.figures["net_paid_cents"]
                               if proposal.figures["printed_net"] else 0),
        "period_missing": proposal.period is None,
    }
    return proposal
