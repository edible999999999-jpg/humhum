# HUMHUM Anywhere Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an invite-only cross-network Android beta that can read HUMHUM session summaries, inspect recent conversation, resolve approvals, and send short follow-up instructions while the Mac and phone are on unrelated networks.

**Architecture:** Preserve LAN HTTPS as the fastest path. During pairing, provision two independent opaque relay channels: a desktop-published downlink and an Android-published uplink. Payloads are AES-256-GCM encrypted on devices with channel, direction, sequence, request id, and expiry bound as authenticated data; the relay stores only bounded ciphertext and credentials digests.

**Tech Stack:** Rust/Tauri, Java Android, Node.js `node:http` and `node:sqlite`, AES-256-GCM, HTTPS long polling, Vitest, Node test runner, Cargo tests, Gradle/JUnit.

## Global Constraints

- Default access is read-only; control actions require the existing control scope.
- Relay plaintext never includes session content, commands, approval details, device tokens, or encryption keys.
- Maximum encrypted envelope is 64 KiB, maximum 128 messages per channel, retention 24 hours for beta.
- No images, audio, video, project files, repository contents, or arbitrary shell RPC in the beta.
- Every action has an opaque request id, expiration, strict schema, and at-most-once desktop execution.
- Revoking one Android device deletes both relay channels and invalidates its local bridge token.
- Existing LAN, Tailnet, wake-only v1 pairing, and mobile web behavior remain compatible.

---

### Task 1: Invite-Gated Bounded Relay

**Files:**
- Modify: `relay/src/server.mjs`
- Modify: `relay/src/store.mjs`
- Modify: `relay/test/relay.test.mjs`
- Modify: `relay/README.md`

- [ ] Add failing tests for invite-gated channel creation, 64 KiB opaque envelopes, existing idempotency, 128-message retention, and credential-free errors.
- [ ] Run `node --test relay/test/*.test.mjs` and verify the new tests fail for missing invite and size behavior.
- [ ] Add constant-time invite verification, startup validation, bounded request parsing, and health capacity counters without exposing channel ids or credentials.
- [ ] Run relay tests and verify all pass.
- [ ] Commit the relay boundary.

### Task 2: Bidirectional Pairing Material

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/mobile_relay.rs`
- Modify: `src-tauri/src/mobile_bridge.rs`
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `android/app/src/main/java/com/humhum/mobile/Models.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/ConnectionStore.java`
- Modify tests beside each component.

- [ ] Add failing Rust, frontend, and Android tests for v2 pairing with independent downlink/uplink credentials, invite configuration, migration from v1, and secret-free status.
- [ ] Verify failures with targeted Cargo, Vitest, and Gradle commands.
- [ ] Provision two channels transactionally and return only the role-specific credentials to Android.
- [ ] Persist desktop and Android material with owner-only/local-private storage and remove both channels on revoke.
- [ ] Add a compact Hexa "Anywhere 内测" configuration using relay URL and invite code; never render stored credentials.
- [ ] Run targeted tests and commit.

### Task 3: Shared Anywhere Envelope Protocol

**Files:**
- Create: `src-tauri/src/anywhere_crypto.rs`
- Create: `android/app/src/main/java/com/humhum/mobile/AnywhereEnvelope.java`
- Create: `android/app/src/main/java/com/humhum/mobile/AnywhereEnvelopeCipher.java`
- Create matching Rust and Android tests.

- [ ] Add shared known-vector tests for AES-256-GCM encryption/decryption and rejection of wrong direction, channel, sequence, expiry, duplicate request id, malformed JSON, and oversized plaintext.
- [ ] Verify both suites fail before implementation.
- [ ] Implement the versioned strict envelope using platform crypto libraries.
- [ ] Verify matching vectors on Rust and Android and commit.

### Task 4: Desktop Snapshot Publisher And Command Consumer

**Files:**
- Modify: `src-tauri/src/mobile_relay.rs`
- Modify: `src-tauri/src/mobile_bridge.rs`
- Add focused tests in both modules.

- [ ] Add failing tests for scoped snapshot publication, uplink long polling, read/control authorization, duplicate suppression, expiration, bounded responses, and revoke/stop barriers.
- [ ] Extract existing mobile session/conversation/approval/message operations into transport-neutral functions.
- [ ] Publish encrypted scoped snapshots after visible cursor changes and encrypted request results after command execution.
- [ ] Poll each device uplink with bounded retry and execute an accepted request at most once.
- [ ] Run Rust tests and commit.

### Task 5: Android Automatic Anywhere Fallback

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/AnywhereRelayClient.java`
- Create: `android/app/src/main/java/com/humhum/mobile/MobileTransport.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AgentMonitorService.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/ConnectionStore.java`
- Add focused JUnit tests.

- [ ] Add failing tests for direct-first routing, timeout fallback, snapshot parsing, request/response correlation, retry without duplicate execution, offline display, and no fallback on certificate/authentication errors.
- [ ] Implement direct LAN transport plus encrypted relay transport behind one interface.
- [ ] Keep the last decrypted snapshot only in Android encrypted local storage and show `Anywhere 已连接` when relay is active.
- [ ] Route conversation, approvals, and short follow-ups through relay when direct access is unavailable.
- [ ] Run Android tests and build the release APK; commit.

### Task 6: Capacity, Deployment, And 5G Evidence

**Files:**
- Create: `relay/test/load.mjs`
- Create: `relay/docker-compose.yml`
- Modify: `docs/android-install.md`
- Modify: `README.md`

- [ ] Add a deterministic load test for 30 users, 60 idle long polls, 15 active publishers, envelope bounds, memory, latency, and cleanup.
- [ ] Add production Docker/HTTPS documentation, SQLite volume, backups, invite rotation, health checks, and log redaction.
- [ ] Run all frontend, relay, Rust, and Android tests plus production builds.
- [ ] Deploy to the supplied 2-core/2-GB host without embedding server secrets in git.
- [ ] Pair a clean Android install, disable Wi-Fi, and record successful 5G session refresh, approval, and follow-up evidence.
- [ ] Push the branch and publish clearly labeled beta artifacts only after the 5G evidence passes.

