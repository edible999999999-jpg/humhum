# Android Role Visual Personality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Hexa a restrained yellow-and-black engineering control-surface identity and make Hush feel warmer and more personal without changing behavior.

**Architecture:** Add role-specific semantic color tokens to the existing Compose theme, then consume them only inside Hexa and Hush task components. Keep the shared header, navigation, data models, callbacks, permissions, and test tags unchanged. Mirror the final result in the existing high-fidelity HTML board and Android visual fixtures.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, Android instrumentation tests, JUnit 4, static HTML/CSS design board.

## Global Constraints

- Keep the current top app bar, four-role bottom navigation, spacing scale, typography hierarchy, and 8 dp component radius.
- Do not add mascot images, gradients, decorative blobs, fake terminal output, or invented production message data.
- Hexa uses dark graphite only for the primary session; secondary sessions remain light.
- Hush retains sender, source, time, preview, filter behavior, and privacy copy.
- All existing permission, follow-up, message, and Agent control behavior must remain unchanged.

---

### Task 1: Role Semantic Colors

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/theme/HumHumTheme.kt`
- Test: `android/app/src/test/java/com/humhum/mobile/ui/theme/HumHumThemeTest.kt`

**Interfaces:**
- Consumes: existing `Color` constants and `contrastRatio` test helper.
- Produces: `HexaPanel`, `HexaPanelRaised`, `HexaPanelText`, `HexaPanelMuted`, `HexaSignal`, `HushCanvas`, `HushPeach`, `HushRose`, and `HushMintWarm`.

- [ ] **Step 1: Add failing contrast assertions**

Add the new foreground/background pairs to `roleAccentsMeetWcagAaAgainstWhite` and assert at least `4.5` for body text and `3.0` for large status accents.

- [ ] **Step 2: Run the theme test and verify it fails**

Run:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew testDebugUnitTest --tests com.humhum.mobile.ui.theme.HumHumThemeTest
```

Expected: compilation failure because the new semantic colors do not exist.

- [ ] **Step 3: Add the semantic colors**

Define the exact role-local tokens in `HumHumTheme.kt`, preserving existing public role accents:

```kotlin
val HexaPanel = Color(0xFF181A1F)
val HexaPanelRaised = Color(0xFF23262D)
val HexaPanelText = Color(0xFFF7F4E8)
val HexaPanelMuted = Color(0xFFADB2BC)
val HexaSignal = Color(0xFFFFC928)
val HushCanvas = Color(0xFFFFFBF7)
val HushPeach = Color(0xFFFFE7D8)
val HushRose = Color(0xFFF8DDE0)
val HushMintWarm = Color(0xFFE8F5EE)
```

- [ ] **Step 4: Run the theme test and verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/theme/HumHumTheme.kt \
  android/app/src/test/java/com/humhum/mobile/ui/theme/HumHumThemeTest.kt
git commit -m "style(android): add Hexa and Hush semantic colors"
```

### Task 2: Hexa Engineering Control Surface

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HexaScreen.kt`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`

**Interfaces:**
- Consumes: Task 1 Hexa semantic colors and existing `SessionPanel` state.
- Produces: dark primary `SessionPanel`; light secondary panels remain unchanged.

- [ ] **Step 1: Add a behavior-preservation test**

Extend `hexaFirstViewportPromotesTheCurrentTaskAndComposer` to assert the primary panel test tag `hexa-primary-session`, the follow-up field, send action, and conversation action remain visible.

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class='com.humhum.mobile.ui.HumHumAppTest#hexaFirstViewportPromotesTheCurrentTaskAndComposer'
```

Expected: FAIL because `hexa-primary-session` does not exist.

- [ ] **Step 3: Implement the dark primary session**

In `SessionPanel`, apply `HexaPanel` only when `primary` is true. Use
`HexaPanelRaised` for the icon and command composer, `HexaPanelText` for the
project and status copy, `HexaPanelMuted` for metadata, and `HexaSignal` for
progress, status, focus border, and send icon. Apply monospace only to the
metadata line. Add `testTag("hexa-primary-session")` to the primary surface.

