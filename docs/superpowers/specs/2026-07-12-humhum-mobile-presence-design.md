# HUMHUM Mobile Presence Design

## Goal

Give Hexa truthful, privacy-bounded knowledge of whether each paired Android device is actively open, maintaining its background monitor, or no longer reachable. This is the routing foundation for later FCM and encrypted-relay delivery; it is not itself an internet push claim.

## Chosen Architecture

Mobile Bridge owns an in-memory presence table keyed by the existing opaque device ID. Presence is intentionally ephemeral: restarting HUMHUM makes every device offline until that device reports again, and heartbeat traffic never rewrites `mobile-devices.json`.

Alternatives rejected:

- Treating any API request as presence cannot distinguish the visible Activity from the background monitor.
- Persisting every heartbeat in the paired-device store creates unnecessary disk writes and makes stale runtime state look durable after restart.
- Adding FCM first would require external Firebase credentials and would still lack reliable foreground/background routing state.

## Protocol

Add authenticated `POST /api/presence` to the existing pinned-HTTPS Mobile Bridge. Its bounded JSON body is exactly:

```json
{"mode":"foreground"}
```

or:

```json
{"mode":"monitoring"}
```

The bearer token identifies the paired device; clients cannot select another device ID or alter scope. Unknown fields, oversized bodies, unknown modes, and revoked credentials fail. A successful response is content-minimal.

Each accepted report records the mode and server-side UTC timestamp. A device is online only for 90 seconds after its latest report. Status serialization exposes `presence_mode` and `last_seen_at` only for a currently fresh report; stale and never-seen devices return `null` for both so Hexa never implies a dead monitor is alive.

## Android Behavior

- `MainActivity` reports `foreground` after activating a valid saved connection and again on resume.
- `AgentMonitorService` reports `monitoring` after each successful refresh or event heartbeat. A failed report follows the monitor's existing retry path and never weakens session synchronization.
- The report contains no session, approval, project, notification, device-name, or message data.
- No Android permission, dependency, wake lock, receiver, or background component is added.
- Old desktop builds returning `404` are treated as presence unsupported; normal sessions and monitoring continue.

## Desktop Experience

Hexa shows one compact state beside each paired device:

- `正在使用` for fresh foreground presence.
- `后台监控` for fresh monitoring presence.
- `离线` when no fresh report exists.

Device revocation removes its presence immediately. Revoke-all and Mobile Bridge disable clear all presence entries. The existing device name and read/control scope remain unchanged.

## Security And Privacy

- Presence requires the same raw bearer token, exact certificate pin, private host validation, and revocation checks as every Mobile API.
- The server derives device identity from the token digest using constant-time comparison.
- Presence is volatile and bounded by paired-device count; no location, IP history, network name, activity content, or usage history is retained.
- Timestamps come from the Mac so an Android client cannot forge recency.

## Verification

- Rust tests cover token-to-device identity, valid modes, stale cutoff, revocation cleanup, oversized/malformed bodies, and status privacy.
- Android tests cover request construction, strict `404` compatibility, and mode values.
- Frontend tests/build cover the extended status contract and display labels.
- API 36 runtime verification installs the release APK through Package Manager, pairs through the visible form, observes foreground then monitoring presence in desktop status, stops reporting to prove the 90-second offline transition or a test-clock equivalent, revokes the device, and confirms zero devices and zero presence.
- Full Rust, frontend, Android test/lint/release, signature, permission and artifact-hash checks remain required.

## Explicit Non-Goals

This tranche does not add FCM, Xiaomi Push, a public relay, location tracking, remote wake after process death, store publication, or guaranteed HyperOS survival. It supplies authoritative routing state those later transports need.
