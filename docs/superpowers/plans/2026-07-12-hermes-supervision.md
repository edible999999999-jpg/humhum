# Hermes Agent Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly installed, owner-safe Hermes Agent plugin that forwards normalized local supervision events into Hexa.

**Architecture:** Extend the client registry with a plugin-directory format and isolate generated Hermes assets in a focused Rust module. Existing Tauri commands route install, uninstall, and status checks through that module; the generated Python plugin posts to the existing authenticated loopback event endpoint.

**Tech Stack:** Rust, Tauri commands, Python 3 standard library, Hermes Python plugin hooks, Cargo tests.

## Global Constraints

- Install only after the user enables Hermes in settings.
- Write only `~/.hermes/plugins/humhum/plugin.yaml` and `~/.hermes/plugins/humhum/__init__.py`.
- Refuse to remove plugin files without the `HUMHUM_HERMES_PLUGIN` marker.
- Post only to the authenticated local HUMHUM loopback endpoint.
- Hook callbacks must never block, modify, or fail Hermes actions.
- Do not claim Hermes follow-up command delivery in this increment.

---

### Task 1: Registry Contract

**Files:**
- Modify: `src-tauri/src/client_registry.rs`

**Interfaces:**
- Produces: `ConfigFormat::HermesPlugin` and client id `hermes` with eight official hook names.

- [ ] **Step 1: Write the failing registry test**

Add an assertion that `get_client("hermes")` exists, uses `ConfigFormat::HermesPlugin`, points to `.hermes/plugins/humhum`, and includes `pre_tool_call` and `on_session_finalize`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test client_registry::tests::includes_hermes_plugin_profile --manifest-path src-tauri/Cargo.toml`

Expected: compile failure or assertion failure because the variant/profile does not exist.

- [ ] **Step 3: Add the minimal registry variant and profile**

Add the enum variant and a `ClientProfile` entry named `Hermes Agent` with the official hook names from the design.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: one passing test.

- [ ] **Step 5: Commit**

Commit message: `feat(hexa): register Hermes Agent hooks`

### Task 2: Managed Plugin Assets

**Files:**
- Create: `src-tauri/src/hermes_plugin.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `install_at(path: &Path) -> Result<(), String>`, `uninstall_at(path: &Path) -> Result<(), String>`, and `is_installed_at(path: &Path) -> bool`.

- [ ] **Step 1: Write failing ownership and generation tests**

Tests must require both generated files, the ownership marker, all eight `register_hook` calls, loopback configuration loading, normalized event names, and refusal to uninstall an unmanaged directory.

- [ ] **Step 2: Run the module tests and verify RED**

Run: `cargo test hermes_plugin::tests --manifest-path src-tauri/Cargo.toml`

Expected: compile failure because `hermes_plugin` does not exist.

- [ ] **Step 3: Implement the minimal generator and owner-safe file operations**

Generate the manifest and Python bridge from Rust string constants. Use atomic same-directory temporary-file rename for each asset. On uninstall, validate both existing managed files before deleting either one, then remove the directory only when empty.

- [ ] **Step 4: Run Python syntax and Rust tests**

Run the Step 2 command and compile the generated Python source in a temporary test directory with `python3 -m py_compile`.

Expected: all module tests pass and Python exits zero.

- [ ] **Step 5: Commit**

Commit message: `feat(hexa): generate owner-safe Hermes plugin`

### Task 3: Tauri Installation Routing

**Files:**
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Consumes: `hermes_plugin::{install_at, uninstall_at, is_installed_at}`.
- Produces: Hermes support through existing `install_hooks_for_client`, `uninstall_hooks_for_client`, and `check_hooks_status` commands.

- [ ] **Step 1: Write failing command-routing tests**

Extract `install_client_format`, `uninstall_client_format`, and `client_format_is_installed` helpers, then test that Hermes installation invokes plugin-directory behavior while status requires both managed files.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cargo test commands::tests::hermes --manifest-path src-tauri/Cargo.toml`

Expected: failing assertion because no Hermes match arm exists.

- [ ] **Step 3: Add all exhaustive match arms and status routing**

Route `ConfigFormat::HermesPlugin` to the module functions. Do not create the generic HUMHUM shell hook for this format.

- [ ] **Step 4: Run focused and full Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all non-ignored tests pass.

- [ ] **Step 5: Commit**

Commit message: `feat(hexa): manage Hermes plugin from settings`

### Task 4: Runtime Envelope Smoke Test

**Files:**
- Modify: `src-tauri/src/hermes_plugin.rs`

**Interfaces:**
- Validates the generated Python callback contract against a temporary local HTTP server.

- [ ] **Step 1: Write a failing callback smoke test**

Create a temporary HUMHUM config, import generated `__init__.py`, register callbacks against a fake context, invoke session/prompt/tool/finalize callbacks, and capture HTTP envelopes. Assert `client_type == "hermes"`, prefixed session id, canonical event order, workspace, tool name, and failure status.

- [ ] **Step 2: Run the smoke test and verify RED**

Run: `cargo test hermes_plugin::tests::generated_plugin_delivers_normalized_events --manifest-path src-tauri/Cargo.toml -- --nocapture`

Expected: assertion failure on the first missing or malformed envelope.

- [ ] **Step 3: Complete only the bridge behavior required by the smoke test**

Use `urllib.request`, `threading.Thread`, a one-second timeout, token header, and best-effort exception handling. Return `None` from all observer callbacks.

- [ ] **Step 4: Run module and full suites**

Run the Step 2 command, then `cargo test --manifest-path src-tauri/Cargo.toml` and `npm test -- --run`.

Expected: all non-ignored tests pass.

- [ ] **Step 5: Commit**

Commit message: `test(hexa): verify Hermes event delivery`

### Task 5: Report And Release Verification

**Files:**
- Modify: `docs/competitive-parity-2026-07-12.md`

**Interfaces:**
- Produces: verified capability matrix entry and a fresh macOS release artifact.

- [ ] **Step 1: Update the matrix with exact scope**

Record Hermes supervision as complete for lifecycle/progress, explicitly noting no command follow-up and no live runtime claim when Hermes is absent.

- [ ] **Step 2: Run complete verification**

Run: `npm test -- --run`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `npm run tauri build`.

Expected: all non-ignored tests and builds pass.

- [ ] **Step 3: Verify and launch the release**

Run strict deep code-sign verification on `src-tauri/target/release/bundle/macos/HumHum.app`, verify the DMG with `hdiutil verify`, launch the release app, and query `/health`.

Expected: signature valid, DMG valid, and health JSON reports `status: ok`.

- [ ] **Step 4: Record artifact hash and cleanup temporary clones**

Record the DMG SHA-256 in the report. Remove only `/tmp/humhum-compare-ping` and `/tmp/humhum-compare-happy`; leave user files untouched.

- [ ] **Step 5: Commit**

Commit message: `docs: verify Hermes parity release`
