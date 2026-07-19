# Android Room Background Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Android's mascot-tab shell with a functional icon navigation, Mac-identical room backgrounds, and a deliberate Noto Sans SC type hierarchy.

**Architecture:** A new `RoleRoomBackground` Compose boundary maps each role to an Android copy of the exact Mac background asset and renders it behind the selected room. `RoleNavigation` becomes a fixed four-icon control with no mascot dependency, while `RoomIntro` becomes typography-only. The existing data, state, pairing, privacy, and role screen implementations remain intact.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, Android drawable/font resources, JUnit 4, Android Compose UI testing, Gradle 9.

## Global Constraints

- Use the exact four Mac room files named in the design spec.
- No visible Compose navigation or room intro may use the old mascot resources.
- Keep exactly four fixed role destinations with 48dp minimum touch targets.
- Use Noto Sans SC for Chinese and Latin product text.
- Letter spacing is zero and platform font padding is disabled.
- User-facing body text is at least 15sp.
- Preserve all existing role data and privacy boundaries.
- Do not edit the hidden legacy XML compatibility UI in this change.

---

### Task 1: Lock Shared Visual Assets And Font Provenance

**Files:**
- Create: `android/app/src/test/java/com/humhum/mobile/ui/RoomVisualAssetContractTest.java`
- Create: `android/app/src/main/res/drawable-nodpi/room_humi.webp`
- Create: `android/app/src/main/res/drawable-nodpi/room_hype.webp`
- Create: `android/app/src/main/res/drawable-nodpi/room_hush.webp`
- Create: `android/app/src/main/res/drawable-nodpi/room_hexa.png`
- Create: `android/app/src/main/res/font/noto_sans_sc.ttf`
- Create: `android/app/src/main/res/raw/noto_sans_sc_ofl.txt`

**Interfaces:**
- Consumes: Mac room assets under `public/mascots/hub-backgrounds/`.
- Produces: Android resources `R.drawable.room_humi`, `room_hype`, `room_hush`, `room_hexa`, and `R.font.noto_sans_sc`.

- [ ] **Step 1: Write the failing asset contract**

```java
package com.humhum.mobile.ui;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;

public class RoomVisualAssetContractTest {
    @Test
    public void androidRoomBackgroundsExactlyMatchMacAssets() throws Exception {
        assertSameFile(
                "../../public/mascots/hub-backgrounds/humi-room.webp",
                "src/main/res/drawable-nodpi/room_humi.webp");
        assertSameFile(
                "../../public/mascots/hub-backgrounds/hype-room.webp",
                "src/main/res/drawable-nodpi/room_hype.webp");
        assertSameFile(
                "../../public/mascots/hub-backgrounds/hush-room.webp",
                "src/main/res/drawable-nodpi/room_hush.webp");
        assertSameFile(
                "../../public/mascots/hub-backgrounds/hexa-room-v2.png",
                "src/main/res/drawable-nodpi/room_hexa.png");
    }

    @Test
    public void bundledChineseFontKeepsItsOflLicense() throws Exception {
        Path font = Path.of("src/main/res/font/noto_sans_sc.ttf");
        Path license = Path.of("src/main/res/raw/noto_sans_sc_ofl.txt");
        assertTrue(Files.isRegularFile(font));
        assertTrue(Files.size(font) > 10_000_000L);
        String licenseText = Files.readString(license, StandardCharsets.UTF_8);
        assertTrue(licenseText.contains("SIL OPEN FONT LICENSE"));
    }

    private static void assertSameFile(String shared, String android) throws Exception {
        assertEquals(-1L, Files.mismatch(Path.of(shared), Path.of(android)));
    }
}
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew testDebugUnitTest --tests com.humhum.mobile.ui.RoomVisualAssetContractTest
```

Expected: FAIL because the four room resources and the bundled font do not exist.

- [ ] **Step 3: Copy the exact Mac assets and download the official font**

Run:

