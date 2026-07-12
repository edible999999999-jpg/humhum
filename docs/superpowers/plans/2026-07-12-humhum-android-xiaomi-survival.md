# HUMHUM Android Xiaomi Survival Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add truthful Xiaomi/HyperOS background-settings shortcuts and immediate foreground-monitor recovery when Android's default network returns.

**Architecture:** A pure Java `DeviceCarePlan` describes manufacturer-specific settings candidates and battery-state copy; an Android `DeviceCareNavigator` resolves and opens only those allow-listed targets with standard fallbacks. A pure `NetworkRecoveryGate` coalesces connectivity transitions, while `AgentMonitorService` owns one default-network callback for its lifetime.

**Tech Stack:** Java 17, Android SDK 26-36, `PowerManager`, `Settings`, `PackageManager`, `ConnectivityManager`, JUnit 4, API 36 ARM64 emulator.

## Global Constraints

- Add no Android permission and preserve the existing exact six-permission manifest contract.
- Never request direct Doze exemption, automate settings, use accessibility, hold a wake lock, or call an unresolved explicit component.
- Keep monitoring explicitly enabled, HTTPS-only, certificate pinned, privacy-safe, and `remoteMessaging` typed.
- A settings launch failure must fall back to standard app details without disabling monitoring.
- Preserve package `com.humhum.mobile`, min SDK 26, target SDK 36, and release signing identity.

---

### Task 1: Device-Care Policy And Navigation

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/DeviceCarePlan.java`
- Create: `android/app/src/main/java/com/humhum/mobile/DeviceCareNavigator.java`
- Create: `android/app/src/test/java/com/humhum/mobile/DeviceCarePlanTest.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`

**Interfaces:**
- `DeviceCarePlan.isXiaomiFamily(String manufacturer): boolean`
- `DeviceCarePlan.batteryStatus(boolean exempt): String`
- `DeviceCarePlan.autostartTargets(String manufacturer): List<Target>` where `Target` exposes package and class names.
- `DeviceCareNavigator.openBatterySettings(Activity): boolean`
- `DeviceCareNavigator.openAutostartSettings(Activity, String manufacturer): boolean`

- [x] **Step 1: Write failing policy tests** for case-insensitive Xiaomi/Redmi/Poco/BlackShark recognition, generic-device rejection, factual exempt/restricted status text, ordered allow-listed MIUI/HyperOS targets, and an empty generic target list.
- [x] **Step 2: Run** `./gradlew :app:testDebugUnitTest --tests com.humhum.mobile.DeviceCarePlanTest` and require compilation failure because `DeviceCarePlan` does not exist.
- [x] **Step 3: Implement the minimal immutable policy** with exact target constants and no Android framework dependency.
- [x] **Step 4: Run the focused test** and require all policy cases to pass.
- [x] **Step 5: Extend the manifest contract test** to assert the exact existing permission set still excludes `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, then run it green.
- [x] **Step 6: Implement navigation** using `Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)`, resolved explicit Xiaomi components, and `Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName()))` fallback. Catch only launch-time runtime failures and try the next safe target.
- [x] **Step 7: Commit** `feat(android): add Xiaomi background settings assistant`.

### Task 2: Paired-Screen Reliability Controls

**Files:**
- Modify: `android/app/src/main/res/layout/activity_main.xml`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`

**Interfaces:**
- Consumes `DeviceCarePlan` and `DeviceCareNavigator` from Task 1.
- Produces `batteryStatusText`, `batterySettingsButton`, and Xiaomi-only `autostartSettingsButton` views.

- [x] **Step 1: Add stable layout controls** beneath the monitor switch: one status line and two 42dp command buttons; keep the autostart button `gone` unless `DeviceCarePlan.isXiaomiFamily(Build.MANUFACTURER)`.
- [x] **Step 2: Bind click handlers** to the navigator and expose a short error only if every safe settings target fails.
- [x] **Step 3: Refresh factual battery state in `onResume`** using `PowerManager.isIgnoringBatteryOptimizations(getPackageName())`; never infer Xiaomi autostart state.
- [x] **Step 4: Run Android unit tests and `lintDebug`** and require no layout, accessibility, or permission regression.
- [x] **Step 5: Commit** `feat(android): expose background reliability controls`.

### Task 3: Immediate Network Recovery

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/NetworkRecoveryGate.java`
- Create: `android/app/src/test/java/com/humhum/mobile/NetworkRecoveryGateTest.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AgentMonitorService.java`

**Interfaces:**
- `NetworkRecoveryGate.onNetworkAvailable(): boolean` returns true only for an unavailable-to-available transition.
- `NetworkRecoveryGate.onNetworkLost(): void` marks the default network unavailable.

- [x] **Step 1: Write failing gate tests** proving initial availability schedules once, duplicate availability coalesces, loss rearms recovery, and a second availability schedules once.
- [x] **Step 2: Run the focused test** and require compilation failure because `NetworkRecoveryGate` does not exist.
- [x] **Step 3: Implement the minimal synchronized gate** and run the focused test green.
- [x] **Step 4: Register one `ConnectivityManager.NetworkCallback` in service `onCreate`**. Route `onAvailable` through the existing single-thread scheduler and call `schedule(0)` only when the gate returns true; route `onLost` to the gate.
- [x] **Step 5: Unregister exactly once in `onDestroy`**. Treat registration/unregistration runtime errors as nonfatal because bounded polling remains the fallback.
- [x] **Step 6: Run all Android tests and release lint/build**.
- [x] **Step 7: Commit** `feat(android): recover monitor when network returns`.

### Task 4: Runtime And Release Verification

**Files:**
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan to check completed steps.
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.apk`
- Generate ignored: `build/releases/HUMHUM-Android-0.1.0.aab`

**Interfaces:**
- Consumes the signed release build and AVD `humhum_api36`.
- Produces updated public artifacts, hashes, runtime evidence, and explicit physical-Xiaomi limits.

- [x] **Step 1: Install and cold-launch the signed APK** on API 36 ARM64; capture a screenshot proving controls fit without overlap.
- [x] **Step 2: Use UI automation to open standard battery optimization settings** and return to HUMHUM; verify no new runtime permission prompt appears.
- [x] **Step 3: Enable monitoring, force a long retry state, toggle Wi-Fi off/on, and verify a Bridge request occurs promptly after network return while foreground service type remains `0x200`**.
- [x] **Step 4: Reboot the emulator** and verify explicit-enabled monitor restoration still works; revoke the disposable device and verify cleanup.
- [x] **Step 5: Run** Android tests/lint/release build, frontend tests/build, Rust tests, `apksigner --Werr`, `jarsigner -verify`, manifest inspection, and desktop HTTPS root smoke.
- [x] **Step 6: Copy only verified APK/AAB, record new hashes, update docs, confirm paired-device count zero, and stop the emulator.**
- [x] **Step 7: Commit** `docs(android): verify Xiaomi survival assistant`.
