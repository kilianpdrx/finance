# Installation

Ce projet a **deux publics**. Choisissez la section qui vous concerne.

---

# 1. Vous voulez juste utiliser l'application

**Ne clonez pas ce dépôt.** Téléchargez le fichier `finance-app.zip` de la dernière
version depuis la page **Releases** du projet, décompressez-le, et suivez le
`LISEZMOI.md` qu'il contient.

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
- (optionnel) conda — `start.sh` active un environnement nommé `finenv` s'il existe

### Lancer en développement
```bash
./start.sh
```
Démarre l'API sur `127.0.0.1:8000` (avec `--reload`) et l'interface sur
`127.0.0.1:3000`. `MODE=prod ./start.sh` fait un build de production.

### Lancer la version conteneurisée depuis les sources
```bash
docker compose up -d --build
```
Construit les images localement et sert l'application sur http://127.0.0.1:3000.

### Tests
```bash
cd backend && python -m pytest        # 145 tests
cd web && npx tsc --noEmit && npx vitest run
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

- `start.sh` lance les serveurs sur `127.0.0.1` explicitement.
- `docker-compose.yml` publie `127.0.0.1:3000:3000` — et **ne publie pas** le port 8000,
  l'interface joignant l'API par le réseau interne de Docker.

Quiconque peut atteindre un port publié a un accès complet en lecture **et en écriture** à
tous les profils. Ne retirez donc jamais le préfixe `127.0.0.1:`, n'exposez pas le port
8000, et ne placez pas l'application derrière un tunnel public.
