#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

echo "=== Finance Dashboard ==="

# Activate conda env if available
if command -v conda &>/dev/null; then
  source "$(conda info --base)/etc/profile.d/conda.sh"
  conda activate finenv 2>/dev/null || echo "Warning: could not activate finenv, using current env"
fi

# Install backend deps
echo "Installing backend dependencies..."
pip install -r "$BACKEND/requirements.txt" -q

# Install frontend deps
echo "Installing frontend dependencies..."
cd "$FRONTEND" && npm install --silent && cd "$ROOT"

# Start backend
echo "Starting backend on http://localhost:8000 ..."
cd "$BACKEND"
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd "$ROOT"

# Start frontend
echo "Starting frontend on http://localhost:5173 ..."
cd "$FRONTEND"
npm run dev &
FRONTEND_PID=$!
cd "$ROOT"

echo ""
echo "Both servers started."
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both."

# Wait and cleanup on exit
cleanup() {
  echo "Stopping servers..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait $BACKEND_PID $FRONTEND_PID
