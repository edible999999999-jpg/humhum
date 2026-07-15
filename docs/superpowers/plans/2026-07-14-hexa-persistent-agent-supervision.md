# Hexa Persistent Agent Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hexa registrations survive restart and present them as durable Agent identities with current work and history.

**Architecture:** Extend the existing Rust watch store into a file-backed store containing durable agents and runs. Keep the current HTTP/Tauri boundary, add explicit load/error state to the React hook, and render a compact Agent overview plus selected detail without introducing orchestration.

**Tech Stack:** Rust, serde/serde_json, Tauri v2, React, TypeScript, Vitest.

## Global Constraints

- Hexa observes, records, reminds, and reviews; it does not orchestrate agents.
- Do not change the permission request flow.
- Store local supervision data under `~/.humhum/`.
- Preserve passive hook/bridge sessions as a separate lower-confidence source.

---

### Task 1: File-backed Hexa watch store

**Files:**
- Modify: `src-tauri/src/hexa_watch_store.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `HexaWatchStore::load_or_create(humhum_dir: &Path) -> Result<Self, String>`
- Produces: durable `register`, `update`, and `delete` methods returning `Result`
- Produces: `agents() -> Vec<HexaWatchedAgent>`

- [ ] **Step 1: Write failing persistence tests**

Create temp-backed tests that register an Agent/run, reconstruct the store from the same path, and assert the run is present. Add update and delete restart tests.

- [ ] **Step 2: Verify the tests fail**

Run: `cargo test hexa_watch_store --manifest-path src-tauri/Cargo.toml`

Expected: FAIL because `load_or_create` and persistence do not exist.

- [ ] **Step 3: Implement the durable data model**

Add `HexaWatchedAgent`, a serializable store snapshot, stable Agent keys based on provider/workspace, mutable display metadata, and atomic save. Make all mutations persist before returning.

- [ ] **Step 4: Load the store during Tauri setup**

Replace `HexaWatchStore::default()` with `HexaWatchStore::load_or_create(&home.join(".humhum"))`, logging and falling back only when loading fails.

- [ ] **Step 5: Verify Rust behavior**

Run: `cargo test hexa_watch_store --manifest-path src-tauri/Cargo.toml`

Expected: persistence tests PASS.

### Task 2: Preserve watch data across frontend refresh failures

**Files:**
- Create: `src/hooks/hexaWatchState.ts`
- Create: `src/hooks/hexaWatchState.test.ts`
- Modify: `src/hooks/useHexaData.ts`

**Interfaces:**
- Produces: `resolveWatchRefresh(previous, result)` returning data plus `loading | ready | error`
- Produces: `watchDataState` and `retryHexaData` from `useHexaData`

- [ ] **Step 1: Write failing state tests**

Test that a fulfilled refresh replaces prior data, a rejected refresh preserves prior data and exposes an error, and the first rejected refresh remains distinguishable from a valid empty result.

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- --run src/hooks/hexaWatchState.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the state reducer and integrate it**

Keep the last successful watched snapshot, expose connection state, and avoid setting metrics to zero when watch/session commands fail.

- [ ] **Step 4: Verify frontend state tests**

Run: `npm test -- --run src/hooks/hexaWatchState.test.ts`

Expected: PASS.

### Task 3: Harness-inspired Agent overview and detail

**Files:**
- Create: `src/hooks/hexaAgentOverview.ts`
- Create: `src/hooks/hexaAgentOverview.test.ts`
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `src/hooks/useHexaData.ts`

**Interfaces:**
- Consumes: persistent watched agents/runs and `watchDataState`
- Produces: supervised Agent list, selected Agent detail, history metrics, explicit loading/error/empty states

- [ ] **Step 1: Add pure aggregation tests**

Add tests for total runs, completed, blocked, success rate, current run selection, and updated-at ordering.

- [ ] **Step 2: Verify aggregation tests fail**

Run: `npm test -- --run src/hooks/hexaWatchState.test.ts`

Expected: FAIL for missing aggregation behavior.

- [ ] **Step 3: Implement compact Agent supervision UI**

Render supervised Agents before mobile/setup panels. Show identity, status, current goal/step, heartbeat, four metrics, recent history, delete action, and a retry banner when the store is unavailable.

- [ ] **Step 4: Verify responsive rendering and build**

Run: `npm run build`

Expected: TypeScript and Vite build PASS.

### Task 4: End-to-end restart verification

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Register a real watched run**

Run: `npm run hexa:watch -- "验证 Hexa Agent 持久化与工作历史"`

Expected: command prints a session id and the Agent appears in Hexa.

- [ ] **Step 2: Restart HUMHUM and verify recovery**

Stop and restart `npm run tauri dev`. Open Hexa and confirm the same Agent and run history remain.

- [ ] **Step 3: Run final gates**

Run: `npm run build`

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: both PASS.

- [ ] **Step 4: Commit and push**

Commit the scoped files with `feat: persist hexa supervised agents` and push `main`.
