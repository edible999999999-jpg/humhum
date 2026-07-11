# Hush macOS Notification Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest newly delivered WeChat and DingTalk notifications from the local macOS notification database into Hush within three seconds, without duplicates or private chat database access.

**Architecture:** A macOS-only Rust watcher polls the read-only `usernoted` SQLite database, decodes binary property-list payloads, and normalizes supported records into the existing Hush store. A persistent cursor prevents historical surprise imports and duplicate restarts, while a small status command lets the Hush UI explain whether the bridge is running or needs Full Disk Access.

**Tech Stack:** Tauri v2, Rust 2021, `rusqlite`, `plist`, Serde, React 18, TypeScript, Vitest-free Rust unit/integration tests

## Global Constraints

- The bridge is read-only and supports only notifications received after the first watcher initialization.
- Supported bundle identifiers are exactly `com.tencent.xinwechat` and `com.alibaba.dingtalkmac`.
- Polling interval is two seconds and manual acceptance latency is at most three seconds.
- Do not parse private chat databases, recover chat history, infer hidden content, or send replies.
- Persist only normalized notification metadata, never the opaque binary plist payload.
- Existing `~/.humhum/hush-inbox.json` files must continue to deserialize.

---

## File Map

- Create `src-tauri/src/mac_notification_watcher.rs`: database access, plist decoding, cursor persistence, polling loop, bridge status, and focused Rust tests.
- Modify `src-tauri/Cargo.toml`: add macOS-only `plist` and `rusqlite` dependencies.
- Modify `src-tauri/src/hush_store.rs`: accept source timestamps/IDs, flag limited previews, and deduplicate imports.
- Modify `src-tauri/src/lib.rs`: manage watcher status, start the watcher, and register status/settings commands.
- Modify `src-tauri/src/commands.rs`: expose bridge status and open Full Disk Access settings.
- Modify `src/components/Hub/HushModule.tsx`: display live bridge state and limited-preview truth labels.

### Task 1: Extend the Hush message contract and deduplication

**Files:**
- Modify: `src-tauri/src/hush_store.rs`

**Interfaces:**
- Consumes: existing `HushStore::add_from_value(raw: Value)` callers.
- Produces: `HushInboxMessage.source_id: Option<String>`, `preview_limited: bool`, source-aware `received_at`, and duplicate rejection through `HushStore::contains_source_id(&str) -> bool`.

- [ ] **Step 1: Write failing backward-compatibility and deduplication tests**

Add tests that construct a temporary `HushStore`, deserialize a legacy message without the new fields, insert a payload with `source_id`, and then assert a second insert returns the existing duplicate error:

```rust
#[test]
fn legacy_messages_default_new_notification_fields() {
    let message: HushInboxMessage = serde_json::from_value(serde_json::json!({
        "id": "legacy", "platform": "wechat", "sender": "WeChat",
        "chat": null, "text": "hello", "tier": "friends", "importance": 2,
        "suggested_reply": null, "received_at": "2026-07-11T00:00:00Z", "raw": {}
    })).unwrap();
    assert_eq!(message.source_id, None);
    assert!(!message.preview_limited);
}

#[test]
fn rejects_duplicate_source_id() {
    let mut store = HushStore::with_file_path(temp_file("dedupe"));
    let payload = serde_json::json!({
        "platform": "wechat", "sender": "WeChat", "text": "你收到了一条消息",
        "source_id": "wechat:abc", "preview_limited": true,
        "received_at": "2026-07-11T01:02:03Z"
    });
    store.add_from_value(payload.clone()).unwrap();
    assert!(store.add_from_value(payload).unwrap_err().contains("Duplicate source message"));
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml hush_store::tests -- --nocapture`

Expected: compilation fails because the new fields and test constructor do not exist.

- [ ] **Step 3: Implement the minimal compatible message fields and deduplication**

Add optional/defaulted fields to both serialized types, accept source timestamps, and check before insertion:

```rust
#[serde(default)]
pub source_id: Option<String>,
#[serde(default)]
pub preview_limited: bool,

pub fn contains_source_id(&self, source_id: &str) -> bool {
    self.messages.iter().any(|message| message.source_id.as_deref() == Some(source_id))
}
```

Use `parsed.received_at.unwrap_or_else(|| chrono::Utc::now().to_rfc3339())`. When `preview_limited` is true, do not call `suggest_reply`. Add `HushStore::with_file_path` under `#[cfg(test)]` so tests never touch the real inbox.

- [ ] **Step 4: Run focused tests and formatting**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml hush_store::tests -- --nocapture`

Expected: formatting and all Hush store tests pass.

- [ ] **Step 5: Commit the message contract**

```bash
git add src-tauri/src/hush_store.rs
git commit -m "feat(hush): deduplicate notification messages"
```

### Task 2: Decode and query macOS notifications

**Files:**
- Create: `src-tauri/src/mac_notification_watcher.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: macOS `app(app_id, identifier)` and `record(rec_id, app_id, uuid, data, delivered_date)` tables.
- Produces: `NotificationCursor`, `DecodedNotification`, `fetch_new_notifications(path, cursor)`, `initial_cursor(path)`, and `decode_notification(record)` for the polling loop.

