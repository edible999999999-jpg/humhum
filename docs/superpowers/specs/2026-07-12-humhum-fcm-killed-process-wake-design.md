# HUMHUM FCM Killed-Process Wake Design

Updated: 2026-07-12

## Scope

This tranche adds an optional Firebase Cloud Messaging transport so Android can receive a privacy-minimal wake after the operating system has reclaimed the HUMHUM process. It preserves the existing certificate-pinned Mobile Bridge for session reads, approvals and follow-ups, and preserves the encrypted relay long poll as the foreground fallback.

It does not claim that Android user-initiated **Force stop** can be bypassed. Android suppresses application delivery after force stop until the user opens the app again. It also does not claim HyperOS reliability until a physical Xiaomi device has completed sleep, process-reclaim, reboot and network-transition tests.

## Chosen Architecture

The self-hosted relay gains an optional FCM adapter. Android registers its opaque FCM registration token against the already authenticated per-device relay channel. The relay encrypts that token at rest with a server-local AES-256-GCM key and decrypts it only while sending through FCM HTTP v1. The publisher and subscriber credentials remain separated.

When the desktop publishes an encrypted wake envelope, the relay stores the envelope first and then attempts a high-priority FCM data message. The message contains exactly `kind=humhum_wake`, the opaque channel ID and the wake sequence. It contains no session ID, project, Agent, approval, message, device name or Mobile Bridge credential.

The relay returns `201` only after either no push subscription exists or the configured push provider accepts the wake. A provider failure returns `503` after the envelope is durably stored. The desktop retries the exact same envelope; the relay's existing idempotency path retries delivery without allocating a new sequence. FCM collapse keys limit duplicate system delivery after a lost relay response.

## Relay Configuration

Push registration is disabled unless all server-side settings are valid:

- `HUMHUM_PUSH_TOKEN_KEY`: exactly 64 lowercase hexadecimal characters encoding a 32-byte token-encryption key.
- `HUMHUM_FCM_PROJECT_ID`: a Firebase project identifier.
- `GOOGLE_APPLICATION_CREDENTIALS`: a readable Google service-account JSON file used only by the relay process.

The relay uses Node built-ins to sign a short-lived RS256 OAuth assertion, requests the `https://www.googleapis.com/auth/firebase.messaging` scope and caches the returned access token only in memory. Service-account material, OAuth tokens and FCM registration tokens never appear in logs, health responses or API errors.

`PUT /v1/channels/{channel}/push` requires the subscriber bearer credential and exact JSON `{ "provider": "fcm", "token": "..." }`. Tokens are bounded to 4,096 visible ASCII characters. `DELETE` removes the subscription. A disabled adapter returns `503`; ordinary channel creation, encrypted publishing, polling and deletion continue to work.

## Android Configuration

The APK includes Firebase Messaging but initializes it only when four build-time public client values are present: application ID, API key, project ID and sender ID. These values are Firebase client identifiers, not server credentials. Analytics and automatic data collection remain disabled.

After pairing, token creation or token rotation, Android registers the current FCM token through the relay subscriber route. Registration failure is non-destructive: the app reports push as unavailable while relay polling and the direct pinned event wait continue.

`HumHumMessagingService` accepts only an exact three-field data payload whose channel matches the stored connection and whose sequence is a positive integer. A high-priority wake may start the existing `remoteMessaging` foreground service only when the user previously enabled background monitoring. A normal-priority or malformed message cannot start the service. No notification body supplied by FCM is trusted or displayed.

The foreground monitor performs the existing authenticated relay decrypt and private Mobile Bridge refresh. FCM never carries the AES wake key or ciphertext plaintext. Token rotation registers the new token; disconnect deletes the entire relay channel, which cascades subscription removal.

## Permissions And User Control

The app keeps explicit notification consent and the existing persistent foreground notification. Firebase Messaging may merge Google Play service permissions such as wake lock and C2DM receive into the final manifest; release verification must record the exact merged set rather than retaining the previous six-permission claim.

Background monitoring remains opt in. Pairing alone does not allow FCM to start the monitor. Disabling monitoring prevents push-triggered service startup but may retain the token so re-enabling does not require another pairing. Disconnect revokes the relay channel and token association.

## Failure Behavior

- Missing Firebase client configuration: FCM initialization and token registration remain disabled; existing transports work.
- Missing relay push configuration: registration returns `503`; existing relay endpoints work.
- OAuth or FCM timeout/failure: publish returns `503`, desktop retries the same envelope and sequence.
- Invalid or stale FCM token: provider failure is generic; logs contain only a bounded reason code, never the token.
- FCM priority downgraded: Android does not start a foreground service and waits for the next user-open, relay poll or private event path.
- User force stop: no background component is claimed to run; opening HUMHUM restores eligible registration and monitoring.

## Verification

Automated evidence must cover strict push registration authentication and JSON shape, encrypted token-at-rest storage, deletion cascade, OAuth assertion/request boundaries, exact FCM payload, provider-failure idempotent retry, disabled-config compatibility, Android payload validation, priority gate, channel match, monitor opt-in gate, token rotation and manifest contracts.

Runtime evidence without production Firebase credentials may use an injected local push provider to prove relay registration, encrypted storage and retry semantics. A complete killed-process claim additionally requires a real Firebase project, a release-signed APK configured for that project and an attached Xiaomi/HyperOS phone receiving a high-priority data message after OS process reclamation.

## Explicitly Deferred

- Xiaomi Push SDK and Xiaomi developer-console integration.
- APNs and iOS packaging.
- Notification text or session content through FCM.
- Multi-device routing policy beyond one push token per relay channel.
- A HUMHUM-operated public relay and production Firebase service account.
