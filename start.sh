#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env.local ]; then
  cp .env.staging.example .env.local
  echo "Created .env.local from .env.staging.example. Add SAMSAR_API_KEY before running live Samsar."
fi

if [ ! -d node_modules ]; then
  npm install
fi

PORT="${PORT:-3000}"

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo "Port $PORT is in use. Stopping process(es): $PIDS"
    kill $PIDS 2>/dev/null || true
    sleep 1

    STILL_RUNNING="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
    if [ -n "$STILL_RUNNING" ]; then
      echo "Process(es) still using port $PORT. Force stopping: $STILL_RUNNING"
      kill -9 $STILL_RUNNING 2>/dev/null || true
      sleep 1
    fi
  fi
fi

npm run dev -- --port "$PORT"
