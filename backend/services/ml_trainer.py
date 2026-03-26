"""Train and use a TF-IDF + LogisticRegression model for transaction categorization."""
import json
import pickle
from pathlib import Path
from typing import Optional
from datetime import datetime

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
MODEL_PATH = DATA_DIR / "model.pkl"
META_PATH = DATA_DIR / "model_meta.json"

FRENCH_STOP_WORDS = [
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "au", "aux",
    "sur", "dans", "par", "pour", "avec", "sans", "sous", "entre", "vers",
    "ce", "se", "sa", "son", "ses", "mon", "ma", "mes", "ton", "ta", "tes",
    "notre", "nos", "votre", "vos", "leur", "leurs", "il", "elle", "ils", "elles",
    "je", "tu", "nous", "vous", "que", "qui", "dont", "ou", "mais", "car",
]


def train(transactions: list) -> tuple[float, int]:
    """Train the ML model on labeled transactions. Returns (accuracy, sample_count)."""
    from sklearn.pipeline import Pipeline
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    import numpy as np

    X = [t.description for t in transactions]
    y = [t.category_id for t in transactions]

    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(2, 4),
            max_features=10000,
            sublinear_tf=True,
            stop_words=FRENCH_STOP_WORDS,
        )),
        ("clf", LogisticRegression(max_iter=1000, C=1.0, solver="lbfgs", multi_class="auto")),
    ])

    # Cross-validate to get accuracy
    if len(set(y)) >= 2 and len(X) >= 10:
        scores = cross_val_score(pipeline, X, y, cv=min(5, len(X) // 2), scoring="accuracy")
        accuracy = float(np.mean(scores))
    else:
        accuracy = 0.0

    # Train on full dataset
    pipeline.fit(X, y)

    # Save model
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(pipeline, f)

    # Save metadata
    meta = {
        "trained_at": datetime.utcnow().isoformat(),
        "sample_count": len(X),
        "accuracy": accuracy,
    }
    with open(META_PATH, "w") as f:
        json.dump(meta, f)

    return accuracy, len(X)


def predict(description: str) -> Optional[int]:
    """Predict category_id from description. Returns None if no model or low confidence."""
    if not MODEL_PATH.exists():
        return None
    try:
        with open(MODEL_PATH, "rb") as f:
            pipeline = pickle.load(f)
        proba = pipeline.predict_proba([description])[0]
        max_proba = max(proba)
        if max_proba < 0.5:
            return None
        predicted_class = pipeline.classes_[proba.argmax()]
        return int(predicted_class)
    except Exception:
        return None


def get_status() -> dict:
    """Return model status metadata."""
    if not MODEL_PATH.exists():
        return {
            "trained": False,
            "last_trained": None,
            "sample_count": None,
            "accuracy": None,
        }
    try:
        with open(META_PATH) as f:
            meta = json.load(f)
        return {
            "trained": True,
            "last_trained": meta.get("trained_at"),
            "sample_count": meta.get("sample_count"),
            "accuracy": meta.get("accuracy"),
        }
    except Exception:
        return {
            "trained": True,
            "last_trained": None,
            "sample_count": None,
            "accuracy": None,
        }
