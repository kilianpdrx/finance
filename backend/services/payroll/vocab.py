"""Which payslip line is which: the kinds, the totals, and each pack's words.

A line's `kind` says what it does to the pay:
- gross      a component of the gross salary (base, bonus, overtime…)
- social     a social contribution (AVS/AI/APG, AC, AANP, IJM / CSG, retraite…)
- pension    the occupational pension (LPP / BVG, Pensionskasse)
- tax        tax withheld at source (Quellensteuer / prélèvement à la source)
- deduction  any other amount taken off (canteen, parking, meal vouchers…)
- addition   paid on top of the net (expenses, family allowances…)
- retained   earned but held back by the employer until the end of the contract
             (Rückbehalt): off this month's payout, owed later
- released   that held-back money, paid out at last
- info       printed, but no money moves (hours, holidays, cumulative figures)

A TOTAL (gross, net, payout…) is not a line: it is read into the payslip's own
figures, and counting it as a line would add it twice.

The words are matched on `normalize_label`: lower case, no accents, no digits —
"13. Monatslohn" and "Quellensteuer A0N" keep the same key from month to month.
What the vocabulary does not know stays « à classer »: the user classifies it
once per employer (PayslipLabelRule). Never guess a kind to look complete.
"""
import re
import unicodedata

GROSS, SOCIAL, PENSION, TAX, DEDUCTION, ADDITION, RETAINED, RELEASED, INFO = (
    "gross", "social", "pension", "tax", "deduction", "addition", "retained", "released", "info")
KINDS = (GROSS, SOCIAL, PENSION, TAX, DEDUCTION, ADDITION, RETAINED, RELEASED, INFO)
# Taken off the gross on the way to the net paid.
TAKEN = (SOCIAL, PENSION, TAX, DEDUCTION, RETAINED)

# Totals printed on a payslip, read into its figures.
GROSS_TOTAL, NET_TOTAL, PAYOUT_TOTAL, CONTRIBUTIONS_TOTAL, TAXABLE_TOTAL, NET_BEFORE_TAX = (
    "gross_total", "net_total", "payout_total", "contributions_total", "taxable_total", "net_before_tax")
TOTALS = (GROSS_TOTAL, NET_TOTAL, PAYOUT_TOTAL, CONTRIBUTIONS_TOTAL, TAXABLE_TOTAL, NET_BEFORE_TAX)


def normalize_label(label: str) -> str:
    """'13. Monatslohn' → 'monatslohn'; 'Impôt à la source' → 'impot a la source'."""
    text = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"[^a-z]+", " ", text)
    return " ".join(text.split())


# (pattern on the normalized label, kind or total). The first match wins:
# totals come first, so « Bruttolohn » is never read as a « Lohn » line — after
# the held-back pay: « Auszahlung Rückbehalt » is not the payout, and « Total
# Rückbehalt kumulierte Lohnarten » not a total.
_CH = [
    (r"auszahlung (des )?ruckbehalt|ruckbehalt\w* (auszahlung|ausbezahlt)|versement (de la |des? )?retenues?", RELEASED),
    (r"ruckbehalt|retenues? (de )?fin de contrat", RETAINED),
    (r"^(total )?brutto(lohn)?\b|^bruttolohn|^salaire brut|^total brut|^salario lordo|^gross salary", GROSS_TOTAL),
    (r"^(total )?netto(lohn)?\b|^nettolohn|^salaire net|^salario netto|^net salary", NET_TOTAL),
    (r"^auszahlung|^ausbezahlt|^auszuzahlen|^uberweisung|^bankuberweisung|^zahlung\b|^versement|^montant verse"
     r"|^net a payer|^salaire verse|^pagamento|^importo pagato|^payout|^net pay\b", PAYOUT_TOTAL),
    (r"^total (der )?(sozial)?abzuge|^abzuge total|^total (des )?(deductions|retenues)|^total trattenute", CONTRIBUTIONS_TOTAL),
    (r"quellensteuer|^qst\b|impot a la source|imposta alla fonte|withholding tax", TAX),
    (r"\bbvg\b|pensionskasse|\bpk\b|\blpp\b|caisse de pension|prevoyance professionnelle|berufliche vorsorge"
     r"|cassa pensione|\bpension fund", PENSION),
    (r"\bahv\b|\biv\b|\beo\b|\bavs\b|\bai\b|\bapg\b|\balv\b|\bac\b|arbeitslosen|chomage|disoccupazione"
     r"|\bnbuv?\b|\baanp\b|nichtberufsunfall|accident non professionnel|\bktg\b|krankentaggeld|\bijm\b"
     r"|indemnite journaliere|perte de gain|unfallversicherung|assurance accident", SOCIAL),
    (r"spesen|frais|kinderzulage|familienzulage|ausbildungszulage|allocations? familiale|allocations? (pour )?enfant"
     r"|assegni|reisekosten", ADDITION),
    (r"monatslohn|grundlohn|stundenlohn|^lohn\b|^gehalt|salaire mensuel|salaire de base|^salario|^salary"
     r"|treizieme|^bonus|gratifikation|pramie|^prime|uberstunden|heures supplementaires|schichtzulage"
     r"|^provision|ferienentschadigung|feiertagsentschadigung|indemnite vacances", GROSS),
    (r"ferienguthaben|feriensaldo|^stunden|^anzahl|solde vacances|^heures\b", INFO),
]

_FR = [
    (r"net a payer avant impot", NET_BEFORE_TAX),
    (r"^salaire brut|^total brut|^brut\b|remuneration brute", GROSS_TOTAL),
    (r"^total des cotisations|^total cotisations|^total des retenues", CONTRIBUTIONS_TOTAL),
    (r"net imposable", TAXABLE_TOTAL),
    (r"^net paye|^net a payer|^net verse|^montant net paye|^net en euros", PAYOUT_TOTAL),
    # « CSG déductible de l'impôt sur le revenu » is a contribution, not the tax.
    (r"\bcsg\b|\bcrds\b", SOCIAL),
    (r"impot sur le revenu|prelevement a la source", TAX),
    (r"net social|^cumul|^heures|^conges|^plafond", INFO),
    (r"titres? restaurant|tickets? restaurant|^acompte|^avance", DEDUCTION),
    (r"remboursement|transport|navigo|frais professionnels|indemnite kilometrique", ADDITION),
    (r"securite sociale|maladie|vieillesse|retraite|complementaire|agirc|arrco|chomage|\bapec\b|\bcsg\b|\bcrds\b"
     r"|famille|accident du travail|prevoyance|mutuelle|\bsante\b|deces|invalidite|cotisations? salariale"
     r"|exoneration|reduction", SOCIAL),
    (r"salaire de base|heures supplementaires|^prime|treizieme|^indemnite|avantage en nature|anciennete|commission", GROSS),
]

VOCABULARY = {"ch_zh": [(re.compile(p), k) for p, k in _CH], "fr": [(re.compile(p), k) for p, k in _FR]}


def known_kind(pack: str, label: str):
    """The kind (or total) the pack's vocabulary gives this label, else None."""
    key = normalize_label(label)
    for pattern, kind in VOCABULARY.get(pack, []):
        if pattern.search(key):
            return kind
    return None
