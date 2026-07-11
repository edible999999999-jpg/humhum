# macOS Awake Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an explicit, persisted HUMHUM skill that prevents display and idle system sleep on macOS and releases automatically with the app process.

**Architecture:** A focused Rust state object owns `/usr/bin/caffeinate -d -i -w <pid>`. Typed Tauri commands toggle it, config restores the user's choice at startup, and Settings mirrors Rage Mode while a periodic Tauri event provides pet feedback.

**Tech Stack:** Rust, Tokio process management, Tauri commands/events, React, TypeScript.

## Global Constraints

- Default off.
- Never synthesize mouse or keyboard input.
- Never modify `pmset` or permanent system settings.
- The caffeinate child must watch the HUMHUM PID.
- Disable and process exit must release assertions.

---

### Task 1: Wake Guard Process

**Files:**
- Create: `src-tauri/src/wake_guard.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `WakeGuardState::status()`, `WakeGuardState::set_enabled(bool)`, and `WakeGuardStatus`.

- [x] Add failing tests for `-d -i -w <pid>` arguments and idempotent state transitions.
- [x] Implement one-child process ownership and stale-child detection.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml wake_guard -- --nocapture`.

### Task 2: Commands and Persisted Preference

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `get_wake_guard_status` and `set_wake_guard_enabled` Tauri commands; `ui.awake_mode` config.

- [x] Add the serde-defaulted preference and frontend type.
- [x] Register typed commands and restore enabled mode after app setup.
- [x] Emit `humhum://awake-mode-pulse` every three minutes while active.
- [x] Run Rust tests and `cargo check`.

### Task 3: Settings Experience

**Files:**
- Modify: `src/components/Settings/SettingsPanel.tsx`
- Modify: `src/lib/i18n/translations.ts`

**Interfaces:**
- Consumes: wake guard commands and status.
- Produces: immediate "陪我守夜" toggle, active/error feedback, and persisted config update.

- [x] Load wake status with settings.
- [x] Toggle backend immediately, then update local config.
- [x] Add Chinese and English copy beside Rage Mode.
- [x] Run `npm run build`.

### Task 4: Real macOS Verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: this plan checklist.

- [x] Start mode and verify `pmset -g assertions` reports display and idle sleep assertions.
- [x] Disable mode and verify those assertions disappear.
- [x] Run formatting, full Rust tests, frontend build, and `git diff --check`.
- [x] Commit implementation and verification.
