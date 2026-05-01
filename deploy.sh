#!/usr/bin/env bash
set -euo pipefail

REMOTE="${DEPLOY_REMOTE:-origin}"
DEVELOP_BRANCH="${DEPLOY_DEVELOP_BRANCH:-develop}"
MAIN_BRANCH="${DEPLOY_MAIN_BRANCH:-main}"
SKIP_BOOTSTRAP="${DEPLOY_SKIP_BOOTSTRAP:-false}"
BOOTSTRAP_ARGS="${DEPLOY_BOOTSTRAP_ARGS:-}"
SKIP_ENV_SETUP="${DEPLOY_SKIP_ENV_SETUP:-false}"
VERCEL_DEFAULT_SCOPE="${VERCEL_SCOPE:-${VERCEL_TEAM:-proy24s-projects}}"

APP_NAME="${DEPLOY_APP:-}"
PRODUCTION=false
CUSTOM_MESSAGE=""

usage() {
  cat <<USAGE
Usage: ./deploy.sh [superreferrals] [--production] [--skip-bootstrap] [-m "commit message"]

Checks Vercel auth/project setup, lists existing deployed env key names, prompts only for missing values,
syncs only missing env keys to Vercel, bootstraps storage, then commits and pushes all current changes to ${DEVELOP_BRANCH}.
With --production, also merges ${DEVELOP_BRANCH} into ${MAIN_BRANCH} and pushes ${MAIN_BRANCH}.

Environment overrides:
  DEPLOY_APP             App to deploy when omitted from argv (default: superreferrals)
  DEPLOY_REMOTE          Git remote name (default: origin)
  DEPLOY_DEVELOP_BRANCH  Development branch (default: develop)
  DEPLOY_MAIN_BRANCH     Production branch (default: main)
  DEPLOY_SKIP_BOOTSTRAP  Set true to skip deploy storage bootstrap
  DEPLOY_SKIP_ENV_SETUP  Set true to skip env file creation and prompts
  DEPLOY_BOOTSTRAP_ARGS  Extra args for deploy:setup, for example "--scope my-team"
  VERCEL_TOKEN           Vercel token for env inspection/sync, or put it in .vercel-token
USAGE
}

die() {
  echo "deploy.sh: $*" >&2
  exit 1
}

if [[ $# -gt 0 && "$1" != -* ]]; then
  APP_NAME="$1"
  shift
fi
APP_NAME="${APP_NAME:-superreferrals}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --production)
      PRODUCTION=true
      ;;
    --skip-bootstrap)
      SKIP_BOOTSTRAP=true
      ;;
    -m|--message)
      [[ $# -ge 2 ]] || die "missing value for $1"
      CUSTOM_MESSAGE="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"

case "$APP_NAME" in
  superreferrals)
    APP_DIR="$ROOT/app"
    VERCEL_DEFAULT_PROJECT="${VERCEL_PROJECT:-super-referrals}"
    ;;
  *)
    die "unknown app: $APP_NAME. The only deployable app is superreferrals."
    ;;
esac

[[ -d "$APP_DIR" ]] || die "missing app directory: $APP_DIR"
cd "$APP_DIR"

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

env_file_for_target() {
  case "$1" in
    production)
      printf '.env.production\n'
      ;;
    staging)
      printf '.env.staging\n'
      ;;
    *)
      die "unknown deploy target: $1"
      ;;
  esac
}

example_file_for_target() {
  case "$1" in
    production)
      printf '.env.production.example\n'
      ;;
    staging)
      printf '.env.staging.example\n'
      ;;
    *)
      die "unknown deploy target: $1"
      ;;
  esac
}

vercel_environment_for_target() {
  case "$1" in
    production)
      printf 'production\n'
      ;;
    staging)
      printf 'preview\n'
      ;;
    *)
      die "unknown deploy target: $1"
      ;;
  esac
}

vercel_branch_for_target() {
  case "$1" in
    production)
      printf '\n'
      ;;
    staging)
      printf '%s\n' "$DEVELOP_BRANCH"
      ;;
    *)
      die "unknown deploy target: $1"
      ;;
  esac
}

