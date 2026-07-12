# HUMHUM Android 0.2.0

HUMHUM Android is a native private-network client for the desktop Mobile Bridge. It supports Android 8.0 and newer, including current Xiaomi and Redmi phones. Pair on the same LAN by default, or use an optional Tailscale tailnet when the Mac and phone are on different networks.

## Installable APK

- Release APK: `build/releases/HUMHUM-Android-0.2.0.apk`
- Play-compatible bundle: `build/releases/HUMHUM-Android-0.2.0.aab`
- Package: `com.humhum.mobile`
- Version: `0.2.0` (`versionCode 2`)
- APK SHA-256: `a8a977e3e4bf8969e3bf8290ea6fd0abbbcb574d079a613ba80e33010b378411`
- AAB SHA-256: `b46546f6ad2394000a9399d0e5b3258d372eadd1229dd67e00254bda06698542`
- Release certificate SHA-256: `C2:8C:FF:BE:03:98:B2:DB:58:DB:B7:14:DD:39:4F:06:36:CB:55:A6:90:EE:FE:6F:DA:20:2A:78:ED:4E:12:F8`

The APK and AAB use HUMHUM's durable local release certificate. They are installable and update-compatible with later builds signed by the same key, but they have not been published to Xiaomi GetApps or Google Play.

If a debug build is already installed, uninstall it once before installing the release APK. Android does not allow the debug and release certificates to update each other. Uninstalling clears the phone's local pairing, so pair with the Mac again afterward.

## Install On A Xiaomi Phone

### From The Phone

1. Send the APK to the phone without renaming it.
2. Open it in Files and allow that file source to install unknown apps when HyperOS or MIUI asks.
3. Install and open HUMHUM.

### With USB Debugging

Connect an authorized phone, then run:

```bash
~/Library/Android/sdk/platform-tools/adb install -r \
  build/releases/HUMHUM-Android-0.2.0.apk
```

## Pair With The Mac

1. Put the Mac and phone on the same trusted Wi-Fi network. Guest Wi-Fi or client isolation can prevent local devices from seeing each other.
2. Open HUMHUM Hub on the Mac, choose Hexa, and enable mobile access.
3. Generate a read-only or control pairing code. Control scope is required for approvals and follow-up messages.
4. Click **Copy Android pairing setup**. Send that short JSON bundle to the phone; it contains an expiring code and the Mac certificate fingerprint, never a durable device token.
5. In the Android app, paste the setup, name the phone, and pair within five minutes.

After pairing, the app stores its token in app-private storage and verifies the exact TLS certificate fingerprint on every connection. Pressing **Disconnect** revokes that device on the Mac before clearing the local credential. If the Mac is unreachable, the app clears the phone and asks the user to revoke the stale device from Hexa.

## Use Away From Home With Tailnet

1. Install Tailscale on both the Mac and phone, sign both into the same tailnet, and confirm they can reach each other. HUMHUM never installs Tailscale or reads its credentials.
2. Restart HUMHUM Mobile access. When Hexa detects the Mac's current `100.64.0.0/10` address, it shows **同网 LAN / 外出 Tailnet**.
3. Select **外出 Tailnet**, generate a fresh read-only or control setup, and paste it into Android as usual.

The Android app accepts only a bounded assignable tailnet IPv4 address, the exact configured host, and the exact pinned HUMHUM certificate. Pairing codes, hashed device tokens, read/control scope, revocation, realtime wake, approvals and follow-ups remain the same. Port `31276` is not exposed as a public internet service.

If the Tailnet choice is absent, Tailscale is unavailable or not connected on the Mac; LAN pairing continues to work. The current release was fallback-tested on a Mac without Tailscale, so actual cross-network routing still requires physical verification with both devices joined to one tailnet.

## Background Monitoring On Xiaomi

Turn on **后台监控** from the paired session screen. Android 13 and newer asks for notification permission at that moment. HUMHUM then shows a persistent notification while it watches the paired Mac over trusted Wi-Fi and sends a generic notification when a new Agent approval appears.

