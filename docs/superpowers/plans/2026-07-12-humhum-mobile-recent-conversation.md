# HUMHUM Mobile Recent Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let paired mobile users explicitly expand up to 12 recent redacted user/assistant turns from a known local Agent transcript without syncing transcript history to the phone.

**Architecture:** A shared bounded Rust JSONL reader replaces the commands-only parser and preserves Hexa readouts. Mobile Bridge resolves session IDs to canonical provider-owned transcript files, projects exact redacted messages, and Android fetches them over existing pinned TLS into Activity-only memory.

**Tech Stack:** Rust, Tokio/Hyper, serde_json, Java 17, Android Views, JUnit 4.

## Global Constraints

- Mobile callers submit only a session ID; never accept a transcript path or root from the phone.
- Allow canonical regular files only below `~/.codex/sessions`, `~/.claude/projects`, or `~/.openclaw/agents` for matching providers.
- Read at most the final 1 MiB / 500 JSONL records and return at most 12 chronological user/assistant turns.
- Return only exact `{role,text}` messages; role is `user|assistant`, text is at most 500 Unicode scalar values, total JSON is at most 64 KiB.
- Omit tool calls/results, reasoning, images, attachments, IDs, timestamps, usage, metadata and raw JSON.
- Replace absolute/home/file-URL paths with `[本机路径]` before serialization.
- Conversation access is allowed for read and control pairings, but it never changes the control-only follow-up/approval rules.
- Android keeps conversation text in Activity memory only; offline snapshots and notifications never contain it.
- Stale generation, changed connection, disconnect and Activity destruction cannot render or retain a late response.

---

### Task 1: Shared Bounded Transcript Reader

**Files:**
- Create: `src-tauri/src/transcript_reader.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `TranscriptRole::{User,Assistant}`, `TranscriptMessage { role, text }`, and `TranscriptSignals { user_messages, assistant_messages, tool_names, messages }` with crate-visible fields.
- Produces: `parse_transcript_signals(path: &Path) -> Result<TranscriptSignals, String>` using fixed 1 MiB, 500-line and bounded-vector limits.

- [x] Move the existing role/text/tool extraction behavior into tests in `transcript_reader.rs`; add failing tests for Claude/Codex JSONL forms, chronological interleaving, tail-file truncation, malformed lines, tool-only omission, Unicode truncation and the fixed limits.
- [x] Run `cargo test transcript_reader --lib` and require missing-module/API failures.
- [x] Implement bounded tail reading with `File::seek`, skip a partial first record when starting mid-file, parse only the last 500 records and keep at most 12 interleaved messages while preserving existing Hexa user/assistant/tool limits.
- [x] Register the module and replace `commands.rs`'s private parser/helpers with imports from `transcript_reader`; keep `build_hexa_readout` behavior and tests green.
- [x] Run focused and full Rust tests, then commit `refactor(transcript): share bounded recent-message reader`.

### Task 2: Authenticated Mobile Conversation Projection

**Files:**
- Modify: `src-tauri/src/session_store.rs`
- Modify: `src-tauri/src/mobile_bridge.rs`

**Interfaces:**
- Produces: `SessionStore::get_session_with_history(&self, session_id: &str) -> Option<&Session>`.
- Produces: authenticated `POST /api/session/conversation` with exact `{session_id}` request and `{session_id,messages}` response.
- Extends: `MobileSessionSummary.can_read_conversation: bool`.

- [x] Write failing Rust tests for active/completed lookup, exact request shape, read/control authorization, unknown ID, provider/root matching, canonical containment, symlink escape, missing/non-file/oversized transcript, 12-turn order, 64 KiB cap, path redaction and tool omission.
- [x] Run focused tests and require missing lookup/route/projection failures.
- [x] Add completed-history lookup without changing existing active lookup behavior.
- [x] Implement provider-root resolution from the desktop home directory, canonicalize both root and transcript, require regular-file containment, and expose only a boolean in session lists.
- [x] Implement bounded request parsing and mobile message projection from `transcript_reader`; replace Unix/macOS/home/Windows-user/file-URL path tokens with `[本机路径]` before final 500-character truncation.
- [x] Register the endpoint before action routes; permit any valid device scope and retain generic `401/404/400` errors without paths.
- [x] Run focused and full Rust tests, then commit `feat(mobile): expose bounded recent conversation`.

### Task 3: Android In-Memory Conversation Disclosure

**Files:**
- Modify: `android/app/src/main/java/com/humhum/mobile/Models.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MobileProtocol.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/MainActivity.java`
- Modify: `android/app/src/main/java/com/humhum/mobile/SessionSnapshotCodec.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/MobileProtocolTest.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/SessionSnapshotCodecTest.java`
- Modify: `android/app/src/test/java/com/humhum/mobile/ManifestContractTest.java`
- Modify: `android/app/build.gradle.kts`

**Interfaces:**
- Adds: `Models.ConversationMessage(role, text)` and `Models.Session.canReadConversation()`.
- Adds: `MobileProtocol.conversation(Models.Session): List<ConversationMessage>` and strict request/parser helpers.

- [x] Write failing JVM tests for `can_read_conversation`, exact POST body/path, 12-message cap, exact root/message keys, role enum, 500-character limit, malformed/extra values, and snapshot reconstruction forcing `canReadConversation=false`.
- [x] Run focused tests and require missing model/protocol API failures.
- [x] Implement strict model/protocol parsing over the existing pinned client; never send a path and never fallback to offline content.
- [x] Add **查看最近对话** only to eligible live cards; render compact user/Agent rows inline, loading/error/retry/collapse states, dynamic text wrapping and stable dimensions.
- [x] Keep an Activity-only `Map<String,List<ConversationMessage>>`; clear it on new pairing, disconnect, `showConnect` and `onDestroy`; generation/protocol/connection checks must reject late responses.
- [x] Add source/layout contracts proving cached sessions cannot expose the control and conversation text is absent from snapshot/push/notification code.
- [x] Bump Android to `0.3.3` / `versionCode 6`; run focused/full JVM tests, release lint/build/signature/permission checks, then commit `feat(android): expand recent Agent conversation`.

### Task 4: Runtime, Docs And Release

**Files:**
- Modify: `docs/android-install.md`
- Modify: `docs/competitive-parity-2026-07-12.md`
- Modify: this plan.

- [x] Build/restart the desktop app and enable a disposable LAN control pairing.
- [x] Install signed 0.3.3 over 0.3.2 on API 36 and verify `firstInstallTime` is preserved.
- [x] Pair through the visible Android form, expand a real supported conversation, verify chronological user/Agent text and absence of absolute paths/tool controls, then collapse/reopen.
- [x] Rotate while a conversation request is in flight and verify no stale/duplicate rendering; disable networking and verify conversation errors do not use the offline session snapshot.
- [x] Disconnect, verify zero devices/relay secrets and disabled bridge, and overwrite all temporary pairing material.
- [x] Run frontend, relay, Rust, Android JVM and API 36 instrumentation suites plus release lint/build/signature/permission checks.
- [x] Copy 0.3.3 APK/AAB to `build/releases`, record hashes, update docs/checklist, commit `docs(mobile): verify recent conversation disclosure`, rebuild/relaunch desktop and keep the overall Xiaomi goal active.