read_vercel_token() {
  if [[ -n "${VERCEL_TOKEN:-}" ]]; then
    printf '%s\n' "$VERCEL_TOKEN"
    return
  fi
  if [[ -f ".vercel-token" ]]; then
    tr -d '[:space:]' < ".vercel-token"
    return
  fi
  if [[ -f "$ROOT/.vercel-token" ]]; then
    tr -d '[:space:]' < "$ROOT/.vercel-token"
  fi
}

run_vercel() {
  local token
  token="$(read_vercel_token)"
  if [[ -n "${VERCEL_CLI_BIN:-}" ]]; then
    if [[ -n "$token" ]]; then
      VERCEL_TOKEN="$token" "$VERCEL_CLI_BIN" "$@"
    else
      "$VERCEL_CLI_BIN" "$@"
    fi
    return
  fi
  if [[ -n "$token" ]]; then
    VERCEL_TOKEN="$token" npx --yes vercel@latest "$@"
  else
    npx --yes vercel@latest "$@"
  fi
}

has_vercel_auth() {
  run_vercel whoami >/dev/null 2>&1
}

ensure_vercel_auth() {
  if has_vercel_auth; then
    echo "Vercel auth: ok."
    return
  fi

  if [[ ! -t 0 ]]; then
    die "Vercel auth is required to inspect deployed env keys. Set VERCEL_TOKEN, put it in .vercel-token, or run npx vercel login first."
  fi

  echo
  echo "Vercel auth is required to inspect which deployment env keys already exist."
  echo "Choose one:"
  echo "  1) Start Vercel login in this terminal"
  echo "  2) Paste a Vercel token for this deploy run"
  echo "  3) Abort"
  local choice token
  read -r -p "Selection [1]: " choice
  choice="${choice:-1}"
  case "$choice" in
    1)
      run_vercel login
      ;;
    2)
      read -r -s -p "VERCEL_TOKEN: " token
      echo
      [[ -n "$token" ]] || die "VERCEL_TOKEN cannot be blank."
      export VERCEL_TOKEN="$token"
      ;;
    3)
      die "Vercel auth setup aborted."
      ;;
    *)
      die "Unknown selection: $choice"
      ;;
  esac

  has_vercel_auth || die "Vercel auth still failed. Set VERCEL_TOKEN, .vercel-token, or run npx vercel login."
  echo "Vercel auth: ok."
}

ensure_vercel_project_link() {
  if [[ -f ".vercel/project.json" ]]; then
    echo "Vercel project link: ok."
    return
  fi

  if [[ ! -t 0 ]]; then
    die "Vercel project is not linked. Run npx vercel link --yes --scope ${VERCEL_DEFAULT_SCOPE} --project ${VERCEL_DEFAULT_PROJECT}."
  fi

  echo
  echo "This workspace is not linked to a Vercel project."
  local answer scope project
  read -r -p "Vercel scope/team [${VERCEL_DEFAULT_SCOPE}]: " scope
  read -r -p "Vercel project [${VERCEL_DEFAULT_PROJECT}]: " project
  scope="${scope:-$VERCEL_DEFAULT_SCOPE}"
  project="${project:-$VERCEL_DEFAULT_PROJECT}"
  echo "Project to link: ${scope}/${project}"
  read -r -p "Link this Vercel project now? [Y/n] " answer
  case "${answer:-Y}" in
    y|Y|yes|YES)
      run_vercel link --yes --scope "$scope" --project "$project"
      ;;
    *)
      die "Vercel project link is required before deployed env keys can be inspected."
      ;;
  esac
}