For stronger survival on HyperOS or MIUI, open HUMHUM's system App info and enable **Autostart**, then set Battery saver to **No restrictions**. Menu names vary by Xiaomi system version. The service can restore after reboot only when the user previously enabled background monitoring, notification permission remains granted, and a valid pairing still exists.

The paired screen now includes **后台可靠性** controls. **电池设置** opens Android's standard battery-optimization list and reports only the exemption state Android actually exposes. Xiaomi, Redmi, Poco and BlackShark builds also show **自启动设置**; HUMHUM tries a small allow-list of resolvable MIUI/HyperOS Security Center activities and falls back to this app's standard system details page. HUMHUM cannot read Xiaomi's private autostart switch, so it never claims that switch is enabled.

Background monitoring is visible and user-controlled. It uses Android's `remoteMessaging` foreground-service type and, with the current desktop, holds an authenticated 20-second HTTPS event wait protected by the same pinned certificate. A scope-specific SHA-256 cursor wakes a full redacted refresh when visible state changes; the wake response contains only cursor, change flag and retry metadata. Older desktops automatically use 15-second polling, and network failures back off to at most 60 seconds. It does not hold a wake lock, request location, or bypass Android/Xiaomi power controls. Xiaomi may still stop it under aggressive battery policy; physical-device behavior has not yet been verified on this Mac.

For cross-network wakeups, Hexa can optionally connect each newly paired phone to a self-hosted encrypted wake relay. The relay receives only AES-256-GCM ciphertext, opaque channel IDs, sequence numbers and credential digests; it never receives session names, messages, approvals, device names or encryption keys. Public relay URLs must use HTTPS, while loopback HTTP is accepted only for local development. A wake tells Android to refresh through the existing certificate-pinned LAN or Tailnet Mobile Bridge, so session reading, approvals and follow-ups are never sent through the relay. If the relay is unavailable, the private-network event wait remains the fallback.

Hexa now shows whether each paired phone is **正在使用**, **后台监控**, or **离线**. Android reports only one bounded mode through the authenticated pinned-HTTPS bridge; the Mac supplies the timestamp and keeps it in memory. If no report arrives for 90 seconds, both mode and last-seen time disappear and Hexa shows offline. This prevents a force-stopped Xiaomi process from looking healthy and provides routing state for future FCM or encrypted-relay delivery without collecting app activity, location, network names, or message content.

## Runtime Validation

