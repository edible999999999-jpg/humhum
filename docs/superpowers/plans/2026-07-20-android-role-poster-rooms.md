# HUMHUM Android Role Poster Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic full-page room background layout with the approved role-poster Android experience while preserving current pairing, privacy, health, and Agent-control behavior.

**Architecture:** A focused `RolePoster` component owns the exact Mac room asset, crop, fixed poster height, and decorative semantics. Each role screen composes that poster with a role-specific first action and then renders its existing state-backed content in a distinct information order. The shared app shell keeps the 60dp toolbar and 68dp four-role navigation, while settings remains an unbranded utility list.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, Android drawable resources, JUnit 4, Android Compose UI tests, Gradle 9.

## Global Constraints

- Use the exact Humi, Hype, Hush, and Hexa files listed in `docs/superpowers/specs/2026-07-20-android-role-poster-rooms-design.md`.
- Never redraw, recolor, substitute, or place the role images in the bottom navigation.
- Keep the shared toolbar at 60dp and the bottom navigation at 68dp.
- Keep Noto Sans SC, zero letter spacing, controls at least 48dp, and corners no larger than 8dp.
- Humi conversation, Hype search, Hush attention, and Hexa decisions are the first role-specific actions.
- Hush remains read-only and never auto-replies.
- Hexa approval and follow-up controls remain hidden for read-only scope.
- Settings does not render a role poster.
- UI code continues to consume `HumHumUiState` and callbacks; it does not access network, storage, or Health Connect directly.

---

### Task 1: Create The Shared Role Poster Boundary

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/ui/components/RolePoster.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/components/RoleRoomBackground.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HumHumApp.kt`
- Modify: `android/app/src/test/java/com/humhum/mobile/ui/components/RoleRoomBackgroundTest.kt`
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`

**Interfaces:**
- Consumes: `MobileRoleDashboard.Role` and the existing `roomBackgroundFor(role)` resource mapping.
- Produces: `RolePoster(role, modifier, content)` with `role-poster` and `role-poster-<role id>` semantics, plus `rolePosterHeight(role): Dp`.

- [ ] **Step 1: Write the failing poster contract tests**

Replace the opacity contract with fixed poster-height assertions:

```kotlin
@Test
fun everyRoleUsesACompactPosterInsteadOfAFullPageBackdrop() {
    MobileRoleDashboard.Role.entries.forEach { role ->
        assertTrue(rolePosterHeight(role) in 230.dp..250.dp)
    }
}
```

Update the Compose shell test:

```kotlin
@Test
fun everyRoomUsesOneRolePosterAndNoFullPageBackground() {
    var state by mutableStateOf(connectedState())
    compose.setContent { HumHumApp(state, HumHumCallbacks()) }

    MobileRoleDashboard.Role.entries.forEach { role ->
        compose.runOnIdle { state = state.copy(selectedRole = role) }
        compose.onAllNodesWithTag("role-poster", useUnmergedTree = true)
            .assertCountEquals(1)
        compose.onNodeWithTag("role-poster-${role.id()}", useUnmergedTree = true)
            .assertIsDisplayed()
        compose.onNodeWithTag("room-background", useUnmergedTree = true)
            .assertDoesNotExist()
    }
}
```

- [ ] **Step 2: Run the targeted tests and verify RED**

Run:

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew testDebugUnitTest \
  --tests com.humhum.mobile.ui.components.RoleRoomBackgroundTest
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew connectedDebugAndroidTest \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.humhum.mobile.ui.HumHumAppTest#everyRoomUsesOneRolePosterAndNoFullPageBackground'
```

Expected: FAIL because `RolePoster`, `rolePosterHeight`, and poster semantics do not exist.

- [ ] **Step 3: Implement the shared poster and remove the scaffold backdrop**

Create a fixed, decorative image boundary:

```kotlin
@Composable
fun RolePoster(
    role: MobileRoleDashboard.Role,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit = {},
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(rolePosterHeight(role))
            .clip(RoundedCornerShape(bottomStart = 8.dp, bottomEnd = 8.dp))
            .testTag("role-poster"),
    ) {
        Image(
            painter = painterResource(roomBackgroundFor(role)),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            alignment = posterAlignment(role),
            modifier = Modifier
                .matchParentSize()
                .testTag("role-poster-${role.id()}"),
        )
        content()
    }
}

internal fun rolePosterHeight(role: MobileRoleDashboard.Role): Dp = when (role) {
    MobileRoleDashboard.Role.HUMI -> 242.dp
    MobileRoleDashboard.Role.HYPE -> 236.dp
    MobileRoleDashboard.Role.HUSH -> 240.dp
    MobileRoleDashboard.Role.HEXA -> 244.dp
}
```

Remove `RoleRoomBackground` from `CompanionScaffold`; each room now owns exactly one poster at the top of its `LazyColumn`.

- [ ] **Step 4: Run the targeted tests and verify GREEN**

Run the commands from Step 2.

Expected: both targeted contracts pass.

- [ ] **Step 5: Commit the poster boundary**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/components/RolePoster.kt \
  android/app/src/main/java/com/humhum/mobile/ui/components/RoleRoomBackground.kt \
  android/app/src/main/java/com/humhum/mobile/ui/HumHumApp.kt \
  android/app/src/test/java/com/humhum/mobile/ui/components/RoleRoomBackgroundTest.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt
git commit -m "refactor(android): introduce role poster shell"
```