- [ ] **Step 1: Add macOS-only dependencies and write failing decoder tests**

Add under `[target.'cfg(target_os = "macos")'.dependencies]`:

```toml
plist = "1"
rusqlite = { version = "0.32", features = ["bundled"] }
```

Write tests in the new module that serialize redacted plist fixtures and verify platform mapping, title/body/chat extraction, Apple epoch conversion, and generic preview detection:

```rust
#[test]
fn decodes_privacy_limited_wechat_notification() {
    let data = fixture_plist("com.tencent.xinWeChat", None, "你收到了一条消息", Some("room_42"));
    let decoded = decode_payload(7, "com.tencent.xinwechat", &[1, 2, 3], &data, 805_442_595.0).unwrap();
    assert_eq!(decoded.platform, "wechat");
    assert_eq!(decoded.sender, "WeChat");
    assert_eq!(decoded.chat.as_deref(), Some("room_42"));
    assert!(decoded.preview_limited);
    assert!(decoded.suggested_reply.is_none());
}

#[test]
fn decodes_visible_dingtalk_notification() {
    let data = fixture_plist("com.alibaba.DingTalkMac", Some("项目群"), "需求文档已更新", None);
    let decoded = decode_payload(8, "com.alibaba.dingtalkmac", &[4, 5, 6], &data, 805_442_596.0).unwrap();
    assert_eq!(decoded.platform, "dingtalk");
    assert_eq!(decoded.sender, "项目群");
    assert_eq!(decoded.text, "需求文档已更新");
    assert!(!decoded.preview_limited);
}
```

- [ ] **Step 2: Run decoder tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mac_notification_watcher::tests -- --nocapture`

Expected: compilation fails because the module and decoder do not exist.

- [ ] **Step 3: Implement decoder, cursor, and read-only query**

Define focused serializable types:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct NotificationCursor { pub delivered_date: f64, pub record_id: i64 }

#[derive(Debug, Clone)]
struct NotificationRecord { record_id: i64, bundle_id: String, uuid: Vec<u8>, data: Vec<u8>, delivered_date: f64 }

#[derive(Debug, Clone)]
struct DecodedNotification {
    platform: String, sender: String, chat: Option<String>, text: String,
    source_id: String, received_at: String, preview_limited: bool,
    suggested_reply: Option<String>, cursor: NotificationCursor,
}
```

Open SQLite with `OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX`. Query supported lowercased identifiers ordered by `(delivered_date, rec_id)` and compare both cursor fields. Decode `data` with `plist::Value::from_reader(Cursor::new(data))`; read `req.titl`, `req.subt`, `req.body`, and `req.iden` with full-word fallbacks. Convert Apple seconds using `2001-01-01T00:00:00Z + Duration::milliseconds(seconds * 1000)`.

Build `source_id` from the lowercased bundle ID plus UUID hex, falling back to record ID. Treat an empty body or exact generic strings `你收到了一条消息`, `You received a message`, and `You have a new message` as limited previews.

- [ ] **Step 4: Add temporary-SQLite query tests**

Create the production-shape schema in a temporary database, initialize the cursor, insert one WeChat record after initialization, and assert `fetch_new_notifications` returns it exactly once. Add a malformed plist row and assert the valid row is still returned while the malformed row becomes a nonfatal decode error count.

- [ ] **Step 5: Run decoder/query tests and formatting**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml mac_notification_watcher::tests -- --nocapture`

Expected: all watcher decoder and SQLite tests pass.

- [ ] **Step 6: Commit the source reader**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/mac_notification_watcher.rs
git commit -m "feat(hush): read macOS notification records"
```

### Task 3: Run the watcher and expose bridge status

**Files:**
- Modify: `src-tauri/src/mac_notification_watcher.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `HushStore::contains_source_id`, `HushStore::add_from_value`, `fetch_new_notifications`, and Tauri `AppHandle`.
- Produces: managed `Arc<Mutex<MacNotificationBridgeStatus>>`, `start_watcher(app: AppHandle)`, `get_hush_notification_bridge_status`, and `open_full_disk_access_settings`.

- [ ] **Step 1: Write failing cursor-restart and status tests**

Test that a missing cursor initializes to the database maximum without importing history, a saved cursor resumes after restart, and permission errors map to `permission_required`:

```rust
#[test]
fn missing_cursor_starts_after_existing_records() {
    let db = temp_notification_db("initial-cursor");
    insert_fixture_record(&db, 41, "com.tencent.xinwechat", 100.0, "existing");
    let cursor_file = temp_file("initial-cursor.json");
    let cursor = load_or_initialize_cursor(&db, &cursor_file).unwrap();
    assert_eq!(cursor, NotificationCursor { delivered_date: 100.0, record_id: 41 });
    assert!(fetch_new_notifications(&db, &cursor).unwrap().notifications.is_empty());
}

