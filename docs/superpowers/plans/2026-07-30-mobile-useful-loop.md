# HUMHUM Mobile Useful Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android Hush show authorized local WeChat messages, make Hexa foreground the latest controllable Agent conversation, make follow-up delivery truthful and usable, and replace decorative mascot stickers with an information-first mobile shell.

**Architecture:** Reuse the existing separately authorized `personal_context` capability and encrypted LAN/Anywhere transports. Desktop projects a bounded, redacted Hush inbox from `HushStore`; Android parses and renders it. Agent follow-ups continue through the intervention queue, but delivery failures remain visible instead of being reported as success. Compose owns the visible UI; the hidden legacy XML remains compatibility-only.

**Tech Stack:** Rust, Tauri v2, Java 17, Kotlin, Jetpack Compose, JUnit 4, Android instrumentation tests.

## Global Constraints

- Only devices paired with `personal_context: true` may receive Hush projections.
- Mobile Hush receives at most 8 newest items with sender, platform, bounded text preview, timestamp, and importance; no raw message object, source identifier, database path, credential, or attachment path.
- Relay continues to carry authenticated encrypted envelopes only.
- Read-only pairings cannot approve actions or send Agent follow-ups.
- Follow-up UI clears only after the desktop reports `delivered`; queued or failed work remains visible with a reader-facing status.
- Primary role screens and bottom navigation do not render mascot PNGs.
- Hush and Hexa prioritize useful content over explanatory or decorative cards.

---

### Task 1: Authorized Mobile Hush Projection

**Files:**
- Modify: `src-tauri/src/mobile_personal_context.rs`
- Test: `src-tauri/src/mobile_personal_context.rs`

**Interfaces:**
- Consumes: `HushStore::summary() -> HushInboxSummary`.
- Produces: `MobilePersonalContext.inbox: Vec<MobileInboxItem>` sorted newest first and bounded to 8.

- [x] **Step 1: Replace the privacy regression test with tests that require bounded, path-redacted Hush projection and exclude `raw` fields.**
- [x] **Step 2: Run `cargo test mobile_personal_context::tests --lib` and verify failure because production currently returns an empty inbox.**
- [x] **Step 3: Populate `MobileContextSources.inbox` only inside the already authorized personal-context projection, sanitize every field, sort by timestamp, and cap at 8.**
- [x] **Step 4: Re-run the focused Rust tests and require all to pass.**

### Task 2: Truthful Agent Follow-Up

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/mobile_bridge.rs`
- Modify: `android/app/src/main/java/com/humhum/mobile/app/HumHumUiState.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/app/HumHumAction.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/app/HumHumViewModel.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Test: `src-tauri/src/commands.rs`
- Test: `android/app/src/test/java/com/humhum/mobile/app/HumHumViewModelTest.kt`

**Interfaces:**
- Consumes: existing `CodexSendReceipt.status`.
- Produces: explicit `delivered`, `queued`, or failure UI state for the selected session.

- [x] **Step 1: Add failing Rust and Android reducer tests proving a transport failure is not surfaced as delivered and a queued receipt does not clear the draft.**
- [x] **Step 2: Run the focused tests and confirm expected failures.**
- [x] **Step 3: Preserve queue retry semantics while returning a truthful receipt; carry the receipt status into Android actions and visible session state.**
- [x] **Step 4: Re-run focused tests and require all to pass.**

### Task 3: Information-First Hush And Hexa

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/RoomComponents.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/components/RoleNavigation.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HushRoomScreen.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HexaScreen.kt`
- Modify: `android/app/src/main/java/com/humhum/mobile/ui/HumHumApp.kt`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/ui/HumHumAppTest.kt`
- Test: `android/app/src/androidTest/java/com/humhum/mobile/ui/LivingSignalsVisualQaTest.kt`

**Interfaces:**
- Consumes: `HumHumUiState.personalContext.inbox`, `sessions`, `conversation`, and follow-up status.
- Produces: icon navigation, real Hush rows, prioritized Hexa sessions, conversation detail, and a persistent follow-up composer.

- [x] **Step 1: Add failing Compose tests requiring no mascot semantics in room headers/navigation, real WeChat text in Hush, and a visible Hexa follow-up composer for the primary session.**
- [x] **Step 2: Run connected tests and confirm the new assertions fail against the sticker-led UI.**
- [x] **Step 3: Replace mascot images with Material role icons, remove poster-style room introductions, group Hush by conversation, and place the most recent controllable or attention session first in Hexa.**
- [x] **Step 4: Capture 390x844 Hush and Hexa screenshots and inspect them for clipping, overlap, empty first viewport, and decorative-image dominance.**

### Task 4: Build, Install, And Release Evidence

**Files:**
- Modify: `android/app/build.gradle.kts`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/android-install.md`

**Interfaces:**
- Consumes: verified desktop and Android source.
- Produces: signed macOS DMG, signed Xiaomi-installable APK/ZIP, checksums, and a GitHub prerelease.

- [x] **Step 1: Run focused Rust, JVM, and connected Compose tests.**
- [x] **Step 2: Run complete Rust, frontend, relay, Android JVM, lint, connected, and release build checks.**
- [x] **Step 3: Install the release APK on the API 36 emulator, cold launch it, and capture pairing/Hush/Hexa evidence.**
- [ ] **Step 4: Build and replace the local Mac app, verify Hush projection and Agent follow-up routes, then publish matching Mac and Android assets with direct README links.**
