# HUMHUM Mobile Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report bounded Android foreground/background-monitor presence to Mobile Bridge and show truthful fresh/offline device state in Hexa.

**Architecture:** Mobile Bridge keeps a volatile device-ID keyed presence table and accepts one authenticated mode report. Android reports from the visible Activity and successful monitor cycles; Hexa derives compact labels from server-filtered status fields.

**Tech Stack:** Rust, Hyper, Serde, React/TypeScript, Java 17, `HttpsURLConnection`, JUnit 4, Android SDK 26-36.

## Global Constraints

- Presence is in memory only and never rewrites `mobile-devices.json`.
- Accept only `foreground` and `monitoring`; freshness is exactly 90 seconds by Mac time.
- Add no Android permission, dependency, wake lock, receiver, or background component.
- Old desktop `404` responses must not interrupt sessions or monitoring.
- Revoke-one, revoke-all and bridge-disable clear corresponding presence.
- Preserve pinned TLS, private-host validation, hashed device tokens, scopes and all current privacy bounds.

---

### Task 1: Presence State And Device Identity

**Files:**
- Modify: `src-tauri/src/mobile_bridge.rs`

**Interfaces:**
- `MobilePresenceMode::{Foreground,Monitoring}` serialized snake case.
- `MobileDeviceStore::authorize_device(&self, raw_token: &str) -> Option<MobileDeviceAuth>`.
- `MobilePresenceStore::report(device_id, mode, now)` and `fresh(device_id, now)`.
- `MobileDeviceSummary` adds nullable `presence_mode` and `last_seen_at`.

- [x] **Step 1: Write failing Rust tests** that authorize to device ID without exposing the digest, classify reports at 90 seconds as fresh and at 91 seconds as stale, and prove stale summaries serialize both fields as null.
- [x] **Step 2: Run** `cargo test mobile_bridge::tests::mobile_presence --lib`; expect missing presence types/APIs.
- [x] **Step 3: Implement immutable auth results and a mutex-protected bounded in-memory presence map**; status joins only currently paired IDs and filters freshness using Mac UTC time.
- [x] **Step 4: Add revoke/disable cleanup tests**, implement cleanup for one token/device, all devices and bridge disable, then rerun focused tests.
- [x] **Step 5: Commit** `feat(mobile): track paired device presence`.

### Task 2: Authenticated Presence Endpoint

**Files:**
- Modify: `src-tauri/src/mobile_bridge.rs`

**Interfaces:**
- `POST /api/presence` body exactly `{"mode":"foreground"}` or `{"mode":"monitoring"}`.
- Success response `{"status":"recorded"}`.

- [x] **Step 1: Write failing route tests** for valid token/mode, revoked or missing token `401`, unknown mode/field/malformed JSON/over-256-byte body `400`, and no device-selected fields.
- [x] **Step 2: Run the focused tests** and require `404` or missing-handler failures.
- [x] **Step 3: Implement strict `#[serde(deny_unknown_fields)]` parsing**, authorize token to device ID, record server timestamp and return the minimal response.
- [x] **Step 4: Run all mobile bridge tests and commit** `feat(mobile): accept bounded presence reports`.

### Task 3: Android Presence Client

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AgentMonitorService.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/MobileProtocolTest.java`

**Interfaces:**
- `MobileProtocol.PresenceMode::{FOREGROUND,MONITORING}`.
- `MobileProtocol.reportPresence(mode): boolean` returns false only for legacy `404`; other failures retain existing error semantics.

- [x] **Step 1: Write failing JVM tests** for exact authenticated request bodies and strict mode values plus a helper that maps `404` to unsupported without swallowing `401`.
- [x] **Step 2: Run** `./gradlew testDebugUnitTest --tests com.humhum.mobile.MobileProtocolTest`; expect missing APIs.
- [x] **Step 3: Implement request construction and `404` compatibility**, then report foreground after valid activation/resume without blocking UI synchronization.
- [x] **Step 4: Report monitoring after successful refresh and unchanged event heartbeat**; presence failure must enter existing retry only for auth/network failure, while legacy `404` continues normally.
- [x] **Step 5: Run Android unit tests and commit** `feat(android): report foreground and monitor presence`.

### Task 4: Hexa Presence Labels

**Files:**
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`
- Test: existing frontend suite and production build.

**Interfaces:**
- Device contract adds `presence_mode: "foreground" | "monitoring" | null` and `last_seen_at: string | null`.
- Labels are `正在使用`, `后台监控`, or `离线`.

- [x] **Step 1: Extend TypeScript contracts and add a pure label helper with tests** for both fresh modes and null fallback.
- [x] **Step 2: Run the focused frontend test and require failure**, then implement the helper and compact device-row label.
- [x] **Step 3: Run frontend tests/build and commit** `feat(hexa): show mobile device presence`.

### Task 5: Release And Runtime Evidence

**Files:**
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan.
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.apk`
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.aab`

- [x] **Step 1: Run full Rust, frontend and Android test/lint/release builds**, then verify exact six permissions, APK v2/v3 signer and AAB signature.
- [x] **Step 2: Build/relaunch desktop and install the release APK on API 36**, pair through the visible form and require `foreground` status with a server timestamp.
- [x] **Step 3: Enable Android monitoring**, require `monitoring` after a successful wait heartbeat, then stop/revoke and confirm zero paired devices plus zero presence.
- [x] **Step 4: Copy verified APK/AAB, record hashes and evidence**, update capability docs without claiming FCM or physical Xiaomi survival.
- [x] **Step 5: Stop emulator and commit** `docs(mobile): verify device presence routing`.
