# HUMHUM Encrypted Wake Relay Design

## Goal

Let the Android foreground monitor learn that HUMHUM state changed when the phone and Mac are on different networks, without exposing session content or control operations to a relay. After a verified wake, Android continues to fetch redacted sessions and send approvals/follow-ups through the existing pinned-HTTPS LAN or Tailnet Mobile Bridge.

This tranche delivers a self-hostable encrypted wake relay and a locally verified end-to-end path. It does not claim FCM killed-process wake or remove the need for a reachable private Mobile Bridge.

## Competitive Principle

Happy keeps its relay deliberately unable to read payloads: endpoint devices encrypt before upload and decrypt after download. HUMHUM follows that zero-knowledge relay boundary while retaining its existing local-first Mobile API instead of adopting Happy's account, session, or command protocol.

Alternatives rejected:

- Reusing Happy Server directly couples HUMHUM identity and compatibility to another product's protocol.
- A plaintext webhook lets the relay infer Agent state and cannot honestly be called private.
- Relaying full session and command bodies now duplicates the pinned Mobile API and increases the control-plane attack surface before wake delivery is proven.

## Components

### Opaque Relay Server

Add a dependency-free Node 22+ service under `relay/`. It uses `node:http`, `node:crypto`, and `node:sqlite` with a caller-selected data directory.

The server supports:

- `POST /v1/channels`: creates a 256-bit random channel ID, publisher token and subscriber token. It stores only SHA-256 token digests.
- `POST /v1/channels/{id}/messages`: publisher-authenticated upload of one bounded encrypted envelope.
- `GET /v1/channels/{id}/messages?after={sequence}&wait=20`: subscriber-authenticated bounded long poll.
- `DELETE /v1/channels/{id}`: either credential revokes the channel and deletes queued blobs.
- `GET /health`: no secret data or channel count.

Each channel retains at most 128 messages for 24 hours. Envelopes are at most 4 KiB; channel/token/path/query sizes are fixed. The server applies per-IP and per-channel request limits, `Cache-Control: no-store`, no permissive CORS, and generic authentication failures. SQLite stores channel ID, credential digests, sequence, timestamp, nonce and ciphertext, never plaintext or encryption keys.

### Wake Cryptography

Pairing creates one independent 32-byte wake key per Android device. The Mac stores it in a separate owner-only `mobile-relay-secrets.json`; Android stores it in the existing app-private connection preferences. The normal Mobile token remains digest-only in `mobile-devices.json`.

AES-256-GCM uses a fresh random 12-byte nonce for every envelope. Additional authenticated data is:

```text
humhum-wake-v1:{channel_id}:{sequence}
```

Plaintext is exactly:

```json
{"kind":"wake","issued_at":1783836000}
```

The relay sees channel ID, sequence, ciphertext size and timing. It cannot see session IDs, projects, approval summaries, cursors, scopes, device names, messages or the wake key. Android rejects version mismatch, nonce/key/ciphertext bounds, authentication failure, unknown plaintext fields, wrong kind, replayed sequence and timestamps more than ten minutes from its clock.

## Configuration And Pairing

Relay is disabled by default. Hexa accepts one explicit HTTPS relay base URL; loopback HTTP is allowed only for local development/runtime tests. Enabling relay performs `/health` and channel-registration checks before advertising it.

When a device completes ordinary pinned-HTTPS pairing, the Mac creates its relay channel and returns a nested `wake_relay` object containing base URL, channel ID, subscriber token and wake key. Publisher credentials never go to Android; subscriber credentials never appear in Hexa. Pairing fails closed if relay was explicitly selected but channel creation fails. LAN/Tailnet pairing without relay remains backward compatible.

Relay secrets are associated with the paired opaque device ID. Revoke-one, self-revoke and revoke-all delete local secrets; revocation also attempts remote channel deletion with a bounded timeout. Local deletion succeeds even if the relay is unreachable. Disabling Mobile Bridge stops publishing but preserves paired channels for the next enable. Explicitly disabling relay deletes every channel and requires fresh relay pairing.

## Desktop Publisher

Mobile Bridge already computes a scope-filtered cursor for each device. A single publisher loop wakes on internal session changes and, at most once per second per device, compares the current cursor with the last published cursor. When it changes, it allocates the next sequence, encrypts the minimal wake plaintext and uploads it with a five-second timeout.

Failed uploads retain only the newest pending wake and retry with 5/15/30/60-second bounded backoff. The publisher never blocks Agent hooks, local Mobile API responses, device revocation or app shutdown. Hexa status exposes relay state as `disabled`, `connected`, `retrying` or `errored`, without credentials.

## Android Subscriber

Connection storage gains an optional relay bundle. `AgentMonitorService` prefers relay long-poll when configured:

1. Request envelopes after the last accepted sequence.
2. Authenticate/decrypt each envelope locally.
3. On a valid newer wake, call the existing pinned Mobile Bridge session refresh.
4. On relay `404`/`410`, mark relay unavailable and continue the current direct event wait/poll fallback.
5. On transient relay errors, retry with the existing bounded backoff while still attempting direct private-network recovery.

The foreground Activity does not need relay to display sessions. No Android permission, Firebase SDK, wake lock, account, analytics, message persistence or lock-screen content is added. Because this remains a user-enabled foreground service, Xiaomi force-stop still prevents wake; FCM/Xiaomi Push remains a later transport.

## Security Invariants

- Public relay URLs require HTTPS; redirects, URL user info, fragments, non-default credentials and public HTTP are rejected.
- Relay TLS uses Android/Rust platform trust independently of HUMHUM's self-signed Mobile Bridge pin.
- Keys and bearer tokens never appear in logs, status objects, notifications, analytics or error messages.
- The relay cannot publish valid ciphertext, subscribe without its separate token, decrypt payloads, or invoke Mobile API actions.
- A relay compromise reveals bounded metadata only. A phone compromise exposes only that device's wake key/subscriber token and its existing scoped Mobile credential.
- Replays are rejected by monotonically increasing per-device sequence.

## Verification

- Shared deterministic AES-GCM vectors pass in Rust and Java, including tamper/AAD/replay rejection.
- Relay tests run a real HTTP server and SQLite database, proving credential separation, digest-only persistence, long poll, limits, expiry and deletion.
- Desktop tests prove secret-file permissions, per-device isolation, coalescing/backoff and revoke cleanup.
- Android tests prove strict relay URL/config parsing, optional migration, envelope decryption and fallback decisions.
- API 36 runtime starts the local relay, builds/relaunches HUMHUM, visibly pairs the release APK, enables monitoring, triggers one disposable state change, observes opaque SQLite data plus Android refresh, then tests relay outage recovery and complete channel/device cleanup.
- Full Rust, relay, frontend and Android test/lint/release/signature/permission gates remain required.

## Explicit Remaining Gaps

- No FCM, Xiaomi Push or killed-process wake.
- No public hosted HUMHUM relay deployment or uptime claim.
- No full session/command transport through the relay; Tailnet or another private route remains required after wake.
- No physical HyperOS/MIUI lifecycle evidence, store publication or automatic update channel.
