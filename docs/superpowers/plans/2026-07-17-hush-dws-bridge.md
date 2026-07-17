# Hush DingTalk DWS Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, read-only DingTalk DWS bridge that imports recent group and direct messages into Hush with manual sync and optional background sync.

**Architecture:** A focused Rust module discovers DWS, verifies authentication, executes only allowlisted read-only commands, parses paginated JSON, and writes normalized records through the existing `HushStore`. Tauri commands expose status and controls to a replacement DingTalk panel in `HushModule.tsx`; persisted connector state contains only sync settings and cursors.

**Tech Stack:** Rust 2021, Tokio process/time/sync, Serde/Serde JSON, Chrono, Tauri v2 commands and managed state, React 18, TypeScript, Vitest/build tooling.

## Global Constraints

- User-facing naming is only `钉钉`; code identifiers keep the existing `DingTalk` types or `dingtalk` connector key.
- The bridge is read-only and may execute only `dws auth status`, `dws auth login`, and `dws chat message list-all`.
- Do not install DWS automatically, store credentials, call cloud summarization APIs, or send/reply to messages.
- Discover standalone `dws` on `PATH` before `~/.real/.bin/dws/bin/dws`; the bundled executable opens Wukong for login.
- Initial sync is the previous 24 hours; incremental sync overlaps the last success boundary by two minutes.
- A run uses page size 50 and stops after 40 pages or 2,000 examined messages, persisting a resume cursor when partial.
- Automatic sync runs every five minutes only after explicit opt-in and is disabled by default.
- Retain DWS messages for seven days and retain at most 2,000 total Hush messages.
- Preserve the current uncommitted Hype changes in `commands.rs`, `lib.rs`, `knowledge_store.rs`, `KnowledgeModule.tsx`, `types/index.ts`, and `skill_index.rs`.

---

## File Structure

- Create `src-tauri/src/dws_hush_bridge.rs`: DWS discovery, status/config persistence, command execution, JSON parsing, pagination, synchronization, and background loop.
- Modify `src-tauri/src/hush_store.rs`: batch-friendly insertion, DWS age pruning, stable chronological sorting, and 2,000-message total cap.
- Modify `src-tauri/src/commands.rs`: four narrow Tauri commands that delegate to `DwsHushBridge`.
- Modify `src-tauri/src/lib.rs`: module registration, managed state, background task startup, and invoke registration.
- Modify `src/components/Hub/HushModule.tsx`: replace the local-export-first panel with the DingTalk DWS status and sync controls; remove split product naming.
- Test in Rust modules beside the implementation and verify the frontend through TypeScript production build.

### Task 1: Hush Retention and Batch Import

**Files:**
- Modify: `src-tauri/src/hush_store.rs`
- Test: `src-tauri/src/hush_store.rs` inline `#[cfg(test)]` module

**Interfaces:**
- Consumes: existing `HushStore::add_from_value(Value) -> Result<HushInboxMessage, String>`.
- Produces: `HushStore::prune_and_save(&mut self, now: DateTime<Utc>) -> Result<(), String>` and a 2,000-message capacity usable by the DWS synchronizer.

- [ ] **Step 1: Write failing tests for retention and ordering**

Add tests that construct messages through `add_from_value`, then call `prune_and_save`:

```rust
#[test]
fn prunes_old_dws_messages_but_preserves_recent_and_non_dws_messages() {
    let path = temp_file("retention");
    let mut store = HushStore::with_file_path(path.clone());
    let now = chrono::DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    for (source_id, platform, received_at) in [
        ("dws:old", "dingtalk", "2026-07-09T11:59:59Z"),
        ("dws:recent", "dingtalk", "2026-07-17T11:00:00Z"),
        ("wechat:old", "wechat", "2026-06-01T00:00:00Z"),
    ] {
        store.add_from_value(json!({
            "platform": platform,
            "sender": "sender",
            "text": source_id,
            "source_id": source_id,
            "received_at": received_at,
            "raw": {"source": if source_id.starts_with("dws:") { "dws" } else { "notification" }}
        })).unwrap();
    }
    store.prune_and_save(now).unwrap();
    let ids: Vec<_> = store.summary().messages.into_iter()
        .filter_map(|message| message.source_id).collect();
    assert_eq!(ids, vec!["dws:recent", "wechat:old"]);
    let _ = std::fs::remove_file(path);
}

#[test]
fn sorts_newest_first_before_enforcing_total_limit() {
    let path = temp_file("limit");
    let mut store = HushStore::with_file_path(path.clone());
    for index in 0..=MAX_HUSH_MESSAGES {
        store.add_from_value(json!({
            "platform": "wechat",
            "sender": "sender",
            "text": index.to_string(),
            "source_id": format!("wechat:{index}"),
            "received_at": format!("2026-07-17T{:02}:{:02}:00Z", (index / 60) % 24, index % 60)
        })).unwrap();
    }
    let summary = store.summary();
    assert_eq!(summary.total, MAX_HUSH_MESSAGES);
    assert_eq!(summary.messages.first().unwrap().source_id.as_deref(), Some("wechat:2000"));
    let _ = std::fs::remove_file(path);
}
```

