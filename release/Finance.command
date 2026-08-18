#!/usr/bin/env bash
# Finance — double-cliquez ce fichier pour ouvrir l'application.
#
# Il télécharge la dernière version, la démarre, puis ouvre votre navigateur.
# C'est aussi comme ça que les mises à jour arrivent : il suffit de relancer.

cd "$(dirname "$0")" || exit 1

RESET=$'\033[0m'; BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'

say()  { printf "%s\n" "$1"; }
fail() {
  printf "\n%s%s%s\n\n" "$RED$BOLD" "$1" "$RESET"
  shift
  for line in "$@"; do printf "  %s\n" "$line"; done
  printf "\n%sAppuyez sur Entrée pour fermer cette fenêtre.%s\n" "$DIM" "$RESET"
  read -r _
  exit 1
}

printf "%s\n" "${BOLD}Finance${RESET}"
say "${DIM}Démarrage…${RESET}"

# 1. Docker installé ?
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker n'est pas installé." \
       "Cette application a besoin de Docker Desktop (gratuit) pour fonctionner." \
       "" \
       "1. Téléchargez-le ici :  https://www.docker.com/products/docker-desktop/" \
       "2. Installez-le, ouvrez-le une fois." \
       "3. Double-cliquez à nouveau sur Finance."
fi

# 2. Docker démarré ? (installé mais pas lancé est le cas le plus fréquent)
if ! docker info >/dev/null 2>&1; then
  say "${DIM}Docker Desktop n'est pas encore démarré — tentative d'ouverture…${RESET}"
  open -a Docker 2>/dev/null || true
  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  docker info >/dev/null 2>&1 || fail "Docker Desktop ne répond pas." \
    "Ouvrez Docker Desktop manuellement, attendez que l'icône indique « running »," \
    "puis double-cliquez à nouveau sur Finance."
fi

# 3. Sauvegarde automatique AVANT toute mise à jour.
# L'application est d'abord arrêtée proprement : SQLite écrit alors son journal
# (-wal) dans la base, donc la copie est cohérente. Une mise à jour modifie la
# structure de la base et ne peut pas être annulée : cette copie est le seul
# retour en arrière possible.
if [ -f data/finance.db ]; then
  docker compose down >/dev/null 2>&1 || true
  mkdir -p data/backups
  STAMP=$(date +%Y%m%d-%H%M%S)
  if cp data/finance.db "data/backups/finance-$STAMP.db" 2>/dev/null; then
    say "${DIM}Sauvegarde créée : data/backups/finance-$STAMP.db${RESET}"
    # Ne garder que les 5 plus récentes (les noms sont horodatés donc triables).
    ls -1t data/backups/finance-*.db 2>/dev/null | tail -n +6 | while read -r old; do
      rm -f "$old"
    done
  else
    say "${DIM}(Sauvegarde impossible — démarrage quand même.)${RESET}"
  fi
fi

# 4. Dernière version (c'est le mécanisme de mise à jour).
say "${DIM}Recherche d'une mise à jour…${RESET}"
docker compose pull --quiet 2>/dev/null || docker compose pull || \
  say "${DIM}(Téléchargement impossible — démarrage avec la version déjà installée.)${RESET}"

# 5. Démarrage.
if ! docker compose up -d; then
  fail "L'application n'a pas pu démarrer." \
       "Si le port 3000 est déjà utilisé par un autre programme, fermez-le puis réessayez."
fi

# 6. Attendre que ce soit réellement prêt avant d'ouvrir le navigateur.
say "${DIM}Préparation…${RESET}"
for _ in $(seq 1 60); do
  if curl -fs -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    open "http://127.0.0.1:3000"
    printf "\n%sFinance est ouvert dans votre navigateur.%s\n" "$GREEN$BOLD" "$RESET"
    say "Adresse : http://127.0.0.1:3000"
    say ""
    say "${DIM}Pour arrêter l'application : double-cliquez sur « Arreter ».${RESET}"
    say "${DIM}Vous pouvez fermer cette fenêtre.${RESET}"
    exit 0
  fi
  sleep 2
done

fail "L'application a démarré mais ne répond pas." \
     "Réessayez dans une minute. Si le problème persiste, double-cliquez sur « Arreter »," \
     "puis relancez Finance."
