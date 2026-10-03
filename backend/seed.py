"""Seed the database with default categories, rules and bank profiles."""
import logging
from pathlib import Path
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from models import Category, CategoryRule

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"

DEFAULT_CATEGORIES = [
    {"name": "Revenus", "color": "#22c55e", "icon": "arrow-down-circle", "is_income": True},
    {"name": "Alimentation", "color": "#f97316", "icon": "shopping-cart", "is_income": False},
    {"name": "Logement", "color": "#3b82f6", "icon": "home", "is_income": False},
    {"name": "Transport", "color": "#8b5cf6", "icon": "car", "is_income": False},
    {"name": "Santé", "color": "#ec4899", "icon": "heart", "is_income": False},
    {"name": "Loisirs", "color": "#f59e0b", "icon": "music", "is_income": False},
    {"name": "Restaurants", "color": "#ef4444", "icon": "utensils", "is_income": False},
    {"name": "Shopping", "color": "#06b6d4", "icon": "bag", "is_income": False},
    {"name": "Abonnements", "color": "#6366f1", "icon": "repeat", "is_income": False},
    {"name": "Banque & Finances", "color": "#64748b", "icon": "building-bank", "is_income": False},
    {"name": "Voyages", "color": "#10b981", "icon": "plane", "is_income": False},
    {"name": "Éducation", "color": "#84cc16", "icon": "book", "is_income": False},
    {"name": "Divers", "color": "#94a3b8", "icon": "tag", "is_income": False},
    {"name": "Virements internes", "color": "#64748b", "icon": "arrows-right-left", "is_income": False},
]

# Rules have NO priority: every rule is evaluated, and a label matched by rules of
# two different categories is a conflict that leaves the transaction
# uncategorised. The defaults must therefore never disagree with each other —
# `tests/test_seed_first_run.py` checks that each keyword below classifies into
# exactly one category.
#
# One entry = one rule, in one of two shapes:
#   • `keywords` (+ optional `words`): OR-ed conditions. A keyword matches as a
#     substring ("contains"); a `words` entry only as a whole word, for terms
#     short enough to hide inside others — "eau" in BEAUTE/BUREAU, "free" in
#     FREELANCE, "sport" in TRANSPORT.
#   • `all`: AND-ed (field, operator, value) conditions, used when a brand must
#     be told apart from a longer one that contains it ("amazon" vs "amazon
#     prime", "uber" vs "uber eats").
DEFAULT_RULES = [
    # ── Revenus ──────────────────────────────────────────────────────────────
    {"category": "Revenus", "keywords": [
        "salaire", "virement recu", "remboursement", "allocation",
    ]},
    # "prime" (une prime versée) : mot entier, et seulement sur un crédit —
    # AMAZON PRIME est un débit, PRIMEUR est un autre mot.
    {"category": "Revenus", "all": [
        ("description", "word", "prime"), ("is_debit", "equals", "false"),
    ]},

    # ── Dépenses courantes ───────────────────────────────────────────────────
    {"category": "Alimentation", "keywords": [
        "carrefour", "leclerc", "auchan", "lidl", "monoprix", "intermarche",
        "franprix", "supermarche", "epicerie", "boucherie", "boulangerie",
    ]},
    {"category": "Transport", "keywords": [
        "sncf", "ratp", "navigo", "blablacar", "total energies",
        "essence", "station service",
    ]},
    # "uber" seul est une course ; UBER EATS est un repas (Restaurants).
    {"category": "Transport", "all": [
        ("description", "contains", "uber"), ("description", "not_contains", "eats"),
    ]},
    {"category": "Restaurants", "keywords": [
        "uber eats", "restaurant", "brasserie", "mcdonald", "burger king",
        "deliveroo", "just eat",
    ]},
    {"category": "Shopping", "keywords": [
        "fnac", "decathlon", "h&m", "zara", "zalando", "ikea",
    ]},
    # "amazon" seul est un achat ; AMAZON PRIME est un abonnement.
    {"category": "Shopping", "all": [
        ("description", "contains", "amazon"), ("description", "not_contains", "prime"),
    ]},
    {"category": "Voyages", "keywords": [
        "hotel", "airbnb", "booking", "air france", "easyjet", "ryanair",
    ]},

    # ── Charges ──────────────────────────────────────────────────────────────
    {"category": "Logement", "keywords": [
        "loyer", "charges copro", "assurance habitation", "edf", "engie", "electricite",
    ], "words": ["eau"]},
    {"category": "Santé", "keywords": [
        "mutuelle", "pharmacie", "medecin", "hopital", "dentiste",
    ]},
    {"category": "Abonnements", "keywords": [
        "amazon prime", "netflix", "spotify", "canal+", "orange", "sfr", "bouygues",
    ], "words": ["free"]},
    {"category": "Banque & Finances", "keywords": ["agios", "assurance vie"], "words": ["frais"]},
    # Une COTISATION MUTUELLE relève de la Santé, pas de la banque.
    {"category": "Banque & Finances", "all": [
        ("description", "contains", "cotisation"), ("description", "not_contains", "mutuelle"),
    ]},

    # ── Loisirs & Éducation ──────────────────────────────────────────────────
    {"category": "Loisirs", "keywords": [
        "cinema", "theatre", "concert", "salle de sport",
    ], "words": ["sport"]},
    {"category": "Éducation", "keywords": ["universite", "formation", "ecole", "librairie"]},
]


