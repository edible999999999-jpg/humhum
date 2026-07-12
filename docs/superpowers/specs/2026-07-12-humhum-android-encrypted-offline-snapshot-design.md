# HUMHUM Android Encrypted Offline Snapshot Design

## Purpose

HUMHUM Android currently replaces useful session context with a network error whenever the paired Mac is temporarily unreachable. Xiaomi and other Android systems can interrupt local-network access while changing Wi-Fi, applying battery policy, or resuming an app. The paired phone should retain a calm, explicitly stale view of the last successful redacted session list without turning that view into a second message database.

## User Experience

After every successful foreground session refresh, HUMHUM stores one encrypted snapshot. If a later refresh fails, the paired screen renders that snapshot and labels the header **离线快照 · N 分钟前**. Cached cards contain no approval controls and no follow-up composer. A successful refresh immediately replaces the stale view and returns the header to **刚刚同步**.

If no valid snapshot exists, the existing bounded network error remains. Snapshots older than seven days, bound to another Mac connection, malformed, or unauthenticated are deleted and never rendered. In-app disconnect clears the encrypted file and deletes its key before connection credentials are removed.

## Privacy Boundary

The snapshot contains at most 30 entries and only these already-redacted fields:

- project display name
- Agent/provider display name
- bounded status
- bounded last-activity timestamp
- needs-attention boolean

It never stores session IDs, approval IDs, approval summaries, messages, drafts, device tokens, relay credentials, paths, tool data, or transcript content. Cached `Models.Session` values are reconstructed with an empty ID, `canMessage=false`, and no actions, which makes stale controls impossible even if a caller accidentally reuses the normal renderer.

## Storage And Cryptography

`SessionSnapshotCodec` owns a versioned JSON payload and strict size/count/string bounds. It is dependency-free apart from the existing `org.json` API and is covered by JVM tests.

`EncryptedSessionSnapshotStore` owns Android persistence:

- one AES-256 key generated in Android Keystore under a HUMHUM-specific alias
- AES/GCM/NoPadding with a fresh 96-bit nonce for every write
- the current connection binding supplied as authenticated additional data
- one ciphertext envelope in `Context.getNoBackupFilesDir()`
- write-to-temp plus atomic rename
- a 256 KiB maximum envelope and seven-day maximum age

The binding is SHA-256 over the normalized bridge URL, pinned certificate fingerprint, and pairing scope. It is not a credential and prevents a snapshot from one Mac/scope appearing under another pairing. Envelope metadata exposes only format version, save time, nonce, and ciphertext; session fields remain encrypted.

## Failure Handling

Missing keys, GCM authentication failure, binding mismatch, invalid JSON, oversized input, and expired data all fail closed. The store deletes invalid material and returns no snapshot. Cache write failures do not break live session rendering. Cache read failures never replace a more useful network error with a cryptographic diagnostic.

## Components

- `SessionSnapshotCodec.java`: validates and serializes the bounded redacted payload.
- `EncryptedSessionSnapshotStore.java`: Android Keystore, authenticated encryption, no-backup file lifecycle, and connection binding.
- `MainActivity.java`: writes after live success, reads only after live failure, renders stale copy, and clears on disconnect/new pairing.
- `SessionSnapshotCodecTest.java`: round-trip and strict privacy/boundary tests.
- `ManifestContractTest.java`: verifies no storage permission is introduced and offline copy does not imply actionable controls.

## Verification

JVM tests must prove round-trip preservation of allowed fields; removal of IDs, actions, and messaging capability; rejection of unknown keys, oversized lists/strings, invalid ages, and changed bindings; and authentication failure after ciphertext modification. API 36 runtime verification must pair through the visible form, load live sessions, disable emulator networking, refresh, and show the encrypted offline snapshot without action controls. Restoring networking must return to live state. Disconnect must remove both snapshot file and keystore alias. The release manifest must remain free of storage/media permissions.

## Non-Goals

- transcript or message history
- offline approvals or queued follow-ups
- file/image attachments
- cross-device cache sync
- backup or export of snapshot keys
- claims about physical HyperOS process survival

