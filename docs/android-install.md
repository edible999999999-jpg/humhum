# HUMHUM Android 0.1.0

HUMHUM Android is a native LAN client for the desktop Mobile Bridge. It supports Android 8.0 and newer, including current Xiaomi and Redmi phones.

## Installable APK

- Release APK: `build/releases/HUMHUM-Android-0.1.0.apk`
- Play-compatible bundle: `build/releases/HUMHUM-Android-0.1.0.aab`
- Package: `com.humhum.mobile`
- Version: `0.1.0` (`versionCode 1`)
- APK SHA-256: `2ce57ecea5de3b53c1cb851d56b8bd45a7b505d75e6f190b144c748957c70f6e`
- AAB SHA-256: `45145dd446b0f4714556cc1f571480c05f09b46c562d57416f2800828c985d05`
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
  build/releases/HUMHUM-Android-0.1.0.apk
```

## Pair With The Mac

1. Put the Mac and phone on the same trusted Wi-Fi network. Guest Wi-Fi or client isolation can prevent local devices from seeing each other.
2. Open HUMHUM Hub on the Mac, choose Hexa, and enable mobile access.
3. Generate a read-only or control pairing code. Control scope is required for approvals and follow-up messages.
4. Click **Copy Android pairing setup**. Send that short JSON bundle to the phone; it contains an expiring code and the Mac certificate fingerprint, never a durable device token.
5. In the Android app, paste the setup, name the phone, and pair within five minutes.

After pairing, the app stores its token in app-private storage and verifies the exact TLS certificate fingerprint on every connection. Pressing **Disconnect** revokes that device on the Mac before clearing the local credential. If the Mac is unreachable, the app clears the phone and asks the user to revoke the stale device from Hexa.

## Background Monitoring On Xiaomi

Turn on **后台监控** from the paired session screen. Android 13 and newer asks for notification permission at that moment. HUMHUM then shows a persistent notification while it watches the paired Mac over trusted Wi-Fi and sends a generic notification when a new Agent approval appears.

For stronger survival on HyperOS or MIUI, open HUMHUM's system App info and enable **Autostart**, then set Battery saver to **No restrictions**. Menu names vary by Xiaomi system version. The service can restore after reboot only when the user previously enabled background monitoring, notification permission remains granted, and a valid pairing still exists.

Background monitoring is visible and user-controlled. It uses Android's `remoteMessaging` foreground-service type, polls every 15 seconds, and backs off to at most 60 seconds while Wi-Fi is unavailable. It does not hold a wake lock, request location, or bypass Android/Xiaomi power controls. Xiaomi may still stop it under aggressive battery policy; physical-device behavior has not yet been verified on this Mac.

## Runtime Validation

The release APK was installed through Android's real Package Manager on an ARM64 Android 16/API 36 emulator and cold-launched successfully. Reinstalling it with `adb install -r` preserved `firstInstallTime` while changing `lastUpdateTime`; trying to install the debug APK over it failed with Android's expected `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Earlier paired-flow validation used the visible connect form rather than injecting app preferences:

- Exact pinned-TLS pairing reached the Mac over its LAN address and returned control scope plus 23 redacted sessions.
- Enabling background monitoring while the Activity was visible created a foreground service with runtime type `0x200` (`remoteMessaging`) and a low-importance private ongoing notification.
- A disposable desktop permission request produced one high-importance private attention notification and one stored SHA-256 digest. Its notification update timestamp remained unchanged across later polls, proving deduplication at runtime.
- Rebooting Android restored the explicitly enabled monitor, foreground type and ongoing notification after `BOOT_COMPLETED`.
- Revoking the device token on the Mac made the next Android poll stop the service, remove the ongoing notification and clear monitor preferences. Both disposable devices were removed from the desktop store.

This proves Android platform lifecycle behavior, not Xiaomi-specific battery-manager behavior. A physical HyperOS/MIUI device is still required before claiming manufacturer-level sleep survival.

## Current Scope

- Native session list, redacted to project, agent, status, recency, attention state, and bounded approval summaries.
- Read-only and control pairing scopes.
- Allow-once/deny for supported Agent approvals.
- Text follow-ups for known Codex, Claude Code, and OpenCode sessions.
- Foreground session refresh every 10 seconds.
- Optional background monitoring with a persistent notification, 15-second polling, bounded retry, approval deduplication, and opt-in reboot restoration.
- HTTPS only, certificate fingerprint pinning, and no backup of app credentials.

The APK requests only network state, internet, foreground remote messaging, notification, and opt-in boot restoration permissions. It does not request wake lock, location, nearby-device, contacts, files, camera, microphone, overlay, or accessibility access.

Not yet included: FCM server push, guaranteed Xiaomi process survival, an internet relay, attachments, iOS packaging, store distribution, or automatic updates.

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
