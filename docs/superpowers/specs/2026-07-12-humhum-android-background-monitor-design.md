# HUMHUM Android Background Monitor Design

## Goal

Let a paired Xiaomi or other Android phone continue watching the local HUMHUM Mobile Bridge after the Activity leaves the foreground, and surface new Agent approval requests as native notifications. This is a same-LAN background monitor, not a claim of internet push.

## Chosen Architecture

Use an explicitly enabled Android foreground service with service type `remoteMessaging`.

- `AgentMonitorService` owns one scheduled network executor and polls `/api/sessions` every 15 seconds with the existing pinned-TLS `MobileProtocol`.
- Android always shows a low-importance ongoing notification while monitoring is enabled. A separate high-importance channel announces newly observed approval requests without exposing project names, message bodies, paths, or approval summaries on the lock screen.
- `AttentionTracker` is a pure Java unit that converts a bounded `SessionPage` into deduplicated generic notices. It persists only SHA-256 digests of action identity keys, capped at 200 entries, so process restarts do not replay old approvals.
- `MonitorStore` persists the user's enabled choice and the bounded digest set in a separate app-private preference file. It never stores pairing codes, session text, project names, or approval summaries.
- `MainActivity` owns the user consent flow. Android 13 and newer must grant `POST_NOTIFICATIONS` before the monitor starts. The UI switch starts the service only while the Activity is visible and stops it immediately when disabled or disconnected.
- `MonitorBootReceiver` may restore a previously enabled monitor after reboot. It starts only when both an explicit enabled flag and a valid paired connection remain. Xiaomi/HyperOS can still require the user to allow Autostart and remove battery restrictions.

`remoteMessaging` is selected instead of `dataSync`: HUMHUM transfers approval and follow-up text between a Mac and phone, and Android 15 limits `dataSync` foreground services to six hours per 24-hour period. A periodic WorkManager job is rejected because its minimum periodic interval and Doze behavior are too slow for interactive approvals. A hidden background service is rejected because Android 8+ stops it and it would conceal ongoing resource use.

## Permissions And Platform Rules

- Keep `INTERNET` and `ACCESS_NETWORK_STATE`.
- Add `FOREGROUND_SERVICE` for Android 9+.
- Add `FOREGROUND_SERVICE_REMOTE_MESSAGING` for the declared Android 14+ service type.
- Add `POST_NOTIFICATIONS` and request it only when the user enables monitoring on Android 13+.
- Add `RECEIVE_BOOT_COMPLETED` solely to restore an already enabled monitor.
- Do not request wake lock, location, nearby-device, storage, contacts, overlay, accessibility, camera, or microphone permissions.
- Declare the service and receiver as non-exported. Cleartext stays disabled and every service request uses the existing exact leaf-certificate fingerprint verifier.

## Runtime Behavior

1. A paired user turns on `Background monitoring` from the session screen.
2. The Activity requests notification permission when required, persists enabled state only after permission is granted, and starts the foreground service.
3. The service calls `startForeground` immediately, loads the existing app-private connection, and polls on one executor.
4. The first successful response records currently visible approval identities as the baseline and posts one aggregate notification only when approvals already need attention.
5. Later polls notify only for newly added approval identities. Removed identities leave the remembered bounded set so a resolved approval cannot replay after a process restart.
6. Authentication failure updates the ongoing notification and stops polling until the service is explicitly restarted; transient network errors use capped backoff up to 60 seconds while keeping the service visible.
7. Disabling monitoring, disconnecting, or removing the paired connection stops the service and clears monitor state.

The service does not approve, deny, or send messages by itself. Tapping an attention notification opens the Activity, where the existing scoped controls remain the only action path.

## User Experience

The paired screen gains a compact switch labelled `Background monitoring`. Its supporting status is one of: off, watching this Mac, notification permission required, or temporarily unreachable. No internal service, polling, token, or certificate details become primary UI.

The ongoing notification says HUMHUM is watching the paired Mac over trusted Wi-Fi. Attention notifications say only that one or more Agent actions need review. Notification content intentionally stays generic for lock-screen privacy.

## Failure And Recovery

- Missing or invalid connection: stop the service and clear enabled state.
- TLS mismatch or authentication failure: do not weaken trust; show an unavailable status and require a foreground reconnect.
- Temporary Wi-Fi loss: retain the explicit enabled choice and retry with 15, 30, then 60 second delays.
- Notification permission denial: do not start background monitoring; keep foreground-only behavior working.
- OS or Xiaomi task removal: `START_STICKY` permits service recreation, while boot restoration remains conditional on explicit prior enablement. The install guide documents that manufacturer settings can still override this behavior.

## Verification

- JVM tests prove first-poll baseline behavior, deduplication, aggregate counts, bounded digest persistence, and monitor enable/clear rules.
- Android lint and build must pass for min SDK 26 and target SDK 36.
- APK inspection must show exactly the two existing network permissions plus the four background/notification permissions above, a non-exported `remoteMessaging` service, a non-exported boot receiver, cleartext disabled, and backup disabled.
- Runtime shell evidence should start and stop the service on an attached Android target when available. Until a phone or emulator is attached, service lifecycle is build/manifest/unit verified and physical Xiaomi behavior remains unclaimed.
- Existing Rust and frontend suites remain green because the desktop protocol does not change.

## Release Boundary

This tranche improves same-LAN background usefulness. It does not deliver FCM, an end-to-end encrypted internet relay, multi-Mac routing, store signing, or guaranteed Xiaomi process survival. Those remain separate verified milestones.
