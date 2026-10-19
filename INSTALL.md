# Installation

Ce projet a **deux publics**. Choisissez la section qui vous concerne.

---

# 1. Vous voulez juste utiliser l'application

**Ne clonez pas ce dépôt.** Téléchargez le fichier `finance-app.zip` de la dernière
version depuis la page **[Releases](https://github.com/kilianpdrx/finance/releases/latest)**
du projet, décompressez-le, et suivez le `README.md` qu'il contient.

Il tient en trois étapes :

1. Installer **Docker Desktop** (gratuit) — https://www.docker.com/products/docker-desktop/
2. Double-cliquer sur **Finance** (Mac) ou **Finance.bat** (Windows)
3. L'application s'ouvre dans le navigateur sur http://127.0.0.1:3000

**Mises à jour** : relancez simplement *Finance*. La dernière version est téléchargée
automatiquement au démarrage — il n'y a rien d'autre à faire.

**Sauvegardes** : Paramètres → *Sauvegarde & Données*. **Faites-en une avant chaque mise
à jour** : les migrations de base de données ne s'annulent pas.

---

# 2. Vous voulez développer / modifier le code

### Prérequis
- **Python 3.11+** et **Node.js 20+**
- (recommandé) un environnement Python dédié. `start.sh` installe les dépendances
  (`backend/requirements-dev.txt`) dans l'environnement actif : sans environnement
  dédié, elles vont dans votre Python global.

`start.sh` active tout seul un environnement conda nommé `finenv` s'il existe. Pour le
créer, une seule fois :
```bash
conda create -n finenv python=3.11
```
Sans conda, un venv fait la même chose — activez-le avant de lancer `start.sh` :
```bash
python3 -m venv .venv && source .venv/bin/activate
```

### Lancer en développement
```bash
./start.sh
```
Installe les dépendances Python et Node, puis démarre l'API sur `127.0.0.1:8000` (avec
`--reload`) et l'interface sur `127.0.0.1:3000`. `MODE=prod ./start.sh` fait un build de
production.

Si un port est pris par un autre programme, `start.sh` prend le suivant et l'affiche —
typiquement `3001` quand l'application installée (Docker) occupe déjà `3000` : les deux
tournent côte à côte. Un lancement précédent de `start.sh`, lui, est arrêté et remplacé.
Pour imposer un port : `UI_PORT=3005 API_PORT=8005 ./start.sh`.

### Essayer le code en cours sur vos vraies données
```bash
./dev-data.sh        # copie les données de l'application installée dans backend/data
./start.sh           # ouvre l'application de développement sur cette copie
```
`dev-data.sh` trouve le dossier de l'application installée par son conteneur
(`finance-backend`) ; sinon, donnez-le : `./dev-data.sh "/chemin/vers/Suivi finance/data"`.
L'application installée n'est que lue. La copie, elle, est **jetable** : relancer le script
la remplace, et ce que vous y avez modifié est perdu. Une base qui n'était pas une copie
est mise de côté dans `backend/data/avant-copie-…`, jamais supprimée.

Sur une copie, l'application affiche un bandeau « Copie de test » sur chaque page, et
`start.sh` ne lance pas les tâches réseau (cours, taux de change, synchronisation du
courtier) : elles restent l'affaire de l'application installée. `backend/data/` est ignoré
par git — la copie ne peut pas partir dans un commit.

### Lancer la version conteneurisée depuis les sources
```bash
docker compose up -d --build
```
Construit les images localement et sert l'application sur http://127.0.0.1:3000.

### Tests
```bash
cd backend && python -m pytest        # 367 tests
cd web && npx tsc --noEmit && npx vitest run
cd web && npm run test:e2e            # Playwright — démarre sa propre pile isolée
```

### Publier une version
Voir **[RELEASING.md](RELEASING.md)**.

---

## ⚠️ Ne distribuez jamais une archive faite à la main

Le dossier du projet contient **vos données personnelles** :

| Dossier | Contenu |
|---|---|
| `backend/data/` | Votre base de données complète (comptes, transactions) |
| `csv files/` | Vos relevés bancaires |
| `autre/` | Notes de travail |

Ces dossiers sont ignorés par git : un `git clone` ou un ZIP téléchargé depuis GitHub est
**propre**. En revanche, compresser vous-même le dossier depuis le Finder/l'Explorateur
**inclurait tout cela**.

➡️ Pour partager l'application, envoyez le **`finance-app.zip` de la page Releases**
(ou le dossier `release/`, qui ne contient aucune donnée).

---

## Sécurité — à lire une fois

L'application **n'a pas de mot de passe**, par conception : elle n'écoute que sur
`127.0.0.1`, c'est-à-dire uniquement votre propre machine.

- `start.sh` lance les serveurs sur `127.0.0.1` explicitement — l'interface aussi (`-H 127.0.0.1` :
  sans cette option, Next écoute sur toutes les interfaces du réseau).
- `docker-compose.yml` publie `127.0.0.1:3000:3000` — et **ne publie pas** le port 8000,
  l'interface joignant l'API par le réseau interne de Docker.

Quiconque peut atteindre un port publié a un accès complet en lecture **et en écriture** à
tous les profils. Ne retirez donc jamais le préfixe `127.0.0.1:`, n'exposez pas le port
8000, et ne placez pas l'application derrière un tunnel public.
