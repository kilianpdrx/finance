#!/usr/bin/env bash
# Arrêter Finance — double-cliquez ce fichier pour fermer l'application.
# Vos données sont conservées dans le dossier « data ».

cd "$(dirname "$0")" || exit 1

RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'

printf "%s\n" "${BOLD}Arrêt de Finance…${RESET}"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf "%sDocker n'est pas démarré — l'application est déjà arrêtée.%s\n" "$DIM" "$RESET"
  exit 0
fi

docker compose down

printf "\n%sFinance est arrêté. Vos données sont conservées.%s\n" "$BOLD" "$RESET"
printf "%sPour rouvrir l'application : double-cliquez sur « Finance ».%s\n" "$DIM" "$RESET"
