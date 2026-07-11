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
| Exact jump back | Partial | Hook captures terminal, TTY, tmux pane and iTerm session. Hexa can select an exact tmux pane or iTerm session, or open a Codex desktop task through its thread URL. IDE chat routing and Ghostty terminal identifiers are still missing. |
| Follow-up from supervisor | Partial | Codex app-server follow-up resumes before send and now reports sending/delivered/failed with retry-preserved text. Generic terminal inline follow-up is not enabled because typing into an unverified target is unsafe. |
| Completion and attention notifications | Complete | Pet overlays, sounds, and native macOS notifications exist for permission, question, tool, and completion events. Notification preference granularity still trails Ping Island. |
| Transcript backfill | Complete | Local Codex JSONL and Claude stats/readouts feed history and summaries. |
| Broad client coverage | Partial | Managed profiles: Claude Code, Codex, Qwen Code, Gemini CLI, Kimi, QoderWork, Qoder, CodeBuddy and WorkBuddy; local Pi and Wukong watchers also exist. Claude-compatible profile structure is tested, while each third-party runtime still needs a real installed-client smoke test. Ping Island also supports OpenCode, Copilot, Cursor and remote variants. |
| SSH remote bridge | Missing | HUMHUM has no authenticated SSH event bridge yet. |
| Custom sound packs and per-agent mascot | Partial | HUMHUM has event sounds and 2D/3D pets, but no imported sound packs or per-agent mascot assignment. |
| Launch at login | Complete | Settings exposes the native macOS LaunchAgent switch and always reads back system state. Runtime verification created `HumHum.plist` with `RunAtLoad=true`, then disabled it and confirmed clean removal. |

## Happy

| Capability | Status | HUMHUM evidence / next gap |
| --- | --- | --- |
| Remote Codex from phone | Partial | Official Codex Remote Control can pair ChatGPT mobile. HUMHUM Mobile Web now provides a separate read-only view across local hook and Codex sessions; remote follow-up is not enabled yet. |
| iOS, Android and web clients | Partial | A responsive HUMHUM Mobile Web page works on the same LAN over HTTPS after explicit one-time pairing. The first visit must trust the generated certificate and can verify its SHA-256 fingerprint in Hexa. Native iOS/Android packaging and internet access remain missing. |
| End-to-end encrypted relay | Missing | No HUMHUM internet relay exists; an unauthenticated LAN shortcut will not be shipped. |
| Self-hosted relay | Missing | Requires protocol, identity, storage and deployment work. |
| Ordered/retryable outgoing messages | Partial | Codex now has an owner-only persistent queue, strict per-thread order, crash recovery, explicit queued/delivered/failed receipts, and retry/discard controls. Claude and future remote transports do not use the queue yet. |
| Push notifications | Missing | Native Mac notifications exist, but no APNs/FCM/Web Push path. |
| Multi-machine sessions | Missing | Local multi-agent sessions work on one Mac; there is no machine registry or presence protocol. |
| Mobile permission controls | Missing | Desktop permission controls work; there is no HUMHUM remote permission surface. |
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
- Rust: 61 passed, 1 ignored. Frontend: 11 passed. Production frontend build: passed.

## Next Iteration Order

1. Ghostty/Terminal exact terminal identifiers and IDE chat routing.
2. Verified OpenCode, Copilot and Cursor ingestion profiles.
3. Scoped mobile approvals and follow-up on top of the paired read-only foundation.
4. SSH remote bridge with explicit host trust and scoped credentials.
5. Internet E2EE relay, push, attachments and multi-machine presence.