#[test]
fn saved_cursor_resumes_with_next_record() {
    let db = temp_notification_db("resume-cursor");
    insert_fixture_record(&db, 41, "com.tencent.xinwechat", 100.0, "existing");
    let cursor_file = temp_file("resume-cursor.json");
    let first = load_or_initialize_cursor(&db, &cursor_file).unwrap();
    save_cursor(&cursor_file, &first).unwrap();
    insert_fixture_record(&db, 42, "com.tencent.xinwechat", 101.0, "new");
    let resumed = load_or_initialize_cursor(&db, &cursor_file).unwrap();
    let batch = fetch_new_notifications(&db, &resumed).unwrap();
    assert_eq!(batch.notifications.len(), 1);
    assert_eq!(batch.notifications[0].cursor.record_id, 42);
}

#[test]
fn permission_denied_maps_to_actionable_status() {
    let status = status_from_source_error(SourceError::PermissionDenied("denied".into()));
    assert_eq!(status.state, "permission_required");
}
```

- [ ] **Step 2: Run watcher tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mac_notification_watcher::tests -- --nocapture`

Expected: new lifecycle/status symbols are missing.

- [ ] **Step 3: Implement polling lifecycle and safe cursor advancement**

Manage status with:

```rust
#[derive(Debug, Clone, Serialize, Default)]
pub struct MacNotificationBridgeStatus {
    pub state: String,
    pub message: String,
    pub last_scan_at: Option<String>,
    pub supported_apps: Vec<String>,
}
```

`start_watcher` spawns one named thread, loads or initializes `~/.humhum/hush-notification-cursor.json`, polls every two seconds, converts each decoded item to `serde_json::json!`, and calls the managed `HushStore`. Emit `humhum://hush-message` only after successful persistence. Save and advance the cursor after a successful insert or a confirmed duplicate; do not advance it after a write failure. Reopen SQLite on every poll so database replacement and WAL changes are visible.

- [ ] **Step 4: Add commands and Tauri startup wiring**

Expose status by cloning the managed mutex value. Open Full Disk Access with:

```rust
Command::new("open")
    .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
    .output().await
```

In `lib.rs`, declare the module, manage default status immediately after `HushStore`, start the watcher on macOS, and register both commands.

- [ ] **Step 5: Run all Rust tests and compile checks**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: all tests pass and the Tauri backend compiles; existing Cocoa deprecation warnings may remain.

- [ ] **Step 6: Commit watcher integration**

```bash
git add src-tauri/src/mac_notification_watcher.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(hush): watch local macOS notifications"
```

### Task 4: Surface bridge truth in Hush and verify locally

**Files:**
- Modify: `src/components/Hub/HushModule.tsx`
- Modify: `src/lib/i18n/translations.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: `get_hush_notification_bridge_status`, `open_full_disk_access_settings`, and new inbox fields `source_id`/`preview_limited`.
- Produces: visible bridge status, permission action, and limited-preview labeling in the existing Hush page.

- [ ] **Step 1: Add typed status loading and event refresh**

Define the frontend type and fetch it alongside connectors/inbox:

```ts
interface NotificationBridgeStatus {
  state: "running" | "permission_required" | "source_missing" | "error";
  message: string;
  last_scan_at: string | null;
  supported_apps: string[];
}
```

Extend `HushInboxMessage` with `source_id: string | null` and `preview_limited: boolean`. Keep the existing `humhum://hush-message` listener as the inbox refresh trigger and poll bridge status every five seconds.

- [ ] **Step 2: Render the status and limited-preview states**

Add a compact un-nested status band above `LiveInboxPanel`. Show WeChat and DingTalk as supported, the latest scan time, and an icon/text action only for `permission_required`. In message rows, render the translated label `系统通知未包含消息预览` when `preview_limited` is true and hide suggested replies for those records.

- [ ] **Step 3: Add Chinese/English copy and update roadmap truth**

Add translation keys for running, permission required, missing source, error, last scan, open settings, and limited preview. Update README roadmap wording from “real message bridges” to “macOS WeChat/DingTalk notification bridge complete; richer history bridges remain planned.”

- [ ] **Step 4: Run frontend and backend verification**

Run: `npm run build`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: TypeScript/Vite build succeeds and all Rust tests pass.

- [ ] **Step 5: Launch and exercise the real local bridge**

Run: `npm run tauri dev`

Verify the Hush page reports `running`. Record the current inbox total, generate or receive one real WeChat/DingTalk notification, wait at most three seconds, and verify the total increases by one with the correct platform. Restart the app and verify the same `source_id` is not duplicated. If the current app's notification preview is generic, verify the limited-preview label appears.

- [ ] **Step 6: Commit the product surface and documentation**

```bash
git add src/components/Hub/HushModule.tsx src/lib/i18n/translations.ts README.md README.zh-CN.md
git commit -m "feat(hush): show local notification bridge status"
```

- [ ] **Step 7: Final repository checks**

Run: `git diff --check`

Run: `git status --short --branch`

Expected: only the user's pre-existing untracked `design-qa-assets/` and `design-qa.md` remain; implementation files are committed.
