# HUMHUM Tailnet Mobile Access Design

## Goal

Let a paired HUMHUM Android device reach the same secure Mobile Bridge when the Mac and phone are on different physical networks, without opening port 31276 to the public internet or weakening HUMHUM's own pairing, token, scope, realtime-wake, and certificate-pin controls.

This phase adds optional Tailscale tailnet routing. It does not install Tailscale, create an account, change tailnet ACLs, provide FCM, or replace the planned encrypted public relay.

## Approaches Considered

1. **Tailscale private overlay, selected.** Tailscale gives each signed-in device a stable private address and routes it through an authenticated tailnet. HUMHUM can keep its existing HTTPS protocol and foreground realtime monitor.
2. **Arbitrary remote URL, rejected.** Accepting user-entered public hosts would turn a local companion into an unaudited internet service and make certificate, abuse, and routing failures easy to misconfigure.
3. **Cloud tunnel or HUMHUM relay, deferred.** This is the eventual no-extra-app experience, but it needs server identity, E2EE envelopes, storage limits, presence routing, key rotation, deployment, and external credentials.

## Tailnet Discovery

When Mobile Bridge starts, HUMHUM tries only official or common Tailscale CLI locations:

- `tailscale` found through `PATH`
- `/usr/local/bin/tailscale`
- `/opt/homebrew/bin/tailscale`
- `/Applications/Tailscale.app/Contents/MacOS/Tailscale`

It invokes fixed arguments `ip -4`, sets `TAILSCALE_BE_CLI=1` for the macOS app binary, and enforces a two-second timeout. Output is accepted only when it is exactly one IPv4 address inside `100.64.0.0/10`. Failures, multiple lines, other private ranges, public addresses, command hangs, or missing clients mean tailnet unavailable; LAN startup continues normally.

The listener remains bound to all local interfaces as today. Status exposes `lan_url` and optional `tailnet_url`; legacy `url` remains the LAN URL for compatibility.

## Pairing Selection

Pairing gains a transport enum: `lan` or `tailnet`.

- Existing callers that omit the transport receive LAN pairing.
- Tailnet pairing is rejected unless discovery produced a valid tailnet URL during the current bridge lifetime.
- The expiring pairing code, read/control scope, Android setup JSON, leaf-certificate fingerprint, and 64-character device token remain unchanged.
- The Android app already restricts bridge URLs to private IPv4, `.local`, and CGNAT `100.64.0.0/10`; public IPs and public DNS remain rejected.
- A phone moving an existing installation from LAN to tailnet disconnects its current device and pairs again. HUMHUM does not silently rewrite stored endpoints.

Hexa shows a compact LAN/Tailnet segmented control only while tailnet is available. The two existing read/control pairing commands then use the selected transport. When Tailscale is absent, the current LAN UI remains unchanged.

## Stable Certificate Identity

The current desktop regenerates its self-signed leaf certificate when the LAN IP changes. That breaks a durable pin and makes network mobility fragile. HUMHUM will instead treat an existing readable certificate/key pair as durable identity and reuse it across LAN and tailnet addresses. New identities are valid for ten years and remain owner-only.

Android continues to validate certificate dates and compare the exact SHA-256 leaf fingerprint in constant time. Because a durable self-signed leaf cannot enumerate future private addresses, the pinned client uses a hostname verifier that accepts only the already parsed host from its immutable `BridgeConfig`. This does not trust a new certificate or arbitrary host: both the configured private destination and exact certificate pin must match.

If the stored certificate/key pair is malformed or mismatched, bridge startup fails rather than silently rotating identity. Key replacement remains an explicit operator action followed by device re-pairing.

## Android Experience

No new permission or dependency is required. Pairing setup for a tailnet address uses the existing paste flow. The paired status line labels a `100.64.0.0/10` destination as `Tailnet`; LAN remains unchanged. Realtime event waits, approvals, follow-ups, reboot restoration, device revocation, and bounded retry use the selected private route without protocol forks.

## Security And Privacy

- No public bind advertisement, arbitrary hostname, relay payload, Tailscale auth key, tailnet identity, account name, or peer list is stored by HUMHUM.
- CLI output is bounded and never rendered verbatim.
- Fixed CLI arguments prevent option or shell injection.
- Tailnet reachability is defense in depth, not authorization: every private API still requires HUMHUM's hashed device token and pinned TLS.
- Read-only/control separation and three-field realtime wake responses remain unchanged.

## Verification

- Rust tests cover strict CGNAT parsing, command candidates, timeout/failure fallback, pairing transport selection, legacy LAN defaults, and certificate fingerprint reuse.
- Android tests cover CGNAT classification and exact configured-host verification with mismatch rejection.
- Frontend tests/build cover LAN-only and available-tailnet state contracts.
- On this Mac, where Tailscale is currently absent, a fresh release must report `tailnet_url:null`, keep LAN HTTPS 200, complete Android pairing/realtime approval/command flows, and retain the existing fingerprint.
- A synthetic CLI fixture verifies that a valid `100.64/10` result produces a tailnet URL while invalid output never does.
- Physical cross-network proof remains incomplete until Tailscale is installed and signed in on both a Mac and Xiaomi phone.

## Remaining Work

FCM or an encrypted public relay is still required for wake after Xiaomi kills the process and for users who do not install a private-overlay client. Physical HyperOS testing remains required before claiming manufacturer-level reliability.
