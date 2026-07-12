# HUMHUM FCM Killed-Process Wake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional privacy-minimal FCM wake transport that can restart HUMHUM monitoring after Android system process reclamation while preserving all existing private data paths and disabled-config compatibility.

**Architecture:** The relay encrypts one FCM token per authenticated channel and sends an exact high-priority data wake through FCM HTTP v1 after storing each encrypted wake envelope. Android validates the channel, sequence, priority and user monitoring preference before starting the existing `remoteMessaging` foreground service; all session data still travels through the pinned Mobile Bridge.

**Tech Stack:** Node 22 built-ins and SQLite, FCM HTTP v1/OAuth 2.0, Firebase Messaging Android SDK, Java 17, Android SDK 26-36, JUnit 4.

## Global Constraints

- FCM payload is exactly `kind=humhum_wake`, opaque `channel`, and positive decimal `sequence`.
- Relay token storage uses AES-256-GCM under a 32-byte server key and never logs tokens or credentials.
- FCM is disabled unless server and Android client configuration are complete; encrypted polling and direct pinned HTTPS remain functional.
- Only a high-priority FCM message matching the paired channel may start monitoring, and only when the user already enabled it.
- User-initiated Android Force stop is explicitly not bypassed or claimed.
- No analytics, notification body, session ID, project, Agent, approval, message or device name enters FCM.

---

### Task 1: Encrypted Push Subscription Storage And API

**Files:**
- Modify: `relay/src/store.mjs`
- Modify: `relay/src/server.mjs`
- Modify: `relay/test/relay.test.mjs`

**Interfaces:**
- `new RelayStore(databasePath, clock, pushTokenKey?)`
- `store.putPush(channelId, subscriberToken, provider, token) -> "stored" | "disabled" | "unauthorized"`
- `store.pushSubscription(channelId) -> { provider, token } | null`
- `PUT|DELETE /v1/channels/{channel}/push`

- [x] **Step 1: Write failing relay tests** proving subscriber-only registration, exact JSON, 4,096-byte bound, disabled `503`, encrypted-at-rest token absence, replacement, deletion and channel-delete cascade. Use a fixed 64-hex test key and assert the raw SQLite file does not contain the registration token.
- [x] **Step 2: Run** `node --test --test-name-pattern='push subscription' relay/test/relay.test.mjs`; require failures because the route and store methods are missing.
- [x] **Step 3: Implement the schema and AES-256-GCM token codec** with a `push_subscriptions(channel_id PRIMARY KEY, provider, nonce, ciphertext, updated_at)` table, subscriber authentication and transaction-safe upsert/delete.
- [x] **Step 4: Implement strict `PUT` and `DELETE` routing** with exact content type/object fields, generic authentication failures and `503` when the encryption key is absent.
- [x] **Step 5: Run** `node --test relay/test/*.test.mjs`; require all relay tests green, then commit `feat(relay): store encrypted push subscriptions`.

### Task 2: Bounded FCM HTTP v1 Provider And Idempotent Delivery

**Files:**
- Create: `relay/src/fcm.mjs`
- Create: `relay/test/fcm.test.mjs`
- Modify: `relay/src/server.mjs`
- Modify: `relay/test/relay.test.mjs`
- Modify: `relay/README.md`

**Interfaces:**
- `createFcmProvider({ projectId, serviceAccount, fetchImpl, clock }) -> { sendWake(token, channel, sequence) }`
- `loadFcmProviderFromEnvironment(env, readFile, fetchImpl, clock) -> provider | null`
- `provider.sendWake(...)` resolves only for accepted HTTP v1 delivery and otherwise throws a credential-free bounded error.

- [x] **Step 1: Write failing provider tests** for strict service-account shape, RS256 OAuth assertion claims, messaging scope, cached access-token expiry, five-second abort, exact FCM URL/body, Android high priority, channel collapse key and generic non-2xx errors.
- [x] **Step 2: Run** `node --test relay/test/fcm.test.mjs`; require module-not-found failure.
- [x] **Step 3: Implement `fcm.mjs` using Node built-ins** (`crypto.sign`, `fetch`, `AbortController`) with no service-account, OAuth-token or registration-token logging.
- [x] **Step 4: Write the failing relay retry test**: first publish stores sequence 1 but fake provider fails and returns `503`; an identical retry calls the provider again and returns idempotent `201`; a differing envelope remains `409`.
- [x] **Step 5: Wire optional provider delivery after durable publish**, returning `201` when absent/no subscription, `503` on provider failure and retrying push for an identical stored envelope.
- [x] **Step 6: Document the three environment variables and key generation**, run `npm run test:relay`, and commit `feat(relay): deliver generic FCM wakes`.

### Task 3: Android Push Configuration And Wake Policy

