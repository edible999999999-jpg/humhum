# HUMHUM Android Living Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the selected Living Signals Android experience with opt-in read-only health summaries encrypted to a durable Mac-side Hush vault.

**Architecture:** Keep the proven Java pairing, TLS, relay, and Agent protocol classes. Add a Kotlin/Compose presentation and state layer, Health Connect source adapters, and a bounded encrypted sync queue. Add a dedicated Rust Hush signal store and expose it through both the direct mobile bridge and the existing encrypted Anywhere request channel.

**Tech Stack:** Android API 26-36, Kotlin, Jetpack Compose Material 3, AndroidX Health Connect 1.1.0, WorkManager, existing Java transport classes, Rust, rusqlite, AES-256-GCM, Tauri, React.

## Global Constraints

- The selected visual target is `docs/superpowers/specs/assets/humhum-android-living-signals.png`.
- Health access is disabled by default, read-only, and granted separately for steps, resting heart rate, and sleep.
- No Health Connect write permission is declared or requested.
- The phone stores only permission state, sync cursor, and a bounded encrypted seven-day outbound queue.
- Durable signals live in `~/.humhum/hush/structured-signals.sqlite3`.
- The first slice accepts daily aggregates only and rejects raw heart-rate samples, sleep stages, routes, location, and medical records.
- Direct and Anywhere transports enforce the same validation, idempotency, and paired-device identity.
- Existing pairing, TLS pinning, Agent actions, conversation disclosure, and relay cryptography remain unchanged.
- Android layouts are verified at `390 x 844`; all tap targets are at least 48dp.
- Cards use at most 8dp radius and are never nested.

---

### Task 1: Mac Hush Structured Signal Vault

**Files:**
- Create: `src-tauri/src/hush_signal_store.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/hush_signal_store.rs`

**Interfaces:**
- Produces: `HushSignalInput`, `HushSignalBatch`, `HushSignalSummary`, `HushSignalIngestReport`, and `HushSignalStore`.
- Produces: `HushSignalStore::load_or_create(humhum_dir: &Path) -> Result<Self, String>`.
- Produces: `HushSignalStore::ingest(device_id: &str, batch: HushSignalBatch) -> Result<HushSignalIngestReport, String>`.
- Produces: `HushSignalStore::latest_health() -> Result<Vec<HushSignalSummary>, String>`.
- Produces: `HushSignalStore::clear_health() -> Result<usize, String>`.

- [ ] **Step 1: Write failing validation and persistence tests**

Add tests that construct a temporary HUMHUM directory and assert:

```rust
let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
let report = store.ingest("phone-1", HushSignalBatch {
    signals: vec![steps_signal("health-connect:steps:2026-07-17", 6_342.0)],
}).unwrap();
assert_eq!(report.imported, 1);
assert_eq!(store.latest_health().unwrap()[0].value, 6_342.0);

let duplicate = store.ingest("phone-1", same_batch()).unwrap();
assert_eq!(duplicate.duplicates, 1);

let database = std::fs::read(temp.path().join("hush/structured-signals.sqlite3")).unwrap();
assert!(!database.windows(b"6342".len()).any(|window| window == b"6342"));
```

Also test 32-item rejection, 64 KiB rejection, unsupported kinds, invalid units,
non-finite values, end-before-start, timestamps outside a bounded range,
cross-device source IDs, owner-only files, rollback after failed persistence,
and clear-health behavior.

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hush_signal_store -- --nocapture
```

Expected: compilation fails because `hush_signal_store` and its types do not
exist.

- [ ] **Step 3: Implement the encrypted SQLite store**

Use a SQLite schema with unique `(device_id, source_id)`, plaintext indexing
metadata, and an AES-GCM encrypted JSON payload containing `value`, `quality`,
and source detail. Generate a 32-byte key at
`~/.humhum/hush/structured-signals.key`, reject symlinks, and protect the key and
database with `local_api_auth::protect_owner_only`.

Validation accepts exactly:

```rust
const ALLOWED: &[(&str, &str)] = &[
    ("health.steps.daily", "count"),
    ("health.resting_heart_rate.daily", "bpm"),
    ("health.sleep.daily", "minutes"),
];
```

Register `Arc<Mutex<HushSignalStore>>` in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run focused and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hush_signal_store -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: focused tests pass and the existing library suite has zero failures.

- [ ] **Step 5: Commit the vault**

```bash
git add src-tauri/src/hush_signal_store.rs src-tauri/src/lib.rs
git commit -m "feat(hush): add encrypted structured signal vault"
```

### Task 2: Paired Mobile Signal Ingestion Over Direct And Anywhere Routes

**Files:**
- Modify: `src-tauri/src/mobile_bridge.rs`
- Modify: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AnywhereGateway.java`
- Test: `src-tauri/src/mobile_bridge.rs`
- Test: `android/app/src/test/java/com/humhum/mobile/MobileProtocolTest.java`
- Test: `android/app/src/test/java/com/humhum/mobile/AnywhereGatewayTest.java`