---

### Task 2: Recompose Pairing And Humi Around The Poster

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/PairingScreen.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HumiRoomScreen.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/RoomComponents.kt`
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`

**Interfaces:**
- Consumes: `RolePoster`, `HumHumUiState.personalContext`, existing health callbacks, and pairing callbacks.
- Produces: `humi-composer`, `humi-primary-judgment`, and `pairing-primary-action` semantics.

- [ ] **Step 1: Write failing first-action tests**

```kotlin
@Test
fun humiStartsWithPosterJudgmentAndConversationBeforeToday() {
    setContent(connectedState())

    compose.onNodeWithTag("role-poster-humi").assertIsDisplayed()
    compose.onNodeWithTag("humi-primary-judgment").assertIsDisplayed()
    compose.onNodeWithTag("humi-composer").assertIsDisplayed()
    assertAbove("humi-composer", "today-section")
}

@Test
fun pairingStartsWithHumiPosterAndScanActionWithoutRoleNavigation() {
    setContent(HumHumUiState())

    compose.onNodeWithTag("role-poster-humi").assertIsDisplayed()
    compose.onNodeWithTag("pairing-primary-action").assertIsDisplayed()
    compose.onNodeWithTag("role-navigation").assertDoesNotExist()
    compose.onNodeWithTag("manual-pairing-fields").assertDoesNotExist()
}
```

`assertAbove(firstTag, secondTag)` compares `boundsInRoot.top` and fails when the first action is not earlier in the page.

- [ ] **Step 2: Run both tests and verify RED**

Run:

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew connectedDebugAndroidTest \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.humhum.mobile.ui.HumHumAppTest'
```

Expected: FAIL because the new first-action tags and poster layout do not exist.

- [ ] **Step 3: Implement Pairing and Humi**

Pairing places its brand copy in the Humi poster and keeps scan, paste, status, recovery, and storage-boundary copy in the current callback flow.

Humi places the derived context judgment directly below the poster, followed by a locally editable composer shell:

```kotlin
OutlinedTextField(
    value = draft,
    onValueChange = { draft = it.take(1000) },
    placeholder = { Text("和 Humi 聊聊") },
    leadingIcon = { Icon(Icons.Outlined.Mic, contentDescription = "语音输入") },
    trailingIcon = {
        IconButton(onClick = { draft = "" }, enabled = draft.isNotBlank()) {
            Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = "发送给 Humi")
        }
    },
    shape = RoundedCornerShape(8.dp),
    modifier = Modifier.fillMaxWidth().testTag("humi-composer"),
)
```

The composer is deliberately UI-local in this visual change; it does not invent a mobile Humi transport. Existing today, confirmed memory, and health content follows in that order with unchanged source and permission behavior.

- [ ] **Step 4: Run Compose tests and verify GREEN**

Run the command from Step 2.

Expected: Humi, pairing, health-permission, manual-recovery, large-font, and system-inset tests pass.

- [ ] **Step 5: Commit Pairing and Humi**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/PairingScreen.kt \
  android/app/src/main/java/com/humhum/mobile/ui/HumiRoomScreen.kt \
  android/app/src/main/java/com/humhum/mobile/ui/RoomComponents.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt
git commit -m "feat(android): build pairing and Humi poster rooms"
```

---

### Task 3: Give Hype And Hush Distinct First-Viewport Workflows

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HypeRoomScreen.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HushRoomScreen.kt`
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`

**Interfaces:**
- Consumes: `RolePoster`, authorized personal context, knowledge items, preferences, memories, and inbox summaries.
- Produces: `hype-search`, `hush-attention`, `hush-privacy-boundary`, and `hush-first-contact` semantics.

- [ ] **Step 1: Write failing Hype and Hush workflow tests**

