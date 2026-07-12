# HUMHUM Mobile Recent Conversation Design

## Purpose

HUMHUM Mobile can list Agent sessions, show approval summaries and send follow-ups, but it cannot answer the immediate question: “What were we just discussing?” The mobile surface should reveal a small amount of real conversation context only when the paired user asks for it, without turning the phone into a transcript mirror.

## User Experience

Live session cards with a supported local transcript show **查看最近对话**. Tapping it fetches and expands up to 12 recent user/assistant text turns inline. The control toggles to **收起最近对话** after loading. User and Agent turns are visually distinct, long text wraps, and loading/error copy stays inside the session card.

Offline snapshot cards never show the control. Conversation text is never included in the encrypted offline snapshot, Android notifications, wake relay, presence, session-list cursor, or approval payloads. Hiding and reopening a conversation may use the current Activity's in-memory result, but process death or disconnect discards it.

## Desktop Data Boundary

The Mobile Bridge accepts an authenticated `POST /api/session/conversation` body containing exactly one bounded `session_id`. Read-only and control pairings may call it because it performs no action.

The endpoint resolves the ID against `SessionStore`; the caller cannot submit a path. It reads only a canonical regular file whose path is contained by a provider-specific user-owned transcript root:

- Codex: `~/.codex/sessions`
- Claude Code: `~/.claude/projects`
- OpenClaw: `~/.openclaw/agents`

Unknown sessions, unsupported providers, missing transcripts, symlinks escaping those roots, oversized files, and non-files fail closed with generic unavailable responses. The reader scans at most the final 1 MiB / 500 JSONL records and returns at most 12 text turns in chronological order.

## Redaction And Schema

Each response message contains exactly:

- `role`: `user` or `assistant`
- `text`: compact whitespace, maximum 500 Unicode scalar values

Tool calls, tool results, reasoning blocks, images, attachments, usage data, IDs, timestamps, metadata and raw JSON are omitted. Absolute Unix/macOS paths, home-relative paths, Windows user paths and file URLs are replaced with `[本机路径]` before serialization. Empty/redaction-only messages are dropped. The response contains exactly `{session_id,messages}` and is bounded to 64 KiB.

The ordinary `/api/sessions` projection adds only `can_read_conversation: boolean`; it does not expose transcript paths or content. The flag is true only when the current known session has a supported canonical transcript candidate.

## Android Boundary

`MobileProtocol` strictly parses the exact response and applies independent count, role and text bounds. `Models.Session` receives `canReadConversation`; cached snapshots always reconstruct it as false. `MainActivity` keeps loaded messages in memory keyed by current session ID and clears that map on pairing change, disconnect and Activity destruction.

Requests use the existing pinned TLS client and device token. HTTP/authentication/TLS/protocol errors remain visible; no offline fallback is used for conversation content. A stale Activity generation or changed connection cannot render a late response.

## Testing

Rust tests cover canonical containment, symlink escape rejection, exact request/response shapes, JSONL variants, chronological limits, path redaction, tool omission, unknown sessions and read-scope access. Android JVM tests cover strict parsing, bounds, request shape and cached-session exclusion. API 36 runtime verification must pair through the visible form, expand a real supported conversation, confirm no absolute path/tool control appears, rotate during a request without stale rendering, and disconnect with zero retained devices.

## Non-Goals

- full transcript synchronization or search
- transcript pagination
- attachments, tool details or chain-of-thought
- offline conversation history
- editing or deleting local transcripts
- remote transcript roots supplied by the phone