def build_default_rule(rule_data: dict, category_id: int, profile_id: int) -> CategoryRule:
    """Turn a DEFAULT_RULES entry into one CategoryRule (see the shapes above).

    Reads the entry without mutating it, so seeding twice (fresh install, then
    the Paramètres "catégories standard" button) produces the same result.
    """
    if "all" in rule_data:
        logic = "AND"
        conditions = [
            {"field": field, "operator": operator, "value": value}
            for field, operator, value in rule_data["all"]
        ]
    else:
        logic = "OR"
        conditions = [
            {"field": "description", "operator": "contains", "value": kw}
            for kw in rule_data.get("keywords", [])
        ] + [
            {"field": "description", "operator": "word", "value": kw}
            for kw in rule_data.get("words", [])
        ]
    return CategoryRule(
        category_id=category_id,
        profile_id=profile_id,
        logic_operator=logic,
        conditions=conditions,
    )


async def seed_if_empty(db: AsyncSession, profile_id: int):
    """Seed default categories + rules for `profile_id`.

    `profile_id` is REQUIRED: every read filters on it, so rows written without
    one are invisible to the whole app (the user would see no categories and get
    no auto-categorisation at all). The caller must create the default profile
    before calling this.

    The "already seeded" check is **per profile**, not global. A global count
    meant every profile after the first was skipped, so a second household member
    got zero categories and zero rules — an app that cannot categorise anything.
    Scoping it also keeps this safe to call on profile creation: a profile that
    already has categories is never touched, so nobody's existing rules are
    rewritten behind their back.
    """
    result = await db.execute(
        select(func.count(Category.id)).where(Category.profile_id == profile_id)
    )
    count = result.scalar()
    if count and count > 0:
        return  # already seeded

    # Insert categories
    cat_map = {}
    for cat_data in DEFAULT_CATEGORIES:
        cat = Category(**cat_data, profile_id=profile_id)
        db.add(cat)
        await db.flush()
        cat_map[cat.name] = cat.id

    # Insert rules
    for rule_data in DEFAULT_RULES:
        cat_id = cat_map.get(rule_data["category"])
        if cat_id:
            db.add(build_default_rule(rule_data, cat_id, profile_id))

    await db.commit()
    logger.info(
        "Seeded %d categories, %d rules for profile %s.",
        len(DEFAULT_CATEGORIES), len(DEFAULT_RULES), profile_id,
    )
