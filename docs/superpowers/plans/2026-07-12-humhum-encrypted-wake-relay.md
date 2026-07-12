# HUMHUM Encrypted Wake Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a self-hostable zero-knowledge wake relay that notifies the HUMHUM Android foreground monitor across networks while all session reads and controls remain on pinned private Mobile Bridge routes.

**Architecture:** A dependency-free Node/SQLite relay stores bounded ciphertext and credential digests. Rust encrypts minimal wake envelopes with a per-device AES-256-GCM key; Android long-polls, decrypts and then refreshes through the existing LAN/Tailnet protocol.

**Tech Stack:** Node 22+ built-ins, SQLite, Rust `aes-gcm`, Serde, Reqwest, Java 17 JCA, Android SDK 26-36, React/TypeScript.

## Global Constraints

- Relay never receives plaintext, encryption keys, session IDs, projects, scopes, device names, approvals or messages.
- Public relay URLs require HTTPS; only loopback HTTP is accepted for local tests.
- AES-256-GCM uses 32-byte keys, fresh 12-byte nonces and AAD `humhum-wake-v1:{channel}:{sequence}`.
- One channel retains at most 128 envelopes for 24 hours; each envelope is at most 4 KiB.
- Keep normal Mobile tokens digest-only and store relay secrets in a separate owner-only file.
- Add no Android permission, Firebase dependency, wake lock, exported component or analytics.
- Direct pinned-HTTPS event waits remain the fallback and all existing APK/signature/privacy gates remain green.

---

### Task 1: Opaque Self-Hosted Relay

**Files:**
- Create: `relay/package.json`
- Create: `relay/src/store.mjs`
- Create: `relay/src/server.mjs`
- Create: `relay/test/relay.test.mjs`
- Create: `relay/Dockerfile`
- Create: `relay/README.md`

**Interfaces:**
- `createRelayServer({databasePath, clock}) -> http.Server`.
- HTTP endpoints and limits exactly match the design spec.

- [x] **Step 1: Write failing `node:test` cases** for health, channel creation, publisher/subscriber credential separation, generic `401`, monotonic sequences, 20-second bounded long poll, 4-KiB/128-message limits, 24-hour expiry, deletion and no CORS.
- [x] **Step 2: Run** `node --test relay/test/relay.test.mjs`; expect missing modules.
- [x] **Step 3: Implement a prepared-statement SQLite store** that hashes credentials before insert and provides atomic sequence allocation, bounded cleanup and channel deletion.
- [x] **Step 4: Implement strict HTTP parsing, body/time/rate bounds and graceful shutdown**, then prove the database contains ciphertext/digests but no issued raw token.
- [x] **Step 5: Add a non-root Node 22 Docker image and concise self-host guide**, rerun tests and commit `feat(relay): add opaque wake mailbox`.

### Task 2: Shared Wake Envelope Cryptography

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/wake_crypto.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `android/app/src/main/java/com/humhum/mobile/WakeEnvelope.java`
- Create: `android/app/src/test/java/com/humhum/mobile/WakeEnvelopeTest.java`

**Interfaces:**
- Rust `encrypt_wake(key, channel, sequence, issued_at, nonce) -> WakeEnvelope`.
- Rust `decrypt_wake(...) -> WakeSignal` for vector verification.
- Java `WakeEnvelope.decrypt(keyHex, channel, expectedAfter, json, now) -> WakeSignal`.

- [x] **Step 1: Add one fixed key/channel/sequence/nonce/issued-at vector in Rust and Java tests** plus wrong-key, changed-AAD, ciphertext-tamper, replay, unknown-field and stale-time rejection.
- [x] **Step 2: Run focused Rust and JVM tests**, requiring missing crypto APIs.
- [x] **Step 3: Implement strict base64url AES-256-GCM codecs** with exact JSON shapes and no secret-bearing debug output.
- [x] **Step 4: Require both languages to produce/consume the same fixed ciphertext**, run focused tests and commit `feat(mobile): add interoperable wake encryption`.

### Task 3: Relay Configuration And Per-Device Secrets

**Files:**
- Modify: `src-tauri/src/config.rs`
- Create: `src-tauri/src/mobile_relay.rs`
- Modify: `src-tauri/src/mobile_bridge.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- `MobileRelayConfig { enabled, base_url }` defaults disabled.
- `MobileRelaySecretStore` persists channel, key and publisher credential by opaque device ID in `~/.humhum/mobile-relay-secrets.json` mode `0600`.
- Pair response adds optional `wake_relay` bundle with subscriber-only material.

- [x] **Step 1: Write failing Rust tests** for URL policy, legacy config migration, secret-file permissions/isolation, no secret status serialization and pairing response separation.
- [x] **Step 2: Implement strict config/secret storage and channel registration**, failing relay-selected pairing closed while preserving ordinary pairing.
- [x] **Step 3: Implement one/all/self revoke remote deletion with local-first cleanup and bounded timeout**, run Rust tests and commit `feat(mobile): provision encrypted wake channels`.

### Task 4: Desktop Wake Publisher

**Files:**
- Modify: `src-tauri/src/mobile_relay.rs`
- Modify: `src-tauri/src/mobile_bridge.rs`

**Interfaces:**
- One publisher task coalesces newest per-device wake, allocates sequence and uploads encrypted envelopes.
- Status is credential-free `disabled | connected | retrying | errored`.

- [x] **Step 1: Write failing clock/transport tests** for changed-cursor-only publication, one-second coalescing, 5/15/30/60 backoff, newest-only retry and shutdown/revocation cancellation.
- [x] **Step 2: Implement publisher state machine and internal change notification**, then run all Rust/relay tests.
- [x] **Step 3: Commit** `feat(mobile): publish encrypted wake signals`.

### Task 5: Android Relay Subscription And Hexa Configuration

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/ConnectionStore.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/Models.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/AgentMonitorService.java`
- Modify: Android tests.
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`

**Interfaces:**
- Optional `WakeRelayConfig` migrates without invalidating existing pairings.
- Subscriber long poll validates platform HTTPS, sequence, envelope bounds and authenticated decryption.
- Hexa accepts explicit relay URL, performs health check and never displays credentials.

- [x] **Step 1: Write failing Android tests** for bundle persistence/migration, URL rules, request auth, decrypt sequencing and relay/direct fallback decisions.
- [x] **Step 2: Implement subscriber client and monitor state machine**, keeping direct event wait available during relay failure.
- [x] **Step 3: Add tested Hexa relay settings/status and commit** `feat(android): consume encrypted relay wakes`.

### Task 6: End-To-End Release Evidence

**Files:**
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan.
- Generate ignored release APK/AAB.

- [x] **Step 1: Start a real local relay with persistent SQLite**, build/relaunch desktop, visibly pair API 36 release Android and verify only ciphertext/digests exist in SQLite.
- [x] **Step 2: Trigger a disposable state change**, require relay upload, Java authentication/decryption and pinned private session refresh; then stop/restart relay and prove bounded recovery.
- [x] **Step 3: Revoke from Android**, require remote channel deletion, local secret deletion, zero devices and stopped emulator.
- [x] **Step 4: Run relay, Rust, frontend and Android full tests/builds**, verify exact permissions, APK/AAB signatures and hashes.
- [x] **Step 5: Update docs with truthful local-relay evidence and remaining FCM/public-host/physical-Xiaomi gaps**, commit `docs(relay): verify encrypted Android wake`.
