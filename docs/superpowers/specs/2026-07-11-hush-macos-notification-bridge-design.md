# Hush macOS Notification Bridge Design

## Goal

Make Hush ingest real notifications delivered locally by WeChat and DingTalk on macOS. The first version is read-only and starts from notifications received after HUMHUM launches. It does not parse private chat databases, recover history, or send replies.

Success means a new WeChat or DingTalk notification appears in the existing Hush inbox within three seconds, survives an app restart, and is not imported twice.

## Current State

Hush already provides:

- a persistent `HushStore` at `~/.humhum/hush-inbox.json`;
- an HTTP ingestion endpoint at `POST /hush/inbox`;
- normalization into sender, chat, text, tier, importance, and suggested reply;
- a `humhum://hush-message` event and a real-data contact view in the Hub.

The existing DingTalk importer only reads explicitly selected JSON/text exports and intentionally skips database/cache files. macOS stores delivered notification records in:

`~/Library/Group Containers/group.com.apple.usernoted/db2/db`

On the target Mac this database is readable, contains WeChat records, and stores notification payloads as binary property lists. WeChat is currently configured to hide message previews, so some records contain only a generic body and a private conversation identifier. Hush must expose that limitation instead of claiming it read unavailable content.

## Chosen Approach

Add a macOS-only notification database watcher in the Rust backend.

Alternative approaches were rejected for this milestone:

- Accessibility/UI observation is brittle, dependent on macOS UI structure, and can miss dismissed banners.
- Direct WeChat and DingTalk database parsing offers richer history but depends on private or encrypted formats and carries a much larger privacy and maintenance cost.

The notification database is the smallest reliable bridge for real, newly delivered local messages.

## Architecture

Create `src-tauri/src/mac_notification_watcher.rs` with three isolated responsibilities:

1. `NotificationSource` opens the SQLite database read-only and fetches records newer than a cursor for allowed bundle identifiers.
2. `NotificationDecoder` decodes the outer binary plist and extracts the app identifier, notification UUID, request/delivery date, title, subtitle, body, and app-specific user data when available.
3. `MacNotificationWatcher` polls every two seconds, normalizes records, inserts them into `HushStore`, and emits `humhum://hush-message`.

The allowed bundle identifiers are fixed for this version:

- `com.tencent.xinwechat` -> `wechat`
- `com.alibaba.dingtalkmac` -> `dingtalk`

The watcher starts during Tauri setup after `HushStore` is managed. Non-macOS builds use no-op status behavior and do not compile macOS database code.

## Startup and Cursor Semantics

On first launch, the watcher reads the maximum current record ID and delivery date, then begins after that point. Existing notification history is not imported.

The checkpoint is stored at `~/.humhum/hush-notification-cursor.json` and contains the last processed record ID plus delivery date. On restart, the watcher resumes from the checkpoint so notifications delivered while HUMHUM was briefly stopped can be imported. If no checkpoint exists, it starts at the current maximum and avoids surprising historical ingestion.

The database may rotate or reuse record IDs. Queries therefore compare the record ID and delivery date, and the store also rejects duplicate source IDs.

## Normalization

Each notification becomes a Hush message with:

- `platform`: `wechat` or `dingtalk`;
- `sender`: notification title, then subtitle, then a human-readable fallback such as `WeChat`;
- `chat`: app-provided conversation name or identifier when available;
- `text`: body, then title/subtitle fallback;
- `received_at`: converted from Apple's reference date to RFC 3339;
- `source_id`: stable value derived from the bundle identifier and notification UUID/record ID;
- `preview_limited`: true when the body is generic or no sender/content preview is available.

`HushStore` gains source-ID deduplication while remaining backward compatible with existing inbox JSON. Raw payload persistence contains only normalized notification metadata required for debugging, not the entire opaque plist blob.

Generic WeChat bodies such as “你收到了一条消息” are retained because they are real notifications, but the UI labels them as limited previews. Hush does not generate a content-specific suggested reply from a limited preview.

## Permissions and Status

The watcher reports one of these states:

- `running`: database readable and polling;
- `permission_required`: database exists but cannot be opened;
- `source_missing`: notification database path does not exist;
- `error`: decoding/query failure, with a safe diagnostic message.

A Tauri command exposes this status to Hush. The Hush page shows the live bridge state, last successful scan, supported apps, and a direct button to open macOS Full Disk Access settings when permission is required.

No notification contents are logged. Repeated failures use throttled logging so the app does not flood logs or the UI.

## Data Flow

```text
macOS usernoted SQLite database
  -> read-only query for new WeChat/DingTalk records
  -> binary plist decoder
  -> normalized Hush inbound message
  -> source-ID deduplication
  -> HushStore persistence
  -> humhum://hush-message
  -> existing Hush inbox and contact views
```

## Error Handling

- A locked or temporarily unavailable database is retried on the next poll.
- A malformed record is skipped and does not stop the watcher.
- A failed inbox write does not advance the cursor for that record.
- Unknown notification payload keys are ignored.
- Empty notifications are skipped unless they at least identify a real app event; generic privacy-limited notifications remain visible.
- If the database is replaced, the watcher reopens it and resumes using the timestamp portion of the cursor.

## Testing

Rust unit tests cover:

- decoding representative WeChat and DingTalk binary plist fixtures with redacted values;
- Apple reference-date conversion;
- generic-preview detection;
- platform and field normalization;
- source-ID deduplication;
- cursor initialization and restart behavior;
- malformed payload isolation.

An integration-style test uses a temporary SQLite database with the same `app` and `record` schema, inserts a notification after watcher initialization, and verifies that exactly one normalized message is emitted/imported.

Manual acceptance on the target Mac:

1. Launch HUMHUM and verify the Hush bridge reports `running`.
2. Receive one WeChat notification and one DingTalk notification.
3. Verify each appears within three seconds with the correct platform.
4. Verify privacy-hidden previews are labeled as limited rather than presented as full messages.
5. Restart HUMHUM and verify no duplicate appears.
6. Remove database access temporarily and verify Hush shows the permission state without crashing.

## Scope Boundaries

This milestone does not import historical chats, decrypt app databases, infer hidden message text, send replies, or support non-macOS notification stores. Rich per-app bridges can be designed later without changing the Hush inbox contract introduced here.