The release APK was installed through Android's real Package Manager on an ARM64 Android 16/API 36 emulator and cold-launched successfully. Reinstalling it with `adb install -r` preserved `firstInstallTime` while changing `lastUpdateTime`; trying to install the debug APK over it failed with Android's expected `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Earlier paired-flow validation used the visible connect form rather than injecting app preferences:

- Exact pinned-TLS pairing reached the Mac over its LAN address and returned control scope plus 23 redacted sessions.
- Enabling background monitoring while the Activity was visible created a foreground service with runtime type `0x200` (`remoteMessaging`) and a low-importance private ongoing notification.
- A disposable desktop permission request produced one high-importance private attention notification and one stored SHA-256 digest. Its notification update timestamp remained unchanged across later polls, proving deduplication at runtime.
- Rebooting Android restored the explicitly enabled monitor, foreground type and ongoing notification after `BOOT_COMPLETED`.
- Revoking the device token on the Mac made the next Android poll stop the service, remove the ongoing notification and clear monitor preferences. Both disposable devices were removed from the desktop store.
- The reliability control opened Android 16's real Battery Optimization screen and returned to HUMHUM without requesting a new runtime permission. The release manifest still contains exactly the original six permissions and no direct battery-exemption or all-packages permission.
- After Wi-Fi loss moved monitoring into its 60-second retry window, restoring Wi-Fi changed the foreground notification from unreachable to connected in 0 seconds through the registered default-network callback. A full reboot restored both the `0x200` service and callback; token revocation stopped the service, emitted Connectivity `RELEASE`, and left zero paired devices.
- The realtime Mobile Bridge returned a scoped change signal in 1,051 ms when a redacted session changed. A real disposable Claude permission request updated Android's private attention notification in 1,349 ms and was then denied and removed. An unchanged wait returned `changed=false` after 21 seconds and immediately established the next wait.
- The event endpoint revalidates the device token every second, permits 16 concurrent waits, returns `429` plus `Retry-After: 1` for the seventeenth, rejects missing credentials with `401`, rejects missing or malformed cursors with `400`, and lets read-only devices receive only the same three-field wake signal. Revocation during an open Android wait stopped the service and released its network callback in 898 ms.
- With both emulator Wi-Fi and mobile data disabled, the monitor reported unreachable after 9 seconds; restoring a network returned it to connected in 1 second. Full Android reboot restored realtime monitoring from `BOOT_COMPLETED`.
- The current release reported `foreground` after visible-form pairing and `monitoring` after the real `remoteMessaging` service entered its event wait. Android process `force-stop` sent no offline message; 91 seconds after the final report, desktop status retained the paired device but returned both presence fields as null. Relaunch restored live state, and in-app disconnect removed the device and presence, leaving zero paired devices.
- A real local SQLite relay, release desktop and visible API 36 Android pairing produced one channel containing only 64-character credential digests and bounded ciphertext. A disposable desktop change published sequence 1 and Android authenticated and decrypted it. After stopping the relay, a second change remained pending locally; restarting the same database published and consumed sequence 2 without skipping or falsely advancing. Android disconnect then deleted the remote channel, desktop relay secret, paired device and local monitor state, leaving all four counts at zero.

This proves Android platform lifecycle behavior, not Xiaomi-specific battery-manager behavior. A physical HyperOS/MIUI device is still required before claiming manufacturer-level sleep survival.

## Current Scope

- Native session list, redacted to project, agent, status, recency, attention state, and bounded approval summaries.
- Read-only and control pairing scopes.
- Allow-once/deny for supported Agent approvals.
- Text follow-ups for known Codex, Claude Code, and OpenCode sessions.
- Foreground session refresh every 10 seconds.
- Optional background monitoring with a persistent notification, authenticated realtime private-network wake, legacy 15-second polling fallback, bounded retry, approval deduplication, and opt-in reboot restoration.
- Optional self-hosted encrypted cross-network wake signals with strict HTTPS, per-device credentials, replay protection, bounded retention and private-network refresh fallback.
- Immediate monitoring recovery when Android reports that the default network has returned.
- Volatile per-device foreground/background presence with a 90-second fail-closed offline transition.
- In-app battery-settings access and Xiaomi-family autostart-settings routing with safe standard fallbacks.
- HTTPS only, certificate fingerprint pinning, and no backup of app credentials.

The APK requests only network state, internet, foreground remote messaging, notification, and opt-in boot restoration permissions. It does not request direct battery exemption, all-package visibility, wake lock, location, nearby-device, contacts, files, camera, microphone, overlay, or accessibility access.

Not yet included: FCM or Xiaomi killed-process push, guaranteed Xiaomi process survival, a HUMHUM-hosted relay service, attachments, iOS packaging, store distribution, or automatic updates.

## Build Locally

```bash
cd android
JAVA_HOME="$HOME/.humhum/toolchains/jdk-17.0.19+10/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The Gradle wrapper is pinned to 9.4.1. The project compiles and targets SDK 36 with minimum SDK 26.

## Build A Signed Release

Release signing is intentionally stored outside the repository. On a new release machine, create the project key once:

```bash
JAVA_HOME="$HOME/.humhum/toolchains/jdk-17.0.19+10/Contents/Home" \
android/scripts/setup-release-signing.sh
```

Then build both public artifacts:

```bash
cd android
JAVA_HOME="$HOME/.humhum/toolchains/jdk-17.0.19+10/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew :app:testDebugUnitTest :app:lintRelease \
  :app:assembleRelease :app:bundleRelease
```

Back up `~/.humhum/android-signing/humhum-release.jks` and `~/.humhum/android-signing.properties` together in a secure offline location. Do not commit or share either file. Losing the key prevents future APKs from updating existing installations. The setup script refuses to overwrite an existing identity, and release tasks fail instead of silently creating an unsigned artifact when signing is unavailable.
