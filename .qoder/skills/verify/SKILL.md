---
name: verify
description: Run all HUMHUM quality gates — frontend typecheck + vitest, and Rust fmt/clippy/test — mirroring CI. Use before marking work done, opening a PR, or when asked to "verify", "check", or "run the gates".
---

Run the full quality gate suite for HUMHUM and report results. This mirrors what CI checks (frontend typecheck + Rust fmt/clippy/test) plus the frontend unit tests.

Run these from the repo root, in order. Do not stop at the first failure unless a step cannot proceed — collect results from every step so you can report all problems at once.

1. Frontend typecheck (the only frontend quality gate — there is no ESLint/Prettier):
   ```bash
   pnpm exec tsc --noEmit
   ```

2. Frontend unit tests (vitest):
   ```bash
   pnpm test
   ```

3. Rust checks (must run inside `src-tauri/`):
   ```bash
   cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
   ```

Then summarize: report each gate as pass/fail, and for any failure show the specific error(s) and the file/line. If everything passes, say so concisely.

Notes:
- Use `pnpm` (canonical package manager). If `pnpm` is unavailable, fall back to `npm` equivalents (`npx tsc --noEmit`, `npm test`).
- `cargo fmt --check` only reports formatting drift; run `cargo fmt` (without `--check`) to auto-fix, then re-run the check.
- Do not use `--no-verify` or otherwise bypass gates. Fix the root cause of any failure.
