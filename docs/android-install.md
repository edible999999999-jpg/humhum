# HUMHUM Android 0.3.3

HUMHUM Android is a native private-network client for the desktop Mobile Bridge. It supports Android 8.0 and newer, including current Xiaomi and Redmi phones. Pair on the same LAN by default, or use an optional Tailscale tailnet when the Mac and phone are on different networks.

## Installable APK

- Release APK: `build/releases/HUMHUM-Android-0.3.3.apk`
- Play-compatible bundle: `build/releases/HUMHUM-Android-0.3.3.aab`
- Package: `com.humhum.mobile`
- Version: `0.3.3` (`versionCode 6`)
- APK SHA-256: `a67f86a87c20e878977d2c5ae01b769a890db3323a41171773d3e5d19b1fc4a7`
- AAB SHA-256: `ca5fc46497baf411b88921e6312667e3611dae86886c0d183f826a953aabae6e`
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
  build/releases/HUMHUM-Android-0.3.3.apk
```

## Pair With The Mac

1. Put the Mac and phone on the same trusted Wi-Fi network. Guest Wi-Fi or client isolation can prevent local devices from seeing each other.
2. Open HUMHUM Hub on the Mac, choose Hexa, and enable mobile access.
3. Generate a read-only or control pairing code. Control scope is required for approvals and follow-up messages.
4. Click **Copy Android pairing setup**. Send that short JSON bundle to the phone; it contains an expiring code and the Mac certificate fingerprint, never a durable device token.
5. In the Android app, paste the setup, name the phone, and pair within five minutes.

After pairing, the app stores its token in app-private storage and verifies the exact TLS certificate fingerprint on every connection. Pressing **Disconnect** revokes that device on the Mac before clearing the local credential. If the Mac is unreachable, the app clears the phone and asks the user to revoke the stale device from Hexa.

## Read A Recent Agent Conversation

On a live session backed by a supported local transcript, tap **查看最近对话**. HUMHUM reads only the final bounded portion of the user-owned transcript on the Mac and returns at most 12 chronological user/Agent messages. It omits reasoning, tool calls, tool results, attachments, identifiers, timestamps and usage metadata, replaces local paths with **[本机路径]**, and limits the raw response to 64 KiB.

Conversation text stays only in the current Android Activity. It is never written to the encrypted offline snapshot, notifications, push payloads or Android saved-state storage. While a conversation is expanded, Android task previews and screenshots are blocked with `FLAG_SECURE`. Collapsing hides the disclosure while retaining only Activity memory for a quick reopen; disconnecting, changing the pairing or destroying the Activity clears it. Offline snapshot cards never offer conversation, approval or follow-up controls.

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

Background monitoring is visible and user-controlled. It uses Android's `remoteMessaging` foreground-service type and, with the current desktop, holds an authenticated 20-second HTTPS event wait protected by the same pinned certificate. A scope-specific SHA-256 cursor wakes a full redacted refresh when visible state changes; the wake response contains only cursor, change flag and retry metadata. Older desktops automatically use 15-second polling, and network failures back off to at most 60 seconds. HUMHUM does not hold its own continuous wake lock; the bundled Firebase Messaging SDK declares `WAKE_LOCK` for bounded Google Play delivery work. The app does not request location or bypass Android/Xiaomi power controls. Xiaomi may still stop it under aggressive battery policy; physical-device behavior has not yet been verified on this Mac.

For cross-network wakeups, Hexa can optionally connect each newly paired phone to a self-hosted encrypted wake relay. The relay receives only AES-256-GCM ciphertext, opaque channel IDs, sequence numbers and credential digests; it never receives session names, messages, approvals, device names or encryption keys. Public relay URLs must use HTTPS, while loopback HTTP is accepted only for local development. A wake tells Android to refresh through the existing certificate-pinned LAN or Tailnet Mobile Bridge, so session reading, approvals and follow-ups are never sent through the relay. If the relay is unavailable, the private-network event wait remains the fallback.

Version 0.3.3 contains an optional FCM transport for system-reclaimed Android processes. The relay encrypts one opaque FCM token per channel at rest and sends an exact high-priority data payload containing only `kind`, opaque channel ID and sequence. Android accepts it only when the channel matches, the sequence is valid, FCM retained high priority and the user previously enabled monitoring. Normal-priority, malformed, wrong-channel and disabled-monitor messages cannot start the service. User-initiated **Force stop** remains an Android hard boundary until the app is opened again.

FCM registration is generation- and relay-channel-bound. Transient network, `429`, and `5xx` failures retry after 15, 60, and then 300 seconds; `401`, `404`, and `410` stop and ask for a fresh pairing. Every retry rechecks the current pairing before request and before committing state, while disconnect invalidates queued and in-flight work. The paired screen shows only interpreted states such as **系统推送尚未配置**, **正在连接系统推送**, or **需要重新配对**; it never displays or persists the FCM token.

The downloadable 0.3.3 artifacts were deliberately built with empty Firebase client identifiers because no production HUMHUM Firebase project is configured on this machine. They therefore use encrypted relay/private-network monitoring but do not request an FCM token or registration network call. A real Firebase project and matching release build are still required before claiming killed-process delivery.

Hexa now shows whether each paired phone is **正在使用**, **后台监控**, or **离线**. Android reports only one bounded mode through the authenticated pinned-HTTPS bridge; the Mac supplies the timestamp and keeps it in memory. If no report arrives for 90 seconds, both mode and last-seen time disappear and Hexa shows offline. This prevents a stopped Xiaomi process from looking healthy without collecting app activity, location, network names, or message content.

Version 0.3.3 keeps one encrypted offline snapshot of at most 30 redacted sessions for at most seven days. It stores only project, Agent, status, last activity and attention state in `noBackupFilesDir`, encrypted by an Android Keystore AES-256-GCM key and authenticated against the current Mac URL, pinned certificate and pairing scope. If the Mac becomes unreachable, the header explicitly says **离线快照** and every stale card is read-only: session IDs, approvals, approval summaries, follow-up drafts, messages, tokens and credentials are never cached. Reconnecting replaces the snapshot with live state. Pairing changes, corruption, authentication failure, expiration and in-app disconnect delete both ciphertext and key.

## Runtime Validation

The release APK was installed through Android's real Package Manager on an ARM64 Android 16/API 36 emulator and cold-launched successfully. Reinstalling it with `adb install -r` preserved `firstInstallTime` while changing `lastUpdateTime`; trying to install the debug APK over it failed with Android's expected `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Earlier paired-flow validation used the visible connect form rather than injecting app preferences:

