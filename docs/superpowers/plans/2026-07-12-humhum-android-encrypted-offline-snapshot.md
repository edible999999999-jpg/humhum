# HUMHUM Android Encrypted Offline Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve one privacy-bounded, connection-bound encrypted Android session snapshot and render it read-only when the paired Mac is temporarily unreachable.

**Architecture:** Pure Java snapshot and AES-GCM envelope classes enforce the privacy/schema boundary and remain JVM-testable. A small Android store supplies an Android Keystore AES key and an atomic no-backup file, while `MainActivity` writes only after live success, reads only after live failure, and clears material on pairing changes or disconnect.

**Tech Stack:** Java 17, Android Keystore, AES-256-GCM, `android.util.AtomicFile`, `org.json`, JUnit 4.

## Global Constraints

- Cache at most 30 sessions for at most seven days in one file under `noBackupFilesDir`.
- Persist only project, agent, status, last-activity timestamp, and needs-attention; never persist IDs, actions, messages, drafts, tokens, credentials, paths, or transcripts.
- Reconstructed cached sessions always have empty IDs, no actions, and `canMessage=false`.
- Bind AES-GCM authentication to normalized bridge URL, pinned certificate fingerprint, and pairing scope.
- Missing keys, malformed/oversized data, binding mismatch, authentication failure, and expiration fail closed and delete cache material.
- Disconnect and every newly successful pairing delete the prior file and Android Keystore alias.
- Add no storage, media, backup, overlay, or accessibility permission.

---

### Task 1: Strict Snapshot And Cipher Contracts

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/SessionSnapshot.java`
- Create: `android/app/src/main/java/com/humhum/mobile/SessionSnapshotCodec.java`
- Create: `android/app/src/main/java/com/humhum/mobile/SessionSnapshotCipher.java`
- Create: `android/app/src/test/java/com/humhum/mobile/SessionSnapshotCodecTest.java`
- Create: `android/app/src/test/java/com/humhum/mobile/SessionSnapshotCipherTest.java`

**Interfaces:**
- Produces: `SessionSnapshot(long savedAtMillis, List<Models.Session> sessions)` with immutable accessors.
- Produces: `SessionSnapshotCodec.encode(SessionSnapshot): byte[]`, `decode(byte[]): SessionSnapshot`, and `ageCopy(long savedAtMillis, long nowMillis): String`.
- Produces: `SessionSnapshotCipher.encrypt(byte[] payload, String binding, SecretKey key, byte[] nonce, long savedAtMillis): byte[]` and `decrypt(byte[] envelope, String binding, SecretKey key, long nowMillis): Decrypted`.

- [x] Write codec tests that round-trip all five allowed fields and prove decoded sessions have empty ID, no actions, and no messaging capability.
- [x] Write rejection tests for unknown keys, more than 30 entries, strings over their protocol bounds, non-boolean attention, negative/future save times, and snapshots older than seven days.
- [x] Write copy tests for **离线快照 · 刚刚**, minute, hour, and day buckets without raw timestamps.
- [x] Run `./android/gradlew -p android :app:testDebugUnitTest --tests '*SessionSnapshot*'` and require missing-class compilation failure.
- [x] Implement exact JSON shapes: payload `{version,saved_at_ms,sessions}` and entries `{project,agent,status,last_activity_at,needs_attention}`; reject rather than truncate malformed stored input.
- [x] Write AES-GCM tests for round-trip, changed binding, changed nonce/ciphertext, unknown envelope keys/version, oversized envelope, and seven-day expiration.
- [x] Run the focused tests and require cipher failures before implementing `SessionSnapshotCipher`.
- [x] Implement a four-field envelope `{version,saved_at_ms,nonce,ciphertext}`, 12-byte nonce, binding as UTF-8 AAD, 256 KiB maximum input, and `Decrypted.payload()/savedAtMillis()`.
- [x] Run focused and complete Android JVM tests, then commit `feat(android): define encrypted snapshot format`.

### Task 2: Android Keystore And Atomic No-Backup Store

**Files:**
- Create: `android/app/src/main/java/com/humhum/mobile/EncryptedSessionSnapshotStore.java`
- Create: `android/app/src/test/java/com/humhum/mobile/EncryptedSessionSnapshotStoreContractTest.java`

**Interfaces:**
- Consumes: Task 1 codec/cipher and `ConnectionStore.Connection`.
- Produces: `write(ConnectionStore.Connection, List<Models.Session>, long): void`, `read(ConnectionStore.Connection, long): SessionSnapshot`, and `clear(): void`.

- [x] Write a source/contract test requiring `AndroidKeyStore`, AES/GCM, a 256-bit randomized key, `getNoBackupFilesDir`, `AtomicFile`, the fixed alias/file name, and deletion of both file and alias in `clear()`.
- [x] Write binding tests against a package-visible pure `binding(ConnectionStore.Connection)` helper: URL/fingerprint/scope changes must change the 64-hex digest while token and device-name changes must not enter the source material.
- [x] Run the focused contract test and require missing-class compilation failure.
- [x] Implement lazy key creation with `KeyGenParameterSpec`, fresh `SecureRandom` nonce, atomic write, strict read cap, codec/cipher delegation, and fail-closed deletion on every read error.
- [x] Run focused and complete Android JVM tests, then commit `feat(android): store snapshots in Android Keystore`.

### Task 3: Live-To-Offline UI And Release Evidence

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`
- Modify: `android/app/build.gradle.kts`
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan.

**Interfaces:**
- Consumes: Task 2 store.
- Behavior: live success writes before rendering; network failure reads and renders stale read-only sessions; pairing/disconnect clears old material.

- [x] Extend the layout/source contract test to forbid storage/media permissions and require snapshot clearing before `ConnectionStore.clear()` and before saving a new pair.
- [x] Run the focused contract test and confirm the new ordering assertions fail.
- [x] Instantiate the store in `MainActivity`; write after a successful current-protocol refresh; on failure read for the same connection and render with `SessionSnapshotCodec.ageCopy`; preserve the network error when no snapshot exists.
- [x] Clear cache/key before saving a newly successful pairing and before clearing connection state on disconnect; cache failures must never suppress live sessions or disconnection.
- [x] Bump Android to `0.3.2` / `versionCode 5`, run all Android JVM tests, release lint, APK/AAB builds, signature, permission, and non-debuggable checks.
- [ ] Install the signed APK over 0.3.1 on API 36. Pair through the visible form, load live sessions, disable emulator networking, refresh and verify **离线快照** appears with no approval/message controls; restore networking and verify **刚刚同步**; disconnect and verify the snapshot file and keystore alias are gone.
- [ ] Copy final APK/AAB to `build/releases`, record SHA-256 values, update installation/parity docs and this checklist, commit `docs(android): verify encrypted offline snapshot`, rebuild/relaunch desktop, and leave the overall Xiaomi goal active.
