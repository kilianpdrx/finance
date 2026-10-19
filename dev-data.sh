#!/usr/bin/env bash
# Copie les données de l'application INSTALLÉE dans le dossier de développement,
# pour essayer le code en cours sur de vraies données sans publier de version.
#
#   ./dev-data.sh                       # depuis le conteneur « finance-backend »
#   ./dev-data.sh "/chemin/vers/data"   # ou depuis un dossier donné
#
# Sens unique : l'application installée n'est que LUE. La copie, elle, est jetable —
# relancer ce script la remplace, et ce qui y a été modifié entre-temps est perdu.
# `./start.sh` reconnaît une copie (fichier `.copie`) : il le dit, et ne lance pas
# les tâches réseau (cours, taux, synchronisation du courtier), qui restent
# l'affaire de l'application installée.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${FINANCE_DATA_DIR:-$ROOT/backend/data}"
MARKER="$DEST/.copie"

# D'où copier : l'argument, sinon la source de la copie précédente, sinon le
# dossier que le conteneur de l'application installée a monté.
SRC="${1:-}"
if [ -z "$SRC" ] && [ -f "$MARKER" ]; then
  SRC="$(sed -n 2p "$MARKER")"
fi
if [ -z "$SRC" ] && command -v docker &>/dev/null; then
  SRC="$(docker inspect finance-backend \
    --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
fi
if [ -z "$SRC" ] || [ ! -f "$SRC/finance.db" ]; then
  echo "Impossible de trouver les données de l'application installée."
  echo "Indiquez son dossier « data » :  ./dev-data.sh \"/chemin/vers/Suivi finance/data\""
  exit 1
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
"$PYTHON" - "$SRC/finance.db" "$DEST/finance.db" "$MARKER" <<'PY'
import sqlite3, sys
from datetime import datetime

src_path, dest_path, marker = sys.argv[1:4]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dest = sqlite3.connect(dest_path)
with dest:
    src.backup(dest)
count = lambda table: dest.execute(f"select count(*) from {table}").fetchone()[0]
print(f"Copié : {count('profiles')} profil(s), {count('accounts')} compte(s), {count('transactions')} transaction(s).")
src.close()
dest.close()
with open(marker, "w", encoding="utf-8") as fh:
    fh.write(f"{datetime.now().isoformat(timespec='minutes')}\n{src_path.rsplit('/', 1)[0]}\n")
PY

echo "Source      : $SRC (lue seulement)"
echo "Destination : $DEST"
echo "Lancez ./start.sh pour ouvrir l'application de développement sur cette copie."
