"""Seed the database with default categories, rules and bank profiles."""
import json
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

# One rule per (category, priority) instead of one rule per keyword: the keywords
# are combined with OR, so 77 single-keyword rules collapse into ~24 readable ones.
#
# Why priority still splits a category: rules are evaluated by ascending priority
# and the FIRST match wins, so the numbers encode deliberate tie-breaks between
# categories. Two examples that would break if every category were flattened to a
# single rule:
#   • "amazon prime" (45) must beat "amazon" (50, Shopping), or a Prime
#     subscription lands in Shopping.
#   • deliberately vague keywords are pushed late so they can't hijack a better
#     match: "eau" (60) would otherwise catch BEAUTE/NOUVEAU/BUREAU, and "free"
#     (70) would catch FREELANCE.
# Keep a keyword in the priority bucket it belongs to rather than merging buckets.
DEFAULT_RULES = [
    # ── Revenus ──────────────────────────────────────────────────────────────
    {"category": "Revenus", "priority": 10, "keywords": ["salaire"]},
    {"category": "Revenus", "priority": 20, "keywords": ["virement recu"]},
    {"category": "Revenus", "priority": 30, "keywords": ["remboursement", "allocation"]},
    # "prime" est ambigu (AMAZON PRIME, PRIMEUR…) et classait des dépenses en
    # revenu : évalué après les correspondances plus précises.
    {"category": "Revenus", "priority": 55, "keywords": ["prime"]},

    # ── Dépenses courantes ───────────────────────────────────────────────────
    {"category": "Alimentation", "priority": 50, "keywords": [
        "carrefour", "leclerc", "auchan", "lidl", "monoprix", "intermarche",
        "franprix", "supermarche", "epicerie", "boucherie", "boulangerie",
    ]},
    {"category": "Transport", "priority": 50, "keywords": [
        "sncf", "ratp", "navigo", "uber", "blablacar", "total energies",
        "essence", "station service",
    ]},
    # "uber eats" doit passer avant "uber" (Transport, 50), sinon une commande
    # de repas est classée en transport.
    {"category": "Restaurants", "priority": 45, "keywords": ["uber eats"]},
    {"category": "Restaurants", "priority": 50, "keywords": [
        "restaurant", "brasserie", "mcdonald", "burger king", "deliveroo", "just eat",
    ]},
    {"category": "Shopping", "priority": 50, "keywords": [
        "amazon", "fnac", "decathlon", "h&m", "zara", "zalando", "ikea",
    ]},
    {"category": "Voyages", "priority": 50, "keywords": [
        "hotel", "airbnb", "booking", "air france", "easyjet", "ryanair",
    ]},

    # ── Logement (charges fixes avant fournisseurs, "eau" en dernier) ─────────
    {"category": "Logement", "priority": 40, "keywords": [
        "loyer", "charges copro", "assurance habitation",
    ]},
    {"category": "Logement", "priority": 50, "keywords": ["edf", "engie", "electricite"]},
    {"category": "Logement", "priority": 60, "keywords": ["eau"]},

    # ── Santé ────────────────────────────────────────────────────────────────
    {"category": "Santé", "priority": 40, "keywords": ["mutuelle"]},
    {"category": "Santé", "priority": 50, "keywords": [
        "pharmacie", "medecin", "hopital", "dentiste",
    ]},

    # ── Abonnements ("amazon prime" avant "amazon", "free" en dernier) ───────
    {"category": "Abonnements", "priority": 45, "keywords": ["amazon prime"]},
    {"category": "Abonnements", "priority": 50, "keywords": ["netflix", "spotify", "canal+"]},
    {"category": "Abonnements", "priority": 60, "keywords": ["orange", "sfr", "bouygues"]},
    {"category": "Abonnements", "priority": 70, "keywords": ["free"]},

    # ── Banque ("frais" est très générique : évalué en dernier) ──────────────
    {"category": "Banque & Finances", "priority": 50, "keywords": ["agios", "assurance vie"]},
    {"category": "Banque & Finances", "priority": 70, "keywords": ["cotisation"]},
    {"category": "Banque & Finances", "priority": 80, "keywords": ["frais"]},

    # ── Loisirs & Éducation ──────────────────────────────────────────────────
    {"category": "Loisirs", "priority": 50, "keywords": [
        "cinema", "theatre", "concert", "salle de sport",
    ]},
    {"category": "Loisirs", "priority": 60, "keywords": ["sport"]},
    {"category": "Éducation", "priority": 50, "keywords": ["universite", "formation"]},
    {"category": "Éducation", "priority": 60, "keywords": ["ecole", "librairie"]},
]



def build_default_rule(rule_data: dict, category_id: int, profile_id: int) -> CategoryRule:
    """Turn a DEFAULT_RULES entry (a keyword group) into one CategoryRule.

    The keywords are OR-ed: a description matching ANY of them classifies into the
    category. Reads the entry without mutating it, so seeding twice (fresh install,
    then the Paramètres "catégories standard" button) produces the same result.
    """
    operator = rule_data.get("match_type", "contains")
    return CategoryRule(
        category_id=category_id,
        profile_id=profile_id,
        priority=rule_data["priority"],
        logic_operator="OR",
        conditions=[
            {"field": "description", "operator": operator, "value": kw}
            for kw in rule_data["keywords"]
        ],
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
