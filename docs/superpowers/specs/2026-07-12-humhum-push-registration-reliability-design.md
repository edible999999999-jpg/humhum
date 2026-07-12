# HUMHUM Push Registration Reliability Design

Updated: 2026-07-12

## Goal

Make optional Android push registration recover automatically from transient relay/network failures and show a truthful, non-technical status in the paired screen. This closes the current gap where a failed token upload retries only after another app launch or token rotation.

## State Model

One app-private `humhum_push` preference stores only a bounded state and its opaque relay channel association. It never stores the FCM token, server credential, error body or session data.

States are:

- `disabled`: this APK has no complete Firebase client configuration.
- `registering`: a valid paired relay channel and FCM token are being registered.
- `registered`: the current channel accepted the current process's token registration.
- `retrying`: a bounded transient failure will be retried automatically.
- `needs_pairing`: the relay channel was rejected as missing/revoked and requires a new pairing.

Reading a state for a different or missing channel returns `disabled`/unknown rather than showing stale success. Disconnect increments a process-local generation, cancels later effects and clears the state before local connection cleanup.

## Retry Policy

Token acquisition and registration use one static single-thread scheduled executor. Every refresh or token rotation starts a new generation. Attempts re-read the current connection and require the original channel to still match before making a request and before committing state.

Transient network errors, relay `429`, and relay `5xx` retry after 15, 60, then 300 seconds; all later delays remain 300 seconds. A successful `204` resets attempts and records `registered`. Relay `401`, `404`, or `410` records `needs_pairing` without retry. Malformed local configuration fails closed.

The scheduler improves recovery while the process exists; it does not claim Android will keep an arbitrary process alive. System process reclamation is handled by an already registered FCM token, while a user Force stop remains an Android boundary.

## User Experience

The existing **后台可靠性** section gains one line:

- `系统推送尚未配置`
- `系统推送正在连接`
- `系统推送已就绪`
- `系统推送暂时不可用，自动重试`
- `系统推送需要重新配对`

No channel ID, provider token, retry count, endpoint or HTTP status is displayed. MainActivity listens only to the app-private state preference while visible and unregisters on destruction.

## Xiaomi Push Decision

Mi Push remains the next provider, not a placeholder in this tranche. Xiaomi's official flow requires an approved developer account, an application registered with package `com.humhum.mobile`, region selection, AppID/AppKey for the client, AppSecret for the server and the region-matching SDK. HUMHUM will not commit vendor binaries or claim Mi Push until those product and data-residency choices exist.

The relay's existing one-provider subscription schema will be generalized only when real Mi Push credentials and an SDK artifact are available, so FCM behavior is not widened speculatively.

## Verification

Tests must prove channel-bound state migration, no token persistence, delay sequence, transient/permanent classification, generation cancellation, success reset and user-facing copy. Runtime verification uses an injected transport that fails once then succeeds, confirms state transitions and verifies disconnect prevents late success. The ordinary no-Firebase release must still cold-launch with `disabled` status and no network registration.
