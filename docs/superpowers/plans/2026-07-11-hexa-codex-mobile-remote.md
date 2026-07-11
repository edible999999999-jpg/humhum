# Hexa Codex Mobile Remote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let a user intentionally enable Codex remote control, create a short-lived phone pairing code, inspect connection state, and disable the connection from Hexa.

**Architecture:** Reuse the existing local Codex app-server transport and its experimental `remoteControl/*` methods. HUMHUM stores only the latest status and short-lived pairing artifact in memory, exposes narrow Tauri commands, and renders a compact Hexa remote-control surface. The Codex service owns enrollment and transport; HUMHUM does not introduce a plaintext relay or claim provider-neutral Web access in this release.

**Tech Stack:** Rust, Tokio, serde/serde_json, Tauri commands/events, React, TypeScript, Lucide.

## Global Constraints

- Remote control is off until the user explicitly enables it.
- Pairing codes stay in memory and are never written under `~/.humhum/`.
- Disable uses `ephemeral: false`; it disables this app-server client scope but does not claim to revoke already enrolled controller devices.
- Unknown or unsupported protocol responses degrade to an explanatory status; local Hexa remains usable.
- The UI says "Codex mobile" rather than implying all HUMHUM providers are remotely available.

---

### Task 1: Remote-Control Domain Model

**Files:**
- Modify: `src-tauri/src/codex_bridge/mod.rs`

**Interfaces:**
- Consumes: `JsonRpcTransport::request(method, params)`.
- Produces: `CodexRemoteControlState`, `CodexRemotePairing`, `read_remote_control`, `enable_remote_control`, `disable_remote_control`, and `start_remote_pairing`.

- [x] **Step 1: Add failing parser and expiry tests**

Cover status values `disabled`, `connecting`, `connected`, and `errored`; nullable `environmentId`; pairing response fields; and expired pairing removal.

- [x] **Step 2: Run the focused Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_bridge::tests::remote_control -- --nocapture`

Expected: FAIL because the remote-control types and parsers do not exist.

- [x] **Step 3: Implement in-memory state and narrow app-server methods**

Send only these methods:

```text
remoteControl/status/read {}
remoteControl/enable {"ephemeral": false}
remoteControl/disable {"ephemeral": false}
remoteControl/pairing/start {"manualCode": true}
```

Map `remoteControl/status/changed` notifications into the same in-memory state and emit `humhum://codex-remote-control-changed`.

- [x] **Step 4: Run focused and complete Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`

Expected: all tests pass.

- [x] **Step 5: Commit the domain model**

```bash
git add src-tauri/src/codex_bridge/mod.rs
git commit -m "feat(hexa): model Codex mobile remote control"
```

### Task 2: Tauri Command Boundary

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: the four `CodexBridgeState` remote-control methods from Task 1.
- Produces: `get_codex_remote_control`, `hexa_enable_codex_remote_control`, `hexa_disable_codex_remote_control`, and `hexa_start_codex_remote_pairing`.

- [x] **Step 1: Register typed commands**

Each command returns the typed remote state or pairing artifact and converts `CodexBridgeError` to user-facing strings. Do not expose a generic JSON-RPC command.

- [x] **Step 2: Run Rust verification**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [x] **Step 3: Commit the command boundary**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(hexa): expose Codex mobile pairing commands"
```

### Task 3: Hexa Mobile Pairing Surface

**Files:**
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`

**Interfaces:**
- Consumes: the Task 2 Tauri commands and `humhum://codex-remote-control-changed`.
- Produces: remote state, enable/disable/pair callbacks, transient action errors, and a compact Hexa section.

- [x] **Step 1: Add frontend types and hook state**

Represent status, server name, environment ID, optional error, pairing code, manual code, and Unix expiry. Refresh on Tauri events and after each action.

- [x] **Step 2: Add intentional controls**

Show one primary action at a time: `Enable mobile access`, `Create pairing code`, or `Disable`. Pairing codes show their expiry and are not copied automatically. Use Lucide `Smartphone`, `Link`, `RefreshCw`, and `Power` icons with tooltips.

- [x] **Step 3: Run the frontend build**

Run: `npm run build`

Expected: PASS with only the existing large-chunk warning.

- [x] **Step 4: Commit the Hexa surface**

```bash
git add src/hooks/useHexaData.ts src/components/Hub/HexaModule.tsx
git commit -m "feat(hexa): add Codex mobile pairing UI"
```

### Task 4: Live Compatibility Smoke Test and Documentation

**Files:**
- Modify: `src-tauri/tests/codex_app_server_smoke.rs`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: installed Codex app-server with experimental API capability enabled.
- Produces: an ignored live status-read test and an honest compatibility note.

- [x] **Step 1: Extend the ignored smoke test**

Initialize with `capabilities.experimentalApi: true`, call `remoteControl/status/read`, and assert that the result contains `status`, `serverName`, and `installationId`. Do not enable or pair during automated tests.

- [x] **Step 2: Document the provider boundary**

State that this path pairs Codex with its supported mobile controller and is not HUMHUM's provider-neutral Web relay. Document that local sessions continue if remote control is disabled or unavailable.

- [x] **Step 3: Run final verification**

Run:

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --test codex_app_server_smoke -- --ignored --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
git diff --check
```

Expected: all commands pass; existing Cocoa deprecation and Vite chunk-size warnings may remain.

- [x] **Step 4: Commit verification and documentation**

```bash
git add src-tauri/tests/codex_app_server_smoke.rs docs/architecture.md docs/superpowers/plans/2026-07-11-hexa-codex-mobile-remote.md
git commit -m "test(hexa): verify Codex mobile remote control"
```
