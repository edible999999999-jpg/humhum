# Hush DWS Read-Only Bridge Design

## Goal

Connect Hush to DingTalk Workspace CLI (DWS) so a user can import recent messages
from all accessible DingTalk group and direct conversations without depending on
the macOS Notification Center database.

The first release is local-first and read-only. It does not send, reply to,
forward, react to, pin, or recall DingTalk messages.

## Confirmed Product Decisions

- Product naming is unified as `钉钉` in user-facing copy. Code keeps the existing
  `DingTalk` types and `dingtalk` connector key without exposing a separate product.
- Initial synchronization covers the previous 24 hours.
- All conversations returned by `dws chat message list-all` are eligible,
  including group chats and direct messages.
- Hush provides a manual synchronization action.
- Background synchronization is optional, runs every five minutes when enabled,
  and is disabled by default.
- DWS messages are retained locally for seven days, up to 2,000 messages.
- DWS message content is stored only in the existing local Hush inbox.
- No cloud service or external summarization API is introduced.

## Approaches Considered

### 1. Tauri invokes DWS directly (selected)

The Rust backend launches DWS with fixed, read-only arguments and parses its JSON
output. This reuses DWS authentication, audit, and structured response handling
without introducing another long-running process.

Advantages:

- Fits the existing Tauri command and local store architecture.
- Works with both standalone DWS and the DWS bundled with Wukong.
- Gives Hush direct control over synchronization, timeouts, pagination, status,
  deduplication, and retention.
- Keeps write-capable DingTalk commands outside the bridge.

### 2. External script posts to `/hush/inbox`

This is quick to prototype but creates an unmanaged process and leaves lifecycle,
authentication, diagnostics, and synchronization state outside HumHum.

### 3. DingTalk bot or webhook push

This offers lower latency but requires bot provisioning, group configuration, and
more complex authorization. It is not necessary for the first read-only release.

## DWS Discovery and Authentication

The bridge resolves DWS in this order:

1. A standalone `dws` executable found on `PATH`.
2. The Wukong-bundled executable:
   - macOS: `~/.real/.bin/dws/bin/dws`
   - Windows: `%USERPROFILE%/.real/.bin/dws/bin/dws.exe`
3. If neither exists, report `not_installed` and show installation guidance.

HumHum does not automatically download or install DWS.

For a standalone DWS installation, Hush can launch `dws auth login` when the user
explicitly clicks the login action. For Wukong-bundled DWS, authentication is
owned by Wukong; Hush opens Wukong and asks the user to complete login there.

Before synchronization, Hush runs `dws auth status`. It never reads or stores
access tokens.

## Architecture

### `dws_hush_bridge.rs`

A focused Rust module owns:

- executable discovery;
- authentication status parsing;
- fixed read-only command construction;
- bounded process execution and cancellation;
- JSON decoding;
- `list-all` pagination;
- conversion from DWS messages to Hush inbound payloads;
- synchronization status and persisted configuration.

The module invokes commands directly with `tokio::process::Command`; it does not
construct a shell command string.

Only these DWS command families are permitted:

```text
dws auth status
dws auth login
dws chat message list-all
```

The Wukong fallback may additionally open the Wukong application for login. No
other chat command is exposed through this bridge.

### Persisted configuration

Store connector state in `~/.humhum/hush-dws.json`:

```json
{
  "auto_sync_enabled": false,
  "sync_interval_minutes": 5,
  "last_success_at": null,
  "last_attempt_at": null,
  "pending_sync": null
}
```

`pending_sync` contains only the active query start/end timestamps and the opaque
`nextCursor` required to resume a bounded backfill. Tokens, organization
credentials, message bodies, and command output are not written to this file.

### Hush store integration

Each DWS message becomes a normal `HushInboundPayload`:

- `platform`: `dingtalk`
- `sender`: DWS sender display name
- `chat`: conversation title
- `text`: message content
- `received_at`: converted DWS creation time
- `source_id`: `dws:<openMessageId>`
- `preview_limited`: `false`
- raw metadata: conversation ID, direct/group flag, quoted message metadata, and
  source marker `dws`

`source_id` provides idempotent imports across overlapping windows and repeated
manual synchronizations.

The existing Hush inbox limit changes from 500 messages to:

- delete DWS messages older than seven days;
- sort messages by `received_at` before enforcing limits;
- retain at most 2,000 total messages after pruning;
- preserve existing non-DWS messages unless the total limit requires removing
  the oldest entries.