append_remote_env_keys() {
  local output_file="$1"
  local environment="$2"
  local branch="${3:-}"
  local label output json_file
  label="${environment}${branch:+ branch ${branch}}"
  json_file="$(mktemp)"

  local args=(env list "$environment")
  if [[ -n "$branch" ]]; then
    args+=("$branch")
  fi
  args+=(--format json --non-interactive)

  if ! output="$(run_vercel "${args[@]}" 2>&1)"; then
    rm -f "$json_file"
    echo "$output" >&2
    die "Unable to list Vercel env keys for ${label}. Fix Vercel auth/project setup and rerun deploy."
  fi

  printf '%s\n' "$output" > "$json_file"
  if ! node - "$json_file" "$branch" <<'NODE' >> "$output_file"; then
const fs = require("node:fs");
const inputPath = process.argv[2];
const desiredBranch = process.argv[3] || "";
const raw = fs.readFileSync(inputPath, "utf8");
const keys = new Set();
const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseCliJson(text) {
  for (let start = 0; start < text.length; start += 1) {
    const first = text[start];
    if (first !== "{" && first !== "[") {
      continue;
    }

    const stack = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === "}" || char === "]") {
        if (stack.pop() !== char) {
          break;
        }
        if (stack.length === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("Vercel CLI did not return a JSON object or array.");
}

function visit(value) {
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (typeof value.key === "string" && validKey.test(value.key)) {
    const gitBranch = typeof value.gitBranch === "string" ? value.gitBranch : "";
    if ((desiredBranch && (!gitBranch || gitBranch === desiredBranch)) || (!desiredBranch && !gitBranch)) {
      keys.add(value.key);
    }
  }
  for (const prop of ["envs", "environmentVariables", "variables", "items", "results"]) {
    if (Object.prototype.hasOwnProperty.call(value, prop)) {
      visit(value[prop]);
    }
  }
}

try {
  visit(parseCliJson(raw));
  for (const key of Array.from(keys).sort()) {
    console.log(key);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
NODE
    rm -f "$json_file"
    die "Unable to parse Vercel env key list for ${label}."
  fi
  rm -f "$json_file"
}

fetch_remote_env_keys_file() {
  local target="$1"
  local environment branch temp_file
  environment="$(vercel_environment_for_target "$target")"
  branch="$(vercel_branch_for_target "$target")"
  temp_file="$(mktemp)"

  echo "Inspecting existing Vercel env key names for ${environment}${branch:+ branch ${branch}}." >&2
  append_remote_env_keys "$temp_file" "$environment"
  if [[ -n "$branch" ]]; then
    append_remote_env_keys "$temp_file" "$environment" "$branch"
  fi
  sort -u "$temp_file" -o "$temp_file"

  printf '%s\n' "$temp_file"
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

is_vercel_system_key() {
  local key="$1"
  case "$key" in
    VERCEL_TOKEN|VERCEL_AUTH_TOKEN|VERCEL_ACCESS_TOKEN|VERCEL_OIDC_TOKEN|VERCEL_SCOPE|VERCEL_TEAM|VERCEL_PROJECT|VERCEL_PROJECT_ID|VERCEL_ORG_ID|VERCEL_TEAM_ID|VERCEL_*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

remote_has_env_key() {
  local remote_keys_file="$1"
  local key="$2"
  [[ -n "$remote_keys_file" && -f "$remote_keys_file" ]] || return 1
  grep -Fxq -- "$key" "$remote_keys_file"
}

OPTIONAL_ENV_WARNING_KEYS=""

record_optional_env_warning() {
  local key="$1"
  case ",$OPTIONAL_ENV_WARNING_KEYS," in
    *",$key,"*)
      return
      ;;
  esac
  if [[ -z "$OPTIONAL_ENV_WARNING_KEYS" ]]; then
    OPTIONAL_ENV_WARNING_KEYS="$key"
  else
    OPTIONAL_ENV_WARNING_KEYS="${OPTIONAL_ENV_WARNING_KEYS}, $key"
  fi
}

print_optional_env_warning() {
  local target="$1"
  [[ -n "$OPTIONAL_ENV_WARNING_KEYS" ]] || return 0
  echo
  echo "Warning: functionality may be limited in ${target} until these optional Vercel env keys are set:"
  echo "  ${OPTIONAL_ENV_WARNING_KEYS}"
  echo "Deploy will continue; the app will also show admin setup warnings for the affected features."
}

create_missing_env_sync_file() {
  local target="$1"
  local remote_keys_file="$2"
  local env_file sync_file line trimmed key value
  env_file="$(env_file_for_target "$target")"
  sync_file="$(mktemp)"

  [[ -f "$env_file" ]] || die "missing $env_file"

  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ -n "$trimmed" && "$trimmed" != \#* && "$trimmed" == *"="* ]] || continue
    key="${trimmed%%=*}"
    key="${key#export }"
    key="${key//[[:space:]]/}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    is_vercel_system_key "$key" && continue
    remote_has_env_key "$remote_keys_file" "$key" && continue
    value="$(env_value "$env_file" "$key")"
    is_placeholder_value "$value" && continue
    printf '%s=%s\n' "$key" "$(quote_env_value "$value")" >> "$sync_file"
  done < "$env_file"

  printf '%s\n' "$sync_file"
}

prompt_env_value() {
  local file="$1"
  local remote_keys_file="$2"
  local key="$3"
  local title="$4"
  local details="$5"
  local mode="$6"
  local required="$7"
  local default_action="${8:-}"
  local current value prompt

  if remote_has_env_key "$remote_keys_file" "$key"; then
    echo "$key: already set in Vercel."
    return
  fi

  current="$(env_value "$file" "$key")"
  if ! is_placeholder_value "$current"; then
    echo "$key: set locally and will be synced to Vercel."
    return
  fi

  if [[ ! -t 0 ]]; then
    if [[ "$required" == "required" ]]; then
      die "$key is required in $file. $details"
    fi
    echo "$key: missing; deploy will continue, but functionality may be limited."
    record_optional_env_warning "$key"
    return
  fi

  echo
  echo "$title ($key)"
  echo "$details"
  if [[ "$required" == "required" ]]; then
    echo "This value is required before deploying this environment."
  else
    echo "Press Enter to leave it blank and continue; functionality may be limited until it is set."
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
    echo "$key left blank; deploy will continue, but functionality may be limited."
    record_optional_env_warning "$key"
    return
  fi

  set_env_value "$file" "$key" "$value"
  echo "$key saved to $file."
}

prepare_env_file() {
  local target="$1"
  local remote_keys_file="$2"
  local env_file example_file
  env_file="$(env_file_for_target "$target")"
  example_file="$(example_file_for_target "$target")"

  if is_truthy "$SKIP_ENV_SETUP"; then
    echo "Skipping env setup for $target"
    return
  fi

  if [[ ! -f "$env_file" ]]; then
    [[ -f "$example_file" ]] || die "missing $example_file"
    echo "Creating $env_file from $example_file"
    cp "$example_file" "$env_file"
    chmod 600 "$env_file"
  fi

  echo "Checking deploy env values in $env_file"
  OPTIONAL_ENV_WARNING_KEYS=""
  case "$APP_NAME" in
    superreferrals)
      prepare_superreferrals_env_file "$env_file" "$remote_keys_file" "$target"
      ;;
    *)
      die "unknown app: $APP_NAME"
      ;;
  esac
}

prepare_superreferrals_env_file() {
  local env_file="$1"
  local remote_keys_file="$2"
  local target="$3"

  prompt_env_value "$env_file" "$remote_keys_file" "SUPERREFERRALS_SESSION_SECRET" \
    "SuperReferrals session secret" \
    "Used to encrypt account/session cookies. Generate once per environment and keep it stable across redeploys." \
    "secret" "required" "generate"
  prompt_env_value "$env_file" "$remote_keys_file" "ADMIN_SECRET" \
    "Admin dashboard secret" \
    "Used to unlock /admin. Generate a strong value and share only with deployment admins." \
    "secret" "required" "generate"
  prompt_env_value "$env_file" "$remote_keys_file" "SAMSAR_APP_SECRET" \
    "Samsar platform APP_SECRET" \
    "Used only when creating/authenticating generated Samsar APP_KEY credentials for storefront accounts, and for encrypting stored APP_KEYs. Get it from your Samsar platform credentials for this environment." \
    "secret" "optional"
  prompt_env_value "$env_file" "$remote_keys_file" "KEEPERHUB_API_KEY" \
    "KeeperHub API key" \
    "Used for live settlement and refunds. Create or copy it from the KeeperHub dashboard for the deployment account." \
    "secret" "optional"
  prompt_env_value "$env_file" "$remote_keys_file" "KEEPERHUB_WALLET_ADDRESS" \
    "KeeperHub settlement wallet" \
    "EVM address of the KeeperHub organization wallet that receives storefront payments for this environment." \
    "plain" "optional"
  prompt_env_value "$env_file" "$remote_keys_file" "OG_PRIVATE_KEY" \
    "0G deployment signer private key" \
    "Funded private key used for live 0G storage, iNFT minting, and registry writes on this environment's 0G network. Never commit it." \
    "secret" "optional"
  prompt_env_value "$env_file" "$remote_keys_file" "OG_DA_URL" \
    "0G data availability endpoint" \
    "0G DA submission URL from your 0G operator. Leave blank until DA publishing is enabled." \
    "plain" "optional"
  prompt_env_value "$env_file" "$remote_keys_file" "USER_REGISTRY_CONTRACT_ADDRESS" \
    "User registry contract address" \
    "Deploy SuperReferralsUserRegistry on the target 0G network, then paste the deployed address." \
    "plain" "optional"
  prompt_env_value "$env_file" "$remote_keys_file" "AGENT_REGISTRY_CONTRACT_ADDRESS" \
    "Agent registry contract address" \
    "Deploy SuperReferralsAgentRegistry on the target 0G network, then paste the deployed address." \
    "plain" "optional"
  prompt_env_value "$env_file" "$remote_keys_file" "INFT_CONTRACT_ADDRESS" \
    "iNFT contract address" \
    "Run npm run contracts:deploy:inft:testnet for staging or npm run contracts:deploy:inft:mainnet for production, then paste the address." \
    "plain" "optional"
  print_optional_env_warning "$target"
}

run_bootstrap() {
  local target="$1"
  local sync_file="${2:-}"
  if is_truthy "$SKIP_BOOTSTRAP"; then
    echo "Skipping deploy storage bootstrap for $target"
    return
  fi

  echo "Bootstrapping Vercel storage for $target"
  local sync_args=()
  local has_sync_args=false
  if [[ -n "$sync_file" ]] && grep -q '^[A-Za-z_][A-Za-z0-9_]*=' "$sync_file"; then
    sync_args=(--sync-env --force-env-sync --no-overwrite-env-sync)
    has_sync_args=true
  else
    echo "Vercel env sync: no missing target keys to upload."
  fi
  local env_override=()
  case "$target" in
    staging)
      env_override=(VERCEL_STAGING_ENV_FILE="$sync_file")
      ;;
    production)
      env_override=(VERCEL_PRODUCTION_ENV_FILE="$sync_file")
      ;;
  esac
  if [[ "$has_sync_args" == "true" ]]; then
    if [[ -n "$BOOTSTRAP_ARGS" ]]; then
      env "${env_override[@]}" npm run "deploy:setup:$target" -- "${sync_args[@]}" $BOOTSTRAP_ARGS
    else
      env "${env_override[@]}" npm run "deploy:setup:$target" -- "${sync_args[@]}"
    fi
  elif [[ -n "$BOOTSTRAP_ARGS" ]]; then
    env "${env_override[@]}" npm run "deploy:setup:$target" -- $BOOTSTRAP_ARGS
  else
    env "${env_override[@]}" npm run "deploy:setup:$target"
  fi
}

current_branch() {
  git -C "$ROOT" branch --show-current
}

ensure_branch() {
  local branch="$1"
  if [[ "$(current_branch)" != "$branch" ]]; then
    echo "Checking out $branch"
    git -C "$ROOT" checkout "$branch"
  fi
}

changed_files_count() {
  git -C "$ROOT" diff --cached --name-only | wc -l | tr -d '[:space:]'
}

largest_changed_files() {
  git -C "$ROOT" diff --cached --numstat |
    awk '$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ { print ($1 + $2) "\t" $3 }' |
    sort -rn |
    head -5 |
    cut -f2-
}

function_names_for_file() {
  local file="$1"

  case "$file" in
    *.c|*.cc|*.cpp|*.cxx|*.go|*.h|*.hpp|*.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx)
      git -C "$ROOT" diff --cached --unified=0 -- "$file" |
        sed -nE \
          -e 's/^@@.*@@[[:space:]]*(export[[:space:]]+)?(default[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*).*/\4/p' \
          -e 's/^@@.*@@[[:space:]]*(export[[:space:]]+)?(const|let|var)[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=.*/\3/p' \
          -e 's/^@@.*@@[[:space:]]*(public|private|protected)?[[:space:]]*(static[[:space:]]+)?(async[[:space:]]+)?([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*\(.*/\4/p'
      ;;
  esac
}