**Interfaces:**
- Consumes: `HushSignalBatch` and `HushSignalStore::ingest`.
- Produces direct route: `POST /api/hush/signals`.
- Produces Anywhere action: `{"action":"signals_upload","signals":[...]}`.
- Produces Android methods:
  - `MobileProtocol.uploadSignals(JSONArray signals)`.
  - `AnywhereGateway.uploadSignals(Models.WakeRelayConfig relay, JSONArray signals)`.

- [ ] **Step 1: Write failing route and protocol tests**

Rust tests must prove that:

```rust
let request = parse_anywhere_request(
    MobileDeviceScope::Read,
    &json!({"action":"signals_upload","signals":[valid_steps()]}),
).unwrap();
assert!(matches!(request, AnywhereRequest::SignalsUpload { .. }));
```

Direct and relay requests from the same paired device return the same
`{"imported":1,"duplicates":0}` shape. An unknown token returns `401`, more than
31 records returns `400`, and a revoked device cannot upload.

Android tests must assert the exact direct route/body and relay action name.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml mobile_bridge::tests::signal -- --nocapture
cd android && ./gradlew :app:testDebugUnitTest --tests '*MobileProtocolTest' --tests '*AnywhereGatewayTest'
```

Expected: tests fail because the signal route and methods are absent.

- [ ] **Step 3: Implement device-bound ingestion**

Add `request_device_auth` beside `request_scope` so direct requests resolve both
device ID and scope. Add `SignalsUpload` to `AnywhereRequest` and pass
`current.device_id` into `execute_anywhere_request`. Both transports deserialize
the same `HushSignalBatch` and call the same store method.

Keep signal upload available to both `read` and `control` devices because it is
a phone-to-owner-Mac import, not remote Agent control.

- [ ] **Step 4: Implement Android direct and relay request builders**

Validate the array count before network I/O and use the existing authenticated
transport. Signal upload does not participate in retained approval/message
deduplication because the desktop store already provides idempotency.

- [ ] **Step 5: Run protocol, relay, and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml mobile_bridge -- --nocapture
cd android && ./gradlew :app:testDebugUnitTest
npm run test:relay
```

Expected: all commands exit zero.

- [ ] **Step 6: Commit ingestion**

```bash
git add src-tauri/src/mobile_bridge.rs android/app/src/main/java/com/humhum/mobile/MobileProtocol.java android/app/src/main/java/com/humhum/mobile/AnywhereGateway.java android/app/src/test
git commit -m "feat(mobile): ingest Hush signals over encrypted routes"
```

### Task 3: Android Health Domain, Queue, And Source Policy

**Files:**
- Modify: `android/build.gradle.kts`
- Modify: `android/app/build.gradle.kts`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthSignal.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthSummary.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthSourcePolicy.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/EncryptedHealthQueue.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthSignalUploader.kt`
- Test: `android/app/src/test/java/com/humhum/mobile/health/HealthSourcePolicyTest.kt`
- Test: `android/app/src/test/java/com/humhum/mobile/health/HealthSignalUploaderTest.kt`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/health/EncryptedHealthQueueDeviceTest.kt`

**Interfaces:**
- Produces: `HealthSignal.toJson(): JSONObject`.
- Produces: `HealthSummary(steps, restingHeartRate, sleepMinutes, capturedAt, sourceStates)`.
- Produces: `HealthSourcePolicy.plan(availability, grants, backgroundGrant)`.
- Produces: `EncryptedHealthQueue.enqueue`, `peekBatch(31)`, `acknowledge`.
- Produces: `HealthSignalUploader.sync(connection, signals): SyncResult`.

