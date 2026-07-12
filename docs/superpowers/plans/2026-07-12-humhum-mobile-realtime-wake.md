# HUMHUM Mobile Realtime Wake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated same-LAN realtime wake channel that reduces Android approval-notification latency while preserving polling fallback and all existing privacy boundaries.

**Architecture:** Desktop session responses gain a stable SHA-256 cursor over scope-filtered redacted data. A concurrency-limited `/api/events` long poll returns when that cursor changes. The Android foreground monitor alternates between full session refreshes and bounded event waits, falling back to current polling against older desktops.

**Tech Stack:** Rust, Tokio semaphore/time, Hyper 1, SHA-256, Java 17, `HttpsURLConnection`, JUnit 4, Android SDK 26-36.

## Global Constraints

- Event responses contain only `cursor`, `changed`, and `retry_after_ms`.
- Reauthorize every active wait at least once per second and cap waits at 20 seconds.
- Allow at most 16 concurrent waits and return `429` when saturated.
- Add no Android permission, dependency, stored session text, or lock-screen content.
- Preserve package, release signer, certificate pinning, read/control scopes, approval digest deduplication, reboot restore, and device revocation.
- New Android must treat event-route `404` as compatible legacy polling, not connection failure.

---

### Task 1: Stable Scoped Session Cursor

**Files:**
- Modify: `src-tauri/src/mobile_bridge.rs`

**Interfaces:**
- `mobile_session_page(app: &AppHandle, scope: MobileDeviceScope) -> Value`
- `with_mobile_cursor(page: Value) -> Value`
- `/api/sessions` returns `{scope,sessions,cursor}`.

- [ ] **Step 1: Add failing Rust tests** proving identical redacted pages have identical 64-character lowercase cursors, changed bounded state changes the cursor, and no path/transcript sentinel appears in the serialized cursor source or response.
- [ ] **Step 2: Run focused tests** and require failure because `with_mobile_cursor` is absent.
- [ ] **Step 3: Extract current session assembly into `mobile_session_page`**, add ID as deterministic tie-breaker after activity ordering, and hash only its serialized redacted value.
- [ ] **Step 4: Return the cursor from `/api/sessions`**, run mobile-bridge tests, and commit `feat(mobile): add scoped session cursors`.

### Task 2: Authenticated Bounded Event Wait

**Files:**
- Modify: `src-tauri/src/mobile_bridge.rs`

**Interfaces:**
- Route: `GET /api/events?cursor=<sha256>`.
- State: `event_waiters: Arc<tokio::sync::Semaphore>` initialized to 16 permits.
- Helpers: `event_cursor(query: Option<&str>) -> Option<&str>` and `event_signal(cursor, changed) -> Value`.

- [ ] **Step 1: Add failing tests** for exact cursor parsing, malformed/missing rejection, privacy-minimal signal shape, and the 16-permit semaphore limit.
- [ ] **Step 2: Run focused tests** and require the expected missing-helper failures.
- [ ] **Step 3: Implement the route**: authorize, validate cursor, `try_acquire_owned`, recompute scoped cursor once per second, reauthorize the captured token each iteration, and return change or 20-second heartbeat.
- [ ] **Step 4: Add `Retry-After: 1` on `429`**, keep existing security headers, run Rust tests, and commit `feat(mobile): add authenticated event waits`.

### Task 3: Android Realtime Monitor State Machine

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/Models.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/PinnedTlsClient.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AgentMonitorService.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/MobileProtocolTest.java`

**Interfaces:**
- `SessionPage.cursor(): String` with existing two-argument constructor retained for tests/compatibility.
- `EventSignal(cursor: String, changed: boolean)`.
- `MobileProtocol.waitForChange(String cursor): EventSignal` with 25-second read timeout.

- [ ] **Step 1: Write failing protocol tests** for bounded cursor parsing, malformed cursor rejection, exact `/api/events?cursor=` request construction, minimal signal parsing, and unexpected signal rejection.
- [ ] **Step 2: Run focused JVM tests** and require failure on missing cursor/event APIs.
- [ ] **Step 3: Implement model and protocol parsing**, add a bounded read-timeout overload to the pinned client, and run focused tests green.
- [ ] **Step 4: Refactor service scheduling into poll/watch tasks**. After refresh, wait on a valid cursor; changed signals poll immediately; unchanged heartbeats wait again; `401/403` stop; `404` permanently selects 15-second legacy polling for that service process; other failures use existing backoff.
- [ ] **Step 5: Run all Android tests, lint and release builds**, inspect exact permissions, and commit `feat(android): wake monitor on realtime events`.

### Task 4: Runtime, Release And Documentation

**Files:**
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan to check completed steps.
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.apk`
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.aab`

**Interfaces:**
- Produces signed artifacts, runtime latency evidence, compatibility evidence, and explicit LAN/public-push boundaries.

- [ ] **Step 1: Start API 36 ARM64, install release, pair through visible UI, enable monitoring, and verify one active event wait plus foreground type `0x200`.**
- [ ] **Step 2: Submit a disposable authenticated approval after a fresh wait starts** and require Android's private attention notification within five seconds; resolve the request and verify digest deduplication.
- [ ] **Step 3: Verify an unchanged 20-second heartbeat reconnects, Wi-Fi recovery remains immediate, reboot restores watching, and token revocation ends the open wait, stops service, releases connectivity callback, and leaves zero devices.**
- [ ] **Step 4: Runtime-call the event endpoint with malformed, missing, read-only and revoked credentials**, requiring `400/401` without state leakage; saturate 16 waits and require the seventeenth to return `429`.
- [ ] **Step 5: Run Android tests/lint/release build, frontend tests/build, Rust tests, APK/AAB signature verification, exact manifest inspection, and desktop HTTPS smoke.**
- [ ] **Step 6: Copy only verified artifacts, record hashes, update docs, stop emulator, and commit `docs(mobile): verify realtime Android wake`.**
