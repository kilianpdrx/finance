"""Group transactions that carry "the same label".

Bank labels are never identical from one month to the next — each carries its own
date, card and reference numbers. Reducing a label to a broad merchant keyword is
what lets recurring payments be recognised, and what lets the user classify (or
write a rule for) a whole group at once instead of one row at a time.

Used by the recurring analytics and by the "classify by label" screens.
"""
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, List, Optional

# Banking boilerplate that carries no merchant information — dropped so that
# "PAIEMENT CB CARREFOUR 0512" and "ACHAT CARREFOUR 1806" merge into one group.
_STOPWORDS = {
    "paiement", "paiment", "achat", "cb", "carte", "card", "prelevement", "prlv",
    "prelvt", "prel", "virement", "vir", "retrait", "sepa", "facture", "fact",
    "com", "commission", "ttc", "ht", "www", "sarl", "sas", "eurl", "sa",
    "du", "de", "des", "le", "la", "les", "au", "aux", "et", "chez", "mr", "mme",
}
_DIGIT_TOKEN = re.compile(r"\w*\d\w*", re.UNICODE)   # any token containing a digit
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def normalize_label(desc: Optional[str]) -> str:
    """Reduce a raw description to a broad merchant keyword: lowercase, strip
    punctuation, drop tokens that contain digits (dates/refs/amounts) and common
    banking boilerplate, and collapse whitespace."""
    s = (desc or "").lower()
    s = _PUNCT.sub(" ", s)
    s = _DIGIT_TOKEN.sub(" ", s)
    tokens = [t for t in s.split() if len(t) >= 3 and t not in _STOPWORDS]
    return " ".join(tokens).strip()


def label_key(desc: Optional[str]) -> str:
    """The keyword a label is grouped under — the normalised form, or the raw
    lower-cased label when normalising leaves nothing (e.g. "H&M")."""
    return normalize_label(desc) or (desc or "").strip().lower()


def rule_pattern(key: str, labels: Iterable[Optional[str]]) -> str:
    """The fragment a "contains" rule should be built from for this group: the
    longest run of consecutive keyword tokens found verbatim in EVERY real label.

    The keyword itself is not usable: normalising drops reference numbers and
    boilerplate from the MIDDLE of a label, so "CARTE 12/09 FRANPRIX 5106 PARIS"
    becomes "franprix paris" — which appears in no real transaction, and a rule
    built from it would classify nothing. A single token always survives (each one
    is a verbatim piece of every label), so there is always a usable answer."""
    tokens = key.split()
    lowered = {(lbl or "").lower() for lbl in labels}
    best = ""
    for i in range(len(tokens)):
        for j in range(i + 1, len(tokens) + 1):
            cand = " ".join(tokens[i:j])
            if len(cand) > len(best) and all(cand in lbl for lbl in lowered):
                best = cand
    return best or key


@dataclass
class LabelGroup:
    """Transactions sharing a keyword, a currency and a direction."""
    key: str                      # the keyword, lower-case
    currency: str
    is_debit: bool
    members: list = field(default_factory=list)   # the rows, as given

    @property
    def keyword(self) -> str:
        """Display form of the label."""
        return self.key.upper()

    @property
    def pattern(self) -> str:
        """What a "contains" rule must be built from (see `rule_pattern`)."""
        return rule_pattern(self.key, (m.description for m in self.members)).upper()

    @property
    def count(self) -> int:
        return len(self.members)

    @property
    def total_cents(self) -> int:
        return sum(m.amount_cents for m in self.members)

    @property
    def last_date(self) -> date:
        return max(m.date for m in self.members)

    @property
    def top_category_id(self) -> Optional[int]:
        """The category most of the group's rows already have, if any."""
        votes: dict = defaultdict(int)
        for m in self.members:
            if m.category_id is not None:
                votes[m.category_id] += 1
        return max(votes, key=votes.get) if votes else None


def group_by_label(rows, *, min_count: int = 1) -> List[LabelGroup]:
    """Group rows by keyword, currency and direction; most frequent first.

    Rows need `description`, `amount_cents`, `date`, `category_id`, `is_debit`
    and `currency`. Grouping on the keyword (not the exact description) is what
    lets rows that each carry a unique reference still fall together. Currency
    and direction are part of the key so a total never mixes two currencies, nor
    a purchase with its refund."""
    groups: dict = {}
    for r in rows:
        key = label_key(r.description)
        if not key:
            continue
        gkey = (key, r.currency or "", bool(r.is_debit))
        group = groups.get(gkey)
        if group is None:
            group = groups[gkey] = LabelGroup(key=key, currency=gkey[1], is_debit=gkey[2])
        group.members.append(r)

    out = [g for g in groups.values() if g.count >= min_count]
    out.sort(key=lambda g: (g.count, g.total_cents), reverse=True)
    return out