- [ ] **Step 4: Run the targeted test and verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/HexaScreen.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt
git commit -m "style(android): sharpen Hexa control surface"
```

### Task 3: Warm Hush Correspondence Room

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HushRoomScreen.kt`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`

**Interfaces:**
- Consumes: Task 1 Hush semantic colors and existing `InboxFilter`.
- Produces: deterministic sender tone through `messageTone(sender: String, importance: Int): Color`.

- [ ] **Step 1: Add a filter behavior test tag**

Add `testTag("hush-filter-${item.name.lowercase()}")` to each filter destination
and extend `hushFirstViewportReadsLikeAnInbox` to click `REPLY`, assert the
priority message remains, then return to `ALL`.

- [ ] **Step 2: Run the targeted Hush test and verify it fails**

Run:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class='com.humhum.mobile.ui.HumHumAppTest#hushFirstViewportReadsLikeAnInbox'
```

Expected: FAIL because the filter test tags do not exist.

- [ ] **Step 3: Implement warm Hush styling**

Use `HushCanvas` behind the room content, `HushPeach` for the filter track,
`HushRose` for high-importance sender tiles, and `HushMintWarm` for trusted
ordinary messages. Shorten dividers by applying start padding equal to the
avatar width plus row gap. Keep all current text fields and message density.

- [ ] **Step 4: Run the targeted Hush test and verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/HushRoomScreen.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt
git commit -m "style(android): warm the Hush correspondence room"
```

### Task 4: Design Board Synchronization

**Files:**
- Modify: `design/mobile-0.4/index.html`
- Modify: `design/mobile-0.4/design-board.png`

**Interfaces:**
- Consumes: exact Task 1 color values and Task 2/3 component hierarchy.
- Produces: reviewable six-screen board matching Compose.

- [ ] **Step 1: Update Hexa and Hush CSS**

Replace only the Hush and Hexa frame-local colors and component surfaces.
Keep all screen dimensions, text, navigation, and data unchanged.

- [ ] **Step 2: Render the board at 1440 px**

Serve `design/mobile-0.4` locally, capture the full page with Chromium, and
replace `design-board.png`.

- [ ] **Step 3: Inspect the rendered image**

Verify the Hexa primary panel is dark but the page shell remains light; verify
Hush reads warm without lowering sender, time, or preview contrast.

- [ ] **Step 4: Commit**

```bash
git add design/mobile-0.4/index.html design/mobile-0.4/design-board.png
git commit -m "docs: sync Hexa and Hush visual direction"
```

### Task 5: Android Visual Evidence and Release Verification

**Files:**
- Modify: `design/mobile-0.4/screenshots/hexa-first-viewport.png`
- Modify: `design/mobile-0.4/screenshots/hush-first-viewport.png`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/ui/LivingSignalsVisualQaTest.kt`

**Interfaces:**
- Consumes: final Compose implementation.
- Produces: Android 16 screenshots and signed release APK.

- [ ] **Step 1: Capture Hush and Hexa**

Run the two targeted `LivingSignalsVisualQaTest` methods on `humhum_api36`, pull
the MediaStore images, and replace the two repository screenshots.

- [ ] **Step 2: Inspect 390 x 844 output**

Check clipping, contrast, system-bar avoidance, composer visibility, message
density, and bottom navigation separation.

- [ ] **Step 3: Run complete verification**

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew testDebugUnitTest lintDebug connectedDebugAndroidTest assembleRelease
```

Expected: all tasks pass and `app/build/outputs/apk/release/app-release.apk`
verifies with APK Signature Scheme v2 and v3.

- [ ] **Step 4: Commit the evidence**

```bash
git add design/mobile-0.4/screenshots/hexa-first-viewport.png \
  design/mobile-0.4/screenshots/hush-first-viewport.png \
  android/app/src/androidTest/java/com/humhum/mobile/ui/LivingSignalsVisualQaTest.kt
git commit -m "test(android): refresh role visual evidence"
```
