# HUMHUM Android 0.1.0

HUMHUM Android is a native LAN client for the desktop Mobile Bridge. It supports Android 8.0 and newer, including current Xiaomi and Redmi phones.

## Installable APK

- Local artifact: `dist/android/HUMHUM-Android-0.1.0-debug.apk`
- Package: `com.humhum.mobile`
- Version: `0.1.0` (`versionCode 1`)
- SHA-256: `d8f99d6ed184c3846932e67cef03d52b930f36965635633c34c99050caa1dfac`

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
  dist/android/HUMHUM-Android-0.1.0-debug.apk
```

## Pair With The Mac

1. Put the Mac and phone on the same trusted Wi-Fi network. Guest Wi-Fi or client isolation can prevent local devices from seeing each other.
2. Open HUMHUM Hub on the Mac, choose Hexa, and enable mobile access.
3. Generate a read-only or control pairing code. Control scope is required for approvals and follow-up messages.
4. Click **Copy Android pairing setup**. Send that short JSON bundle to the phone; it contains an expiring code and the Mac certificate fingerprint, never a durable device token.
5. In the Android app, paste the setup, name the phone, and pair within five minutes.

After pairing, the app stores its token in app-private storage and verifies the exact TLS certificate fingerprint on every connection. Pressing **Disconnect** revokes that device on the Mac before clearing the local credential. If the Mac is unreachable, the app clears the phone and asks the user to revoke the stale device from Hexa.

## Current Scope

- Native session list, redacted to project, agent, status, recency, attention state, and bounded approval summaries.
- Read-only and control pairing scopes.
- Allow-once/deny for supported Agent approvals.
- Text follow-ups for known Codex, Claude Code, and OpenCode sessions.
- Foreground polling every 10 seconds; polling stops when the Activity leaves the foreground.
- HTTPS only, certificate fingerprint pinning, and no backup of app credentials.

Not yet included: FCM push, Xiaomi background/autostart integration, an internet relay, attachments, iOS packaging, release-key signing, store distribution, or automatic updates.

## Build Locally

```bash
cd android
JAVA_HOME="$HOME/.humhum/toolchains/jdk-17.0.19+10/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The Gradle wrapper is pinned to 9.4.1. The project compiles and targets SDK 36 with minimum SDK 26.