file_labels() {
  largest_changed_files |
    while IFS= read -r file; do
      basename "$file" | sed -E 's/\.(tsx?|jsx?|mjs|cjs|css|json|md|sol)$//'
    done
}

join_items() {
  local items=("$@")
  local count="${#items[@]}"

  case "$count" in
    0)
      return 0
      ;;
    1)
      printf '%s\n' "${items[0]}"
      ;;
    2)
      printf '%s and %s\n' "${items[0]}" "${items[1]}"
      ;;
    *)
      printf '%s, %s, and %s\n' "${items[0]}" "${items[1]}" "${items[2]}"
      ;;
  esac
}

build_commit_message() {
  if [[ -n "$CUSTOM_MESSAGE" ]]; then
    printf '%s\n' "$CUSTOM_MESSAGE"
    return
  fi

  local names=()
  local seen_names="|"
  local file name

  while IFS= read -r file; do
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      if [[ "$seen_names" != *"|$name|"* ]]; then
        names+=("$name")
        seen_names="${seen_names}${name}|"
      fi
      [[ "${#names[@]}" -lt 3 ]] || break
    done < <(function_names_for_file "$file")
    [[ "${#names[@]}" -lt 3 ]] || break
  done < <(largest_changed_files)

  if [[ "${#names[@]}" -gt 0 ]]; then
    printf 'Update %s\n' "$(join_items "${names[@]}")"
    return
  fi

  names=()
  seen_names="|"
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if [[ "$seen_names" != *"|$name|"* ]]; then
      names+=("$name")
      seen_names="${seen_names}${name}|"
    fi
    [[ "${#names[@]}" -lt 3 ]] || break
  done < <(file_labels)

  if [[ "${#names[@]}" -gt 0 ]]; then
    printf 'Update %s\n' "$(join_items "${names[@]}")"
    return
  fi

  printf 'Update project files\n'
}

