#!/bin/bash
#
# Pre-delivery quality gate for git commit/push.
# Only runs the gates affected by the current change set.
# Usage (called from .git/hooks/):
#   .qoder/hooks/pre-delivery-verify.sh pre-commit
#   .qoder/hooks/pre-delivery-verify.sh pre-push

set -uo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cd "$repo_root"

mode="${1:-}"
if [ "$mode" != "pre-commit" ] && [ "$mode" != "pre-push" ]; then
  echo "Usage: $0 pre-commit|pre-push" >&2
  exit 1
fi

echo "Pre-${mode#pre-} quality gate running..."

# ── 1. Determine changed files ──────────────────────────────────────

changed_files=""
if [ "$mode" = "pre-commit" ]; then
  changed_files=$(git diff --name-only --cached 2>/dev/null || true)
fi

if [ "$mode" = "pre-push" ]; then
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    changed_files=$(git diff --name-only origin/main...HEAD 2>/dev/null || true)
  fi
  if [ -z "$changed_files" ]; then
    # First push or no upstream — check everything being pushed.
    changed_files=$(git diff --name-only @{upstream}...HEAD 2>/dev/null || true)
  fi
fi

if [ -z "$changed_files" ]; then
  echo "No changed files detected; skipping all gates."
  exit 0
fi

# ── 2. Decide which gates are affected ─────────────────────────────

run_typecheck=false
run_frontend_test=false
run_rust=false

# Frontend typecheck: any source file or build config changed.
if echo "$changed_files" | grep -qE '(^src/.*\.(ts|tsx|js|jsx|mjs|cjs)$|^package.*\.json$|^tsconfig\.json$|^vite\.config\.ts$|^tailwind\.config\.js$|^postcss\.config\.js$|^index\.html$)'; then
  run_typecheck=true
fi

# Frontend tests: test files or build config (config changes can break tests).
if echo "$changed_files" | grep -qE '(\.test\.(ts|tsx|mjs)$|^package.*\.json$|^vite\.config\.ts$|^vitest\.config)'; then
  run_frontend_test=true
fi

# Rust: source files or cargo config changed.
if echo "$changed_files" | grep -qE '(^src-tauri/.*\.rs$|^src-tauri/Cargo\.toml$|^src-tauri/Cargo\.lock$)'; then
  run_rust=true
fi

if [ "$run_typecheck" = false ] && [ "$run_frontend_test" = false ] && [ "$run_rust" = false ]; then
  echo "No code files changed (only docs/config/assets); skipping code quality gates."
  exit 0
fi

# ── 3. Run selected gates ──────────────────────────────────────────

fail=0

if [ "$run_typecheck" = true ]; then
  echo "→ Frontend typecheck (changed: frontend source or build config)..."
  npx tsc --noEmit || fail=1
fi

if [ "$run_frontend_test" = true ]; then
  echo "→ Frontend tests (changed: test files or build config)..."
  npm test || fail=1
fi

if [ "$run_rust" = true ]; then
  echo "→ Rust checks (changed: Rust source or cargo config)..."
  (
    cd src-tauri
    cargo fmt --check || exit 1
    cargo clippy --locked -- -D warnings || exit 1
    cargo test --lib || exit 1
  ) || fail=1
fi

# ── 4. Report ──────────────────────────────────────────────────────

if [ "$fail" -ne 0 ]; then
  echo "Quality gate failed. Fix the issues above before committing/pushing." >&2
  exit 2
fi

echo "Pre-delivery quality gate passed."