- Exact pinned-TLS pairing reached the Mac over its LAN address and returned control scope plus 23 redacted sessions.
- Enabling background monitoring while the Activity was visible created a foreground service with runtime type `0x200` (`remoteMessaging`) and a low-importance private ongoing notification.
- A disposable desktop permission request produced one high-importance private attention notification and one stored SHA-256 digest. Its notification update timestamp remained unchanged across later polls, proving deduplication at runtime.
- Rebooting Android restored the explicitly enabled monitor, foreground type and ongoing notification after `BOOT_COMPLETED`.
- Revoking the device token on the Mac made the next Android poll stop the service, remove the ongoing notification and clear monitor preferences. Both disposable devices were removed from the desktop store.
- The reliability control opened Android 16's real Battery Optimization screen and returned to HUMHUM without requesting a new runtime permission. The 0.3.3 merged manifest contains the original six permissions plus Firebase's `WAKE_LOCK`, C2DM receive and one package-scoped AndroidX dynamic-receiver permission. It still contains no direct battery-exemption, location, storage or all-packages permission.
- After Wi-Fi loss moved monitoring into its 60-second retry window, restoring Wi-Fi changed the foreground notification from unreachable to connected in 0 seconds through the registered default-network callback. A full reboot restored both the `0x200` service and callback; token revocation stopped the service, emitted Connectivity `RELEASE`, and left zero paired devices.
- The realtime Mobile Bridge returned a scoped change signal in 1,051 ms when a redacted session changed. A real disposable Claude permission request updated Android's private attention notification in 1,349 ms and was then denied and removed. An unchanged wait returned `changed=false` after 21 seconds and immediately established the next wait.
- The event endpoint revalidates the device token every second, permits 16 concurrent waits, returns `429` plus `Retry-After: 1` for the seventeenth, rejects missing credentials with `401`, rejects missing or malformed cursors with `400`, and lets read-only devices receive only the same three-field wake signal. Revocation during an open Android wait stopped the service and released its network callback in 898 ms.
- With both emulator Wi-Fi and mobile data disabled, the monitor reported unreachable after 9 seconds; restoring a network returned it to connected in 1 second. Full Android reboot restored realtime monitoring from `BOOT_COMPLETED`.
- The current release reported `foreground` after visible-form pairing and `monitoring` after the real `remoteMessaging` service entered its event wait. Android process `force-stop` sent no offline message; 91 seconds after the final report, desktop status retained the paired device but returned both presence fields as null. Relaunch restored live state, and in-app disconnect removed the device and presence, leaving zero paired devices.
- A real local SQLite relay, release desktop and visible API 36 Android pairing produced one channel containing only 64-character credential digests and bounded ciphertext. A disposable desktop change published sequence 1 and Android authenticated and decrypted it. After stopping the relay, a second change remained pending locally; restarting the same database published and consumed sequence 2 without skipping or falsely advancing. Android disconnect then deleted the remote channel, desktop relay secret, paired device and local monitor state, leaving all four counts at zero.
- A real HTTP/SQLite relay with an injected push provider accepted a disposable FCM token, stored only a 16-character nonce and encrypted ciphertext, and contained no raw token bytes. The first sequence-1 push failure returned `503`; retrying the exact stored envelope returned `201` and delivered the same generic three-field wake without allocating sequence 2.
- The signed 0.3.3 APK upgraded an installed 0.3.2 release through Package Manager and preserved `firstInstallTime`. A visible-form control pairing loaded 23 real redacted sessions. One real OpenClaw session exposed an explicit conversation disclosure and returned exactly two chronological `assistant,user` messages with only `role,text` keys, no absolute path and no tool controls. Collapse/reopen reused only Activity memory.
- Rotating immediately after requesting that conversation retained the same `MainActivity` instance and produced no duplicate disclosure. The session-level send lock also survives card rerenders and orientation changes, preventing duplicate follow-ups while a request is in flight. Portrait and landscape screenshots confirmed system navigation does not overlap the UI.
- With Android networking disabled after Activity memory was cleared, the app showed **离线快照 · 刚刚** with zero conversation, approval or follow-up controls. Restoring networking returned **刚刚同步**. In-app disconnect returned to the pairing screen, removed the Android device, and a second diagnostic device self-revoked; restarting the desktop left zero devices, no temporary secrets and no listener on port `31276`.
- A real API 36 instrumentation test writes and decrypts the snapshot through Android Keystore, proves cached sessions lose IDs/actions/messaging capability, then verifies `clear()` removes both the no-backup file and Keystore alias. Its initial red run exposed Android Keystore's rejection of caller-provided IVs under randomized-encryption enforcement; 0.3.3 lets the provider generate a fresh 12-byte GCM nonce and the device test passes.

