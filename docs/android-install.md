# HUMHUM Android 0.1.0

HUMHUM Android is a native LAN client for the desktop Mobile Bridge. It supports Android 8.0 and newer, including current Xiaomi and Redmi phones.

## Installable APK

- Local artifact: `build/releases/HUMHUM-Android-0.1.0-debug.apk`
- Package: `com.humhum.mobile`
- Version: `0.1.0` (`versionCode 1`)
- SHA-256: `f1da4af4ec1749496f54b32c5d286f8d76f9afd2f7188730a904e90e0fe2639a`

This is a developer build signed with the Android debug certificate. It is installable, but it is not a Xiaomi Store or Google Play release.

## Install On A Xiaomi Phone

### From The Phone

1. Send the APK to the phone without renaming it.
2. Open it in Files and allow that file source to install unknown apps when HyperOS or MIUI asks.
3. Install and open HUMHUM.

### With USB Debugging

Connect an authorized phone, then run:

```bash
~/Library/Android/sdk/platform-tools/adb install -r \
  build/releases/HUMHUM-Android-0.1.0-debug.apk
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

## Current Scope

- Native session list, redacted to project, agent, status, recency, attention state, and bounded approval summaries.
- Read-only and control pairing scopes.
- Allow-once/deny for supported Agent approvals.
- Text follow-ups for known Codex, Claude Code, and OpenCode sessions.
- Foreground session refresh every 10 seconds.
- Optional background monitoring with a persistent notification, 15-second polling, bounded retry, approval deduplication, and opt-in reboot restoration.
- HTTPS only, certificate fingerprint pinning, and no backup of app credentials.

The APK requests only network state, internet, foreground remote messaging, notification, and opt-in boot restoration permissions. It does not request wake lock, location, nearby-device, contacts, files, camera, microphone, overlay, or accessibility access.

Not yet included: FCM server push, guaranteed Xiaomi process survival, an internet relay, attachments, iOS packaging, release-key signing, store distribution, or automatic updates.

## Build Locally

```bash
cd android
JAVA_HOME="$HOME/.humhum/toolchains/jdk-17.0.19+10/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The Gradle wrapper is pinned to 9.4.1. The project compiles and targets SDK 36 with minimum SDK 26.