- [ ] **Step 1: Add Kotlin test support and write failing domain tests**

Add Kotlin Android plugin support and JUnit tests for:

```kotlin
assertEquals(
    setOf(HealthMetric.STEPS),
    HealthSourcePolicy.plan(
        healthConnectAvailable = false,
        stepSensorAvailable = true,
        grants = setOf(HealthMetric.STEPS),
        backgroundGranted = false,
    ).foregroundMetrics,
)
```

Test stable source IDs, local-day boundaries, 31-record batching, seven-day
pruning, direct-first and relay-first upload selection, and acknowledgement only
after a successful response.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests 'com.humhum.mobile.health.*'
```

Expected: compilation fails because the health domain classes do not exist.

- [ ] **Step 3: Implement the pure health domain**

Keep Android framework types out of `HealthSignal`, `HealthSourcePolicy`, and
`HealthSignalUploader` so JVM tests remain deterministic. Reuse the existing
Android Keystore AES-GCM pattern from `EncryptedSessionSnapshotStore` for the
queue. Persist no readable health values in SharedPreferences.

- [ ] **Step 4: Run focused tests and device queue test**

Run:

```bash
cd android && ./gradlew :app:testDebugUnitTest :app:connectedDebugAndroidTest
```

Expected: health JVM tests pass; the device test proves queue ciphertext
survives process recreation and plaintext values are absent.

- [ ] **Step 5: Commit the domain**

```bash
git add android/build.gradle.kts android/app/build.gradle.kts android/app/src/main/java/com/humhum/mobile/health android/app/src/test/java/com/humhum/mobile/health android/app/src/androidTest/java/com/humhum/mobile/health
git commit -m "feat(android): add private health signal domain"
```

### Task 4: Health Connect, Step Fallback, And Background Refresh

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthDataSource.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthConnectDataSource.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/PhoneStepDataSource.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthRepository.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthSyncWorker.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/health/HealthPermissionController.kt`
- Test: `android/app/src/test/java/com/humhum/mobile/health/HealthRepositoryTest.kt`
- Test: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`

**Interfaces:**
- Consumes: `HealthSourcePolicy`, `EncryptedHealthQueue`, `HealthSignalUploader`.
- Produces: `HealthDataSource.readDay(day: LocalDate): HealthSummary`.
- Produces: `HealthRepository.refresh(trigger: SyncTrigger): HealthUiState`.
- Produces unique work name: `humhum-health-summary-sync`.

- [ ] **Step 1: Write failing repository and manifest tests**

Test that Health Connect wins when available, step sensor is used only as an
explicit fallback, denied metrics are not read, a partial summary remains
usable, stale data is labeled, and background work is scheduled only after the
separate background grant.

Manifest tests require:

```text
android.permission.health.READ_STEPS
android.permission.health.READ_RESTING_HEART_RATE
android.permission.health.READ_SLEEP
android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND
android.permission.ACTIVITY_RECOGNITION
```

They reject every `WRITE_` health permission.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests '*HealthRepositoryTest' --tests '*ManifestContractTest'
```

Expected: missing classes and manifest declarations produce failures.

- [ ] **Step 3: Implement source adapters**

Use Health Connect 1.1.0. Aggregate `StepsRecord.COUNT_TOTAL`, read the latest
`RestingHeartRateRecord`, and sum the previous night's `SleepSessionRecord`
duration. Check feature and permission availability before every read.

`PhoneStepDataSource` uses `TYPE_STEP_COUNTER` only when Health Connect is
unavailable and the user granted activity recognition. Its UI source label is
`本手机计步`, never `Health Connect`.

- [ ] **Step 4: Implement foreground and six-hour background refresh**

Use unique periodic WorkManager work with a six-hour interval, network
constraint, and exponential backoff. Foreground refresh runs on app resume.
The worker reads, enqueues, and uploads a bounded batch. It returns retry only
for transient transport failures.

- [ ] **Step 5: Run health and full Android tests**

Run:

```bash
cd android && ./gradlew :app:testDebugUnitTest :app:lintDebug
```

Expected: all tests and lint pass.

- [ ] **Step 6: Commit source integration**