## Synchronization Flow

### Initial synchronization

1. Verify DWS is installed and authenticated.
2. Set the query interval to now minus 24 hours through now.
3. Run `dws chat message list-all` with JSON output, a page size of 50, and cursor
   `0`.
4. Parse every conversation and message in `conversationMessagesList`.
5. Continue with `nextCursor` while `hasMore` is true.
6. Deduplicate by `openMessageId` and insert new messages into Hush.
7. Prune by age and total count.
8. Persist `last_success_at` only after the full bounded synchronization succeeds.

If the per-run page bound is reached, persist the query interval and
`nextCursor` in `pending_sync`. The next manual or automatic synchronization
resumes that exact query before starting a new incremental interval. Clear
`pending_sync` only when `hasMore` becomes false.

### Incremental synchronization

Resume `pending_sync` first when it exists. Otherwise use `last_success_at` minus
two minutes as the next start time. The overlap avoids losing messages at
timestamp boundaries; source ID deduplication removes repeats.

### Bounds

One synchronization is bounded by:

- 50 messages per DWS page;
- at most 40 pages or 2,000 examined messages;
- a per-command timeout;
- one active synchronization at a time.

If the bound is reached while `hasMore` remains true, Hush reports a partial
result, persists the resume cursor, and does not pretend the interval was fully
synchronized.

## Tauri Commands

Add commands for:

- `get_hush_dws_status`
- `sync_hush_dws`
- `set_hush_dws_auto_sync`
- `open_hush_dws_login`

`sync_hush_dws` returns counts for conversations, examined messages, imported
messages, duplicates, pages, and whether the result was partial.

## Frontend

Replace the current DingTalk local-export emphasis with a DWS connector panel:

- executable source: standalone DWS or Wukong;
- installation and authentication state;
- last successful synchronization time;
- manual `Sync last 24 hours` action;
- automatic synchronization toggle, visibly off by default;
- imported, duplicate, and partial-result counts;
- actionable errors for missing DWS, missing login, timeout, authorization, and
  unsupported response shapes.

The existing Notification Center bridge remains available as a separate fallback
for WeChat and DingTalk notification previews. DWS does not require Full Disk
Access.

The inbox continues to display messages by sender and conversation. DWS messages
receive a visible `DWS` source marker so users can distinguish complete message
content from limited notification previews.

## Background Synchronization

When enabled, a single Tauri background task runs every five minutes. It:

- skips a tick when another synchronization is active;
- stops cleanly when the application exits;
- uses the same synchronization function as the manual command;
- records errors in connector status without clearing prior inbox data.

Automatic synchronization remains disabled after installation and upgrades until
the user enables it.

## Error Handling

- Missing executable: report installation guidance.
- Standalone DWS not authenticated: expose the login action.
- Wukong DWS not authenticated: open Wukong and explain that Wukong owns login.
- Authorization failure: surface DWS error text without tokens or full command
  output.
- Malformed JSON or response drift: fail the page, preserve existing data, and
  report an unsupported response error.
- Timeout or process failure: terminate the child process and preserve
  `last_success_at`.
- Duplicate messages: count and skip them without treating them as errors.
- Partial pagination: keep imported pages, persist the resume cursor, mark the
  result partial, and retain the previous complete synchronization boundary.

## Testing

Rust tests cover:

- standalone and Wukong executable discovery precedence;
- JSON parsing for group and direct conversations;
- pagination and cursor handling;
- persisted partial synchronization and next-run resume behavior;
- 24-hour initial and two-minute-overlap incremental windows;
- source ID deduplication;
- timeout, authentication, malformed JSON, and partial-result behavior;
- seven-day and 2,000-message retention;
- command allowlisting so write-capable DWS arguments cannot be introduced.

Frontend verification covers:

- installed, missing, unauthenticated, syncing, partial, and error states;
- manual synchronization;
- auto-sync toggle persistence;
- DWS source labels and message counts.

Build verification runs:

```text
npm run build
cargo test --lib
cargo check
```

## Out of Scope

- Sending or replying to DingTalk messages.
- Bots, webhooks, cards, reactions, forwarding, pinning, or recalls.
- AI-generated replies sent back to DingTalk.
- Downloading message images or attachments.
- Cross-organization synchronization.
- Unlimited history backfill.
- Automatic DWS installation or credential management.