```kotlin
@Test
fun hypeSearchIsTheFirstActionAfterItsPoster() {
    setContent(connectedState().copy(selectedRole = MobileRoleDashboard.Role.HYPE))

    compose.onNodeWithTag("role-poster-hype").assertIsDisplayed()
    compose.onNodeWithTag("hype-search").assertIsDisplayed()
    compose.onNodeWithTag("hype-first-knowledge").assertIsDisplayed()
    assertAbove("hype-search", "hype-first-knowledge")
}

@Test
fun hushLeadsWithAttentionAndReadOnlyBoundaryBeforeContacts() {
    setContent(connectedState().copy(selectedRole = MobileRoleDashboard.Role.HUSH))

    compose.onNodeWithTag("role-poster-hush").assertIsDisplayed()
    compose.onNodeWithTag("hush-attention").assertIsDisplayed()
    compose.onNodeWithTag("hush-privacy-boundary").assertIsDisplayed()
    compose.onNodeWithTag("hush-first-contact").assertIsDisplayed()
    compose.onNodeWithText("不会自动发送回复", substring = true).assertIsDisplayed()
    compose.onNodeWithTag("health-source-steps").assertDoesNotExist()
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run the full `HumHumAppTest` command from Task 2.

Expected: FAIL because the role-specific poster ordering and semantics are missing.

- [ ] **Step 3: Implement Hype and Hush**

Hype renders `RolePoster(HYPE)`, one current knowledge theme, the tagged search field, and knowledge rows before preferences and memory. Rows keep human-readable title, purpose summary, source category, and available freshness text.

Hush renders `RolePoster(HUSH)`, a priority-derived attention sentence, an adjacent authorized/read-only boundary, and inbox rows ordered by descending importance:

```kotlin
val inbox = state.personalContext?.inbox().orEmpty()
    .sortedByDescending { it.importance() }

Text(
    text = if (priority == 0) "今天没有需要你立刻处理的人" else "$priority 个人值得你今天回一下",
    modifier = Modifier.testTag("hush-attention"),
)
Text(
    text = "只读摘要 · 仅限已授权来源 · 不会自动发送回复",
    modifier = Modifier.testTag("hush-privacy-boundary"),
)
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run the full `HumHumAppTest` command.

Expected: all Hype/Hush role, authorization, privacy, and no-health-in-Hush assertions pass.

- [ ] **Step 5: Commit Hype and Hush**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/HypeRoomScreen.kt \
  android/app/src/main/java/com/humhum/mobile/ui/HushRoomScreen.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt
git commit -m "feat(android): focus Hype search and Hush attention"
```

---

### Task 4: Put Hexa Decisions First And Finish Utility Styling

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HexaScreen.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/SettingsScreen.kt`
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/CharacterRoomsVisualQaTest.kt`

**Interfaces:**
- Consumes: `HumHumUiState.canControl`, sessions, pending actions, Agent summaries, settings callbacks, and `RolePoster`.
- Produces: `hexa-permission`, `hexa-decision-section`, and `settings-screen` semantics with unchanged approval and follow-up behavior.

- [ ] **Step 1: Write failing Hexa and settings tests**

```kotlin
@Test
fun hexaPutsPermissionAndDecisionBeforeAgentProgress() {
    setContent(
        connectedState().copy(
            selectedRole = MobileRoleDashboard.Role.HEXA,
            sessions = listOf(controllableSession()),
        ),
    )

    compose.onNodeWithTag("role-poster-hexa").assertIsDisplayed()
    compose.onNodeWithTag("hexa-permission").assertIsDisplayed()
    compose.onNodeWithTag("hexa-decision-section").assertIsDisplayed()
    compose.onNodeWithText("允许").assertIsDisplayed()
    compose.onNodeWithText("拒绝").assertIsDisplayed()
}

@Test
fun settingsNeverUsesARolePoster() {
    setContent(connectedState().copy(settingsVisible = true))

    compose.onNodeWithTag("settings-screen").assertIsDisplayed()
    compose.onNodeWithTag("role-poster").assertDoesNotExist()
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run the full `HumHumAppTest` command.

Expected: FAIL because the new Hexa decision semantics are absent.

- [ ] **Step 3: Implement Hexa decision ordering and quiet settings rows**

Hexa renders the role poster, permission line, and any session actions before Agent progress. `SessionPanel` remains the owner of approval, conversation disclosure, and follow-up behavior; read scope still omits those controls.

Settings remains poster-free, removes role-color emphasis from ordinary rows, uses the error color only for delete-local-data, and preserves every existing callback and diagnostics disclosure.

- [ ] **Step 4: Run the full Android verification suite**

Run:

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew testDebugUnitTest connectedDebugAndroidTest assembleDebug
```

Expected: all unit and instrumentation tests pass and `app/build/outputs/apk/debug/app-debug.apk` is produced.

- [ ] **Step 5: Capture and inspect responsive visual evidence**

Use `CharacterRoomsVisualQaTest` to capture Pairing, Humi, Hype, Hush, Hexa, and Settings at the 390x844 reference viewport. Repeat the app checks at 360x800 and 412x915, then at font scale 1.3.

Verify:

```text
- exactly one correct poster in each role room
- no poster in Settings
- first action and the next real section are visible at 390x844
- no horizontal clipping or bottom-navigation overlap
- Hush is the real Hush image and Hexa is the yellow Hexa image
- QR, health permissions, Hush privacy, Hexa read/control, and settings actions remain usable
```

- [ ] **Step 6: Commit the completed redesign**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/HexaScreen.kt \
  android/app/src/main/java/com/humhum/mobile/ui/SettingsScreen.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/CharacterRoomsVisualQaTest.kt
git commit -m "feat(android): complete role poster room redesign"
```

