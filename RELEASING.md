# Publier une version

Pour vous (le mainteneur). Vos proches, eux, n'ont qu'à relancer *Finance*.

---

## Le dépôt ne contient que du code

L'historique a été reparti de zéro : le dépôt local **est** le dépôt public, un seul
commit initial, aucune trace des anciennes versions. Vous pouvez donc travailler
normalement — `git commit`, `git push` — sans manipulation particulière.

Ce qui protège vos données, ce n'est plus une procédure mais `.gitignore` :

| Chemin | Contenu |
|---|---|
| `backend/data/` | la base, les sauvegardes, les journaux |
| `csv files/`, `autre/` | vos relevés bancaires |
| `release/data/` | la base si vous lancez l'app depuis le dépôt |
| `CLAUDE.md` | notes de travail |

> ⚠️ **La seule règle : ne jamais commiter de données.** Avant un `git push`, si vous avez
> ajouté des fichiers, vérifiez — la commande doit ne rien afficher :
>
> ```bash
> git ls-files | grep -iE "\.csv$|\.db$|\.env$|data/"
> ```
>
> Des relevés bancaires ont déjà fini dans l'historique de ce projet par le passé. Ils ont
> été supprimés en repartant d'un dépôt neuf, ce qui est la seule méthode fiable : réécrire
> l'historique laisse des objets accessibles côté GitHub, et des références créées par
> d'autres outils peuvent survivre à un `filter-repo`.

### Une seule fois : créer le dépôt

```bash
gh repo create finance --public --source=. --remote=origin --push
```

> Le nom du dépôt détermine le nom des images :
> `ghcr.io/<compte>/<dépôt>-backend` et `-web`. Avec un dépôt nommé `finance` et le
> compte `kilianpdrx`, cela donne exactement ce qu'attend `release/docker-compose.yml`.
> **Si vous le nommez autrement**, changez la ligne `image:` dans ce fichier (deux fois).

### Une seule fois : donner au dépôt le droit d'écrire les images

Les paquets GHCR appartiennent au **compte**, pas au dépôt : ils survivent à la
suppression d'un dépôt, mais gardent leur lien vers celui qui les a créés. Un dépôt
recréé n'a donc aucun droit dessus et la Release échoue sur :

```
denied: permission_denied: write_package
```

Aucune API REST ne couvre ce réglage — c'est l'interface web, une fois par paquet :

`github.com/users/<compte>/packages/container/finance-backend/settings`
→ *Manage Actions access* → **Add repository** → `finance` → rôle **Write**

Puis la même chose pour `finance-web`. Vérifiez aussi que la visibilité de chaque paquet
est **Public** (*Package settings* → *Change visibility*), sinon vos proches devraient
s'authentifier — ce qui ruine le principe du double-clic.

---

## À chaque version

### 1. Vérifier avant de taguer

```bash
cd backend && python -m pytest        # doit être vert
cd ../web && npx tsc --noEmit && npx vitest run && npm run test:e2e
```

**Test de migration sur une vraie base** — c'est le contrôle qui compte, parce que les
migrations ne se jouent que vers l'avant :

Sur une **copie** de votre base réelle — celle de l'installation, pas celle du dépôt
(`~/Desktop/Suivi finance/data/finance.db` ; adaptez si vous l'avez rangée ailleurs —
`docker inspect finance-backend` montre le dossier monté) :

```bash
sqlite3 ~/Desktop/"Suivi finance"/data/finance.db ".backup '/tmp/migration-test.db'"
cd backend && python - <<'PY'
from pathlib import Path
import database; database.DB_PATH = Path("/tmp/migration-test.db")
from alembic.config import Config; from alembic import command
cfg = Config("alembic.ini"); cfg.attributes["embedded"] = True
command.upgrade(cfg, "head")   # doit passer sans erreur
command.upgrade(cfg, "head")   # et être idempotent
PY
```

> `.backup` plutôt que `cp` : SQLite est en mode WAL, une copie brute du seul fichier
> `.db` perdrait les pages encore dans le journal `-wal`.
> `attributes["embedded"]` évite qu'Alembic ne réinitialise la configuration de
> journalisation (voir `alembic/env.py`).

> ⚠️ `env.py` lit `database.DB_PATH` et **ignore** l'URL passée à Alembic : c'est la seule
> façon de viser une autre base que celle de production. Ne lancez pas
> `alembic upgrade head` sans ce patch, vous migreriez vos vraies données.

### 2. Pousser

```bash
git push
```

### 3. Taguer

```bash
git tag v1.2.0 && git push origin v1.2.0   # adaptez le numéro
```

La CI construit alors les images **amd64 + arm64** (indispensable : une image construite
sur un Mac Apple Silicon ne démarre pas sur un PC Intel), les pousse sous le tag et sous
`:latest`, et attache `finance-app.zip` à la Release GitHub. Le job `promote` ne
déplace `:latest` qu'après **les deux** architectures : une release à moitié construite
ne peut pas atteindre vos proches.

> ⚠️ Ne repoussez jamais un tag **antérieur** (ex. `v1.0.0`) : il relancerait sa propre
> Release et `promote` ramènerait `:latest` en arrière, rétrogradant silencieusement
> tout le monde au prochain lancement.

### 4. Vérifier la version publiée

```bash
mkdir /tmp/verif && cd /tmp/verif
curl -L -o app.zip https://github.com/kilianpdrx/finance/releases/latest/download/finance-app.zip
unzip -q app.zip && cd release
bash ./Finance.command
```

Puis contrôler :
- **Paramètres → Général → À propos** affiche bien le tag publié
- l'application répond sur `127.0.0.1:3000` mais **pas** sur votre IP locale
- un nouvel utilisateur obtient 14 catégories et 16 règles
- créer un second profil : il doit lui aussi arriver avec ses 14 catégories

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
