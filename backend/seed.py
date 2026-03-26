"""Seed the database with default categories, rules and bank profiles."""
import json
from pathlib import Path
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from models import Category, CategoryRule

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

DEFAULT_RULES = [
    # Revenus
    {"keyword": "salaire", "match_type": "contains", "category": "Revenus", "priority": 10},
    {"keyword": "virement recu", "match_type": "contains", "category": "Revenus", "priority": 20},
    {"keyword": "remboursement", "match_type": "contains", "category": "Revenus", "priority": 30},
    {"keyword": "allocation", "match_type": "contains", "category": "Revenus", "priority": 30},
    {"keyword": "prime", "match_type": "contains", "category": "Revenus", "priority": 30},
    # Alimentation
    {"keyword": "carrefour", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "leclerc", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "auchan", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "lidl", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "monoprix", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "intermarche", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "franprix", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "supermarche", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "epicerie", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "boucherie", "match_type": "contains", "category": "Alimentation", "priority": 50},
    {"keyword": "boulangerie", "match_type": "contains", "category": "Alimentation", "priority": 50},
    # Transport
    {"keyword": "sncf", "match_type": "contains", "category": "Transport", "priority": 50},
    {"keyword": "ratp", "match_type": "contains", "category": "Transport", "priority": 50},
    {"keyword": "navigo", "match_type": "contains", "category": "Transport", "priority": 50},
    {"keyword": "uber", "match_type": "contains", "category": "Transport", "priority": 50},
    {"keyword": "blablacar", "match_type": "contains", "category": "Transport", "priority": 50},
    {"keyword": "total energies", "match_type": "contains", "category": "Transport", "priority": 50},
    {"keyword": "essence", "match_type": "contains", "category": "Transport", "priority": 50},
    {"keyword": "station service", "match_type": "contains", "category": "Transport", "priority": 50},
    # Logement
    {"keyword": "loyer", "match_type": "contains", "category": "Logement", "priority": 40},
    {"keyword": "edf", "match_type": "contains", "category": "Logement", "priority": 50},
    {"keyword": "engie", "match_type": "contains", "category": "Logement", "priority": 50},
    {"keyword": "eau", "match_type": "contains", "category": "Logement", "priority": 60},
    {"keyword": "electricite", "match_type": "contains", "category": "Logement", "priority": 50},
    {"keyword": "charges copro", "match_type": "contains", "category": "Logement", "priority": 40},
    {"keyword": "assurance habitation", "match_type": "contains", "category": "Logement", "priority": 40},
    # Santé
    {"keyword": "pharmacie", "match_type": "contains", "category": "Santé", "priority": 50},
    {"keyword": "medecin", "match_type": "contains", "category": "Santé", "priority": 50},
    {"keyword": "hopital", "match_type": "contains", "category": "Santé", "priority": 50},
    {"keyword": "mutuelle", "match_type": "contains", "category": "Santé", "priority": 40},
    {"keyword": "dentiste", "match_type": "contains", "category": "Santé", "priority": 50},
    # Restaurants
    {"keyword": "restaurant", "match_type": "contains", "category": "Restaurants", "priority": 50},
    {"keyword": "brasserie", "match_type": "contains", "category": "Restaurants", "priority": 50},
    {"keyword": "mcdonald", "match_type": "contains", "category": "Restaurants", "priority": 50},
    {"keyword": "burger king", "match_type": "contains", "category": "Restaurants", "priority": 50},
    {"keyword": "deliveroo", "match_type": "contains", "category": "Restaurants", "priority": 50},
    {"keyword": "uber eats", "match_type": "contains", "category": "Restaurants", "priority": 50},
    {"keyword": "just eat", "match_type": "contains", "category": "Restaurants", "priority": 50},
    # Shopping
    {"keyword": "amazon", "match_type": "contains", "category": "Shopping", "priority": 50},
    {"keyword": "fnac", "match_type": "contains", "category": "Shopping", "priority": 50},
    {"keyword": "decathlon", "match_type": "contains", "category": "Shopping", "priority": 50},
    {"keyword": "h&m", "match_type": "contains", "category": "Shopping", "priority": 50},
    {"keyword": "zara", "match_type": "contains", "category": "Shopping", "priority": 50},
    {"keyword": "zalando", "match_type": "contains", "category": "Shopping", "priority": 50},
    {"keyword": "ikea", "match_type": "contains", "category": "Shopping", "priority": 50},
    # Abonnements
    {"keyword": "netflix", "match_type": "contains", "category": "Abonnements", "priority": 50},
    {"keyword": "spotify", "match_type": "contains", "category": "Abonnements", "priority": 50},
    {"keyword": "amazon prime", "match_type": "contains", "category": "Abonnements", "priority": 45},
    {"keyword": "canal+", "match_type": "contains", "category": "Abonnements", "priority": 50},
    {"keyword": "orange", "match_type": "contains", "category": "Abonnements", "priority": 60},
    {"keyword": "sfr", "match_type": "contains", "category": "Abonnements", "priority": 60},
    {"keyword": "free", "match_type": "contains", "category": "Abonnements", "priority": 70},
    {"keyword": "bouygues", "match_type": "contains", "category": "Abonnements", "priority": 60},
    # Banque
    {"keyword": "frais", "match_type": "contains", "category": "Banque & Finances", "priority": 80},
    {"keyword": "agios", "match_type": "contains", "category": "Banque & Finances", "priority": 50},
    {"keyword": "cotisation", "match_type": "contains", "category": "Banque & Finances", "priority": 70},
    {"keyword": "assurance vie", "match_type": "contains", "category": "Banque & Finances", "priority": 50},
    # Voyages
    {"keyword": "hotel", "match_type": "contains", "category": "Voyages", "priority": 50},
    {"keyword": "airbnb", "match_type": "contains", "category": "Voyages", "priority": 50},
    {"keyword": "booking", "match_type": "contains", "category": "Voyages", "priority": 50},
    {"keyword": "air france", "match_type": "contains", "category": "Voyages", "priority": 50},
    {"keyword": "easyjet", "match_type": "contains", "category": "Voyages", "priority": 50},
    {"keyword": "ryanair", "match_type": "contains", "category": "Voyages", "priority": 50},
    # Loisirs
    {"keyword": "cinema", "match_type": "contains", "category": "Loisirs", "priority": 50},
    {"keyword": "theatre", "match_type": "contains", "category": "Loisirs", "priority": 50},
    {"keyword": "concert", "match_type": "contains", "category": "Loisirs", "priority": 50},
    {"keyword": "sport", "match_type": "contains", "category": "Loisirs", "priority": 60},
    {"keyword": "salle de sport", "match_type": "contains", "category": "Loisirs", "priority": 50},
    # Éducation
    {"keyword": "universite", "match_type": "contains", "category": "Éducation", "priority": 50},
    {"keyword": "ecole", "match_type": "contains", "category": "Éducation", "priority": 60},
    {"keyword": "formation", "match_type": "contains", "category": "Éducation", "priority": 50},
    {"keyword": "librairie", "match_type": "contains", "category": "Éducation", "priority": 60},
]



async def seed_if_empty(db: AsyncSession):
    result = await db.execute(select(func.count(Category.id)))
    count = result.scalar()
    if count and count > 0:
        return  # already seeded

    # Insert categories
    cat_map = {}
    for cat_data in DEFAULT_CATEGORIES:
        cat = Category(**cat_data)
        db.add(cat)
        await db.flush()
        cat_map[cat.name] = cat.id

    # Insert rules
    for rule_data in DEFAULT_RULES:
        cat_name = rule_data.pop("category")
        cat_id = cat_map.get(cat_name)
        if cat_id:
            kw = rule_data.pop("keyword")
            mt = rule_data.pop("match_type")
            conditions = [{"field": "description", "operator": mt, "value": kw}]
            rule = CategoryRule(category_id=cat_id, conditions=conditions, **rule_data)
            db.add(rule)

    await db.commit()
    print(f"Seeded {len(DEFAULT_CATEGORIES)} categories, {len(DEFAULT_RULES)} rules.")
