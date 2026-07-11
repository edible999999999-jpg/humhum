# OpenClaw Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and activate an owner-safe OpenClaw internal hook that feeds normalized coarse lifecycle events to Hexa.

**Architecture:** A focused Rust module owns generated `HOOK.md` and `handler.ts` assets plus a narrow JSON activation merge. The existing client registry and Tauri hook commands delegate to the module; generated TypeScript maintains an ordered best-effort loopback delivery queue.

**Tech Stack:** Rust, serde_json, TypeScript, OpenClaw internal hooks, Vitest, Cargo tests.

## Global Constraints

- Never start or restart the OpenClaw Gateway automatically.
- Preserve every unrelated key in `~/.openclaw/openclaw.json`.
- Remove only files carrying `HUMHUM_OPENCLAW_HOOK`.
- Send only to authenticated `127.0.0.1` HUMHUM endpoints.
- Do not implement OpenClaw tool interception or follow-up messaging in this increment.

---

### Task 1: Managed Hook And Activation

**Files:**
- Create: `src-tauri/src/openclaw_hook.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/client_registry.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `install_at(hook_dir, config_path)`, `uninstall_at(hook_dir, config_path)`, and `is_installed_at(hook_dir, config_path)`.

- [ ] Write failing tests for profile metadata, generated files, ownership refusal, unrelated-config preservation, activation status, and uninstall cleanup.
- [ ] Run `cargo test openclaw --manifest-path src-tauri/Cargo.toml` and verify failure because the format/module is absent.
- [ ] Implement generated assets, atomic file/config writes, exact activation merge, and exhaustive command routing without creating the generic shell hook.
- [ ] Run the focused tests and verify all pass.
- [ ] Commit with `feat(hexa): supervise OpenClaw gateway sessions`.

### Task 2: Handler Runtime Contract

**Files:**
- Modify: `src-tauri/src/openclaw_hook.rs`
- Modify: OpenClaw identity maps in `src/hooks/useHexaData.ts`, `src/lib/mascot-theme.ts`, and existing display surfaces.

**Interfaces:**
- Validates stable id resolution, seven event mappings, ordered authenticated delivery, and observer-only return behavior.

- [ ] Write a failing Node runtime smoke test and frontend label/theme tests.
- [ ] Run focused Cargo and Vitest tests and verify the intended failures.
- [ ] Implement the minimum handler normalization and OpenClaw display identity required by the tests.
- [ ] Run focused tests, `npm test -- --run`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Commit with `test(hexa): verify OpenClaw event delivery`.

### Task 3: Installed Runtime And Release

**Files:**
- Modify: `docs/competitive-parity-2026-07-12.md`

**Interfaces:**
- Produces: installed OpenClaw discovery evidence and a fresh verified release artifact.

- [ ] Back up the current OpenClaw config in a temporary directory, install through the same Rust-owned behavior, and run `openclaw hooks list --json`, `openclaw hooks info humhum-openclaw`, and `openclaw hooks check` without starting the Gateway.
- [ ] Verify uninstall restores the original configuration semantically and leaves unrelated hooks intact; reinstall only when the product setting is explicitly enabled.
- [ ] Run frontend tests/build, full Rust tests, and release build.
- [ ] Verify strict deep signature, DMG checksum, mounted executable architecture, release health, and record the SHA-256.
- [ ] Update the parity report, remove comparison/temp files, and commit with `docs: verify OpenClaw parity release`.
