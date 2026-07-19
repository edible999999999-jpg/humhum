# Android Companion Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Android companion a privacy-bounded personal-context sync and four useful Humi, Hype, Hush, and Hexa rooms that match the Mac product roles.

**Architecture:** The Mac remains the source of truth and projects existing stores into a small `MobilePersonalContext` response. Existing authenticated TLS and encrypted Anywhere request paths carry the same payload; Android strictly parses it, stores a 24-hour encrypted offline copy, and renders role-specific rooms from one state model.

**Tech Stack:** Rust, Tauri state, serde JSON, Java Android protocol/storage, Kotlin StateFlow, Jetpack Compose Material 3, JUnit, Vitest, Cargo tests.

## Global Constraints

- Personal context is a separate pairing capability from Agent read/control scope.
- Never send raw files, absolute paths, raw inbox payloads, full transcripts, or unconfirmed inferred habits.
- Limits: 5 today items, 3 suggestions, 8 preferences, 8 habits, 6 memories, 8 knowledge items, 8 inbox items, 8 Agent items.
- Android personal-context cache expires after 24 hours and uses an independent Android Keystore AES-GCM key.
- Humi owns companion, health, today, suggestions, habits, and memories; Hype owns knowledge; Hush owns inbox; Hexa owns Agent supervision.
- Existing Mac, Windows, Android pairing, relay, session, approval, and health-upload behavior must remain compatible.

---

### Task 1: Mac Personal Context Projection

**Files:**
- Create: `src-tauri/src/mobile_personal_context.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/mobile_personal_context.rs`

**Interfaces:**
- Consumes: `KnowledgeStore::get_all()`, `HushStore::summary()`, `HexaGoalStore::goals()`, `HexaWatchStore::sessions()`.
- Produces: `pub fn project_mobile_personal_context(app: &tauri::AppHandle) -> MobilePersonalContext`.

- [ ] **Step 1: Write failing projection tests**

```rust
#[test]
fn projection_is_bounded_and_drops_private_fields() {
    let context = MobilePersonalContext::from_sources(sample_sources());
    assert!(context.preferences.len() <= 8);
    assert!(context.inbox.iter().all(|item| !item.preview.contains("/Users/")));
}
```

- [ ] **Step 2: Run the focused test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mobile_personal_context`

Expected: FAIL because the module and projection do not exist.

- [ ] **Step 3: Implement bounded DTOs and source adapters**

```rust
#[derive(Debug, Clone, Serialize)]
pub struct MobilePersonalContext {
    pub version: u8,
    pub generated_at: String,
    pub expires_at: String,
    pub today: Vec<MobileTodayItem>,
    pub suggestions: Vec<MobileSuggestion>,
    pub preferences: Vec<MobilePreference>,
    pub habits: Vec<MobileHabit>,
    pub memories: Vec<MobileMemory>,
    pub knowledge: Vec<MobileKnowledgeItem>,
    pub inbox: Vec<MobileInboxItem>,
    pub agents: Vec<MobileAgentItem>,
}
```

Build `today` from active Hexa goals and explicit open Obsidian tasks, `preferences` and `memories` from the vault-backed KnowledgeStore, `knowledge` from named skill assets and note titles, `inbox` from sanitized Hush summary fields, and `agents` from watched sessions. Keep habits empty until confirmed structured records exist; suggestions remain labeled suggestions.

- [ ] **Step 4: Run projection tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mobile_personal_context`

Expected: PASS with bounded output and no source path/raw fields.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mobile_personal_context.rs src-tauri/src/lib.rs
git commit -m "feat: project bounded mobile personal context"
```

### Task 2: Pairing Capability and Transport

**Files:**
- Modify: `src-tauri/src/mobile_bridge.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`
- Test: `src-tauri/src/mobile_bridge.rs`
- Test: `src/components/Hub/HexaMobilePairingCard.test.tsx`

**Interfaces:**
- Consumes: `project_mobile_personal_context(app)`.
- Produces: LAN `GET /api/personal-context`, Anywhere `{ "action": "personal_context" }`, and persisted `personal_context: bool` device capability.

- [ ] **Step 1: Add failing capability and route tests**

```rust
#[test]
fn personal_context_requires_explicit_device_capability() {
    let device = MobileDevice::test_device(false);
    assert!(!device.personal_context);
}

#[test]
fn anywhere_personal_context_request_is_read_only() {
    assert!(matches!(
        parse_anywhere_request(MobileDeviceScope::Read, &json!({"action":"personal_context"})),
        Ok(AnywhereRequest::PersonalContext)
    ));
}
```

- [ ] **Step 2: Run focused Rust and frontend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mobile_bridge`