- [ ] **Step 2: Run tests and confirm the new API/limit fail**

Run: `cd src-tauri && cargo test hush_store::tests -- --nocapture`

Expected: compile failure because `prune_and_save` is missing and the existing `MAX_HUSH_MESSAGES` is 500.

- [ ] **Step 3: Implement chronological retention**

Set:

```rust
const MAX_HUSH_MESSAGES: usize = 2_000;
const DWS_RETENTION_DAYS: i64 = 7;
```

Add a shared `prune` method used by `add_from_value` and the public finalizer:

```rust
pub fn prune_and_save(&mut self, now: chrono::DateTime<chrono::Utc>) -> Result<(), String> {
    let cutoff = now - chrono::Duration::days(DWS_RETENTION_DAYS);
    self.messages.retain(|message| {
        let is_dws = message.source_id.as_deref().is_some_and(|id| id.starts_with("dws:"))
            || message.raw.get("source").and_then(Value::as_str) == Some("dws");
        if !is_dws {
            return true;
        }
        chrono::DateTime::parse_from_rfc3339(&message.received_at)
            .map(|timestamp| timestamp.with_timezone(&chrono::Utc) >= cutoff)
            .unwrap_or(true)
    });
    self.messages.sort_by(|left, right| right.received_at.cmp(&left.received_at));
    self.messages.truncate(MAX_HUSH_MESSAGES);
    self.save()
}
```

Call the same sorting and truncation after normal insertion so old producers remain compatible.

- [ ] **Step 4: Run Hush tests**

Run: `cd src-tauri && cargo test hush_store::tests -- --nocapture`

Expected: all Hush store tests pass.

### Task 2: DWS Discovery, Parsing, and Allowlist

**Files:**
- Create: `src-tauri/src/dws_hush_bridge.rs`
- Modify: `src-tauri/src/lib.rs` only to declare `mod dws_hush_bridge;`
- Test: `src-tauri/src/dws_hush_bridge.rs` inline `#[cfg(test)]` module

**Interfaces:**
- Consumes: `HushStore::contains_source_id`, `HushStore::add_from_value`, and `HushStore::prune_and_save`.
- Produces: `DwsExecutable`, `DwsPage`, `DwsMessage`, `DwsHushStatus`, `DwsSyncReport`, `DwsHushBridge`, and `discover_dws_with(path_lookup, home)`.

- [ ] **Step 1: Add failing discovery and parsing tests**

Use a resolver closure and temp home to verify standalone precedence, bundled fallback, and missing state. Parse a fixture containing one group chat and one direct chat:

```rust
#[test]
fn parses_group_and_direct_messages() {
    let page = parse_page(r#"{
      "success": true,
      "result": {
        "conversationMessagesList": [
          {"openConversationId":"cid-group","singleChat":false,"title":"项目群",
           "messages":[{"content":"群消息","createTime":"2026-07-17 11:53:52",
             "openMessageId":"mid-group","sender":"小明","senderOpenDingTalkId":"u1"}]},
          {"openConversationId":"cid-direct","singleChat":true,"title":"小红",
           "messages":[{"content":"私聊","createTime":"2026-07-17 11:54:52",
             "openMessageId":"mid-direct","sender":"小红","senderOpenDingTalkId":"u2"}]}
        ],
        "hasMore": true,
        "nextCursor": "opaque-next"
      }
    }"#).unwrap();
    assert_eq!(page.conversations.len(), 2);
    assert!(page.has_more);
    assert_eq!(page.next_cursor.as_deref(), Some("opaque-next"));
    assert_eq!(page.conversations[0].messages[0].open_message_id, "mid-group");
}

#[test]
fn rejects_non_allowlisted_command_shape() {
    assert!(validate_dws_args(&["chat", "message", "list-all"]).is_ok());
    assert!(validate_dws_args(&["chat", "message", "send"]).is_err());
    assert!(validate_dws_args(&["chat", "message", "recall"]).is_err());
}
```

