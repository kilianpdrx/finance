#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
WEB="$ROOT/web"

# Which frontend to run: "web" (new Next.js app, default) or "legacy" (old Vite SPA).
UI="${UI:-web}"
# MODE: "dev" (default) or "prod" (build then start).
MODE="${MODE:-dev}"

echo "=== Finance Dashboard (UI=$UI, MODE=$MODE) ==="

# Free a TCP port by killing whatever is already listening on it.
free_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Port $port in use — stopping existing process(es): $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

# Activate conda env if available
if command -v conda &>/dev/null; then
  source "$(conda info --base)/etc/profile.d/conda.sh"
  conda activate finenv 2>/dev/null || echo "Warning: could not activate finenv, using current env"
fi

# Install backend deps
echo "Installing backend dependencies..."
pip install -r "$BACKEND/requirements.txt" -q

if [ "$UI" = "legacy" ]; then
  UI_DIR="$FRONTEND"
  UI_PORT=5173
else
  UI_DIR="$WEB"
  UI_PORT=3000
fi

# Install frontend deps
echo "Installing frontend dependencies ($UI_DIR)..."
cd "$UI_DIR" && npm install --silent && cd "$ROOT"

# Free the ports before launching (avoids EADDRINUSE from a previous run)
free_port 8000
free_port "$UI_PORT"

# Start backend
if [ "$MODE" = "prod" ]; then
  echo "Starting backend on http://localhost:8000 (production) ..."
  cd "$BACKEND"
  uvicorn main:app --port 8000 --workers 2 &
  BACKEND_PID=$!
  cd "$ROOT"
else
  echo "Starting backend on http://localhost:8000 (dev, --reload) ..."
  cd "$BACKEND"
  uvicorn main:app --reload --port 8000 &
  BACKEND_PID=$!
  cd "$ROOT"
fi

# Build frontend if production mode
if [ "$MODE" = "prod" ] && [ "$UI" = "web" ]; then
  echo "Building Next.js app..."
  cd "$UI_DIR"
  PATH="/opt/homebrew/bin:$PATH" npm run build
  cd "$ROOT"
fi

# Start frontend
if [ "$MODE" = "prod" ] && [ "$UI" = "web" ]; then
  echo "Starting frontend on http://localhost:$UI_PORT (production) ..."
  cd "$UI_DIR"
  PATH="/opt/homebrew/bin:$PATH" npm run start &
  FRONTEND_PID=$!
  cd "$ROOT"
else
  echo "Starting frontend on http://localhost:$UI_PORT (dev) ..."
  cd "$UI_DIR"
  PATH="/opt/homebrew/bin:$PATH" npm run dev &
  FRONTEND_PID=$!
  cd "$ROOT"
fi

echo ""
echo "Both servers started."
echo "  Frontend: http://localhost:$UI_PORT"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Tip: run 'UI=legacy ./start.sh' for the old Vite interface."
echo "      run 'MODE=prod ./start.sh' for a production build."
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
