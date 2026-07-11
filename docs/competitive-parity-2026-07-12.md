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
| Exact jump back | Partial | Hook captures terminal, TTY, tmux pane and iTerm session. Hexa can select an exact tmux pane or iTerm session, then activate the host. IDE chat routing and Ghostty terminal identifiers are still missing. |
| Follow-up from supervisor | Partial | Codex app-server follow-up resumes before send and now reports sending/delivered/failed with retry-preserved text. Generic terminal inline follow-up is not enabled because typing into an unverified target is unsafe. |
| Completion and attention notifications | Complete | Pet overlays, sounds, and native macOS notifications exist for permission, question, tool, and completion events. Notification preference granularity still trails Ping Island. |
| Transcript backfill | Complete | Local Codex JSONL and Claude stats/readouts feed history and summaries. |
| Broad client coverage | Partial | Verified profiles: Claude Code, Codex, Qwen Code, Gemini CLI, Kimi, QoderWork; local Pi and Wukong watchers also exist. Ping Island supports additional OpenCode, Copilot, Cursor and remote variants. |
| SSH remote bridge | Missing | HUMHUM has no authenticated SSH event bridge yet. |
| Custom sound packs and per-agent mascot | Partial | HUMHUM has event sounds and 2D/3D pets, but no imported sound packs or per-agent mascot assignment. |
| Launch at login | Missing | No verified user-facing launch-at-login setting. |

## Happy

| Capability | Status | HUMHUM evidence / next gap |
| --- | --- | --- |
| Remote Codex from phone | Partial | Official Codex Remote Control can pair ChatGPT mobile. This is not a HUMHUM mobile client and does not cover Claude or other agents. |
| iOS, Android and web clients | Missing | No HUMHUM mobile/web app exists. |
| End-to-end encrypted relay | Missing | No HUMHUM internet relay exists; an unauthenticated LAN shortcut will not be shipped. |
| Self-hosted relay | Missing | Requires protocol, identity, storage and deployment work. |
| Ordered/retryable outgoing messages | Partial | Codex resume-before-send plus UI delivery/retry state works; there is no durable offline queue yet. |
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
- Rust: 45 passed, 1 ignored. Frontend: 8 passed. Production frontend build: passed.

## Next Iteration Order

1. Ghostty/Terminal exact terminal identifiers and IDE chat routing.
2. Verified OpenCode, Copilot and Cursor ingestion profiles.
3. Durable encrypted local queue and paired LAN client foundation.
4. SSH remote bridge with explicit host trust and scoped credentials.
5. Native/web mobile client, push, attachments and multi-machine presence.