- [ ] **Step 2: Run the module tests and confirm failure**

Run: `cd src-tauri && cargo test dws_hush_bridge::tests -- --nocapture`

Expected: compile failure because the module types/functions do not exist.

- [ ] **Step 3: Implement discovery, strict args, JSON types, and normalization**

Define executable origin and public response types:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DwsExecutableSource { Standalone, Wukong }

#[derive(Debug, Clone)]
pub struct DwsExecutable {
    pub path: PathBuf,
    pub source: DwsExecutableSource,
}

#[derive(Debug, Clone, Serialize)]
pub struct DwsSyncReport {
    pub conversations: usize,
    pub examined_messages: usize,
    pub imported_messages: usize,
    pub duplicate_messages: usize,
    pub pages: usize,
    pub partial: bool,
    pub next_cursor: Option<String>,
}
```

Deserialize the DWS envelope with `#[serde(rename_all = "camelCase")]`, require `success == true`, and reject missing `result`. Normalize timestamps with:

```rust
fn dws_timestamp_to_rfc3339(value: &str) -> Result<String, String> {
    chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map(|value| value.and_local_timezone(chrono::Local).single()
            .ok_or_else(|| format!("Ambiguous DingTalk timestamp: {value}")))
        .map_err(|error| format!("Unsupported DingTalk timestamp: {error}"))?
        .map(|value| value.with_timezone(&chrono::Utc).to_rfc3339())
}
```

Map each message to a `serde_json::Value` containing:

```rust
json!({
    "platform": "dingtalk",
    "sender": message.sender,
    "chat": conversation.title,
    "text": message.content,
    "received_at": dws_timestamp_to_rfc3339(&message.create_time)?,
    "source_id": format!("dws:{}", message.open_message_id),
    "preview_limited": false,
    "source": "dws",
    "conversation_id": conversation.open_conversation_id,
    "single_chat": conversation.single_chat,
    "quoted_message": message.quoted_message
})
```

The allowlist accepts exactly `["auth","status"]`, `["auth","login"]`, and a `chat message list-all` prefix followed only by `--start`, `--end`, `--limit`, `--cursor`, `--format`, and `-y` values.

- [ ] **Step 4: Run discovery and parser tests**

Run: `cd src-tauri && cargo test dws_hush_bridge::tests -- --nocapture`

Expected: discovery, parsing, timestamp, normalization, and allowlist tests pass.

### Task 3: Persisted Sync State and Bounded Pagination

**Files:**
- Modify: `src-tauri/src/dws_hush_bridge.rs`
- Test: `src-tauri/src/dws_hush_bridge.rs` inline tests

**Interfaces:**
- Consumes: Task 2 parsing/normalization and `Arc<Mutex<HushStore>>`.
- Produces:
  - `DwsHushBridge::load_or_create(home: &Path) -> Result<Self, String>`
  - `DwsHushBridge::status(&self) -> DwsHushStatus`
  - `DwsHushBridge::sync(&self, hush: Arc<Mutex<HushStore>>) -> Result<DwsSyncReport, String>`
  - `DwsHushBridge::set_auto_sync(&self, enabled: bool) -> Result<DwsHushStatus, String>`
  - `DwsHushBridge::open_login(&self) -> Result<(), String>`

- [ ] **Step 1: Add failing window, resume, and pagination tests**

Inject a `DwsRunner` trait:

```rust
#[async_trait]
trait DwsRunner: Send + Sync {
    async fn run(&self, executable: &Path, args: &[String], timeout: Duration)
        -> Result<String, String>;
}
```

Use a fake runner that records args and returns two pages. Assert initial start is now minus 24 hours, page two receives `nextCursor`, repeated IDs increment `duplicate_messages`, and a 40-page response persists:

```rust
assert_eq!(config.pending_sync.as_ref().unwrap().next_cursor, "cursor-40");
assert!(report.partial);
assert_eq!(report.pages, 40);
```

Reload the bridge from the same temp directory and assert the next run begins with `cursor-40`. Add an incremental-window test that verifies `last_success_at - 2 minutes`.

