# Hexa Global Agent Connector Implementation Plan

> Execute with test-driven development and verify every completion claim from fresh command output.

**Goal:** Make explicit Hexa supervision work from any local project and stop stale watched sessions from appearing or polling as active.

**Architecture:** Ship a dependency-free global Node CLI under `~/.humhum/bin`, install a HUMHUM-managed supervision skill into detected Agent skill roots, and make the frontend's active/polling state depend on the same 30-minute freshness rule.

**Tech:** Tauri/Rust, Node.js ESM, React/TypeScript, Vitest.

---

## Task 1: Lock the global CLI contract with tests

**Files:**

- Create: `scripts/humhum-hexa.test.mjs`
- Create: `scripts/humhum-hexa.mjs`

1. Add tests for provider/session resolution, safe state filenames, per-session state selection, positional arguments, and plan parsing.
2. Run the focused Node test and confirm it fails because the module does not exist.
3. Implement only the pure parsing/path/request helpers needed by the tests.
4. Run the focused test and confirm it passes.
5. Add a mocked HTTP integration test for every CLI subcommand.

## Task 2: Lock managed connector installation with Rust tests

**Files:**

- Create: `src-tauri/src/hexa_connector.rs`
- Modify: `src-tauri/src/lib.rs`

1. Add tests proving the CLI is executable, detected skill roots receive the managed skill, a second install is idempotent, and an unmanaged collision is preserved with a capability warning.
2. Run the focused Rust tests and confirm failure.
3. Implement the installer with embedded CLI and skill sources.
4. Call the installer during app startup and log non-fatal capability warnings.
5. Run the focused Rust tests and confirm success.

## Task 3: Make polling freshness-aware

**Files:**

- Modify: `src/hooks/hexaRefreshPolicy.test.ts`
- Modify: `src/hooks/hexaRefreshPolicy.ts`

1. Add failing cases for fresh active, stale active, completed, malformed timestamp, and injected current time.
2. Reuse the 30-minute watched-session expiry rule instead of duplicating status semantics.
3. Run the focused Vitest file until green.

## Task 4: Make disconnected state unambiguous

**Files:**

- Modify: `src/components/Hub/hexa/HexaActiveMonitor.tsx`
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `src/styles/global.css`
- Add or modify focused component/helper tests as needed.

1. Replace repository npm instructions with `~/.humhum/bin/humhum-hexa`.
2. Label stale sessions `已断开` in the navigation.
3. Change the stale status dot from orange to neutral gray.
4. Confirm capability copy distinguishes “Agent cannot report a structured plan” from a HUMHUM failure.

## Task 5: Full verification and cross-project proof

1. Run focused Node, Vitest, and Rust tests.
2. Run `npm test`, `npm run build`, `cargo fmt --check`, `cargo test`, `cargo check`, and `git diff --check`.
3. Build the Tauri app from the isolated worktree and install it.
4. Verify the global executable and managed skills exist.
5. From a non-HUMHUM repository, register a disposable watched session with an explicit provider ID, sync a two-item plan, verify the local record, complete it, and remove it.
6. Preserve unrelated user changes, fast-forward local `main`, push `main`, and confirm the remote SHA.
