#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-.env.local}"
LOCAL_ENV_EXAMPLE="${LOCAL_ENV_EXAMPLE:-.env.example}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-../../.npm-cache}"
PORT="${PORT:-3001}"

die() {
  echo "run.sh: $*" >&2
  exit 1
}

ensure_local_env_file() {
  if [[ -f "$LOCAL_ENV_FILE" ]]; then
    echo "$LOCAL_ENV_FILE already exists."
    return
  fi
  [[ -f "$LOCAL_ENV_EXAMPLE" ]] || die "missing $LOCAL_ENV_EXAMPLE"
  echo "Creating $LOCAL_ENV_FILE from $LOCAL_ENV_EXAMPLE"
  cp "$LOCAL_ENV_EXAMPLE" "$LOCAL_ENV_FILE"
  chmod 600 "$LOCAL_ENV_FILE"
}

ensure_dependencies() {
  if [[ ! -d node_modules ]]; then
    npm install --cache "$NPM_CACHE_DIR"
  fi
}

free_port_if_needed() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi
  local pids still_running
  pids="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi
  echo "Port $PORT is in use. Stopping process(es): $pids"
  kill $pids 2>/dev/null || true
  sleep 1
  still_running="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [[ -n "$still_running" ]]; then
    echo "Process(es) still using port $PORT. Force stopping: $still_running"
    kill -9 $still_running 2>/dev/null || true
    sleep 1
  fi
}

ensure_local_env_file
ensure_dependencies
free_port_if_needed
npm run dev -- --port "$PORT"