- [ ] **Step 2: Run tests and confirm orchestration APIs fail**

Run: `cd src-tauri && cargo test dws_hush_bridge::tests -- --nocapture`

Expected: compile failure for missing config, runner, and sync APIs.

- [ ] **Step 3: Implement config/state and bounded synchronization**

Persist:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DwsHushConfig {
    pub auto_sync_enabled: bool,
    pub sync_interval_minutes: u64,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub pending_sync: Option<DwsPendingSync>,
}

impl Default for DwsHushConfig {
    fn default() -> Self {
        Self {
            auto_sync_enabled: false,
            sync_interval_minutes: 5,
            last_success_at: None,
            last_attempt_at: None,
            pending_sync: None,
        }
    }
}
```

Keep mutable config/status behind `tokio::sync::Mutex`, use `AtomicBool::compare_exchange` to reject concurrent syncs, and write `~/.humhum/hush-dws.json` atomically through a sibling temporary file and `rename`.

For each page execute:

```rust
vec![
    "chat", "message", "list-all",
    "--start", &start.format("%Y-%m-%d %H:%M:%S").to_string(),
    "--end", &end.format("%Y-%m-%d %H:%M:%S").to_string(),
    "--limit", "50",
    "--cursor", &cursor,
    "--format", "json",
    "-y",
]
```

Stop at 40 pages or 2,000 examined messages. Insert while holding the standard Hush mutex only for `contains_source_id` plus insertion, then call `prune_and_save(Utc::now())`. On partial success persist the fixed interval and cursor without moving `last_success_at`; on complete success clear `pending_sync` and set `last_success_at` to the interval end.

- [ ] **Step 4: Add error-path tests**

Verify unauthenticated `auth status`, malformed JSON, command timeout, and a non-success DWS envelope preserve inbox contents and the previous `last_success_at`. Verify duplicate IDs are non-errors.

- [ ] **Step 5: Run all DWS tests**

Run: `cd src-tauri && cargo test dws_hush_bridge::tests -- --nocapture`

Expected: all DWS bridge tests pass with no real DWS process launched.

### Task 4: Tauri Commands and Background Sync

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/dws_hush_bridge.rs` inline tests plus Rust compile

**Interfaces:**
- Consumes: `Arc<DwsHushBridge>` and `Arc<std::sync::Mutex<HushStore>>`.
- Produces Tauri commands `get_hush_dws_status`, `sync_hush_dws`, `set_hush_dws_auto_sync`, and `open_hush_dws_login`.

- [ ] **Step 1: Add command wrappers**

Add narrow wrappers:

```rust
#[tauri::command]
pub async fn get_hush_dws_status(
    bridge: State<'_, Arc<DwsHushBridge>>,
) -> Result<DwsHushStatus, String> {
    bridge.status().await
}

#[tauri::command]
pub async fn sync_hush_dws(
    app: AppHandle,
    bridge: State<'_, Arc<DwsHushBridge>>,
    hush: State<'_, Arc<std::sync::Mutex<HushStore>>>,
) -> Result<DwsSyncReport, String> {
    let report = bridge.sync(hush.inner().clone()).await?;
    let _ = app.emit("humhum://hush-message", ());
    Ok(report)
}

#[tauri::command]
pub async fn set_hush_dws_auto_sync(
    bridge: State<'_, Arc<DwsHushBridge>>,
    enabled: bool,
) -> Result<DwsHushStatus, String> {
    bridge.set_auto_sync(enabled).await
}

#[tauri::command]
pub async fn open_hush_dws_login(
    bridge: State<'_, Arc<DwsHushBridge>>,
) -> Result<(), String> {
    bridge.open_login().await
}
```

- [ ] **Step 2: Register state, task, and commands**

In setup, load from the user home and manage one `Arc<DwsHushBridge>`. Start one background loop that ticks every five minutes, checks persisted `auto_sync_enabled`, invokes the same sync method, skips the active-sync error, logs other errors, and emits `humhum://hush-message` after imported records.

Register all four commands in `tauri::generate_handler!`.

- [ ] **Step 3: Compile Rust**

Run: `cd src-tauri && cargo check`

Expected: successful compile. Existing unrelated warnings may remain; no DWS compile errors.

### Task 5: Replace the Hush DingTalk Source Panel

**Files:**
- Modify: `src/components/Hub/HushModule.tsx`
- Verify: `src/components/Hub/HushModule.tsx`

