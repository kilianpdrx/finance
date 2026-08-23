# Finance

Tableau de bord de finances personnelles, **100 % local**. Aucun compte, aucune inscription,
aucune donnée envoyée sur internet : tout vit dans un fichier sur votre machine.

Importez les CSV de votre banque, laissez les règles classer vos dépenses, et suivez
budget, patrimoine, emprunts et investissements au même endroit.

---

## Installation

**Vous voulez juste utiliser l'application** → téléchargez `finance-app.zip` depuis la
page **[Releases](../../releases/latest)**, décompressez, double-cliquez sur *Finance*.
Il faut simplement [Docker Desktop](https://www.docker.com/products/docker-desktop/)
installé. Le détail est dans le `LISEZMOI.md` fourni.

**Vous voulez modifier le code** → voir **[INSTALL.md](INSTALL.md)**.

> ⚠️ Ne partagez jamais une archive faite à la main du dossier du projet : elle
> contiendrait `backend/data/` (votre base) et `csv files/` (vos relevés). Partagez le zip
> de la page Releases.

---

## Fonctionnalités

| Module | Ce qu'il fait |
|---|---|
| **Transactions** | Import CSV multi-banques (détection des colonnes, dédoublonnage), classement automatique par règles, édition en masse |
| **Analyses** | Dépenses par catégorie, tendances mensuelles, flux de trésorerie, récurrences, dépenses sans règle |
| **Budget** | Budget annuel par catégorie, dépenses planifiées, comparaison prévu / réalisé |
| **Comptes** | Courant, épargne, crédit, immobilier ; soldes manuels, patrimoine dans le temps |
| **Investissements** | Portefeuille (actions, ETF, crypto), cours et dividendes automatiques, import de positions, synchro IBKR |
| **Emprunts** | Amortissement, capital restant, intérêts, remboursements anticipés |
| **Objectifs** | Objectifs d'épargne avec contributions manuelles ou compte lié |

Plusieurs **profils** cohabitent dans la même installation (par exemple vous et un proche),
avec des données totalement séparées. Chaque profil active seulement les modules qu'il veut.

---

## Points de conception

- **L'argent est stocké en centimes entiers.** Jamais de flottant : pas d'erreur d'arrondi.
- **Le journal est immuable.** La catégorie d'une transaction n'est jamais réécrite dans
  votre dos ; toute reclassification de l'historique est explicite et confirmée.
- **Conversion au taux de l'époque.** Une dépense de 2023 est convertie au taux de 2023,
  pas à celui d'aujourd'hui. Si un taux manque, l'application le signale au lieu
  d'additionner des devises différentes en silence.
- **Un import ne perd jamais de ligne en silence.** Chaque ligne ignorée est comptée, avec
  sa raison et un exemple.
- **Pas de mot de passe, par conception** : l'application n'écoute que sur `127.0.0.1`,
  donc uniquement votre machine. Voir [Sécurité](#sécurité).

---

## Architecture

```
backend/     FastAPI + SQLAlchemy (async) + SQLite         → l'API sur :8000
  routers/     endpoints REST (/api/…)
  services/    logique métier (import CSV, règles, FX, cours, emprunts)
  alembic/     migrations de base de données
web/         Next.js 15 (App Router) + TanStack Query      → l'interface sur :3000
release/     ce que reçoivent les utilisateurs (compose + lanceurs + notice)
```

L'interface ne parle jamais directement à l'API : elle passe par un proxy interne
(`web/app/api/[...path]/route.ts`), ce qui permet de ne publier qu'un seul port.

**Stack** : Python 3.11, FastAPI, SQLAlchemy 2 async, SQLite (WAL), Alembic ·
TypeScript, Next.js 15, React 19, TanStack Query, Tailwind, Recharts · Docker.

---

## Développement

```bash
./start.sh                                  # API + interface en mode dev
cd backend && python -m pytest              # 148 tests
cd web && npx tsc --noEmit && npx vitest run
```

Les tests tournent aussi automatiquement sur chaque push (voir `.github/workflows/ci.yml`).
Pour publier une version : **[RELEASING.md](RELEASING.md)**.

---

## Sécurité

L'application **n'a pas d'authentification**. C'est volontaire : elle n'est accessible que
depuis votre propre ordinateur.

- `start.sh` lie les serveurs à `127.0.0.1`.
- `docker-compose.yml` publie `127.0.0.1:3000` et **ne publie pas** le port de l'API.

Quiconque peut atteindre un port publié a un accès complet en lecture et en écriture à tous
les profils. Ne retirez donc pas le préfixe `127.0.0.1:`, ne publiez pas le port 8000, et ne
placez pas l'application derrière un tunnel public.

## Sauvegardes

Tout tient dans un fichier : `backend/data/finance.db` (ou `data/finance.db` à côté du
lanceur pour la version distribuée).

Depuis l'application : **Paramètres → Sauvegarde & Données**. Faites-en une **avant chaque
mise à jour** — les migrations ne se jouent que vers l'avant.
