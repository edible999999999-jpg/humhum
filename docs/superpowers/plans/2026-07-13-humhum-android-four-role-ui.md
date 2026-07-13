# HUMHUM Android Four-Role UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mascot-led four-role Android interface that matches the desktop HUMHUM product language without weakening the existing mobile bridge.

**Architecture:** Keep the native single-Activity application and introduce a pure-Java `MobileRoleDashboard` model for role metadata and Humi session interpretation. Refactor the Activity layout into a weighted scroll area plus persistent bottom navigation, while retaining existing Hexa controls and network paths.

**Tech Stack:** Android platform Views, Java 17, XML resources, JUnit 4, Gradle Android plugin.

## Global Constraints

- Minimum Android version remains API 26 and target SDK remains 36.
- Pairing, certificate pinning, scope gating, token storage, and network routes do not change.
- Humi uses only authorized session data; Hype and Hush never invent unavailable mobile data.
- Four role tabs have minimum 56dp targets and selected state is not color-only.
- Existing conversation privacy and control behavior remains intact.

---

### Task 1: Role Model And Interpreted Humi Summary

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/MobileRoleDashboard.java`
- Create: `android/app/src/test/java/com/humhum/mobile/MobileRoleDashboardTest.java`

**Interfaces:**
- Consumes: `List<Models.Session>` from the existing mobile session response.
- Produces: `MobileRoleDashboard.Role`, `MobileRoleDashboard.Summary`, and `summarize(List<Models.Session>)`.

- [ ] **Step 1: Write failing tests** for the four stable role IDs and Humi summaries with empty, active, and attention-bearing session lists.
- [ ] **Step 2: Run** `./gradlew testDebugUnitTest --tests com.humhum.mobile.MobileRoleDashboardTest` and verify the missing class causes failure.
- [ ] **Step 3: Implement** immutable role metadata and deterministic summary copy derived only from session counts and attention flags.
- [ ] **Step 4: Re-run the focused test** and verify it passes.

### Task 2: Mascot Assets And Four-Tab Layout Contract

**Files:**
- Create: `android/app/src/main/res/drawable-nodpi/mascot_humi.png`
- Create: `android/app/src/main/res/drawable-nodpi/mascot_hype.png`
- Create: `android/app/src/main/res/drawable-nodpi/mascot_hush.png`
- Create: `android/app/src/main/res/drawable-nodpi/mascot_hexa.png`
- Modify: `android/app/src/main/res/values/colors.xml`
- Create: `android/app/src/main/res/drawable/role_tab_selected.xml`
- Create: `android/app/src/main/res/drawable/role_tab_idle.xml`
- Modify: `android/app/src/main/res/layout/activity_main.xml`
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`

**Interfaces:**
- Consumes: role IDs `humi`, `hype`, `hush`, and `hexa` from Task 1.
- Produces: `roleNavigation`, four role tab IDs, `roleHero`, `roleContent`, and `hexaDetailContent` view IDs.

- [ ] **Step 1: Add failing XML contract tests** asserting four 56dp tabs, four mascot drawables, and bottom navigation outside the scroll area.
- [ ] **Step 2: Run the focused contract test** and verify it fails on missing views.
- [ ] **Step 3: Add role color tokens, provided image assets, selected/idle tab surfaces, and the new root layout.** Keep all existing pairing and Hexa control IDs stable.
- [ ] **Step 4: Re-run the contract test** and verify it passes.

### Task 3: Role Rendering And Navigation

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`

**Interfaces:**
- Consumes: `MobileRoleDashboard.Role`, summary output, and Task 2 view IDs.
- Produces: role selection handlers, selected-state rendering, and role-specific interpreted content.

- [ ] **Step 1: Add failing source-contract assertions** for default Humi selection, four tab listeners, and role restoration through `onSaveInstanceState`.
- [ ] **Step 2: Run the focused test** and verify it fails on missing role behavior.
- [ ] **Step 3: Implement tab binding and role rendering.** Humi renders summary cards, Hype/Hush render honest capability states, and Hexa reveals existing monitor/session controls.
- [ ] **Step 4: Re-run focused tests** and the full Android JVM suite.

### Task 4: Build And Visual Verification

**Files:**
- Modify only files required by verified build or layout defects discovered in this task.

**Interfaces:**
- Consumes: completed four-role Android UI.
- Produces: installable debug APK and verification evidence.

- [ ] **Step 1: Run** `./gradlew testDebugUnitTest assembleDebug` and require a successful build.
- [ ] **Step 2: Inspect** the APK with `aapt dump badging` and `unzip -l` to confirm package metadata and all four mascot resources.
- [ ] **Step 3: Capture the UI** on an emulator or device if `adb devices` reports one; otherwise record that real-device screenshot verification remains unavailable.
- [ ] **Step 4: Run** `git diff --check` and review the final diff for unrelated changes, raw paths, fake data, and clipped fixed heights.

