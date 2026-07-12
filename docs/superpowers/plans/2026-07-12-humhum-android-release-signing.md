# HUMHUM Android Release Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a durable locally signed release APK and AAB for HUMHUM Android without committing signing secrets.

**Architecture:** Gradle loads a fixed owner-local properties file, validates its complete four-value contract, and signs only release variants with one long-lived project key. A setup script creates the key once without printing secrets. Public APK/AAB artifacts are copied to ignored `build/releases/` after cryptographic and runtime verification.

**Tech Stack:** Android Gradle Plugin 9.2.1, Gradle 9.4.1, Java keytool 17, Android build-tools 36 `apksigner`/`aapt2`, Android 16 ARM64 emulator.

## Global Constraints

- Never print, commit, log, or include store/key passwords or private-key material in an artifact.
- Accept release keystores only under the current user's home directory.
- Keep `~/.humhum/android-signing/` mode `0700` and both keystore and properties mode `0600`.
- Debug/tests must still work when signing files are absent; requested release tasks must fail instead of emitting unsigned output.
- Keep package `com.humhum.mobile`, version name `0.1.0`, version code `1`, min SDK 26 and target SDK 36.

---

### Task 1: Release Signing Contract

**Files:**
- Modify: `android/app/build.gradle.kts`
- Create: `android/scripts/setup-release-signing.sh`

**Interfaces:**
- Consumes: `~/.humhum/android-signing.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
- Produces: signing config `humhumRelease`, release build failure message when missing, and one idempotent setup command.

- [x] **Step 1: Run `./gradlew :app:assembleRelease` with the properties file absent** and record that current Gradle emits an unsigned APK, proving the safety gap.
- [x] **Step 2: Add configuration loading and validation** before `android {}`. Require exactly four nonblank values, canonical home-contained regular keystore path, and alias `humhum-release`; expose no values in errors.
- [x] **Step 3: Assign `humhumRelease` only to `buildTypes.release`** and add task guards that fail release assemble/package/bundle/sign tasks with `Run android/scripts/setup-release-signing.sh first` when configuration is absent.
- [x] **Step 4: Write the setup script** with `set -euo pipefail`, `umask 077`, `openssl rand -hex 32`, Java 17 `keytool -genkeypair`, RSA 4096, SHA256withRSA, 10950 days, alias `humhum-release`, owner-only properties, and idempotent refusal to overwrite either file.
- [x] **Step 5: Verify debug isolation** with signing properties absent: `:app:testDebugUnitTest :app:assembleDebug` passes while `:app:assembleRelease` fails with the setup message.

### Task 2: Key Creation And Signed Public Artifacts

**Files:**
- Local only: `~/.humhum/android-signing/humhum-release.jks`
- Local only: `~/.humhum/android-signing.properties`
- Generated ignored: `build/releases/HUMHUM-Android-0.1.0.apk`
- Generated ignored: `build/releases/HUMHUM-Android-0.1.0.aab`

**Interfaces:**
- Consumes: setup script and release signing config.
- Produces: one durable signing identity and signed APK/AAB.

- [x] **Step 1: Run setup once** and verify a second run refuses overwrite without changing file hashes.
- [x] **Step 2: Inspect permissions and metadata** without printing passwords: directories `0700`, files `0600`, one alias, RSA 4096, SHA256withRSA, 30-year certificate, public certificate SHA-256 digest recorded.
- [x] **Step 3: Run** `./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleRelease :app:bundleRelease` and require success.
- [x] **Step 4: Verify APK** with `apksigner verify --verbose --print-certs --Werr`, `aapt2 dump badging`, and manifest inspection; require no `application-debuggable` marker.
- [x] **Step 5: Verify AAB** with `jarsigner -verify -certs` and record SHA-256 for both public artifacts.
- [x] **Step 6: Copy only verified public artifacts** to `build/releases/`; never copy properties, JKS, passwords, `.idsig`, or certificate PEM files there.

### Task 3: Runtime Upgrade And Release Documentation

**Files:**
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`

**Interfaces:**
- Consumes: signed release APK and API 36 ARM64 AVD `humhum_api36`.
- Produces: install/upgrade evidence and key backup guidance.

- [x] **Step 1: Start the emulator and remove the debug channel once**, then stream-install the release APK and cold-launch `MainActivity`.
- [x] **Step 2: Reinstall the same release APK with `adb install -r`** and verify retained first-install state, changed update time, package/version, and successful cold launch.
- [x] **Step 3: Prove channel separation** on a disposable emulator state: installing debug over release must fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
- [x] **Step 4: Stop the emulator and verify no paired desktop smoke device remains.**
- [x] **Step 5: Document release and debug migration, artifact hashes, signer digest, key backup requirement, rebuild command, and explicit Play/Xiaomi Store gaps.**
- [x] **Step 6: Run fresh Android, frontend, Rust and HTTPS bridge regressions; commit only source/docs and leave user design QA files untouched.**
