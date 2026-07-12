# HUMHUM Android Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify an installable Android APK for Xiaomi phones that securely pairs with HUMHUM Mobile Bridge, lists sessions, resolves approvals, and sends follow-up messages.

**Architecture:** A native Java Android client uses a small validated configuration model, a leaf-certificate SHA-256 verifier scoped to one bridge URL, and a protocol client matching the existing Rust API. One platform Activity renders connect and session states without adding a web runtime.

**Tech Stack:** Java 17, Android platform APIs, Android Gradle Plugin 9.2.1, Gradle 9.4.1, compile/target SDK 36, min SDK 26, JUnit 4.

## Global Constraints

- Package ID is `com.humhum.mobile` and display name is `HUMHUM`.
- HTTPS is mandatory; cleartext traffic is disabled in the manifest network policy.
- Pairing requires a URL, an eight-character code, and a 64-hex SHA-256 leaf-certificate fingerprint.
- Never use a trust-all manager or globally permissive hostname verifier.
- Persist only URL, fingerprint, bearer token, scope, and device name in app-private storage.
- Request only `INTERNET` and `ACCESS_NETWORK_STATE` in the first APK.
- Read-scoped devices never render or send control actions.

---

### Task 1: Android Build Skeleton And Configuration Validation

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/xml/network_security_config.xml`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/java/com/humhum/mobile/BridgeConfig.java`
- Test: `android/app/src/test/java/com/humhum/mobile/BridgeConfigTest.java`

**Interfaces:**
- Produces: `BridgeConfig.parse(String url, String code, String fingerprint, String deviceName)` and normalized getters used by the TLS and protocol tasks.

- [ ] Write JUnit tests that reject HTTP, public internet hosts, wrong ports, malformed codes and malformed fingerprints, while accepting an IPv4 or `.local` HTTPS URL on port 31276.
- [ ] Install Android command-line tools, SDK platform 36 and build-tools 36.0.0 under `~/Library/Android/sdk`; download Gradle 9.4.1 from the official distribution and generate the checked-in wrapper.
- [ ] Run `./gradlew :app:testDebugUnitTest --tests com.humhum.mobile.BridgeConfigTest` and verify the tests fail because `BridgeConfig` does not exist.
- [ ] Implement immutable parsing and normalization. Strip fingerprint separators, uppercase the pairing code, reject URL userinfo/query/fragment, and normalize the base URL without a trailing slash.
- [ ] Run the focused test and then `./gradlew :app:testDebugUnitTest`; expect all tests to pass.
- [ ] Commit the build skeleton and validator.

### Task 2: Fingerprint-Pinned HTTPS Client

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/PinnedTlsClient.java`
- Test: `android/app/src/test/java/com/humhum/mobile/CertificateFingerprintTest.java`

**Interfaces:**
- Consumes: normalized 64-hex fingerprint from `BridgeConfig`.
- Produces: `PinnedTlsClient.sha256(X509Certificate)` and `PinnedTlsClient.open(BridgeConfig, String path, String method, String token)`.

- [ ] Write a JVM test using an embedded DER certificate fixture and assert its exact SHA-256 fingerprint; add mismatch and separator-normalization cases.
- [ ] Run the focused test and verify failure because `PinnedTlsClient` is absent.
- [ ] Implement a connection-scoped `X509TrustManager` that requires exactly one presented leaf certificate whose SHA-256 equals the configured fingerprint. Keep hostname verification enabled and set 8-second connect/read timeouts.
- [ ] Run focused and full JVM tests; expect all to pass.
- [ ] Commit the pinned transport.

### Task 3: Existing Mobile Bridge Protocol Client

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Create: `android/app/src/main/java/com/humhum/mobile/Models.java`
- Test: `android/app/src/test/java/com/humhum/mobile/MobileProtocolTest.java`

**Interfaces:**
- Consumes: `BridgeConfig`, `PinnedTlsClient`, and optional bearer token.
- Produces: `pair`, `sessions`, `resolveApproval`, and `sendMessage` methods plus immutable session/action records.

- [ ] Write tests for exact endpoint selection and JSON bodies for pairing, Codex approval, hook approval, and provider-aware follow-up. Test that read scope rejects client-side control calls before network access.
- [ ] Run focused tests and verify expected missing-class failures.
- [ ] Implement bounded JSON parsing with `org.json`: at most 30 sessions, 20 actions per session, 240 characters per server error, and no absolute path fields in models.
- [ ] Run focused and full JVM tests; expect all to pass.
- [ ] Commit the protocol layer.

### Task 4: Connect And Session UI

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Create: `android/app/src/main/java/com/humhum/mobile/SessionAdapter.java`
- Create: `android/app/src/main/java/com/humhum/mobile/ConnectionStore.java`
- Create: `android/app/src/main/res/layout/activity_main.xml`
- Create: `android/app/src/main/res/layout/item_session.xml`
- Create: `android/app/src/main/res/drawable/panel_background.xml`
- Test: `android/app/src/test/java/com/humhum/mobile/ConnectionStoreTest.java`

**Interfaces:**
- Consumes: protocol methods and models from Task 3.
- Produces: connect form, foreground session refresh, approval controls, follow-up composer, disconnect action, and app-private connection persistence.

- [ ] Write tests proving partial credentials are never restored and disconnect removes every persisted field.
- [ ] Run focused tests and verify failure because `ConnectionStore` is absent.
- [ ] Implement the store and then the Activity UI. Network calls run on a single executor, results return on the main thread, controls disable in flight, and polling stops in `onStop`.
- [ ] Render control UI only for scope `control`; preserve drafts on failure and clear them only for successful queued/delivered receipts.
- [ ] Run JVM tests, `lintDebug`, and `assembleDebug`; expect a signed debug APK.
- [ ] Commit the usable Android client.

### Task 5: Desktop Pairing Handoff And End-To-End Evidence

**Files:**
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src-tauri/src/mobile_bridge.rs`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Create: `docs/android-install.md`
- Test: `src-tauri/src/mobile_bridge.rs`

**Interfaces:**
- Produces: a copyable Android setup bundle containing URL, code, scope, and fingerprint without changing the existing pair endpoint.

- [ ] Write a Rust test asserting setup-bundle serialization contains only version, URL, code, scope and normalized fingerprint, and rejects expired pairing material.
- [ ] Run the focused Rust test and verify it fails because the setup bundle is absent.
- [ ] Add `android_setup` to `MobilePairingInfo` and a copy action in Hexa. Never log the bundle or persist the one-time code.
- [ ] Build `android/app/build/outputs/apk/debug/app-debug.apk`, inspect its manifest/permissions, and record SHA-256.
- [ ] Pair against the running desktop bridge, load sessions, and exercise one safe control failure or a disposable session action. Record whether a physical Xiaomi device was available.
- [ ] Run Rust, frontend, Android JVM, lint and APK builds; update the capability report and installation guide with exact evidence and remaining push/background gaps.
- [ ] Commit the verified Android release tranche.