```bash
git add android/app/src/main/AndroidManifest.xml android/app/src/main/java/com/humhum/mobile/health android/app/src/test
git commit -m "feat(android): read opt-in Health Connect summaries"
```

### Task 5: Extract Mobile State Coordination From The Legacy Activity

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/app/HumHumUiState.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/app/HumHumAction.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/app/MobileCompanionRepository.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/app/HumHumViewModel.kt`
- Test: `android/app/src/test/java/com/humhum/mobile/app/HumHumViewModelTest.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`

**Interfaces:**
- Produces immutable `HumHumUiState` with connection, selected role, sessions,
  conversation disclosure, pending actions, monitor state, device-care state,
  health state, and settings visibility.
- Produces `HumHumViewModel.dispatch(HumHumAction)`.
- Consumes existing `ConnectionStore`, `MobileProtocol`, `AnywhereGateway`,
  `MonitorStore`, `DurableConnectionTransitionCoordinator`, and health
  repository.

- [ ] **Step 1: Write failing state-transition tests**

Cover unpaired, scanning, pairing, connected, role selection, refresh,
conversation disclosure, approval, follow-up, settings open/close, disconnect,
health permission result, offline snapshot, and relay recovery. Assert that
read-scoped devices never expose control actions.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests 'com.humhum.mobile.app.*'
```

Expected: missing state and ViewModel classes fail compilation.

- [ ] **Step 3: Implement repository and ViewModel adapters**

Move orchestration out of view callbacks without modifying the transport
classes. The repository owns one serial network executor. The ViewModel owns
polling lifecycle and exposes `StateFlow<HumHumUiState>`.

- [ ] **Step 4: Make the legacy Activity delegate without changing visuals**

Wire existing button callbacks and rendering to `dispatch`/`UiState` first.
This intermediate step proves behavior before Compose replaces the view tree.

- [ ] **Step 5: Run the full Android test suite**

Run:

```bash
cd android && ./gradlew :app:testDebugUnitTest
```

Expected: all prior behavior tests remain green.

- [ ] **Step 6: Commit state extraction**

```bash
git add android/app/src/main/java/com/humhum/mobile/app android/app/src/main/java/com/humhum/mobile/MainActivity.java android/app/src/test/java/com/humhum/mobile/app
git commit -m "refactor(android): extract mobile companion state"
```

### Task 6: Compose Living Signals, Hush Sources, Hexa, And Settings

**Files:**
- Modify: `android/app/build.gradle.kts`
- Replace: `android/app/src/main/java/com/humhum/mobile/MainActivity.java` with `android/app/src/main/java/com/humhum/mobile/MainActivity.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/HumHumApp.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/LivingSignalsScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/HypeScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/HushSourcesScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/HexaScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/SettingsScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/PairingScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/components/RoleNavigation.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/theme/HumHumTheme.kt`
- Delete: `android/app/src/main/res/layout/activity_main.xml`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`

**Interfaces:**
- Consumes: `HumHumUiState` and `HumHumViewModel.dispatch`.
- Preserves: QR scanner Activity result, camera permission, secure-window
  behavior, all Hexa actions, and selected role restoration.

- [ ] **Step 1: Write failing Compose UI tests**

At `390 x 844`, assert:

- Humi first viewport contains the date, interpreted headline, day route,
  privacy label, and exactly four bottom destinations.
- Settings is absent until the gear button is tapped.
- Hush requests no permission until a source toggle is tapped.
- Manual pairing fields stay hidden until recovery is opened.
- Hexa read scope hides approval and send controls.
- 1.3x font scale does not clip bottom navigation or primary actions.

- [ ] **Step 2: Run connected UI tests and verify RED**

Run:

```bash
cd android && ./gradlew :app:connectedDebugAndroidTest
```

Expected: tests fail because Compose screens are absent.

- [ ] **Step 3: Implement theme, navigation, and Pairing**

Use Material 3 primitives with HUMHUM's existing mascot PNGs and role colors.
Implement edge-to-edge insets, fixed bottom navigation, 48dp targets, 8dp
maximum radius, and no nested cards.

- [ ] **Step 4: Implement Living Signals and role screens**

Match the selected visual target's hierarchy. Use real session and health state;
empty, denied, unavailable, stale, and offline states must be deterministic.
Hype preserves the honest scoped-unavailable state. Hexa preserves conversation,
approval, follow-up, monitor, refresh, and session behavior.

- [ ] **Step 5: Implement dedicated Settings**

Provide grouped rows for Mac connection, health permissions, background
operation, privacy/delete, and about. Keep raw connection material inside a
collapsed advanced diagnostics section.

- [ ] **Step 6: Run UI tests, lint, and build**

Run:

```bash
cd android && ./gradlew :app:testDebugUnitTest :app:connectedDebugAndroidTest :app:lintDebug :app:assembleDebug
```

Expected: all tasks pass and a debug APK is produced.

- [ ] **Step 7: Commit the Compose app**

```bash
git add android/app
git commit -m "feat(android): ship Living Signals companion UI"
```

### Task 7: Desktop Hush Health Summary And Privacy Controls

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/components/Hub/HushModule.tsx`
- Modify: `src/lib/i18n/translations.ts`
- Test: `src/components/Hub/HushModule.test.tsx`

