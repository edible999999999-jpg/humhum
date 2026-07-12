# HUMHUM Push Registration Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add channel-bound push registration state, bounded automatic retry and truthful Android UI status without persisting FCM tokens.

**Architecture:** Pure policy/store classes define delays, failure classification and state copy. `PushRegistration` serializes generation-bound attempts on one scheduler, rechecks pairing before request and commit, and publishes only bounded state through app-private preferences.

**Tech Stack:** Java 17, Android SharedPreferences, ScheduledExecutorService, Firebase Messaging 25.1.0, JUnit 4.

## Global Constraints

- Never persist or display FCM tokens, relay credentials, channel IDs, HTTP bodies or session data.
- Retry only transient network, `429`, and `5xx` failures at 15/60/300 seconds.
- `401`, `404`, and `410` require a new pairing and never loop.
- Every attempt must match the current generation and relay channel before request and state commit.
- Missing Firebase configuration preserves the release's current no-network disabled behavior.

---

### Task 1: Pure Retry And State Contracts

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/PushRetryPolicy.java`
- Create: `android/app/src/main/java/com/humhum/mobile/PushStateStore.java`
- Create: `android/app/src/test/java/com/humhum/mobile/PushRetryPolicyTest.java`
- Create: `android/app/src/test/java/com/humhum/mobile/PushStateStoreTest.java`

- [x] Write failing tests for 15/60/300 capped delays, transient/permanent statuses, channel-bound states, corrupt-value fallback, clear behavior and user-facing copy.
- [x] Run focused tests and require missing-class compilation failures.
- [x] Implement the dependency-free policy and testable key/value store adapter without token fields.
- [x] Run focused and complete JVM tests, then commit `feat(android): model push registration reliability`.

### Task 2: Generation-Bound Registration Scheduler

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/PushRegistration.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/PushRegistrationTest.java`

- [x] Write failing tests for generation/channel commit gates and retry decisions after success, transient and permanent outcomes.
- [x] Run focused tests and require missing policy APIs.
- [x] Refactor registration through an injectable scheduler/transport coordinator; production uses one static scheduler and `WakeRelayClient`.
- [x] Re-read connection before every attempt and commit, cancel on disconnect, reset attempt count on token rotation/success, and persist only state/channel.
- [x] Run focused and complete JVM tests, then commit `feat(android): retry push registration safely`.

### Task 3: Paired-Screen Status And Runtime Evidence

**Files:**
- Modify: `android/app/src/main/res/layout/activity_main.xml`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan.

- [x] Add one stable push-status TextView under **后台可靠性**, bind only interpreted state copy and register/unregister the preference listener with Activity lifecycle.
- [x] Ensure disconnect cancels registration and clears push state before clearing connection state.
- [x] Run an injected fail-then-success coordinator test and a no-Firebase API 36 release cold launch; verify no registration network request and visible disabled copy.
- [x] Run all frontend, relay, Rust and Android tests plus release lint/build/signature/permission checks.
- [x] Update docs with verified retry/status evidence and the real Xiaomi account/AppID/AppKey/AppSecret blocker, commit `docs(push): verify registration recovery`, rebuild/relaunch desktop and keep the overall goal active.
