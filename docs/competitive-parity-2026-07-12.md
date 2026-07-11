# HUMHUM Competitive Parity Report

Updated: 2026-07-12

Status meanings:

- Complete: verified end to end in HUMHUM.
- Partial: a useful path works, but the competitor has broader coverage.
- Missing: no production path exists yet.

## Ping Island

| Capability | Status | HUMHUM evidence / next gap |
| --- | --- | --- |
| Live Claude/Codex supervision | Complete | Claude hooks plus Codex app-server sessions feed Hexa and the pet. |
| Waiting-first attention view | Complete | Hexa orders waiting, stalled/looping, working, idle, then completed; recency breaks ties. |
| Approve/deny and questions | Complete | Claude hook requests and Codex app-server approvals are session scoped. |
| Exact jump back | Partial | Hook captures terminal, TTY, tmux pane and iTerm session. Hexa can select an exact tmux pane, iTerm session, or allow-listed Terminal.app TTY, open a Codex desktop task through its thread URL, or reopen the exact Cursor workspace. Exact Cursor chat selection and Ghostty terminal identifiers are still missing. |
| Follow-up from supervisor | Partial | Codex app-server follow-up resumes before send and now reports sending/delivered/failed with retry-preserved text. Generic terminal inline follow-up is not enabled because typing into an unverified target is unsafe. |
| Completion and attention notifications | Complete | Pet overlays and sounds remain ambient, while native macOS notifications can be enabled independently for approvals, questions, completions, and ordinary Agent messages. Legacy configs migrate with all four enabled. |
| Transcript backfill | Complete | Local Codex JSONL and Claude stats/readouts feed history and summaries. |
| Broad client coverage | Partial | Managed profiles now include Claude Code, Codex, Qwen Code, Gemini CLI, Kimi, QoderWork, Qoder, CodeBuddy, WorkBuddy, Cursor, GitHub Copilot CLI and OpenCode; local Pi and Wukong watchers also exist. Copilot normalization was runtime-smoked. OpenCode and Cursor still need an installed-client smoke test, and remote variants remain missing. |
| SSH remote bridge | Partial | Settings can bootstrap Claude hooks over an already trusted, key-only SSH connection and receive events through a loopback-only reverse tunnel. The remote credential is event-only, stored separately from the local API token, and revoked locally on disconnect. A real remote-host smoke test and multi-host management are still missing. |
| Custom sound packs and per-agent mascot | Partial | HUMHUM has event sounds and 2D/3D pets, but no imported sound packs or per-agent mascot assignment. |
| Launch at login | Complete | Settings exposes the native macOS LaunchAgent switch and always reads back system state. Runtime verification created `HumHum.plist` with `RunAtLoad=true`, then disabled it and confirmed clean removal. |

## Happy

| Capability | Status | HUMHUM evidence / next gap |
| --- | --- | --- |
| Remote Codex from phone | Partial | Official Codex Remote Control can pair ChatGPT mobile. HUMHUM Mobile Web now shows redacted local sessions, resolves scoped Codex approvals, and sends follow-ups through the same durable ordered queue as Hexa. Internet access remains missing. |
| iOS, Android and web clients | Partial | A responsive HUMHUM Mobile Web page works on the same LAN over HTTPS after explicit one-time read or control pairing. The first visit must trust the generated certificate and can verify its SHA-256 fingerprint in Hexa. Native iOS/Android packaging and internet access remain missing. |
| End-to-end encrypted relay | Missing | No HUMHUM internet relay exists; an unauthenticated LAN shortcut will not be shipped. |
| Self-hosted relay | Missing | Requires protocol, identity, storage and deployment work. |
| Ordered/retryable outgoing messages | Partial | Desktop and mobile Codex follow-ups share an owner-only persistent queue with strict per-thread order, crash recovery, explicit queued/delivered/failed receipts, and retry/discard controls. Claude and future remote transports do not use the queue yet. |
| Push notifications | Missing | Native Mac notifications exist, but no APNs/FCM/Web Push path. |
| Multi-machine sessions | Missing | Local multi-agent sessions work on one Mac; there is no machine registry or presence protocol. |
| Mobile permission controls | Partial | A separately paired control device can inspect bounded Codex and Claude approval summaries and allow once or deny; read-only devices receive 403 and never receive action summaries. Internet delivery remains missing. |
| Voice control | Partial | HUMHUM has local STT/TTS and voice commands, but voice is not connected to a remote session client. |
| Attachments and file review | Missing | Hexa summarizes tools and transcript evidence but has no encrypted remote attachment or changed-file review flow. |

## HUMHUM Advantages To Preserve

- Humi interprets local activity into user profile, preferences, memory suggestions and next steps.
- Hype indexes local skills, rules, memories, Obsidian notes and agent assets.
- Hush provides a user-approved read-only macOS notification bridge for personal messages.
- The desktop pet, local voice, rage mode and awake mode make supervision ambient instead of dashboard-only.

