# Hexa Persistent Session Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an existing Hexa watch resume when its bound Codex thread starts newer work, without letting expired inferred watches become the default report.

**Architecture:** Add a timestamp-gated resume operation to `HexaWatchStore` and call it from the Codex bridge only for new turn/plan evidence. Adjust frontend report selection so expired active-looking records do not outrank valid sessions.

**Tech Stack:** Rust, Tauri, TypeScript, React, Vitest

## Global Constraints

- Preserve the existing watched session identity.
- Never reopen a completed watch from `SessionStarted` alone.
- Never treat replayed older events as new work.
- Preserve expired inferred records as history.

---

### Task 1: Resume a completed watched Codex session

**Files:**
- Modify: `src-tauri/src/hexa_watch_store.rs`
- Modify: `src-tauri/src/codex_bridge/mod.rs`
- Test: `src-tauri/src/hexa_watch_store.rs`
- Test: `src-tauri/src/codex_bridge/mod.rs`

**Interfaces:**
- Consumes: `HexaWatchedSession`, `HexaEvent`, and RFC 3339 timestamps.
- Produces: `HexaWatchStore::resume_completed_session(session_id, event_timestamp, current_step)`.

- [ ] **Step 1: Write failing store and bridge tests**

Add tests proving a newer work event resumes a completed watch, while an older
event and a startup-only session event do not.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
CARGO_TARGET_DIR=/private/tmp/humhum-hexa-complete-current/src-tauri/target \
  cargo test --manifest-path src-tauri/Cargo.toml \
  'hexa_watch_store::tests::resumes_completed_session_only_for_newer_work' --lib
```

Expected: FAIL because the resume API does not exist.

- [ ] **Step 3: Implement the minimal resume behavior**

Compare parsed RFC 3339 timestamps, change only a completed session to
`working`, clear `blocked_reason` and `need_user`, and update its current step.
Invoke it for `TurnStarted` and `PlanUpdated` before normal synchronization.

- [ ] **Step 4: Run the Rust tests**

Run:

```bash
CARGO_TARGET_DIR=/private/tmp/humhum-hexa-complete-current/src-tauri/target \
  cargo test --manifest-path src-tauri/Cargo.toml \
  hexa_watch_store::tests --lib
CARGO_TARGET_DIR=/private/tmp/humhum-hexa-complete-current/src-tauri/target \
  cargo test --manifest-path src-tauri/Cargo.toml \
  codex_bridge::tests --lib
```

Expected: PASS.

### Task 2: Do not default to an expired inferred watch

**Files:**
- Modify: `src/hooks/hexaSessionReport.ts`
- Test: `src/hooks/hexaSessionReport.test.ts`

**Interfaces:**
- Consumes: grouped `HexaWatchedSession` values.
- Produces: `resolveSelectedSession` preferring non-expired sessions.

- [ ] **Step 1: Write the failing selection test**

Create an expired `working` inferred watch and a valid completed native watch;
assert that the valid watch is selected by default.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/hooks/hexaSessionReport.test.ts
```

Expected: FAIL because the expired working watch is currently selected.

- [ ] **Step 3: Implement expiry-aware selection**

Reuse `watchedSessionIsExpired` and skip expired sessions when choosing the
default non-completed report. Keep explicit user selection unchanged.

- [ ] **Step 4: Run the frontend test**

Run:

```bash
npx vitest run src/hooks/hexaSessionReport.test.ts
```

Expected: PASS.

### Task 3: Verify and package

**Files:**
- Verify all changed files.

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: tested release commit and locally installed application.

- [ ] **Step 1: Run full tests**

```bash
npm test
CARGO_TARGET_DIR=/private/tmp/humhum-hexa-complete-current/src-tauri/target \
  cargo test --manifest-path src-tauri/Cargo.toml --lib
```

- [ ] **Step 2: Build the frontend and Tauri application**

```bash
npm run build
npm run tauri build -- --bundles app
```

- [ ] **Step 3: Commit the fix**

```bash
git add docs/superpowers src/hooks/hexaSessionReport.ts \
  src/hooks/hexaSessionReport.test.ts src-tauri/src/hexa_watch_store.rs \
  src-tauri/src/codex_bridge/mod.rs
git commit -m "fix(hexa): resume persistent Codex watches"
```

- [ ] **Step 4: Install and verify**

Replace `/Applications/HumHum.app` atomically, restart it, and verify the bound
session has a fresh update time and verifiable work items.