```bash
mkdir -p android/app/src/main/res/font android/app/src/main/res/raw
cp public/mascots/hub-backgrounds/humi-room.webp \
  android/app/src/main/res/drawable-nodpi/room_humi.webp
cp public/mascots/hub-backgrounds/hype-room.webp \
  android/app/src/main/res/drawable-nodpi/room_hype.webp
cp public/mascots/hub-backgrounds/hush-room.webp \
  android/app/src/main/res/drawable-nodpi/room_hush.webp
cp public/mascots/hub-backgrounds/hexa-room-v2.png \
  android/app/src/main/res/drawable-nodpi/room_hexa.png
curl -fsSL \
  'https://raw.githubusercontent.com/google/fonts/389b770410cc0b7c21c85673bfa2077420fe7f65/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf' \
  -o android/app/src/main/res/font/noto_sans_sc.ttf
curl -fsSL \
  'https://raw.githubusercontent.com/google/fonts/389b770410cc0b7c21c85673bfa2077420fe7f65/ofl/notosanssc/OFL.txt' \
  -o android/app/src/main/res/raw/noto_sans_sc_ofl.txt
```

- [ ] **Step 4: Run the contract and verify GREEN**

Run the Task 1 Gradle command again.

Expected: `RoomVisualAssetContractTest` passes.

- [ ] **Step 5: Commit the asset boundary**

```bash
git add android/app/src/test/java/com/humhum/mobile/ui/RoomVisualAssetContractTest.java \
  android/app/src/main/res/drawable-nodpi/room_humi.webp \
  android/app/src/main/res/drawable-nodpi/room_hype.webp \
  android/app/src/main/res/drawable-nodpi/room_hush.webp \
  android/app/src/main/res/drawable-nodpi/room_hexa.png \
  android/app/src/main/res/font/noto_sans_sc.ttf \
  android/app/src/main/res/raw/noto_sans_sc_ofl.txt
git commit -m "assets(android): share Mac room backgrounds and font"
```

---

### Task 2: Replace Mascot Tabs With Functional Navigation

**Files:**
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/components/RoleNavigation.kt`

**Interfaces:**
- Consumes: `MobileRoleDashboard.Role`, `paletteFor(role)`, and `onSelect(role)`.
- Produces: `RoleNavigation` with four `role-navigation-icon` nodes and unchanged `role-destination` semantics.

- [ ] **Step 1: Write the failing Compose navigation tests**

Add these assertions to `humiFirstViewportKeepsFourRoomsAndSettingsSeparate`:

```kotlin
compose.onAllNodesWithTag("role-destination", useUnmergedTree = true)
    .assertCountEquals(4)
compose.onAllNodesWithTag("role-navigation-icon", useUnmergedTree = true)
    .assertCountEquals(4)
compose.onAllNodesWithTag("role-navigation-mascot", useUnmergedTree = true)
    .assertCountEquals(0)
