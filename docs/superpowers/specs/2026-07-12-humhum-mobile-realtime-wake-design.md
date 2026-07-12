# HUMHUM Mobile Realtime Wake Design

## Goal

Reduce same-LAN approval notification latency from a 15-second polling interval to approximately one second while preserving HUMHUM's existing explicit pairing, scoped device tokens, pinned TLS, foreground-service visibility, and polling fallback.

This is a local realtime wake channel. It is not FCM, APNs, an internet relay, or a claim that Android can receive notifications after Xiaomi kills the app process.

## Chosen Transport

Add an authenticated bounded long-poll endpoint to the existing HTTPS Mobile Bridge:

`GET /api/events?cursor=<64 lowercase hex characters>`

The alternatives are deferred:

1. FCM requires a Firebase project, app credentials, server credentials, and external delivery infrastructure. It remains the next public-push phase.
2. WebSocket would require a new framing dependency and custom pinned-TLS Android client while providing little benefit for a one-bit wake signal.
3. Server-Sent Events require a streaming HTTP body and a second lifecycle model. Bounded long polling uses existing Hyper/`HttpsURLConnection` behavior and survives proxy or Wi-Fi reconnects predictably.

## Scoped Cursor

The existing `/api/sessions` response gains `cursor`. The cursor is SHA-256 over the stable JSON serialization of the already redacted, scope-specific response:

- Read devices hash no approval summaries or control capabilities.
- Control devices hash only the same bounded approval summaries already returned by `/api/sessions`.
- Raw transcripts, paths, messages, tokens, device names and private bridge state never enter the cursor source.
- Sessions are sorted by activity and then ID so identical state produces an identical cursor.

The endpoint returns only:

```json
{"cursor":"<sha256>","changed":true,"retry_after_ms":0}
```

If state is unchanged for 20 seconds, it returns `changed:false` with the current cursor. The response is always `Cache-Control: no-store`.

## Authorization And Resource Limits

- Use the existing exact Bearer device token and its read/control scope.
- Validate the token before entering the wait and again on every state check. Revocation therefore ends an open wait with `401` within one second.
- Reject missing or malformed cursors with `400`.
- Limit the bridge to 16 concurrent event waits. Additional requests return `429` with no state disclosure.
- Each wait checks state at one-second intervals for at most 20 seconds, then releases its permit.
- Disabling the Mobile Bridge closes its listener as today; Android reconnects through bounded retry.

## Android Monitor State Machine

After a successful session refresh, Android stores no new content. It immediately calls `waitForChange(cursor)` with a 25-second read timeout:

- `changed:true`: fetch the complete redacted session page, run existing digest deduplication, and notify only genuinely new approvals.
- `changed:false`: start the next bounded wait without changing notifications.
- `401/403`: clear monitor state and stop exactly as current polling does.
- `404`: treat the desktop as an older compatible version and use the existing 15/30/60-second polling path without showing an error.
- timeout/network failure: show the existing unreachable state and use bounded retry. The default-network callback still schedules immediate recovery.

Only the foreground monitor uses the wake channel. The visible Activity keeps its current 10-second refresh behavior.

## Compatibility And Privacy

- Old Android clients ignore the added `cursor` field.
- New Android clients continue working with old desktop builds through the `404` fallback.
- No Android permission, analytics field, stored session text, notification copy, or lock-screen exposure is added.
- Certificate pinning protects both session and event requests.

## Verification

- Rust tests prove stable scoped cursors, state-change detection, malformed-cursor rejection, waiter limits, and revocation during a wait.
- Android tests prove cursor validation, request construction, response bounds, legacy `404` fallback, and monitor transition decisions.
- API 36 runtime pairs through the visible form, enables the foreground monitor, creates a disposable authenticated approval, and requires the private notification to appear within five seconds rather than the 15-second poll interval.
- Runtime then verifies a 20-second unchanged heartbeat, Wi-Fi recovery, full reboot restoration, token-revocation shutdown, callback release, and zero residual paired devices.
- Signed APK/AAB, exact permissions, frontend, Rust, desktop HTTPS, and compatibility regressions remain green.

## Remaining Public-Push Work

FCM or a self-hosted encrypted internet relay must later wake a stopped app outside the trusted LAN. That phase requires external endpoint identity, encrypted payload envelopes, device-presence routing, key rotation, abuse controls, and physical Xiaomi/HyperOS validation.
