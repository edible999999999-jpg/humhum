# HUMHUM Android Xiaomi Survival Assistant Design

## Goal

Make HUMHUM's explicitly enabled background monitor easier to keep alive on Xiaomi/Redmi devices and faster to recover after Wi-Fi changes, without silently changing system policy, requesting broad exemptions, or weakening pinned TLS.

## Chosen Approach

Add a small, user-operated background reliability panel to the paired Android screen and register a default-network callback while the foreground monitor service is alive.

The alternatives were rejected for this tranche:

1. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` can show a direct exemption prompt, but it adds a sensitive permission and creates Google Play policy risk. HUMHUM will open the standard battery-optimization settings instead.
2. Xiaomi private APIs or accessibility automation could change settings more directly, but they are unstable, intrusive, and inappropriate for a read/control companion.
3. Periodic polling alone already recovers within 60 seconds, but it wastes time after a known network return and gives users no path to manufacturer controls.

## Device-Care Navigation

Create a pure `DeviceCarePlan` that accepts manufacturer, SDK level, and battery-exemption state. It returns declarative actions rather than starting activities itself, so routing is unit-testable.

- Battery action: open Android's battery-optimization list on API 23+; fall back to this app's standard details page when unavailable.
- Autostart action: on Xiaomi/Redmi/Poco, try known MIUI/HyperOS Security Center autostart components in ordered sequence. Resolve every explicit component before launch. If none exists, fall back to app details.
- Other manufacturers: hide the Xiaomi-specific autostart action and keep the standard battery action.
- Status: use `PowerManager.isIgnoringBatteryOptimizations(packageName)` only as factual evidence. Never claim that Xiaomi's separate autostart or background policy is enabled because Android exposes no reliable public read API for it.

The paired screen adds one compact, unframed row beneath the monitor switch. It shows battery state and exposes `电池设置`; Xiaomi-family devices also see `自启动设置`. Returning to the app refreshes the battery state.

## Network Recovery

While `AgentMonitorService` exists, register one `ConnectivityManager.registerDefaultNetworkCallback` callback. `onAvailable` and a validated-capability transition enqueue an immediate poll on the service's existing single-thread scheduler. Multiple network callbacks coalesce into one scheduled poll. `onLost` changes no credentials and does not stop the service; ordinary bounded retry remains the fallback.

Unregister the callback exactly once in `onDestroy`. Registration failure must not stop monitoring because the existing 15/30/60-second retry path remains valid.

## Security And Privacy

- Add no Android permission.
- Do not request direct Doze exemption, draw overlays, automate taps, hold wake locks, or inspect other apps.
- Launch only allow-listed system settings components after package-manager resolution.
- Persist no new user, session, network, or manufacturer data.
- Continue HTTPS-only certificate pinning and generic lock-screen notification text.

## Verification

- Unit tests cover Xiaomi-family detection, generic-device behavior, battery status copy, ordered settings candidates, standard fallback, and callback coalescing.
- Manifest tests continue proving the exact existing permission set.
- API 36 emulator runtime opens the standard battery settings, returns to HUMHUM, and keeps the foreground service at type `remoteMessaging`.
- Runtime toggling Wi-Fi off/on causes an immediate post-return request rather than waiting for the previous 60-second backoff.
- Signed APK/AAB verification, Android tests/lint, frontend tests/build, Rust tests, and desktop Mobile Bridge HTTPS smoke remain green.

## Explicit Limits

This improves setup and recovery but does not prove Xiaomi firmware survival. A physical HyperOS/MIUI phone must still verify autostart routing, battery policy, screen-off duration, reboot restoration, and notification delivery. FCM/public relay remains a separate next phase.
