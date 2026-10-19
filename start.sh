#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
WEB="$ROOT/web"

# MODE: "dev" (default) or "prod" (build then start).
MODE="${MODE:-dev}"

echo "=== Finance Dashboard (MODE=$MODE) ==="

# Is this process running from this project's folder — i.e. a previous ./start.sh?
is_ours() {
  local cwd
  cwd=$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  case "$cwd" in "$ROOT"|"$ROOT"/*) return 0 ;; *) return 1 ;; esac
}

# Print a port this run can use, starting at $1. A port still held by a previous
# run of THIS project is freed. A port held by anything else is skipped, never
# killed: on a machine that also runs the installed app, 3000 belongs to Docker's
# own process, and killing it takes Docker Desktop down with every container.
claim_port() {
  local port="$1" tries=0 pids pid foreign
  while [ "$tries" -lt 20 ]; do
    pids=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -z "$pids" ]; then
      echo "$port"
      return 0
    fi
    foreign=""
    for pid in $pids; do
      is_ours "$pid" || foreign=1
    done
    if [ -z "$foreign" ]; then
      echo "Port $port in use by a previous run — stopping it: $(echo $pids)" >&2
      kill $pids 2>/dev/null || true
      sleep 1
      pids=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null || true
      fi
      echo "$port"
      return 0
    fi
    echo "Port $port is used by another program — using $((port + 1)) instead" >&2
    port=$((port + 1))
    tries=$((tries + 1))
  done
  echo "No free port found from $1" >&2
  return 1
}

# Activate conda env if available
if command -v conda &>/dev/null; then
  source "$(conda info --base)/etc/profile.d/conda.sh"
  conda activate finenv 2>/dev/null || echo "Warning: could not activate finenv, using current env"
fi

# Install backend deps
echo "Installing backend dependencies..."
# -dev : le dossier de dev fait aussi tourner les tests.
pip install -r "$BACKEND/requirements-dev.txt" -q

UI_DIR="$WEB"

# Install frontend deps
echo "Installing frontend dependencies ($UI_DIR)..."
cd "$UI_DIR" && npm install --silent && cd "$ROOT"

# Ports: 8000 and 3000 unless taken by another program (or set: UI_PORT=3001 ./start.sh).
API_PORT=$(claim_port "${API_PORT:-8000}")
UI_PORT=$(claim_port "${UI_PORT:-3000}")
# The interface proxies /api to the backend; the in-app "stop" button frees both.
export BACKEND_URL="http://127.0.0.1:$API_PORT"
export FINANCE_APP_PORTS="$UI_PORT,$API_PORT"

# A data folder filled by ./dev-data.sh is a COPY of the installed app's data: say
# so, and leave the network jobs (prices, rates, broker sync) to the installed app.
DATA_DIR="${FINANCE_DATA_DIR:-$BACKEND/data}"
if [ -f "$DATA_DIR/.copie" ]; then
  echo "Data: a copy made by ./dev-data.sh on $(sed -n 1p "$DATA_DIR/.copie") — the installed app is not touched."
  export FINANCE_OFFLINE="${FINANCE_OFFLINE:-1}"
fi

# Start backend
if [ "$MODE" = "prod" ]; then
  echo "Starting backend on http://localhost:$API_PORT (production) ..."
  cd "$BACKEND"
  # Bind to loopback only: the app has no authentication (profiles are selected
  # via a client header), so it must not be reachable from the local network.
  uvicorn main:app --host 127.0.0.1 --port "$API_PORT" --workers 2 &
  BACKEND_PID=$!
  cd "$ROOT"
else
  echo "Starting backend on http://localhost:$API_PORT (dev, --reload) ..."
  cd "$BACKEND"
  # Loopback only — see note above.
  uvicorn main:app --reload --host 127.0.0.1 --port "$API_PORT" &
  BACKEND_PID=$!
  cd "$ROOT"
fi

# Build frontend if production mode
if [ "$MODE" = "prod" ]; then
  echo "Building Next.js app..."
  cd "$UI_DIR"
  PATH="/opt/homebrew/bin:$PATH" npm run build
  cd "$ROOT"
fi

# Start frontend
if [ "$MODE" = "prod" ]; then
  echo "Starting frontend on http://localhost:$UI_PORT (production) ..."
  cd "$UI_DIR"
  # -H: Next listens on every interface by default — loopback only, like the backend.
  PATH="/opt/homebrew/bin:$PATH" npx next start -H 127.0.0.1 -p "$UI_PORT" &
  FRONTEND_PID=$!
  cd "$ROOT"
else
  echo "Starting frontend on http://localhost:$UI_PORT (dev) ..."
  cd "$UI_DIR"
  PATH="/opt/homebrew/bin:$PATH" npx next dev -H 127.0.0.1 -p "$UI_PORT" --turbopack &
  FRONTEND_PID=$!
  cd "$ROOT"
fi

echo ""
echo "Both servers started."
echo "  Frontend: http://localhost:$UI_PORT"
echo "  Backend:  http://localhost:$API_PORT"
echo "  API docs: http://localhost:$API_PORT/docs"
echo ""
echo "Tip: run 'MODE=prod ./start.sh' for a production build."
echo "Press Ctrl+C to stop both."

# Wait and cleanup on exit
cleanup() {
  echo "Stopping servers..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
