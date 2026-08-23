"""Ready-made column mappings for known bank exports.

Column mapping is the step where a non-technical user gets stuck: they must look
at raw CSV headers and decide which is the date, the label, the amount. A preset
answers that in one click for a bank someone has already worked out.

Every entry here is a mapping that was VERIFIED against a real export — guessing
header names would be worse than having no preset at all, because a wrong column
silently produces wrong amounts. Add one only after importing that bank's file
successfully; the same shape can be shared between users via the mapping
export/import in the importer.
"""
from typing import Optional

BANK_PRESETS: list[dict] = [
    {
        "name": "Crédit Mutuel",
        "column_mapping": {
            "date": "Date de valeur",
            "description": "Libellé",
            "debit": "Débit",
            "credit": "Crédit",
            "balance": "Solde",
        },
        "date_format": "%d/%m/%Y",
        "encoding": "utf-8",
        "delimiter": ";",
    },
    {
        "name": "Crédit Agricole",
        "column_mapping": {
            "date": "Date",
            "description": "Libellé",
            "debit": "Débit euros",
            "credit": "Crédit euros",
        },
        "date_format": "%d/%m/%Y",
        "encoding": "utf-8",
        "delimiter": ";",
    },
    {
        "name": "UBS",
        "column_mapping": {
            "date": "Date de transaction",
            "description": "Description1",
            "debit": "Débit",
            "credit": "Crédit",
            "balance": "Solde",
        },
        "date_format": "%d/%m/%Y",
        "encoding": "utf-8",
        "delimiter": ";",
    },
]


def match_preset(headers: list[str]) -> Optional[dict]:
    """The preset whose mapped columns are all present in `headers`, if any.

    Used to pre-select a bank in the importer. Requires an exact match on every
    mapped column so a partial overlap can't silently pick the wrong bank.
    """
    available = {h.strip() for h in headers}
    for preset in BANK_PRESETS:
        needed = set(preset["column_mapping"].values())
        if needed and needed.issubset(available):
            return preset
    return None