## Current Verified Tranche

- Hook route enrichment uses structured JSON serialization and refreshes on app startup.
- Session route data merges without later empty events erasing exact identifiers.
- tmux pane targets are allow-listed before direct process invocation.
- Hexa has a stable crosshair action for returning to the originating session.
- Intervention drafts survive failure and clear only after successful Codex delivery.
- Codex interventions persist under `~/.humhum/intervention-queue.json`, preserve per-thread order, recover interrupted sends as retryable failures, and never silently auto-repeat after a crash.
- The localhost API now requires an owner-only token for private data and control routes, disables browser CORS, and keeps only `/health` public.
- Hook debug logging no longer records message payloads and uses owner-only file permissions.
- HUMHUM Mobile Web is explicitly enabled, TLS-only, protected by an expiring eight-character pairing challenge with a five-attempt lockout, and exposes redacted read-only session summaries.
- Mobile device credentials are 64-character random tokens; only SHA-256 digests persist in an owner-only store, and Hexa can revoke all paired devices.
- Runtime mobile verification: Wi-Fi HTTPS URL returned 200, unpaired/wrong tokens returned 401, pairing succeeded, 23 sessions loaded, and neither local paths nor a private message sentinel appeared in the response.
- Launch at Login uses Tauri's native LaunchAgent backend. Enable/status/disable were verified against `~/Library/LaunchAgents/HumHum.plist`; the development-path test entry was removed afterward.
- Cursor uses its current flat `~/.cursor/hooks.json` protocol, Copilot uses a versioned user-level `~/.copilot/hooks/humhum.json`, and OpenCode receives a managed global TypeScript plugin without embedded credentials.
- A synthetic Copilot CLI camelCase event passed through the installed shell hook and appeared as a normalized `github-copilot` session; its private prompt did not appear in the mobile summary.
- Cursor sessions now route through the verified `com.todesktop.230313mzl4w4u92` bundle and their existing absolute workspace path; invalid or missing paths are rejected before launching.
- The SSH bridge validates targets before process launch, requires an existing known-host entry and SSH key, binds both sides of the reverse tunnel to loopback, and authorizes its separate SHA-256 credential only for `/event`.
- Remote Claude installation replaces only HUMHUM-managed hook entries, preserves other hooks, labels incoming sessions with their SSH host, and revokes ingress immediately when disconnected or when tunnel exit is observed.
- SSH bridge limitation: no suitable second host was available for a real remote smoke test; installer, argument boundaries, authorization scope, replacement behavior, and disconnect revocation are covered locally.
- Mobile pairing now records an explicit `read` or `control` scope. Existing device records migrate to read-only, read devices cannot see approval summaries or message controls, and only control credentials reach Codex action routes.
- Mobile Codex follow-ups use the desktop durable intervention queue. Runtime HTTPS verification returned `control` and `read` scopes, control approval reached Codex and returned 409 for a synthetic missing item, read approval returned 403, control malformed message reached parsing with 400, read message returned 403, and revoked tokens returned 401.
- Hexa lists paired devices without exposing token digests, shows each device's read/control scope, and can revoke one device without invalidating the others; revoke-all remains available.
- Native macOS notification preferences are independently configurable for approvals, questions, completions, and ordinary Agent messages without hiding the corresponding desktop-pet activity.
- Awake Mode now combines persistent display/system idle assertions with a five-second `UserIsActive` pulse every 120 seconds, restores from saved config, and restarts its long-lived guard if that child exits unexpectedly.
- Runtime power verification observed the persistent `PreventUserIdleDisplaySleep` and `PreventUserIdleSystemSleep` assertions plus pulse PID 94482 reporting `UserIsActive` with a five-second timeout in `pmset`.
- Claude pending permissions are projected to control-scoped mobile devices with full paths reduced to file names. Decisions reuse the desktop pending channel instead of a second execution path.
- Runtime Claude mobile verification showed `Edit · secret-mobile.txt` without a `/Users` path, returned HTTP 200 for deny, and the blocked hook received `behavior: deny`; the test device was then revoked.
- Terminal.app routes now normalize only `ttys` plus digits, reject script input, and select the matching AppleScript tab before activating the window. A locked Mac prevented the temporary real-tab smoke test, so this remains unit/build verified rather than runtime verified.
- Rust: 79 passed, 1 ignored. Frontend: 12 passed. Production frontend build: passed.

## Next Iteration Order

1. Ghostty/Terminal exact terminal identifiers and IDE chat routing.
2. Real installed-client smoke tests for OpenCode and Cursor, plus OpenCode permission reply support.
3. Durable queued Claude follow-up on top of the scoped Codex and Claude approval controls.
4. Real-host SSH smoke testing, multi-host presence, reconnect controls, and remote cleanup.
5. Internet E2EE relay, push, attachments and multi-machine presence.