**Files:**
- Modify: `android/app/build.gradle.kts`
- Create: `android/app/src/main/java/com/humhum/mobile/PushConfig.java`
- Create: `android/app/src/main/java/com/humhum/mobile/PushWakePolicy.java`
- Create: `android/app/src/test/java/com/humhum/mobile/PushConfigTest.java`
- Create: `android/app/src/test/java/com/humhum/mobile/PushWakePolicyTest.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`

**Interfaces:**
- `PushConfig.fromBuildValues(applicationId, apiKey, projectId, senderId) -> PushConfig?`
- `PushWakePolicy.evaluate(data, priority, expectedChannel, monitorEnabled) -> START_MONITOR | IGNORE`

- [x] **Step 1: Write failing JVM tests** for all-or-none Firebase values, bounded identifier formats, exact three-field data map, channel match, positive sequence, high-priority constant and monitor-enabled gate.
- [x] **Step 2: Run** `./android/gradlew -p android :app:testDebugUnitTest --tests '*Push*'`; require compilation failures for missing classes.
- [x] **Step 3: Implement the two dependency-free policy classes** so security decisions can be exhaustively tested without Android or Firebase runtime mocks.
- [x] **Step 4: Add Firebase Messaging `25.1.0` and four escaped BuildConfig fields** sourced from `HUMHUM_FIREBASE_APPLICATION_ID`, `HUMHUM_FIREBASE_API_KEY`, `HUMHUM_FIREBASE_PROJECT_ID`, and `HUMHUM_FIREBASE_SENDER_ID`; default each to empty and keep analytics disabled.
- [x] **Step 5: Update the manifest contract test** to enumerate the actual merged FCM permissions and reject analytics, exported messaging service, notification payload defaults and broad package visibility.
- [x] **Step 6: Run focused JVM tests and release manifest processing**, then commit `feat(android): define strict FCM wake policy`.

### Task 4: Token Registration And Firebase Messaging Service

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/HumHumApplication.java`
- Create: `android/app/src/main/java/com/humhum/mobile/HumHumMessagingService.java`
- Create: `android/app/src/main/java/com/humhum/mobile/PushRegistration.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/com/humhum/mobile/WakeRelayClient.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AgentMonitorService.java`
- Create: `android/app/src/test/java/com/humhum/mobile/PushRegistrationTest.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/WakeRelayClientTest.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/ServiceLifecycleGateTest.java`

**Interfaces:**
- `WakeRelayClient.putPushToken(String token)` performs strict authenticated `PUT` with no redirects.
- `PushRegistration.plan(configured, paired, relayConfigured, token) -> REGISTER | SKIP`
- `HumHumMessagingService` delegates all start decisions to `PushWakePolicy`.

- [ ] **Step 1: Write failing tests** for strict registration URL/body/auth, no registration before pairing or without complete Firebase configuration, token rotation replacement, timeout/cancellation and no persisted FCM token.
- [ ] **Step 2: Run focused JVM tests** and require missing registration APIs.
- [ ] **Step 3: Implement `PushRegistration` and `WakeRelayClient.putPushToken`** using platform TLS, subscriber bearer auth, bounded body/status handling and no redirects.
- [ ] **Step 4: Implement `HumHumApplication`** to initialize Firebase only for complete public client configuration, disable automatic analytics/data collection and request/register a token after pairing or process start.
- [ ] **Step 5: Implement the non-exported messaging service** with exact policy validation; high-priority valid wakes start the existing foreground monitor through one explicit action, while malformed/normal/disabled messages do nothing.
- [ ] **Step 6: Add lifecycle tests** proving teardown rejects late registration/start effects and disconnect clears the relay channel before local connection state.
- [ ] **Step 7: Run all Android JVM tests and lint**, then commit `feat(android): receive privacy-minimal FCM wakes`.

### Task 5: Release And Runtime Evidence

**Files:**
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan.
- Generate: ignored signed APK/AAB artifacts.

**Interfaces:**
- Disabled-config release remains installable and uses relay/private wake fallback.
- Injected local provider proves registration encryption and idempotent retry without production Firebase credentials.

- [ ] **Step 1: Run a local relay with fixed test push key and injected provider**, register a disposable token, inspect SQLite for ciphertext/no plaintext, publish sequence 1, fail once, retry the exact envelope and prove one accepted generic payload.
- [ ] **Step 2: Build and install the release APK with Firebase client config absent**, cold-launch API 36, verify no crash/token registration and confirm existing pairing UI remains usable.
- [ ] **Step 3: Run complete relay, Rust, frontend and Android suites**, plus release lint, APK/AAB builds, merged-permission inspection, signature verification and SHA-256 generation.
- [ ] **Step 4: If production Firebase credentials and a Xiaomi phone are unavailable, explicitly retain physical killed-process delivery as unverified**; do not simulate or relabel force-stop evidence.
- [ ] **Step 5: Update installation and parity documentation**, check every plan item, commit `docs(push): verify optional FCM wake`, rebuild/relaunch the desktop app and leave the goal active for Xiaomi Push/physical-device/store work.