Run: `npm test -- --run src/components/Hub/HexaMobilePairingCard.test.tsx`

Expected: FAIL because the capability, action, and UI control are absent.

- [ ] **Step 3: Implement capability persistence and transport**

Add `personal_context` with `#[serde(default)]` to devices, auth, summaries, pairing challenge/info, and pairing responses. Reject the LAN route and Anywhere action with `403`/error unless the authenticated device has the capability. Reuse the existing response encryption.

- [ ] **Step 4: Add a visible pairing toggle**

Add a checked-by-default control labeled `同步个人上下文` beside the read/control pairing actions and pass `personalContext` through `start_mobile_pairing`.

- [ ] **Step 5: Run focused tests and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mobile_bridge`

Run: `npm test -- --run src/components/Hub/HexaMobilePairingCard.test.tsx`

Expected: PASS.

```bash
git add src-tauri/src/mobile_bridge.rs src-tauri/src/commands.rs src/hooks/useHexaData.ts src/components/Hub/HexaModule.tsx src/components/Hub/HexaMobilePairingCard.test.tsx
git commit -m "feat: authorize mobile personal context"
```

### Task 3: Android Protocol and Encrypted Cache

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/PersonalContextSnapshot.java`
- Create: `android/app/src/main/java/com/humhum/mobile/PersonalContextCodec.java`
- Create: `android/app/src/main/java/com/humhum/mobile/EncryptedPersonalContextStore.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/Models.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AnywhereGateway.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/ConnectionStore.java`
- Test: `android/app/src/test/java/com/humhum/mobile/PersonalContextCodecTest.java`
- Test: `android/app/src/test/java/com/humhum/mobile/MobileProtocolTest.java`
- Test: `android/app/src/test/java/com/humhum/mobile/AnywhereGatewayTest.java`

**Interfaces:**
- Consumes: JSON `MobilePersonalContext` from Task 1 and capability flag from Task 2.
- Produces: `Models.PersonalContext`, `MobileProtocol.personalContext()`, `AnywhereGateway.personalContext()`, and encrypted offline read/write.

- [ ] **Step 1: Write strict parser tests**

```java
@Test public void personalContextRejectsOversizedCollectionsAndUnknownShape() {
    assertThrows(JSONException.class, () -> MobileProtocol.parsePersonalContext(oversizedPayload()));
}
```

- [ ] **Step 2: Run focused Android unit tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*PersonalContext*' --tests '*MobileProtocolTest'`

Expected: FAIL because the model and parser are absent.

- [ ] **Step 3: Implement models, strict parser, LAN and Anywhere fetch**

Keep only display-safe IDs, labels, summaries, timestamps, statuses, and suggestion confidence/source labels. Enforce server collection limits and bounded text during parsing.

- [ ] **Step 4: Implement independent encrypted 24-hour cache**

Use key alias `humhum-personal-context-v1`, file `humhum-personal-context-v1.json`, connection-bound AAD, atomic writes, 256 KiB maximum envelope, and delete corrupt or expired values.

- [ ] **Step 5: Run tests and commit**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*PersonalContext*' --tests '*MobileProtocolTest' --tests '*AnywhereGatewayTest'`

Expected: PASS.

```bash
git add android/app/src/main/java/com/humhum/mobile android/app/src/test/java/com/humhum/mobile
git commit -m "feat: sync encrypted Android personal context"
```

### Task 4: Android State and Refresh Lifecycle

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/app/HumHumUiState.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/app/HumHumAction.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/app/HumHumViewModel.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/app/MobileCompanionRepository.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Test: `android/app/src/test/java/com/humhum/mobile/app/HumHumViewModelTest.kt`

**Interfaces:**
- Consumes: `Models.PersonalContext` and encrypted cache from Task 3.
- Produces: `HumHumUiState.personalContext`, `personalContextAvailable`, and stale/offline status for Compose.

- [ ] **Step 1: Write reducer tests**

```kotlin
@Test fun `personal context survives session refresh and clears on disconnect`() {
    viewModel.dispatch(HumHumAction.PersonalContextLoaded(context, false))
    viewModel.dispatch(HumHumAction.SessionsLoaded(emptyList(), false))
    assertEquals(context, viewModel.state.value.personalContext)
    viewModel.dispatch(HumHumAction.Disconnected)
    assertNull(viewModel.state.value.personalContext)
}
```

- [ ] **Step 2: Run reducer tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*HumHumViewModelTest'`