commit_develop() {
  ensure_branch "$DEVELOP_BRANCH"

  echo "Staging changes"
  git -C "$ROOT" add -A

  if [[ "$(changed_files_count)" == "0" ]]; then
    echo "No changes to commit on $DEVELOP_BRANCH"
    return
  fi

  local message
  message="$(build_commit_message)"

  echo "Committing to $DEVELOP_BRANCH: $message"
  git -C "$ROOT" commit -m "$message"
}

push_develop() {
  echo "Pushing $DEVELOP_BRANCH to $REMOTE"
  git -C "$ROOT" push "$REMOTE" "$DEVELOP_BRANCH"
}

promote_to_main() {
  echo "Checking latest $MAIN_BRANCH from $REMOTE"
  git -C "$ROOT" fetch "$REMOTE" "$MAIN_BRANCH"

  ensure_branch "$MAIN_BRANCH"
  git -C "$ROOT" pull --ff-only "$REMOTE" "$MAIN_BRANCH"

  echo "Merging $DEVELOP_BRANCH into $MAIN_BRANCH"
  git -C "$ROOT" merge --no-edit "$DEVELOP_BRANCH"

  echo "Pushing $MAIN_BRANCH to $REMOTE"
  git -C "$ROOT" push "$REMOTE" "$MAIN_BRANCH"
}

