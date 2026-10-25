"""What a situation is: France or Zurich — its settings, its words, its board.

The interface builds the situation form from `describe()`. A new situation (a
canton, a cross-border regime) is a new entry here plus its words in vocab.py,
not a new screen. Settings are checked by `clean_params`: an unknown key is
dropped, a missing one takes its default, a wrong value is refused in French.
"""
import re
from dataclasses import dataclass, field
from typing import Any, Optional

# The board's widgets, in their default order (web/lib/payroll-widgets.ts).
DEFAULT_WIDGETS = ("month", "ytd", "evolution", "rates", "deposits", "payslips")


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    type: str                                   # select | int | text | bool
    default: Any = None
    options: tuple = ()                         # ((value, label), …) for a select
    help: Optional[str] = None
    min: Optional[int] = None
    max: Optional[int] = None
    pattern: Optional[str] = None               # for a text, with `pattern_message`
    pattern_message: Optional[str] = None
    show_if: Optional[tuple] = None             # (key, value): only meaningful then


@dataclass(frozen=True)
class Pack:
    id: str
    label: str
    country: str
    currency: str
    params: tuple
    widgets: tuple = field(default=DEFAULT_WIDGETS)


PACKS = {
    "ch_zh": Pack(
        id="ch_zh", label="Suisse · Zurich", country="CH", currency="CHF",
        # « Rückbehalt »: pay held back until the end of a (temporary) contract.
        widgets=("month", "retained", *DEFAULT_WIDGETS[1:]),
        params=(
            Param("regime", "Imposition", "select", "source", options=(
                ("source", "Impôt à la source (permis B, L…)"),
                ("ordinary", "Imposition ordinaire (permis C, nationalité suisse)"),
            )),
            Param("tariff", "Barème de l'impôt à la source", "text", "A0N",
                  help="Tel qu'imprimé sur la fiche de paie : A0N = seul·e, sans enfant, sans église.",
                  pattern=r"^[A-Z]\d{1,2}[YN]$", pattern_message="Barème attendu sous la forme A0N, B1Y, C2N…",
                  show_if=("regime", "source")),
            Param("municipality", "Commune", "text", "Zürich"),
            Param("church", "Église", "select", "none", options=(
                ("none", "Aucune"), ("reformed", "Réformée"), ("catholic", "Catholique romaine"),
                ("christ_catholic", "Catholique chrétienne"),
            )),
            Param("nov", "Taxation ordinaire ultérieure demandée (TOU / NOV)", "bool", False,
                  help="Une fois demandée, elle vaut pour les années suivantes.", show_if=("regime", "source")),
        ),
    ),
    "fr": Pack(
        id="fr", label="France", country="FR", currency="EUR",
        params=(
            Param("household", "Foyer fiscal", "select", "single", options=(
                ("single", "Une personne"), ("couple", "Couple marié ou pacsé"),
            )),
            Param("children", "Enfants à charge", "int", 0, min=0, max=12),
            Param("pas_rate", "Taux du prélèvement à la source", "select", "personal", options=(
                ("personal", "Personnalisé"), ("individual", "Individualisé"), ("neutral", "Non personnalisé"),
            )),
        ),
    ),
}


def describe() -> list[dict]:
    return [{
        "id": p.id, "label": p.label, "country": p.country, "currency": p.currency, "widgets": list(p.widgets),
        "params": [{
            "key": q.key, "label": q.label, "type": q.type, "default": q.default, "help": q.help,
            "options": [{"value": v, "label": lbl} for v, lbl in q.options], "min": q.min, "max": q.max,
            "show_if": {"key": q.show_if[0], "value": q.show_if[1]} if q.show_if else None,
        } for q in p.params],
    } for p in PACKS.values()]


def clean_params(pack_id: str, params: dict) -> dict:
    """The settings as stored. Raises ValueError (French) on a wrong value."""
    pack = PACKS.get(pack_id)
    if pack is None:
        raise ValueError("Situation inconnue.")
    out: dict = {}
    for q in pack.params:
        value = params.get(q.key, q.default)
        if q.type == "select":
            if value not in {v for v, _ in q.options}:
                raise ValueError(f"« {q.label} » : choix inconnu.")
        elif q.type == "int":
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise ValueError(f"« {q.label} » : un nombre est attendu.") from None
            if (q.min is not None and value < q.min) or (q.max is not None and value > q.max):
                raise ValueError(f"« {q.label} » : entre {q.min} et {q.max}.")
        elif q.type == "bool":
            value = bool(value)
        else:
            value = str(value or "").strip()[:60]
            if q.key == "tariff":
                value = value.upper()
            hidden = q.show_if and out.get(q.show_if[0]) != q.show_if[1]
            if q.pattern and value and not hidden and not re.match(q.pattern, value):
                raise ValueError(q.pattern_message or f"« {q.label} » : valeur invalide.")
        out[q.key] = value
    return out


def summary(pack_id: str, params: dict) -> str:
    """What the page's header says: « Zurich · impôt à la source · A0N »."""
    if pack_id == "ch_zh":
        if params.get("regime") == "source":
            return " · ".join(filter(None, ["Zurich", "impôt à la source", params.get("tariff")]))
        return "Zurich · imposition ordinaire"
    if pack_id == "fr":
        household = "couple" if params.get("household") == "couple" else "une personne"
        children = int(params.get("children") or 0)
        return f"France · {household}" + (f" · {children} enfant{'s' if children > 1 else ''}" if children else "")
    return PACKS[pack_id].label if pack_id in PACKS else pack_id