```

Add a stable-bounds test:

```kotlin
@Test
fun selectingARoomDoesNotMoveNavigationDestinations() {
    var state by mutableStateOf(connectedState())
    compose.setContent {
        HumHumApp(
            state = state,
            callbacks = HumHumCallbacks(onSelectRole = { state = state.copy(selectedRole = it) }),
        )
    }
    val before = compose.onAllNodesWithTag("role-destination", useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map { it.boundsInRoot }

    compose.onNodeWithText("Hush").performClick()

    val after = compose.onAllNodesWithTag("role-destination", useUnmergedTree = true)
        .fetchSemanticsNodes()
        .map { it.boundsInRoot }
    assertEquals(before, after)
}
```

- [ ] **Step 2: Run the Compose test and verify RED**

Run:

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew connectedDebugAndroidTest \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.humhum.mobile.ui.HumHumAppTest'
```

Expected: FAIL because no `role-navigation-icon` nodes exist.

- [ ] **Step 3: Implement the icon navigation**

Replace `RoleDestination` content with a fixed marker, icon, and label. Map icons as:

```kotlin
private fun iconFor(role: MobileRoleDashboard.Role): ImageVector = when (role) {
    MobileRoleDashboard.Role.HUMI -> Icons.Outlined.ChatBubbleOutline
    MobileRoleDashboard.Role.HYPE -> Icons.Outlined.AutoStories
    MobileRoleDashboard.Role.HUSH -> Icons.Outlined.MarkEmailUnread
    MobileRoleDashboard.Role.HEXA -> Icons.Outlined.AccountTree
}
```

Use this destination body:

```kotlin
Column(
    modifier = modifier
        .height(60.dp)
        .clickable(role = Role.Tab, onClick = onClick)
        .semantics(mergeDescendants = true) {
            this.selected = selected
            contentDescription = "${role.displayName()}：${role.purpose()}"
        }
        .testTag("role-destination")
        .padding(horizontal = 4.dp, vertical = 4.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
) {
    Box(
        Modifier
            .size(width = 24.dp, height = 2.dp)
            .background(if (selected) palette.accent else Color.Transparent),
    )
    Icon(
        imageVector = iconFor(role),
        contentDescription = null,
        tint = if (selected) palette.accent else Muted,
        modifier = Modifier.size(23.dp).testTag("role-navigation-icon"),
    )
    Text(
        text = role.displayName(),
        style = MaterialTheme.typography.labelMedium,
        color = if (selected) palette.accent else Muted,
        maxLines = 1,
    )
}
```

Render the row inside a `Surface` with `shadowElevation = 8.dp`, no surrounding
border, no selected fill, and a fixed 68dp height.

- [ ] **Step 4: Run the Compose test and verify GREEN**

Run the Task 2 Gradle command again.

Expected: all `HumHumAppTest` tests pass and destination bounds remain identical.

- [ ] **Step 5: Commit the navigation**

```bash
git add android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt \
  android/app/src/main/java/com/humhum/mobile/ui/components/RoleNavigation.kt
git commit -m "feat(android): replace mascot tabs with room icons"
```

---

### Task 3: Put Character Art Into The Room Background

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/ui/components/RoleRoomBackground.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HumHumApp.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/RoomComponents.kt`
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`
- Delete: `android/app/src/main/java/com/humhum/mobile/ui/components/RoleMascot.kt`

**Interfaces:**
- Produces: `RoleRoomBackground(role, modifier, content)` and `roomBackgroundFor(role)`.
- Consumes: the four drawable resources from Task 1.

- [ ] **Step 1: Write failing room-background tests**

Add:

```kotlin
@Test
fun everyRoomUsesOneDecorativeBackgroundAndNoIntroMascot() {
    var state by mutableStateOf(connectedState())
    compose.setContent { HumHumApp(state = state, callbacks = HumHumCallbacks()) }

    MobileRoleDashboard.Role.entries.forEach { role ->
        compose.runOnIdle { state = state.copy(selectedRole = role) }
        compose.onAllNodesWithTag("room-background", useUnmergedTree = true)
            .assertCountEquals(1)
        compose.onAllNodesWithTag("room-intro-mascot", useUnmergedTree = true)
            .assertCountEquals(0)
    }
}
```

- [ ] **Step 2: Run the room test and verify RED**

Run the Task 2 Gradle command.

Expected: FAIL because `room-background` does not exist.

- [ ] **Step 3: Implement `RoleRoomBackground`**

```kotlin
package com.humhum.mobile.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R

@Composable
fun RoleRoomBackground(
    role: MobileRoleDashboard.Role,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier.fillMaxSize()) {
        Image(
            painter = painterResource(roomBackgroundFor(role)),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            alignment = if (role == MobileRoleDashboard.Role.HUSH) {
                Alignment.CenterEnd
            } else {
                Alignment.Center
            },
            modifier = Modifier
                .fillMaxSize()
                .alpha(roomBackgroundAlpha(role))
                .testTag("room-background"),
        )
        content()
    }
}

@DrawableRes
fun roomBackgroundFor(role: MobileRoleDashboard.Role): Int = when (role) {
    MobileRoleDashboard.Role.HUMI -> R.drawable.room_humi
    MobileRoleDashboard.Role.HYPE -> R.drawable.room_hype
    MobileRoleDashboard.Role.HUSH -> R.drawable.room_hush
    MobileRoleDashboard.Role.HEXA -> R.drawable.room_hexa
}

private fun roomBackgroundAlpha(role: MobileRoleDashboard.Role): Float = when (role) {
    MobileRoleDashboard.Role.HUMI -> 0.78f
    MobileRoleDashboard.Role.HYPE -> 0.72f
    MobileRoleDashboard.Role.HUSH -> 0.76f
    MobileRoleDashboard.Role.HEXA -> 0.68f
}
```

- [ ] **Step 4: Wire the fixed background around selected content**

In `CompanionScaffold`, apply Scaffold padding once and render:

```kotlin
RoleRoomBackground(
    role = state.selectedRole,
    modifier = Modifier.padding(padding),
) {
    when (state.selectedRole) {
        MobileRoleDashboard.Role.HUMI ->
            HumiRoomScreen(state, callbacks, Modifier.fillMaxSize())
        MobileRoleDashboard.Role.HYPE ->
            HypeRoomScreen(state, Modifier.fillMaxSize())
        MobileRoleDashboard.Role.HUSH ->
            HushRoomScreen(state, Modifier.fillMaxSize())
        MobileRoleDashboard.Role.HEXA ->
            HexaScreen(state, callbacks, Modifier.fillMaxSize())
    }
}
```

Change `RoomIntro` from a `Row` to a typography-only `Column`:

```kotlin
Column(
    modifier = modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 16.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp),
) {
    Text(
        text = "${role.displayName()} · ${role.purpose()}",
        style = MaterialTheme.typography.labelLarge,
        color = palette.accent,
    )
    Text(
        text = title,
        style = MaterialTheme.typography.headlineMedium,
        color = Ink,
        maxLines = 3,
    )
    Text(
        text = summary,
        style = MaterialTheme.typography.bodyMedium,
        color = Muted,
        maxLines = 3,
    )
}
```

Remove visible Compose `RoleMascot` imports and delete the now-unused component.
Keep the old drawable resources because the hidden compatibility layout still binds them.

- [ ] **Step 5: Run the room test and verify GREEN**

Run the Task 2 Gradle command again.

Expected: one background per room, zero intro mascot nodes, and all tests pass.

- [ ] **Step 6: Commit the room composition**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/components/RoleRoomBackground.kt \
  android/app/src/main/java/com/humhum/mobile/ui/HumHumApp.kt \
  android/app/src/main/java/com/humhum/mobile/ui/RoomComponents.kt \
  android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt
git rm android/app/src/main/java/com/humhum/mobile/ui/components/RoleMascot.kt
git commit -m "feat(android): place characters in room backgrounds"
```

---

### Task 4: Apply The Deliberate CJK Type System

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/theme/HumHumTheme.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HumiRoomScreen.kt`
- Modify: `android/app/src/test/java/com/humhum/mobile/ui/theme/HumHumThemeTest.kt`

**Interfaces:**
- Produces: `HumHumFontFamily` and `HeadlineNumberStyle`.
- Consumes: `R.font.noto_sans_sc` from Task 1.

- [ ] **Step 1: Write the failing typography contract**

Add:

```kotlin
@Test
fun mobileTypographyUsesTheDeclaredCjkHierarchy() {
    assertTrue(HumHumTypography.headlineMedium.fontSize.value == 22f)
    assertTrue(HumHumTypography.titleMedium.fontSize.value == 16f)
    assertTrue(HumHumTypography.bodyMedium.fontSize.value == 15f)
    assertTrue(HumHumTypography.labelMedium.fontSize.value == 12f)
    assertTrue(HumHumTypography.bodyMedium.letterSpacing.value == 0f)
    assertTrue(HeadlineNumberStyle.fontFeatureSettings == "tnum")
}
```

Make `HumHumTypography` internal instead of private so the unit test can inspect it.

- [ ] **Step 2: Run the theme test and verify RED**

Run:

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew testDebugUnitTest --tests com.humhum.mobile.ui.theme.HumHumThemeTest
```

Expected: FAIL because the current sizes and `HeadlineNumberStyle` do not match.

- [ ] **Step 3: Implement the font family and exact hierarchy**

Define:

```kotlin
val HumHumFontFamily = FontFamily(
    Font(R.font.noto_sans_sc, FontWeight.Normal),
    Font(R.font.noto_sans_sc, FontWeight.Medium),
    Font(R.font.noto_sans_sc, FontWeight.SemiBold),
)

private val NoExtraFontPadding = PlatformTextStyle(includeFontPadding = false)

internal val HeadlineNumberStyle = TextStyle(
    fontFamily = HumHumFontFamily,
    fontWeight = FontWeight.SemiBold,
    fontSize = 17.sp,
    lineHeight = 22.sp,
    letterSpacing = 0.sp,
    fontFeatureSettings = "tnum",
    platformStyle = NoExtraFontPadding,
)
```

Set Material styles to the spec table:

```kotlin
displaySmall = productTextStyle(FontWeight.SemiBold, 30.sp, 38.sp)
headlineMedium = productTextStyle(FontWeight.SemiBold, 22.sp, 30.sp)
titleLarge = productTextStyle(FontWeight.SemiBold, 17.sp, 24.sp)
titleMedium = productTextStyle(FontWeight.Medium, 16.sp, 23.sp)
bodyLarge = productTextStyle(FontWeight.Normal, 15.sp, 23.sp)
bodyMedium = productTextStyle(FontWeight.Normal, 15.sp, 23.sp)
labelLarge = productTextStyle(FontWeight.Medium, 13.sp, 19.sp)
labelMedium = productTextStyle(FontWeight.Medium, 12.sp, 16.sp)
```

Implement `productTextStyle` with `HumHumFontFamily`, zero letter spacing, and
`NoExtraFontPadding`. Use `HeadlineNumberStyle` for `HealthMetricValue`.

- [ ] **Step 4: Run the theme and Compose tests and verify GREEN**

Run the Task 4 unit command, then the Task 2 connected command.

Expected: both commands pass.

- [ ] **Step 5: Commit the typography**

```bash
git add android/app/src/main/java/com/humhum/mobile/ui/theme/HumHumTheme.kt \
  android/app/src/main/java/com/humhum/mobile/ui/HumiRoomScreen.kt \
  android/app/src/test/java/com/humhum/mobile/ui/theme/HumHumThemeTest.kt
git commit -m "style(android): apply deliberate Chinese typography"
```

---

### Task 5: Verify Build, Layout, And Four Room Captures

**Files:**
- Modify: `android/app/src/androidTest/java/com/humhum/mobile/ui/LivingSignalsVisualQaTest.kt`
- Output: `android/app/build/visual-qa/living-signals-first-viewport.png`
- Output: `android/app/build/visual-qa/hype-first-viewport.png`
- Output: `android/app/build/visual-qa/hush-first-viewport.png`
- Output: `android/app/build/visual-qa/hexa-first-viewport.png`

**Interfaces:**
- Consumes: completed UI from Tasks 1-4.
- Produces: fresh emulator evidence for the four role rooms.

- [ ] **Step 1: Rename the visual test class and Humi capture**

Rename `LivingSignalsVisualQaTest` to `CharacterRoomsVisualQaTest` and change the
Humi filename to `humi-first-viewport`. Keep the existing representative personal
context and all four role captures.

- [ ] **Step 2: Run the full Android verification**

Run:

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew testDebugUnitTest assembleDebug connectedDebugAndroidTest
```

Expected: all unit tests, APK assembly, and connected Compose tests pass.

- [ ] **Step 3: Capture the four rooms on the 390x844 emulator viewport**

Install the debug and test APKs, run `CharacterRoomsVisualQaTest`, and copy the four
PNG files from app-private storage to `android/app/build/visual-qa/`.

Expected evidence:

- four icons and labels in the bottom navigation;
- no mascot sticker in navigation or intro;
- Mac-identical room artwork visible behind content;
- Hush character retained on the right;
- settings and connection state fully visible;
- Chinese text has consistent shapes, weights, and line heights;
- no clipping or overlap.

- [ ] **Step 4: Inspect all four PNGs**

Use the local image viewer on each PNG at original resolution. If any foreground
text loses contrast, adjust only that role's background alpha in
`RoleRoomBackground.kt`, rerun the connected tests, and recapture all four files.

- [ ] **Step 5: Run repository-wide verification**

Run:

```bash
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: all frontend and Rust tests pass, the production frontend builds, and no
whitespace errors remain.

- [ ] **Step 6: Commit final visual evidence updates**

```bash
git add android/app/src/androidTest/java/com/humhum/mobile/ui/CharacterRoomsVisualQaTest.kt
git commit -m "test(android): verify room background navigation"
```
