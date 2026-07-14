# HUMHUM Android QR Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish HUMHUM v0.3.6 with one-tap QR pairing between Hexa on macOS and the native Android app.

**Architecture:** Hexa encodes the existing `android_setup` JSON with `QRCodeSVG` and hides it after its backend expiry. Android uses JourneyApps' offline ZXing scanner, feeds scan text through `PairingSetup.parse`, then calls the existing pinned-TLS `pair()` path.

**Tech Stack:** React 18, TypeScript, qrcode.react 4.2, Android Java, JourneyApps ZXing Embedded 4.3, Gradle, Vitest, JUnit.

## Global Constraints

- Preserve the existing version 1 setup payload and all certificate, URL, port, scope, and code validation.
- Request camera permission only after the user taps the scanner.
- Keep camera hardware optional and retain paste/manual fallback.
- Release Android versionCode 9 and versionName 0.3.6.
- Publish signed APK, AAB, Xiaomi install bundle, and macOS DMG together in GitHub release v0.3.6.

---

### Task 1: Pairing Expiry Contract

**Files:**
- Create: `src/hooks/mobilePairingQr.ts`
- Create: `src/hooks/mobilePairingQr.test.ts`

**Interfaces:**
- Produces: `mobilePairingSecondsRemaining(expiresAt: number, nowMs?: number): number`

- [ ] **Step 1: Write failing tests** for an active challenge and an expired challenge.
- [ ] **Step 2: Run** `npm test -- src/hooks/mobilePairingQr.test.ts` and confirm the missing module failure.
- [ ] **Step 3: Implement** a clamped seconds-remaining helper using the backend Unix timestamp.
- [ ] **Step 4: Re-run** the focused test and confirm both cases pass.

### Task 2: Android Scanner Contract

**Files:**
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/res/layout/activity_main.xml`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/build.gradle.kts`

**Interfaces:**
- Consumes: `PairingSetup.parse(String)` and `MainActivity.pair()`.
- Produces: `scanSetup()` and `applyPairingSetup(String, boolean)`.

- [ ] **Step 1: Write failing contract tests** for optional camera hardware, the scan button, and strict scan-to-pair routing.
- [ ] **Step 2: Run** the focused JUnit test and confirm the scanner contract fails.
- [ ] **Step 3: Add** ZXing Embedded 4.3, optional camera declarations, the primary scan button, and activity-result handling.
- [ ] **Step 4: Parse** every scan through `PairingSetup.parse`, populate the existing inputs, and call `pair()` only after valid scan data.
- [ ] **Step 5: Re-run** Android unit tests and lint.

### Task 3: Hexa QR Surface

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/components/Hub/HexaModule.tsx`

**Interfaces:**
- Consumes: `MobilePairingInfo.android_setup`, `MobilePairingInfo.expires_at`, and `mobilePairingSecondsRemaining`.
- Produces: a scannable QR panel with expiry, scope, and network labels.

- [ ] **Step 1: Install** `qrcode.react@4.2.0`.
- [ ] **Step 2: Render** the QR only while it is active and retain the copy action.
- [ ] **Step 3: Run** frontend tests and the production build.

### Task 4: Release Verification And Publication

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/android-install.md`

**Interfaces:**
- Produces: signed v0.3.6 Android artifacts and a GitHub release containing both Android and macOS downloads.

- [ ] **Step 1: Update** install documentation to make QR scanning the default path.
- [ ] **Step 2: Build** signed APK/AAB and verify package metadata and signer fingerprint.
- [ ] **Step 3: Install and launch** the release APK on the API 36 emulator and open the QR scanner.
- [ ] **Step 4: Commit, push, merge to main, tag v0.3.6, and upload APK, AAB, Xiaomi bundle, and DMG.
- [ ] **Step 5: Verify** GitHub release assets and direct-download HTTP responses.
