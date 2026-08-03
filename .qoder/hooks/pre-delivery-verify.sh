#!/bin/bash
#
# Pre-delivery quality gate for git commit/push.
# Runs the relevant subset of the verify skill's gate based on changed files.
# Usage:
#   .qoder/hooks/pre-delivery-verify.sh qoder   (called from Qoder PreToolUse)
#   .qoder/hooks/pre-delivery-verify.sh pre-commit
#   .qoder/hooks/pre-delivery-verify.sh pre-push

set -uo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cd "$repo_root"

mode="${1:-qoder}"

if [ "$mode" = "qoder" ]; then
  # Qoder PreToolUse events stream a JSON object on stdin.
  input=$(cat)
  cmd=$(echo "$input" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')

  # Only intercept git commit/push attempts.
  if ! echo "$cmd" | grep -qE '\bgit\s+(commit|push)\b'; then
    exit 0
  fi

  echo "Pre-delivery quality gate triggered for: $cmd"
fi

if [ "$mode" = "pre-commit" ]; then
  echo "Pre-commit quality gate running..."
fi

if [ "$mode" = "pre-push" ]; then
  echo "Pre-push quality gate running..."
fi

# Determine the files in the current delivery boundary.
changed_files=""
if [ "$mode" = "pre-push" ] && git rev-parse --verify origin/main >/dev/null 2>&1; then
  changed_files=$(git diff --name-only origin/main...HEAD 2>/dev/null || true)
fi
if [ "$mode" = "pre-commit" ]; then
  changed_files=$(git diff --name-only --cached 2>/dev/null || true)
fi
if [ -z "$changed_files" ]; then
  changed_files=$(git diff --name-only HEAD 2>/dev/null || true)
fi

run_frontend=false
run_rust=false

if echo "$changed_files" | grep -qE '\.(ts|tsx|js|jsx|mjs|cjs)$'; then
  run_frontend=true
fi

if echo "$changed_files" | grep -qE '\.rs$'; then
  run_rust=true
fi

# If we could not determine changed files, run both gates to be safe.
if [ -z "$changed_files" ]; then
  run_frontend=true
  run_rust=true
fi

if [ "$run_frontend" = false ] && [ "$run_rust" = false ]; then
  echo "No code files changed; skipping code quality gates."
  exit 0
fi

fail=0

if [ "$run_frontend" = true ]; then
  echo "Running frontend quality gates..."
  npx tsc --noEmit || fail=1
  npm test || fail=1
fi

if [ "$run_rust" = true ]; then
  echo "Running Rust quality gates..."
  (
    cd src-tauri
    cargo fmt --check || exit 1
    cargo clippy -- -D warnings || exit 1
    cargo test || exit 1
  ) || fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Quality gate failed. Commit/push blocked." >&2
  exit 2
fi

echo "Pre-delivery quality gate passed."