Expected: FAIL because personal context actions/state are absent.

- [ ] **Step 3: Fetch context with each refresh**

After sessions succeed, fetch context over the same chosen route when authorized, persist it, and dispatch `PersonalContextLoaded`. On network failure, load only an unexpired encrypted context snapshot; do not turn a context-only failure into an Agent session failure.

- [ ] **Step 4: Clear private context on revoke/disconnect**

Delete both context ciphertext and key alongside the session snapshot, Anywhere state, and connection.

- [ ] **Step 5: Run tests and commit**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*HumHumViewModelTest' --tests '*ConnectionStoreTest'`

Expected: PASS.

```bash
git add android/app/src/main/java/com/humhum/mobile/app android/app/src/main/java/com/humhum/mobile/MainActivity.java android/app/src/test/java/com/humhum/mobile/app
git commit -m "feat: integrate personal context refresh state"
```

### Task 5: Four Android Character Rooms

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/ui/HumiRoomScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/HypeRoomScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/HushRoomScreen.kt`
- Create: `android/app/src/main/java/com/humhum/mobile/ui/RoomComponents.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HexaScreen.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HumHumApp.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/components/RoleNavigation.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/theme/HumHumTheme.kt`
- Delete: `android/app/src/main/java/com/humhum/mobile/ui/LivingSignalsScreen.kt`
- Delete: `android/app/src/main/java/com/humhum/mobile/ui/HypeScreen.kt`
- Delete: `android/app/src/main/java/com/humhum/mobile/ui/HushSourcesScreen.kt`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`

**Interfaces:**
- Consumes: `HumHumUiState.personalContext`, health, sessions, and existing control callbacks.
- Produces: four role-specific Compose rooms under one shared header and compact icon/label navigation.

- [ ] **Step 1: Write failing Compose semantics tests**

```kotlin
@Test fun humiShowsTodayMemoryAndHealthWithoutRawPaths() {
    compose.setContent { HumHumApp(populatedHumiState(), HumHumCallbacks()) }
    compose.onNodeWithTag("humi-room").assertExists()
    compose.onNodeWithText("今天").assertExists()
    compose.onAllNodesWithText("/Users/", substring = true).assertCountEquals(0)
}
```

- [ ] **Step 2: Run instrumented test compilation**

Run: `cd android && ./gradlew compileDebugAndroidTestKotlin`

Expected: FAIL because room tags/components do not exist.

- [ ] **Step 3: Implement shared shell and compact navigation**

Use a 64dp bottom bar, 22-24dp role icons/mascot crops, one accent per room, unframed section bands, 8dp maximum card radius, and no nested cards.

- [ ] **Step 4: Implement role content**

Humi: companion brief, today, suggestions, memory/habits, health source strip.
Hype: search entry, skills/knowledge, preferences, memories.
Hush: priority inbox previews with sender/platform/time and no health controls.
Hexa: attention queue, active sessions, approvals, and existing conversation/control flows.

- [ ] **Step 5: Run Android compile/tests and commit**

Run: `cd android && ./gradlew testDebugUnitTest compileDebugAndroidTestKotlin assembleDebug`

Expected: PASS.

```bash
git add android/app/src/main/java/com/humhum/mobile/ui android/app/src/androidTest/java/com/humhum/mobile/ui
git commit -m "feat: align Android character rooms with Mac"
```

### Task 6: Full Verification and Visual QA

**Files:**
- Modify only files needed to fix discovered regressions.
- Output: `docs/design/android-companion-rooms/` screenshots if an emulator is available.

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: release-ready evidence that protocol, privacy, existing desktop behavior, and Android layout pass.

- [ ] **Step 1: Run all desktop tests**

Run: `npm test -- --run`

Run: `npm run build`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all tests and builds PASS.

- [ ] **Step 2: Run all Android tests and build**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug`

Expected: PASS and a debug APK under `android/app/build/outputs/apk/debug/`.

- [ ] **Step 3: Run visual verification**

On an available emulator, capture Humi, Hype, Hush, and Hexa at a phone viewport. Verify no overlap, no blank canvas, readable longest Chinese labels, compact navigation, and room-specific content. If no emulator is available, report that limitation and retain Compose semantics/build evidence.

- [ ] **Step 4: Review the diff for privacy and compatibility**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only intentional source, test, design, and plan changes.

- [ ] **Step 5: Commit final fixes**

```bash
git add src-tauri src android docs/superpowers/plans/2026-07-19-android-companion-rooms.md
git commit -m "test: verify Android companion rooms"
```