This proves Android platform lifecycle behavior, not Xiaomi-specific battery-manager behavior. A physical HyperOS/MIUI device is still required before claiming manufacturer-level sleep survival.

## Current Scope

- Native session list, redacted to project, agent, status, recency, attention state, and bounded approval summaries.
- Read-only and control pairing scopes.
- Allow-once/deny for supported Agent approvals.
- Text follow-ups for known Codex, Claude Code, and OpenCode sessions.
- Explicit, Activity-only disclosure of up to 12 bounded recent user/Agent messages for supported Codex, Claude and OpenClaw transcripts.
- Foreground session refresh every 10 seconds.
- Optional background monitoring with a persistent notification, authenticated realtime private-network wake, legacy 15-second polling fallback, bounded retry, approval deduplication, and opt-in reboot restoration.
- Optional self-hosted encrypted cross-network wake signals with strict HTTPS, per-device credentials, replay protection, bounded retention and private-network refresh fallback.
- Optional FCM registration and high-priority generic wake handling when both Android client and relay server configuration are supplied.
- Immediate monitoring recovery when Android reports that the default network has returned.
- Volatile per-device foreground/background presence with a 90-second fail-closed offline transition.
- One connection-bound AES-256-GCM offline snapshot with read-only stale cards and disconnect/key destruction.
- In-app battery-settings access and Xiaomi-family autostart-settings routing with safe standard fallbacks.
- HTTPS only, certificate fingerprint pinning, and no backup of app credentials.

The APK requests network state, internet, foreground remote messaging, notification and opt-in boot restoration permissions. Firebase Messaging adds bounded wake-lock and C2DM receive permissions plus one package-scoped AndroidX receiver permission. HUMHUM does not request direct battery exemption, all-package visibility, location, nearby-device, contacts, files, camera, microphone, overlay, or accessibility access.

Not yet verified or shipped: production-configured FCM delivery, Xiaomi Push, physical HyperOS process-reclaim survival, a HUMHUM-hosted relay service, full encrypted transcript history, attachments, iOS packaging, store distribution, or automatic updates. Xiaomi Push additionally requires an approved Xiaomi developer account, a registered package with AppID/AppKey, server-side AppSecret, and the region-appropriate Xiaomi SDK; none of those credentials are present on this machine, so the release does not pretend to initialize that provider. See Xiaomi's official [enablement guide](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1691) and [Android AAR integration guide](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1544).

## Build With FCM

Firebase Android client identifiers are public project configuration, not service-account credentials. Supply all four or none:

```bash
export HUMHUM_FIREBASE_APPLICATION_ID="1:123456789012:android:abcdef0123456789"
export HUMHUM_FIREBASE_API_KEY="your-public-firebase-api-key"
export HUMHUM_FIREBASE_PROJECT_ID="your-firebase-project-id"
export HUMHUM_FIREBASE_SENDER_ID="123456789012"
```

The self-hosted relay separately needs `HUMHUM_PUSH_TOKEN_KEY`, `HUMHUM_FCM_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS`; see `relay/README.md`. Never place the Google service-account JSON or push-token encryption key in the APK.

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
