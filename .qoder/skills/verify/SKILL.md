---
name: verify
description: Run the HUMHUM quality gates that are actually touched by the current diff — frontend typecheck + vitest, and Rust fmt/clippy/test — mirroring CI. Use before marking work done, opening a PR, or when asked to "verify", "check", or "run the gates".
---

Run the quality gate suite for HUMHUM, but only for the gates that cover files changed in the current diff. This mirrors what CI checks (frontend typecheck + Rust fmt/clippy/test) plus the frontend unit tests.

## 1. Diff-aware check selection

First determine which gates are actually affected by the current change.

```bash
git diff --name-only origin/main...HEAD
```

If that fails (no upstream branch), fall back to:

```bash
git diff --name-only HEAD
```

A gate is affected when at least one changed file matches its pattern:

- **Frontend typecheck**: `src/**`, `package*.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`
- **Frontend unit tests (vitest / node --test)**: `src/**/*.test.{ts,tsx}`, `scripts/*.test.mjs`, `relay/**/*.test.mjs`, plus `package*.json`, `vite.config.ts`, `vitest.config.*`
- **Rust backend (fmt / clippy / test)**: `src-tauri/**`, `Cargo.toml`, `Cargo.lock`

Report which gates were selected and why. If no gate matches the diff (for example, only docs, design assets, `.github/workflows`, or skill markdown changed), report that no quality gates are needed for this diff and stop. Do not run the full suite unnecessarily.

## 2. Run selected gates

For each selected gate, run the commands below from the repo root. Do not stop at the first failure unless a step cannot proceed — collect results from every selected step so you can report all problems at once.

### Frontend typecheck (selected when frontend source/config changed)

```bash
npx tsc --noEmit
```

### Frontend unit tests (selected when a frontend or scripts test file changed)

```bash
npm test
```

### Rust checks (selected when Rust source/config changed; run inside `src-tauri/`)

```bash
cd src-tauri && cargo fmt --check && cargo clippy --locked && cargo test --lib
```

## 3. Summarize

Report each selected gate as pass/fail, and for any failure show the specific error(s) and the file/line. If no gates were selected, say so concisely and explain which files changed. If everything selected passes, say so concisely.

Notes:
- Use `npm` (canonical package manager, per `package.json` `packageManager` field).
- `cargo fmt --check` only reports formatting drift; run `cargo fmt` (without `--check`) to auto-fix, then re-run the check.
- `cargo clippy --locked` reports warnings without failing the build. `-- -D warnings` is the goal once existing warnings on main are cleaned.
- Do not use `--no-verify` or otherwise bypass gates. Fix the root cause of any failure.