**Interfaces:**
- Consumes Tauri response properties:
  - status: `state`, `message`, `executable_source`, `executable_path`, `authenticated`, `auto_sync_enabled`, `sync_interval_minutes`, `last_success_at`, `last_attempt_at`, `syncing`, `pending_sync`.
  - report: `conversations`, `examined_messages`, `imported_messages`, `duplicate_messages`, `pages`, `partial`, `next_cursor`.
- Produces manual sync, opt-in auto sync, login action, status/error feedback, and DWS labels on imported messages.

- [ ] **Step 1: Replace local-export state and actions with typed DWS state**

Define:

```ts
interface DwsHushStatus {
  state: "not_installed" | "authentication_required" | "ready" | "syncing" | "error";
  message: string;
  executable_source: "standalone" | "wukong" | null;
  executable_path: string | null;
  authenticated: boolean;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  last_success_at: string | null;
  last_attempt_at: string | null;
  syncing: boolean;
  pending_sync: boolean;
}

interface DwsSyncReport {
  conversations: number;
  examined_messages: number;
  imported_messages: number;
  duplicate_messages: number;
  pages: number;
  partial: boolean;
  next_cursor: string | null;
}
```

Fetch `get_hush_dws_status` on mount and every five seconds. Add callbacks for `sync_hush_dws`, `set_hush_dws_auto_sync`, and `open_hush_dws_login`, refreshing both status and inbox after actions.

- [ ] **Step 2: Implement a compact DingTalk DWS panel**

Show:

- title `钉钉消息同步`;
- source `独立 DWS` or `悟空内置 DWS` without presenting either as a different DingTalk product;
- installed/authenticated/ready/syncing/error state;
- manual button text `同步最近 24 小时` or `继续同步`;
- a checkbox/toggle labeled `每 5 分钟自动同步`, off by default;
- login button only in `authentication_required`;
- last success time and last report counts;
- `DWS` badge on messages whose `source_id` starts with `dws:`.

Use the existing `kawaii-tab` and inline panel patterns; keep card radius at 8px or less for the new panel and do not add a marketing hero.

- [ ] **Step 3: Remove split naming and obsolete local-source emphasis**

Delete the old local source diagnosis/import state, callbacks, and `DingTalkSourcePanel` usage. Standardize all user-visible copy as `钉钉`. Keep old backend import commands registered for compatibility, but do not expose them as the primary UI.

- [ ] **Step 4: Run frontend build**

Run: `npm run build`

Expected: TypeScript and Vite production build complete successfully.

### Task 6: Integrated Verification

**Files:**
- Verify: `src-tauri/src/dws_hush_bridge.rs`
- Verify: `src-tauri/src/hush_store.rs`
- Verify: `src-tauri/src/commands.rs`
- Verify: `src-tauri/src/lib.rs`
- Verify: `src/components/Hub/HushModule.tsx`

**Interfaces:**
- Consumes the complete feature.
- Produces test/build evidence and a clean scoped diff review.

- [ ] **Step 1: Scan naming and write-command regressions**

Run:

```bash
rg -n '钉钉|dingtalk' src src-tauri
rg -n 'message (send|recall)|chat message (send|recall)' src-tauri/src/dws_hush_bridge.rs
```

Expected: no split product naming and no write-capable DWS command.

- [ ] **Step 2: Run focused and full Rust verification**

Run:

```bash
cd src-tauri
cargo test hush_store::tests -- --nocapture
cargo test dws_hush_bridge::tests -- --nocapture
cargo test --lib
cargo check
```

Expected: all tests pass and `cargo check` exits zero.

- [ ] **Step 3: Run frontend verification**

Run:

```bash
npm run build
npm test -- --run
```

Expected: production build and test suite pass. If an unrelated pre-existing test fails, record its exact test name and output without modifying unrelated code.

- [ ] **Step 4: Review only the intended diff**

Run:

```bash
git diff -- src-tauri/src/dws_hush_bridge.rs src-tauri/src/hush_store.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/components/Hub/HushModule.tsx
git status --short
```

Expected: the DWS changes are scoped, and the pre-existing Hype modifications/untracked files remain intact.

- [ ] **Step 5: Commit only when unrelated dirty hunks can be excluded**

Stage the new file and clean files directly. For shared dirty files, do not stage unrelated Hype hunks. If scoped staging cannot be guaranteed non-interactively, leave the implementation uncommitted and report that choice instead of mixing work.
