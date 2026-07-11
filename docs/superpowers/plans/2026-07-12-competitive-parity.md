# Competitive Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first working HUMHUM parity tranche: attention-first supervision, exact session return, and reliable intervention, with a secure mobile foundation explicitly separated from unsupported claims.

**Architecture:** Enrich hook events at the shell boundary, persist normalized route metadata in Rust, expose a session-aware focus command, and consume it from Hexa. Keep pure ordering and state helpers independently testable in TypeScript; keep macOS automation behind a Rust strategy layer with generic fallback.

**Tech Stack:** Tauri 2, Rust, Tokio, React 18, TypeScript, Vitest, Bash, macOS AppleScript and tmux.

## Global Constraints

- Local-first and read-only behavior remain the default.
- No unauthenticated mobile or LAN control endpoint may be introduced.
- Competitor parity requires a working end-to-end path, not placeholder UI.
- Existing user changes and untracked design QA files remain untouched.

---

### Task 1: Session Route Model

**Files:**
- Modify: `hooks/humhum-hook.sh`
- Modify: `src-tauri/src/session_store.rs`

**Interfaces:**
- Consumes: hook JSON from stdin and terminal environment variables.
- Produces: `SessionRoute` serialized as `route`, plus `Session.route: Option<SessionRoute>`.

- [x] Write Rust tests proving route fields are extracted and later non-empty fields merge without erasing earlier identifiers.
- [ ] Run `cargo test session_store::tests --manifest-path src-tauri/Cargo.toml` and confirm the new tests fail because `SessionRoute` is absent.
- [x] Add `SessionRoute`, payload normalization, and non-empty merge behavior.
- [x] Enrich the shell payload through Python JSON serialization using `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TTY`, `TMUX`, `TMUX_PANE`, `ITERM_SESSION_ID`, and parent PID; never construct JSON with string interpolation.
- [ ] Re-run the focused Rust tests and a shell fixture that parses the posted payload as JSON.

### Task 2: Exact macOS Session Focus

**Files:**
- Modify: `src-tauri/src/window_focus.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `session_id: String` and route data from `SessionStore`.
- Produces: `focus_agent_session(session_id) -> FocusResult { strategy, application, exact }`.

- [x] Write Rust tests for terminal-name normalization, tmux pane allow-list validation, and strategy selection.
- [ ] Run the focused tests and confirm failure for missing focus strategy APIs.
- [x] Implement tmux `select-pane`/`select-window`, captured app activation, iTerm/TTY AppleScript where identifiers exist, and generic fallback.
- [x] Register `focus_agent_session` and return actionable errors when the session or route cannot be resolved.
- [ ] Re-run focused tests and invoke the command with a synthetic session route.

### Task 3: Attention-First Hexa

**Files:**
- Create: `src/hooks/hexaPriority.ts`
- Create: `src/hooks/hexaPriority.test.ts`
- Modify: `src/hooks/hexaBridge.ts`
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`

**Interfaces:**
- Consumes: `HexaSupervisorSession[]`.
- Produces: `sortHexaSessions()` and `focusAgentSession(sessionId)`.

- [x] Write Vitest cases ordering waiting before stalled/failed, working, idle, completed, with recency as tie-breaker.
- [ ] Run `npm test -- src/hooks/hexaPriority.test.ts` and confirm failure because the module is absent.
- [x] Implement the pure sorter and apply it before active/history slicing.
- [x] Add a stable icon button to each card for exact return, including busy/success/error feedback and tooltip.
- [ ] Remove duplicate JSX declarations encountered in the touched panel and ensure compact layouts wrap without overlap.
- [ ] Run frontend tests and build.

### Task 4: Reliable Follow-Up State

**Files:**
- Create: `src/hooks/interventionState.ts`
- Create: `src/hooks/interventionState.test.ts`
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `src/hooks/useHexaData.ts`

**Interfaces:**
- Consumes: send/resume outcomes and draft text.
- Produces: reducer states `idle | sending | delivered | failed` with retry-preserved draft.

- [x] Write reducer tests proving failures retain the draft and successful retry clears it.
- [ ] Run the test and confirm failure for the missing reducer.
- [x] Implement the reducer and wire it into Codex intervention controls.
- [x] Show concise delivered/failed status without resizing the control row.
- [ ] Run frontend tests and build.

### Task 5: Parity Report And Runtime Verification

**Files:**
- Create: `docs/competitive-parity-2026-07-12.md`

**Interfaces:**
- Consumes: verified test output and live runtime checks.
- Produces: evidence-based complete/partial/missing matrix for Ping Island and Happy.

- [ ] Run `cargo fmt --check --manifest-path src-tauri/Cargo.toml`.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [x] Run `npm test` and `npm run build`.
- [ ] Launch `npm run tauri dev`, inject a synthetic routed hook event, and verify Hexa rendering plus focus result.
- [ ] Record completed, partial, and missing capabilities without calling the Codex-only remote panel a HUMHUM mobile app.
- [ ] Commit the verified tranche and leave the app running on the latest commit.