TEMP_ENV_FILES=()
TEMP_ENV_FILE_COUNT=0
cleanup_temp_env_files() {
  local file
  [[ "$TEMP_ENV_FILE_COUNT" -gt 0 ]] || return 0
  for file in "${TEMP_ENV_FILES[@]}"; do
    rm -f "$file"
  done
}
trap cleanup_temp_env_files EXIT

setup_remote_target() {
  local target="$1"
  local remote_keys_file=""
  local sync_env_file=""
  if ! is_truthy "$SKIP_ENV_SETUP"; then
    remote_keys_file="$(fetch_remote_env_keys_file "$target")"
    TEMP_ENV_FILES+=("$remote_keys_file")
    TEMP_ENV_FILE_COUNT=$((TEMP_ENV_FILE_COUNT + 1))
  fi
  prepare_env_file "$target" "$remote_keys_file"
  if ! is_truthy "$SKIP_ENV_SETUP"; then
    sync_env_file="$(create_missing_env_sync_file "$target" "$remote_keys_file")"
    TEMP_ENV_FILES+=("$sync_env_file")
    TEMP_ENV_FILE_COUNT=$((TEMP_ENV_FILE_COUNT + 1))
  fi
  run_bootstrap "$target" "$sync_env_file"
}

if ! is_truthy "$SKIP_ENV_SETUP"; then
  ensure_vercel_auth
  ensure_vercel_project_link
fi

setup_remote_target staging
if [[ "$PRODUCTION" == "true" ]]; then
  setup_remote_target production
fi
commit_develop
push_develop

if [[ "$PRODUCTION" == "true" ]]; then
  promote_to_main
fi
