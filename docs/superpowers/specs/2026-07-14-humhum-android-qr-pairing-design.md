# HUMHUM Android QR Pairing Design

## Goal

Let a user connect the HUMHUM Android app by scanning one QR code shown by Hexa on the Mac, while preserving the existing local-first pairing security.

## User Flow

1. The user enables mobile access in Hexa and chooses read-only or control access.
2. Hexa shows a QR code containing the existing versioned Android setup JSON.
3. The Android app opens an offline camera scanner from a primary scan button.
4. A successful scan is parsed by `PairingSetup`, fills the connection fields, and immediately enters the existing pinned-TLS `pair()` flow.
5. Expired or malformed setup data is rejected. Paste and manual entry remain available as recovery paths.

## Security Boundary

- The QR payload is the existing version 1 setup JSON. No secret or alternate protocol is introduced.
- The payload must contain an HTTPS private-network URL on port 31276, an eight-character temporary code, an allowed scope, and a SHA-256 certificate fingerprint.
- The Mac pairing challenge remains valid for five minutes and is single-purpose.
- Android keeps certificate pinning and existing bridge validation. Scanning never bypasses `PairingSetup` or `BridgeConfig`.
- Camera permission is requested only when the user opens the scanner. Camera hardware is optional so paste pairing still works on devices without one.

## UI

- Hexa renders a high-contrast QR square only while the current setup has time remaining.
- Android presents `扫描 Mac 配对二维码` as the primary action and keeps `粘贴配对资料` as a secondary action.
- Scanning success starts pairing immediately; cancellation and parse failures stay on the connection screen with plain-language feedback.

## Verification

- Unit tests cover active and expired QR setup timing.
- Android contract tests cover the optional camera capability, scalable scan control, strict scan parsing, and reuse of `pair()`.
- Frontend tests, Android unit tests, lint, signed release builds, APK signature inspection, and emulator launch are required before release.
