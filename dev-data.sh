#!/usr/bin/env bash
# Copie les données de l'application INSTALLÉE dans le dossier de développement,
# pour essayer le code en cours sur de vraies données sans publier de version.
#
#   ./dev-data.sh                       # depuis l'application installée (voir plus bas)
#   ./dev-data.sh "/chemin/vers/data"   # ou depuis un dossier donné, retenu ensuite
#   ./dev-data.sh --find                # affiche seulement la source qui serait lue
#
# L'application installée, sans dossier donné : l'application de bureau si ses
# données existent (macOS : ~/Library/Application Support/Finance/data), sinon le
# conteneur Docker « finance-backend ». Un dossier donné une fois est retenu
# (fichier `.copie`) et passe avant les deux aux copies suivantes.
#
# Sens unique : l'application installée n'est que LUE. La copie, elle, est jetable —
# relancer ce script la remplace, et ce qui y a été modifié entre-temps est perdu.
# `./start.sh` reconnaît une copie (fichier `.copie`) : il la RAFRAÎCHIT à chaque
# lancement (FRESH_DATA=0 ./start.sh la garde telle quelle), le dit, et ne lance pas
# les tâches réseau (cours, taux, synchronisation du courtier), qui restent
# l'affaire de l'application installée. Un dossier sans base (une nouvelle copie
# du dépôt) reçoit sa première copie de la même façon.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${FINANCE_DATA_DIR:-$ROOT/backend/data}"
MARKER="$DEST/.copie"

FIND=""
if [ "${1:-}" = "--find" ]; then
  FIND=1
  shift
fi

# Les données de l'application de bureau (desktop/main.js : <userData>/data).
desktop_data() {
  case "$(uname -s)" in
    Darwin) echo "$HOME/Library/Application Support/Finance/data" ;;
    *) echo "${XDG_CONFIG_HOME:-$HOME/.config}/Finance/data" ;;
  esac
}

# D'où copier, dans l'ordre : le dossier donné ; celui donné à une copie précédente
# (3e ligne de `.copie` : « choisie ») ; l'application de bureau ; le dossier que le
# conteneur Docker a monté ; la source de la copie précédente (Docker arrêté : ses
# fichiers restent lisibles).
SRC="${1:-}"
CHOSEN=""
[ -n "$SRC" ] && CHOSEN=1
if [ -z "$SRC" ] && [ -f "$MARKER" ] && [ "$(sed -n 3p "$MARKER")" = "choisie" ]; then
  SRC="$(sed -n 2p "$MARKER")"
  CHOSEN=1
fi
if [ -z "$SRC" ] && [ -f "$(desktop_data)/finance.db" ]; then
  SRC="$(desktop_data)"
fi
if [ -z "$SRC" ] && command -v docker &>/dev/null; then
  SRC="$(docker inspect finance-backend \
    --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
fi
if [ -z "$SRC" ] && [ -f "$MARKER" ]; then
  SRC="$(sed -n 2p "$MARKER")"
fi
if [ -z "$SRC" ] || [ ! -f "$SRC/finance.db" ]; then
  [ -n "$FIND" ] && exit 1
  echo "Impossible de trouver les données de l'application installée."
  echo "Indiquez son dossier « data » :  ./dev-data.sh \"/chemin/vers/Suivi finance/data\""
  exit 1
fi
if [ -n "$FIND" ]; then
  echo "$SRC"
  exit 0
fi
SRC="$(cd "$SRC" && pwd)"
mkdir -p "$DEST"
if [ "$SRC" = "$(cd "$DEST" && pwd)" ]; then
  echo "La source et la destination sont le même dossier : rien à copier."
  exit 1
fi

# Un serveur de développement en marche garde la base ouverte : la remplacer sous
# lui la corromprait.
if [ -f "$DEST/finance.db" ] && lsof -- "$DEST/finance.db" &>/dev/null; then
  echo "La base de développement est en cours d'utilisation : arrêtez ./start.sh (Ctrl+C), puis relancez."
  exit 1
fi

# Ce qui est déjà là. Une copie précédente est remplacée ; une base qui n'est PAS
# une copie (vos données, si vous utilisiez l'application depuis les sources) est
# mise de côté, jamais supprimée. Les fichiers -wal/-shm suivent la base : laissés
# en place, ils seraient relus avec la nouvelle.
if [ -f "$DEST/finance.db" ]; then
  if [ -f "$MARKER" ]; then
    rm -f "$DEST/finance.db" "$DEST/finance.db-wal" "$DEST/finance.db-shm"
  else
    KEPT="$DEST/avant-copie-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$KEPT"
    for f in finance.db finance.db-wal finance.db-shm; do
      [ -f "$DEST/$f" ] && mv "$DEST/$f" "$KEPT/"
    done
    echo "La base qui était là a été mise de côté : $KEPT"
  fi
fi

PYTHON="python3"
if command -v conda &>/dev/null; then
  source "$(conda info --base)/etc/profile.d/conda.sh"
  conda activate finenv 2>/dev/null || true
  PYTHON="python"
fi

# L'API de sauvegarde de SQLite donne une copie cohérente même si l'application
# installée tourne (un simple `cp` pourrait saisir la base au milieu d'une écriture).
"$PYTHON" - "$SRC/finance.db" "$DEST/finance.db" "$MARKER" "$CHOSEN" <<'PY'
import sqlite3, sys
from datetime import datetime

src_path, dest_path, marker, chosen = sys.argv[1:5]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dest = sqlite3.connect(dest_path)
with dest:
    src.backup(dest)
count = lambda table: dest.execute(f"select count(*) from {table}").fetchone()[0]
has = lambda table: dest.execute("select 1 from sqlite_master where type='table' and name=?", (table,)).fetchone()
payslips = f", {count('payslips')} fiche(s) de paie" if has("payslips") else ""
print(f"Copié : {count('profiles')} profil(s), {count('accounts')} compte(s), {count('transactions')} transaction(s){payslips}.")
src.close()
dest.close()
with open(marker, "w", encoding="utf-8") as fh:
    fh.write(f"{datetime.now().isoformat(timespec='minutes')}\n{src_path.rsplit('/', 1)[0]}\n")
    if chosen:
        fh.write("choisie\n")   # a folder given by hand: the next copies read it too
PY

echo "Source      : $SRC (lue seulement)"
echo "Destination : $DEST"
if [ -z "${FROM_START_SH:-}" ]; then
  echo "Lancez ./start.sh pour ouvrir l'application de développement sur cette copie."
fi
