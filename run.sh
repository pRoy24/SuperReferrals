#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-.env.local}"
LOCAL_ENV_EXAMPLE="${LOCAL_ENV_EXAMPLE:-.env.example}"
LOCAL_CONFIGURE_LIVE="${LOCAL_CONFIGURE_LIVE:-false}"
PORT="${PORT:-3000}"

die() {
  echo "run.sh: $*" >&2
  exit 1
}

is_truthy() {
  case "$1" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
    return
  fi
  node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
}

env_value() {
  local file="$1"
  local key="$2"
  local line value
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  value="${line#*=}"
  value="${value%% #*}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s\n' "$value"
}

is_placeholder_value() {
  local value="$1"
  [[ -z "$value" ]] && return 0
  case "$value" in
    change-me*|replace_with_*|\<*\>|*your*.example*|*paste*|*Paste*|*todo*|*TODO*)
      return 0
      ;;
  esac
  return 1
}

quote_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local quoted tmp
  quoted="$(quote_env_value "$value")"
  tmp="$(mktemp)"
  awk -v key="$key" -v quoted="$quoted" '
    BEGIN { written = 0 }
    $0 ~ "^" key "=" {
      if (!written) {
        print key "=" quoted
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) {
        print key "=" quoted
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
}

prompt_env_value() {
  local file="$1"
  local key="$2"
  local title="$3"
  local details="$4"
  local mode="$5"
  local required="$6"
  local default_action="${7:-}"
  local current value prompt

  current="$(env_value "$file" "$key")"
  if ! is_placeholder_value "$current"; then
    echo "$key: already set in $file."
    return
  fi

  if [[ ! -t 0 ]]; then
    if [[ "$required" == "required" ]]; then
      die "$key is required in $file. $details"
    fi
    echo "$key: missing; skipped because run.sh is running non-interactively."
    return
  fi

  echo
  echo "$title ($key)"
  echo "$details"
  if [[ "$required" == "required" ]]; then
    echo "This local value is required."
  else
    echo "Press Enter to leave it blank for now; the app will run and show an admin setup warning."
  fi

  prompt="Value"
  if [[ "$default_action" == "generate" ]]; then
    prompt="Value (press Enter to generate a secure random value)"
  fi

  if [[ "$mode" == "secret" ]]; then
    read -r -s -p "$prompt: " value
    echo
  else
    read -r -p "$prompt: " value
  fi

  if [[ -z "$value" && "$default_action" == "generate" ]]; then
    value="$(generate_secret)"
    echo "Generated $key."
  fi

  if [[ -z "$value" ]]; then
    if [[ "$required" == "required" ]]; then
      die "$key cannot be blank for $file."
    fi
    echo "$key left blank."
    return
  fi

  set_env_value "$file" "$key" "$value"
  echo "$key saved to $file."
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

configure_local_env() {
  ensure_local_env_file
  prompt_env_value "$LOCAL_ENV_FILE" "SUPERREFERRALS_SESSION_SECRET" \
    "SuperReferrals session secret" \
    "Used to encrypt account/session cookies. Generate once and keep it stable for this local workspace." \
    "secret" "required" "generate"
  prompt_env_value "$LOCAL_ENV_FILE" "ADMIN_SECRET" \
    "Admin dashboard secret" \
    "Used to unlock /admin locally." \
    "secret" "required" "generate"

  if is_truthy "$LOCAL_CONFIGURE_LIVE" || [[ "$(env_value "$LOCAL_ENV_FILE" "SUPERREFERRALS_MOCKS")" == "false" ]]; then
    prompt_env_value "$LOCAL_ENV_FILE" "SAMSAR_APP_SECRET" \
      "Samsar platform APP_SECRET" \
      "Used only for live storefront APP_KEY provisioning. Get it from Samsar platform credentials." \
      "secret" "optional"
    prompt_env_value "$LOCAL_ENV_FILE" "KEEPERHUB_API_KEY" \
      "KeeperHub API key" \
      "Used for live local settlement/refund testing." \
      "secret" "optional"
    prompt_env_value "$LOCAL_ENV_FILE" "KEEPERHUB_WALLET_ADDRESS" \
      "KeeperHub settlement wallet" \
      "EVM address that receives live storefront payments." \
      "plain" "optional"
    prompt_env_value "$LOCAL_ENV_FILE" "OG_PRIVATE_KEY" \
      "0G signer private key" \
      "Funded private key used for live local 0G storage, iNFT minting, and registry writes. Never commit it." \
      "secret" "optional"
    prompt_env_value "$LOCAL_ENV_FILE" "OG_DA_URL" \
      "0G data availability endpoint" \
      "0G DA submission URL from your 0G operator." \
      "plain" "optional"
    prompt_env_value "$LOCAL_ENV_FILE" "USER_REGISTRY_CONTRACT_ADDRESS" \
      "User registry contract address" \
      "Local live registry writes need the deployed target-network address." \
      "plain" "optional"
    prompt_env_value "$LOCAL_ENV_FILE" "AGENT_REGISTRY_CONTRACT_ADDRESS" \
      "Agent registry contract address" \
      "Local live agent registry writes need the deployed target-network address." \
      "plain" "optional"
    prompt_env_value "$LOCAL_ENV_FILE" "INFT_CONTRACT_ADDRESS" \
      "iNFT contract address" \
      "Local live minting needs the deployed iNFT contract address." \
      "plain" "optional"
  else
    echo "SUPERREFERRALS_MOCKS is enabled; skipping live-provider prompts for local run."
    echo "Set LOCAL_CONFIGURE_LIVE=true or SUPERREFERRALS_MOCKS=false in $LOCAL_ENV_FILE to configure live local providers."
  fi
}

ensure_dependencies() {
  if [[ ! -d node_modules ]]; then
    npm install
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

configure_local_env
ensure_dependencies
free_port_if_needed
npm run dev -- --port "$PORT"
