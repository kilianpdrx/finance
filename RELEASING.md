# Publier une version

Pour vous (le mainteneur). Vos proches, eux, n'ont qu'à relancer *Finance*.

---

## Une seule fois : créer le dépôt

Rien n'est publié tant que vous ne faites pas ceci.

```bash
gh repo create finance --private --source=. --remote=origin
git push -u origin master
```

> Le nom du dépôt détermine le nom des images :
> `ghcr.io/<compte>/<dépôt>-backend` et `-web`. Avec un dépôt nommé `finance` et le
> compte `kilianpdrx`, cela donne exactement ce qu'attend `release/docker-compose.yml`.
> **Si vous le nommez autrement**, changez la ligne `image:` dans ce fichier (deux fois).

### Rendre les images publiques (une fois, après la première release)

Sans cela vos proches devraient s'authentifier avec un jeton GitHub — ce qui ruine le
principe du double-clic. Les paquets peuvent être publics même si le dépôt est privé.

1. GitHub → votre profil → **Packages**
2. Ouvrir `finance-backend` → *Package settings* → **Change visibility** → *Public*
3. Recommencer pour `finance-web`

---

## À chaque version

### 1. Vérifier avant de taguer

```bash
cd backend && python -m pytest        # doit être vert
cd ../web && npx tsc --noEmit && npx vitest run
```

**Test de migration sur une vraie base** — c'est le contrôle qui compte, parce que les
migrations ne se jouent que vers l'avant :

```bash
cp backend/data/finance.db /tmp/migration-test.db
cd backend && python - <<'PY'
from pathlib import Path
import database; database.DB_PATH = Path("/tmp/migration-test.db")
from alembic.config import Config; from alembic import command
command.upgrade(Config("alembic.ini"), "head")   # doit passer sans erreur
command.upgrade(Config("alembic.ini"), "head")   # et être idempotent
PY
```

> ⚠️ `env.py` lit `database.DB_PATH` et **ignore** l'URL passée à Alembic : c'est la seule
> façon de viser une autre base que celle de production. Ne lancez pas
> `alembic upgrade head` sans ce patch, vous migreriez vos vraies données.

### 2. Taguer et pousser

```bash
git tag v1.0.0
git push origin v1.0.0
```

La CI construit alors les images **amd64 + arm64** (indispensable : une image construite
sur un Mac Apple Silicon ne démarre pas sur un PC Intel), les pousse en `:v1.0.0` et
`:latest`, et attache `finance-app.zip` à la Release GitHub.

### 3. Vérifier la version publiée

```bash
mkdir /tmp/verif && cd /tmp/verif
curl -L -o app.zip https://github.com/<compte>/finance/releases/latest/download/finance-app.zip
unzip -q app.zip && cd release
bash ./Finance.command
```

Puis contrôler :
- **Paramètres → Général → À propos** affiche bien `v1.0.0`
- l'application répond sur `127.0.0.1:3000` mais **pas** sur votre IP locale
- un nouvel utilisateur obtient 14 catégories et 77 règles

Enfin `bash ./Arreter.command`, puis `rm -rf /tmp/verif`.

---

## Numérotation

`APP_VERSION` vient **du tag git**, injecté à la construction de l'image. Il n'y a pas de
fichier de version à maintenir : un lancement depuis les sources affiche `dev`, ce qui est
honnête plutôt qu'un faux numéro.

Utilisez `vMAJEUR.MINEUR.CORRECTIF` :
- **correctif** — corrections seules
- **mineur** — nouveautés, sans migration risquée
- **majeur** — changement de structure de données important (prévenez vos proches de
  sauvegarder avant)

---

## Si une version est cassée

Vos proches peuvent revenir en arrière en figeant le tag :

```bash
TAG=v1.0.0 docker compose up -d
```

Mais **si la mauvaise version a déjà migré leur base**, revenir à l'image précédente ne
suffit pas : la structure a changé. Ils doivent restaurer leur sauvegarde
(Paramètres → *Sauvegarde & Données* → *Restaurer*). C'est précisément pour cela que
l'écran « À propos » leur rappelle de sauvegarder avant chaque mise à jour.
