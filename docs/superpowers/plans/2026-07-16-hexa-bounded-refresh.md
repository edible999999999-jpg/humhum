# Hexa Bounded Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hexa event-driven by default, poll only active watched sessions every 20 seconds, and bound Codex transcript reads.

**Architecture:** Extract a testable refresh scheduler/policy module for the React hook and separate full snapshot, live event, and watched-only refresh paths. Replace whole-file Codex parsing with a bounded buffered reader.

**Tech Stack:** React, TypeScript, Vitest, Tauri 2, Rust

## Global Constraints

- Non-watched sessions and history have no periodic polling.
- Active watched sessions poll every 20 seconds.
- A refresh class has at most one request in flight and one coalesced follow-up.
- Existing uncommitted Hype work must not be changed or committed.

---

### Task 1: Refresh policy and scheduler

**Files:**
- Create: `src/hooks/hexaRefreshPolicy.ts`
- Create: `src/hooks/hexaRefreshPolicy.test.ts`
- Modify: `src/hooks/useHexaData.ts`

- [ ] Write failing tests for active-watch eligibility, the 20-second constant, and coalescing multiple triggers into one follow-up.
- [ ] Run `npm test -- src/hooks/hexaRefreshPolicy.test.ts` and confirm the missing module fails.
- [ ] Implement the minimal policy and scheduler.
- [ ] Replace the 3-second full polling loop with one initial snapshot, event-driven refreshes, and watched-only 20-second polling.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Bounded Codex session parsing

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] Write a Rust test proving session parsing succeeds without reading beyond the first 600 lines.
- [ ] Run the focused Rust test and confirm it fails against whole-file parsing instrumentation/helper expectations.
- [ ] Introduce a buffered, line-bounded reader and use it in `parse_codex_session_file`.
- [ ] Run the focused Rust test and related command tests.

### Task 3: Verification and delivery

**Files:**
- Verify only files belonging to this fix are staged.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `cargo check --manifest-path src-tauri/Cargo.toml`.
- [ ] Review the diff for the agreed refresh policy and bounded IO.
- [ ] Commit only this fix on `main` with a `fix:` commit message.
