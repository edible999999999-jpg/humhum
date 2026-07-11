# Session Change Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand, privacy-bounded changed-files summary to each eligible Hexa session.

**Architecture:** A new Rust module owns Git invocation and parsing. The existing Tauri command layer validates the session/workspace boundary, while a small frontend state reducer and Hexa block own loading and presentation.

**Tech Stack:** Rust, Tokio process execution, Git porcelain/numstat, Tauri commands, React, TypeScript, Vitest.

## Global Constraints

- Never evaluate a shell command string.
- Never return absolute paths or file contents.
- Cap output at 80 files and every Git process at five seconds.
- Preserve existing session-card layout and load only after user action.

---

### Task 1: Structured Git Summary

**Files:**
- Create: `src-tauri/src/git_changes.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `GitChangeSummary`, `GitChangedFile`, and `summarize_workspace(&Path)`.

- [ ] Write parser tests for modified, staged, untracked, rename, and binary records.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml git_changes` and confirm the tests fail because parsing is missing.
- [ ] Implement separated `git` process calls, five-second timeouts, structured parsing, relative output, and the 80-file cap.
- [ ] Re-run the focused tests and commit the backend unit.

### Task 2: Session-Bound Command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `summarize_workspace(&Path)` and the existing `SessionStore`.
- Produces: Tauri command `get_session_change_summary(session_id)`.

- [ ] Write a temporary-repository test that proves only relative paths are returned.
- [ ] Verify the test fails before command/workspace integration exists.
- [ ] Resolve only HUMHUM-known sessions with canonical directory workspaces and register the command.
- [ ] Re-run the focused Rust tests and commit.

### Task 3: Hexa On-Demand Review

**Files:**
- Create: `src/hooks/sessionChangesState.ts`
- Create: `src/hooks/sessionChangesState.test.ts`
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`

**Interfaces:**
- Consumes: `get_session_change_summary`.
- Produces: a session-card disclosure with branch, totals, changed files, loading, empty, and retry states.

- [ ] Write reducer tests for load, success, empty, and failure transitions and observe the initial failure.
- [ ] Implement the reducer and typed Tauri invocation.
- [ ] Add an icon disclosure to eligible session cards; render at most the bounded backend result without nested cards.
- [ ] Run `npm test` and `npm run build`, then commit.

### Task 4: Release Evidence

**Files:**
- Modify: `docs/competitive-parity-2026-07-12.md`

- [ ] Run `git diff --check`, `npm test`, `npm run build`, and the full Rust suite.
- [ ] Record exact counts and the remaining full-patch/remote-attachment gap.
- [ ] Build and verify the release DMG in the final parity tranche.

