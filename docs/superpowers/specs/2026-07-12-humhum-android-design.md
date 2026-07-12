# HUMHUM Android Client Design

## Goal

Deliver a real installable Android APK for Xiaomi phones that connects to the existing HUMHUM desktop Mobile Bridge. The first usable release must pair a device, list redacted Agent sessions, resolve scoped approvals, and send follow-up messages. It must not weaken the desktop bridge's TLS or control-scope boundaries.

## Chosen Architecture

Use a small native Android application in `android/` rather than a WebView or Capacitor shell.

- A native client can verify the desktop bridge's self-signed certificate fingerprint before sending the pairing code.
- The app uses the existing `/api/pair`, `/api/sessions`, approval, and message routes; the desktop protocol remains the source of truth.
- The UI uses one Activity and Android platform views for the first release. This keeps the APK small and avoids making Compose or a web runtime part of the security boundary.
- Network and response parsing live outside the Activity so protocol behavior is unit-testable on the JVM.

Rejected alternatives:

1. WebView wrapper: fastest visually, but handling a changing self-signed LAN certificate safely requires custom interception and gives little value over opening Mobile Web.
2. Capacitor: reuses web UI, but adds a JavaScript/native bridge and still needs a custom native TLS verifier. It is larger without simplifying the hard part.

## Pairing And Trust

The user enters three values shown by Hexa:

- HTTPS bridge URL, restricted to an IP literal or `.local` host on port `31276`.
- Eight-character one-time pairing code.
- SHA-256 certificate fingerprint.

The Android TLS verifier accepts a connection only when the leaf certificate fingerprint exactly matches the normalized 64-hex fingerprint. It does not install a permissive `TrustManager`, accept cleartext HTTP, disable hostname checks globally, or trust arbitrary user certificates.

After pairing, the app stores the bridge URL, certificate fingerprint, device token, and returned `read` or `control` scope in app-private preferences. A disconnect action deletes all four. Pairing failures never persist the code or token.

## Screens And Flows

### Connect

- URL, pairing code, certificate fingerprint, and device name inputs.
- Validation happens before network access.
- The connect action shows a bounded error and remains retryable.

### Sessions

- Refreshes the 30-item redacted session response on demand and every 10 seconds while foregrounded.
- Shows Agent, project label, status, last activity, and attention state.
- Control-scoped devices see pending approval summaries and text follow-up controls.
- Read-scoped devices never render control actions.

### Approval

- Codex approvals post `approval_id` to `/api/codex/approval`.
- Claude/OpenCode hook approvals post `event_id` to `/api/hook/permission`.
- Buttons disable while a request is in flight and refresh after a successful decision.

### Follow-up

- Codex, Claude Code, and OpenCode use `/api/session/message` with the normalized provider and stable session ID.
- Draft text clears only after a successful queued/delivered receipt.

## Android And Xiaomi Behavior

- Minimum Android 8.0 (API 26); target the installed stable SDK.
- Request only `INTERNET` and `ACCESS_NETWORK_STATE` in the first release.
- No camera, contacts, notification, accessibility, overlay, storage, or background location permission.
- Add a network security config that rejects cleartext traffic. Dynamic self-signed trust is handled only by the scoped fingerprint verifier.
- A later foreground-service/push tranche will document Xiaomi battery and autostart settings; the first release does not pretend to receive background push.

## Testing And Evidence

- JVM tests cover URL, code and fingerprint validation; session parsing; endpoint/body selection; scope gating; and certificate fingerprint matching.
- Existing Rust Mobile Bridge tests remain green.
- `assembleDebug` must produce a signed debug APK.
- APK inspection must confirm package ID, permissions, min/target SDK, and absence of cleartext opt-in.
- End-to-end verification pairs against the running desktop bridge and exercises session load plus one non-destructive control request. Physical Xiaomi installation remains separately recorded if no device is connected.

## Release Boundary

The first APK is a local developer build, not a Play Store or Xiaomi Store release. Store distribution, release-key custody, push transport, background service behavior, and manufacturer-specific keepalive are follow-up tranches and must remain listed as incomplete until independently verified.
