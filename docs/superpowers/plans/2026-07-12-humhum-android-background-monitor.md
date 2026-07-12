# HUMHUM Android Background Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly enabled, privacy-safe Android foreground monitor that keeps a paired Xiaomi phone aware of new HUMHUM approval requests while the Activity is backgrounded.

**Architecture:** A pure Java tracker and app-private store own deduplication and enabled state. A non-exported `remoteMessaging` foreground service reuses `MobileProtocol` and pinned TLS, while the Activity owns notification consent and start/stop actions. A non-exported boot receiver restores only an already enabled, still-paired monitor.

**Tech Stack:** Java 17, Android platform APIs, Android Gradle Plugin 9.2.1, Gradle 9.4.1, compile/target SDK 36, min SDK 26, JUnit 4.

## Global Constraints

- Poll the existing `/api/sessions` response; do not add a weaker desktop route.
- Never persist pairing codes, message bodies, project names, paths, approval summaries, or plaintext action IDs.
- Show generic lock-screen notification text and keep all service/receiver components non-exported.
- Do not request wake lock, location, nearby devices, storage, contacts, overlay, accessibility, camera, or microphone.
- Keep foreground-only app behavior functional when notifications are denied.

---

### Task 1: Bounded Attention Deduplication

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/AttentionTracker.java`
- Create: `android/app/src/test/java/com/humhum/mobile/AttentionTrackerTest.java`

**Interfaces:**
- Consumes: `Models.SessionPage`, each session's bounded `actions()` list.
- Produces: `AttentionTracker.Result evaluate(Models.SessionPage page)` with `newCount()` and `knownDigests()`; constructor accepts an existing digest collection.

- [ ] **Step 1: Write failing tests** proving the first page reports current approvals once, repeated pages report zero, newly added approvals report only their delta, digests are 64 lowercase hex characters, and retained state is capped at 200.
- [ ] **Step 2: Run** `./gradlew :app:testDebugUnitTest --tests com.humhum.mobile.AttentionTrackerTest` and confirm compilation fails because `AttentionTracker` is missing.
- [ ] **Step 3: Implement** SHA-256 over `session.id() + "\u0000" + action.provider() + "\u0000" + action.id()`, preserve insertion order in a `LinkedHashSet`, return immutable copies, and evict oldest entries above 200.
- [ ] **Step 4: Re-run the focused test** and require all cases to pass.

### Task 2: Monitor State Store

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/MonitorStore.java`
- Create: `android/app/src/test/java/com/humhum/mobile/MonitorStoreTest.java`

**Interfaces:**
- Consumes: Android `SharedPreferences` or a package-private `KeyValueStore` test adapter.
- Produces: `isEnabled()`, `setEnabled(boolean)`, `knownDigests()`, `saveKnownDigests(Collection<String>)`, and `clear()`.

- [ ] **Step 1: Write failing tests** proving disabled is the default, enabled survives recreation, only valid 64-hex digests load, persistence stays capped at 200, and `clear()` removes both choice and history.
- [ ] **Step 2: Run** `./gradlew :app:testDebugUnitTest --tests com.humhum.mobile.MonitorStoreTest` and confirm the missing class failure.
- [ ] **Step 3: Implement** a separate `humhum_monitor` preference contract using one atomic editor transaction per mutation; serialize digests as a JSON array and discard malformed values on load.
- [ ] **Step 4: Re-run the focused test** and require all cases to pass.

### Task 3: Foreground Service And Boot Restoration

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/AgentMonitorService.java`
- Create: `android/app/src/main/java/com/humhum/mobile/MonitorBootReceiver.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/res/values/strings.xml`

**Interfaces:**
- Consumes: `ConnectionStore`, `MonitorStore`, `AttentionTracker`, `MobileProtocol.sessions()`.
- Produces: static `start(Context)` and `stop(Context)` helpers; a `START_STICKY` service with low-importance `humhum_monitor` channel and high-importance `humhum_attention` channel.

- [ ] **Step 1: Add a manifest assertion script/test expectation** for `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_REMOTE_MESSAGING`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, a non-exported `remoteMessaging` service, and a non-exported boot receiver.
- [ ] **Step 2: Implement the service** so `startForeground` runs before network work, one scheduled executor polls at 15 seconds, transient failures back off through 15/30/60 seconds, missing credentials disable and stop, and notification taps open `MainActivity` through an immutable/update-current `PendingIntent`.
- [ ] **Step 3: Implement the receiver** to react only to `BOOT_COMPLETED`, and start only when monitor state is enabled and `ConnectionStore.load()` succeeds.
- [ ] **Step 4: Build and inspect** with `./gradlew :app:assembleDebug` and `aapt2 dump xmltree ... --file AndroidManifest.xml`; require all declarations and no exported background component.

### Task 4: User Consent, Toggle, Disconnect, And Evidence

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/main/res/layout/activity_main.xml`
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`

**Interfaces:**
- Consumes: Android 13 `POST_NOTIFICATIONS` result and `AgentMonitorService.start/stop`.
- Produces: a paired-screen switch, clear status copy, and disconnect behavior that stops and clears monitoring before revoking the connection.

- [ ] **Step 1: Add the switch and status text** with stable dimensions; initialize from `MonitorStore` only when paired.
- [ ] **Step 2: Implement consent flow**: on API 33+ request permission from the visible Activity, start only after grant, and revert the switch with `Notification permission required` after denial. Older versions start directly.
- [ ] **Step 3: Link lifecycle actions**: disabling stops service and clears monitor history; disconnect does the same before network revocation; successful pairing does not silently enable monitoring.
- [ ] **Step 4: Run full verification**: Android JVM tests, `lintDebug`, `assembleDebug`, APK signature verification, manifest inspection, frontend tests/build, Rust tests, and the existing HTTPS pair/session/revoke smoke.
- [ ] **Step 5: Record truthful evidence** including the new APK hash and permission list. If `adb devices -l` remains empty, state that physical Xiaomi lifecycle behavior is not verified.
- [ ] **Step 6: Commit** only monitor implementation, tests, and docs; leave `design-qa-assets/` and `design-qa.md` untouched.
