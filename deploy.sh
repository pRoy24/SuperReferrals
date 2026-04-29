#!/usr/bin/env bash
set -euo pipefail

REMOTE="${DEPLOY_REMOTE:-origin}"
DEVELOP_BRANCH="${DEPLOY_DEVELOP_BRANCH:-develop}"
MAIN_BRANCH="${DEPLOY_MAIN_BRANCH:-main}"
SKIP_BOOTSTRAP="${DEPLOY_SKIP_BOOTSTRAP:-false}"
BOOTSTRAP_ARGS="${DEPLOY_BOOTSTRAP_ARGS:-}"

PRODUCTION=false
CUSTOM_MESSAGE=""

usage() {
  cat <<USAGE
Usage: ./deploy.sh [--production] [--skip-bootstrap] [-m "commit message"]

Bootstraps Vercel storage, then commits and pushes all current changes to ${DEVELOP_BRANCH}.
With --production, also merges ${DEVELOP_BRANCH} into ${MAIN_BRANCH} and pushes ${MAIN_BRANCH}.

Environment overrides:
  DEPLOY_REMOTE          Git remote name (default: origin)
  DEPLOY_DEVELOP_BRANCH  Development branch (default: develop)
  DEPLOY_MAIN_BRANCH     Production branch (default: main)
  DEPLOY_SKIP_BOOTSTRAP  Set true to skip deploy storage bootstrap
  DEPLOY_BOOTSTRAP_ARGS  Extra args for deploy:setup, for example "--scope my-team"
USAGE
}

die() {
  echo "deploy.sh: $*" >&2
  exit 1
}

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
cd "$ROOT"

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

run_bootstrap() {
  local target="$1"
  if is_truthy "$SKIP_BOOTSTRAP"; then
    echo "Skipping deploy storage bootstrap for $target"
    return
  fi

  echo "Bootstrapping Vercel storage for $target"
  if [[ -n "$BOOTSTRAP_ARGS" ]]; then
    npm run "deploy:setup:$target" -- --skip-env-validation $BOOTSTRAP_ARGS
  else
    npm run "deploy:setup:$target" -- --skip-env-validation
  fi
}

current_branch() {
  git branch --show-current
}

ensure_branch() {
  local branch="$1"
  if [[ "$(current_branch)" != "$branch" ]]; then
    echo "Checking out $branch"
    git checkout "$branch"
  fi
}

changed_files_count() {
  git diff --cached --name-only | wc -l | tr -d '[:space:]'
}

largest_changed_files() {
  git diff --cached --numstat |
    awk '$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ { print ($1 + $2) "\t" $3 }' |
    sort -rn |
    head -5 |
    cut -f2-
}

function_names_for_file() {
  local file="$1"

  case "$file" in
    *.c|*.cc|*.cpp|*.cxx|*.go|*.h|*.hpp|*.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx)
      git diff --cached --unified=0 -- "$file" |
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
  git add .

  if [[ "$(changed_files_count)" == "0" ]]; then
    echo "No changes to commit on $DEVELOP_BRANCH"
    return
  fi

  local message
  message="$(build_commit_message)"

  echo "Committing to $DEVELOP_BRANCH: $message"
  git commit -m "$message"
}

push_develop() {
  echo "Pushing $DEVELOP_BRANCH to $REMOTE"
  git push "$REMOTE" "$DEVELOP_BRANCH"
}

promote_to_main() {
  echo "Checking latest $MAIN_BRANCH from $REMOTE"
  git fetch "$REMOTE" "$MAIN_BRANCH"

  ensure_branch "$MAIN_BRANCH"
  git pull --ff-only "$REMOTE" "$MAIN_BRANCH"

  echo "Merging $DEVELOP_BRANCH into $MAIN_BRANCH"
  git merge --no-edit "$DEVELOP_BRANCH"

  echo "Pushing $MAIN_BRANCH to $REMOTE"
  git push "$REMOTE" "$MAIN_BRANCH"
}

if [[ "$PRODUCTION" == "true" ]]; then
  run_bootstrap production
else
  run_bootstrap staging
fi
commit_develop
push_develop

if [[ "$PRODUCTION" == "true" ]]; then
  promote_to_main
fi