**Interfaces:**
- Produces Tauri commands:
  - `get_hush_health_signals() -> Vec<HushSignalSummary>`.
  - `clear_hush_health_signals() -> usize`.
- Consumes the Mac-side Hush signal vault.

- [ ] **Step 1: Write failing Hush UI tests**

Test a connected phone source with real summaries, partial metrics, stale data,
empty data, and delete confirmation. Assert that raw JSON, file paths, and
device tokens never render.

- [ ] **Step 2: Run the focused frontend test and verify RED**

Run:

```bash
npm test -- src/components/Hub/HushModule.test.tsx
```

Expected: missing commands and source UI make the tests fail.

- [ ] **Step 3: Implement commands and interpreted Hush source section**

Show latest date, source device, step/heart/sleep availability, last sync, and
delete action. Keep the existing relationship inbox unchanged.

- [ ] **Step 4: Run frontend and Rust tests**

Run:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: all commands exit zero.

- [ ] **Step 5: Commit desktop integration**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/components/Hub/HushModule.tsx src/components/Hub/HushModule.test.tsx src/lib/i18n/translations.ts
git commit -m "feat(hush): surface private phone health summaries"
```

### Task 8: Visual QA, Physical Behavior, Release Build, And Documentation

**Files:**
- Create: `design-qa-android-living-signals.md`
- Modify: `docs/android-install.md`
- Modify: `README.md`
- Modify: version files only after all gates pass

**Interfaces:**
- Consumes the selected target and a `390 x 844` emulator capture.
- Produces release APK/AAB and a user-facing Xiaomi install ZIP.

- [ ] **Step 1: Capture every required state**

Capture Pairing, Humi, Hush Sources, Hexa, Settings, Health Connect unavailable,
permission denied, and stale data at `390 x 844`.

- [ ] **Step 2: Run blocking visual comparison**

Place the selected reference and emulator Humi capture into one comparison image.
Write `design-qa-android-living-signals.md` with P0-P3 findings. Fix every P0,
P1, and P2 issue and repeat until the file says:

```text
final result: passed
```

- [ ] **Step 3: Exercise the real workflows**

Verify QR pairing, 5G Anywhere refresh, Health Connect permission grant and
revocation, phone-step fallback, foreground sync, background work scheduling,
Mac-offline queueing, reconnect upload, health deletion, Hexa conversation,
approval, and follow-up.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```bash
npm test
npm run test:relay
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
cd android && ./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleRelease :app:bundleRelease
```

Expected: every command exits zero with no failed tests or lint errors.

- [ ] **Step 5: Inspect the release artifacts**

Confirm package `com.humhum.mobile`, version increment, minimum API 26, only
approved health read permissions, v2/v3 signatures, cold installation with
Package Manager `--no-streaming`, and cold launch.

- [ ] **Step 6: Update install and privacy documentation**

Document Health Connect availability, Xiaomi fallback, every permission's
purpose, foreground/background behavior, Mac-side storage, deletion, and the
fact that heart rate and sleep are unavailable without a trusted source.

- [ ] **Step 7: Commit release evidence**

```bash
git add design-qa-android-living-signals.md docs/android-install.md README.md android src src-tauri package.json package-lock.json
git commit -m "release: prepare Living Signals Android beta"
```

