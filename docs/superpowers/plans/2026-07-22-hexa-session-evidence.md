# Hexa Session Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open a Hexa work item and inspect bounded, searchable, real local session evidence without adding global polling or treating transcript context as verified completion.

**Architecture:** Keep `hexa-watch.json` authoritative and add `~/.humhum/hexa/evidence-v1.sqlite3` only as a rebuildable derived cache. Resolve a watched session to an exact transcript, normalize Codex and Claude JSONL through provider adapters, index only on demand, and expose one paginated read-only Tauri command to a dedicated React evidence panel.

**Tech Stack:** Rust 2021, `rusqlite` with bundled SQLite/FTS5, Serde JSON, Tauri 2 commands and managed state, React 18, TypeScript, Vitest/happy-dom, existing HumHum CSS.

## Global Constraints

- `~/.humhum/hexa-watch.json` remains authoritative; the evidence database must never mutate work-item status, progress, reviews, milestones, or explicit evidence.
- Only explicitly watched sessions are eligible for indexing.
- No recurring evidence poll, filesystem watcher, transcript-root scan, model call, or network request.
- Default pages contain 40 events, backend maximum is 100, and stored excerpts are capped at 1,000 Unicode characters.
- Direct evidence, Agent reports, and related context remain visibly distinct; time proximity alone is never direct evidence.
- Codex and Claude-compatible JSONL receive deep parsing. Other Agents return the exact capability message: `该 Agent 没有提供可读取的工作轨迹。Hexa 只能展示它上报的状态，这不是 HUMHUM 监控故障。`
- Raw JSON blobs and complete tool output are never stored.
- Existing Pet, Overlay, Hush, and `src/styles/global.css` worktree changes are out of scope and must not be staged or modified.

---

## File Map

- Create `src-tauri/src/hexa_evidence/mod.rs`: evidence request/response types, index facade, source resolution, pagination, cleanup, and module tests.
- Create `src-tauri/src/hexa_evidence/adapters.rs`: provider-neutral adapter boundary plus Codex and Claude JSONL normalization tests.
- Modify `src-tauri/src/lib.rs`: register the evidence module, initialize fail-soft managed state, and register the command.
- Modify `src-tauri/src/commands.rs`: add the thin `get_hexa_session_evidence` command and cleanup after watched-session deletion.
- Create `src/hooks/useHexaEvidence.ts` and `src/hooks/useHexaEvidence.test.ts`: frontend contracts and bounded request state.
- Create `src/components/Hub/hexa/HexaEvidencePanel.tsx` and its test: work-item evidence UI.
- Modify `src/components/Hub/hexa/HexaWorkflowEditor.tsx`: separate evidence selection from editing.
- Modify `src/components/Hub/hexa/HexaSessionReport.tsx`: own selected work-item ID and render the panel.
- Modify `src/components/Hub/hexa/HexaActiveMonitor.test.tsx`: integration interaction coverage.
- Modify `src/styles/hub-character-rooms.css`: scoped evidence styles; do not touch dirty `src/styles/global.css`.

---

### Task 1: Normalize Codex and Claude transcript records

**Files:**
- Create: `src-tauri/src/hexa_evidence/adapters.rs`
- Create: `src-tauri/src/hexa_evidence/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: provider string, one complete JSONL line, canonical session ID, byte start, and byte end.
- Produces: `adapter_for(provider: &str) -> Option<TranscriptAdapter>` and `TranscriptAdapter::parse_line(&self, context: &ParseContext, line: &str) -> Vec<EvidenceEventDraft>`.

- [ ] **Step 1: Write failing adapter tests**

Add synthetic fixtures directly to `adapters.rs` tests:

```rust
#[test]
fn codex_classifies_explicit_event_kinds() {
    let context = ParseContext::new("watched-1", "codex", 0, 120);
    let lines = [
        r#"{"timestamp":"2026-07-22T10:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"修复分类器"}]}}"#,
        r#"{"timestamp":"2026-07-22T10:00:01Z","payload":{"type":"function_call","name":"functions.exec","arguments":"{}"}}"#,
        r#"{"timestamp":"2026-07-22T10:00:02Z","payload":{"type":"function_call","name":"skills.read","arguments":"{}"}}"#,
        r#"{"timestamp":"2026-07-22T10:00:03Z","payload":{"type":"function_call","name":"mcp__github__search","arguments":"{}"}}"#,
        r#"{"timestamp":"2026-07-22T10:00:04Z","payload":{"type":"function_call","name":"collaboration.spawn_agent","arguments":"{}"}}"#,
        r#"{"timestamp":"2026-07-22T10:00:05Z","payload":{"type":"task_complete","error":"build failed"}}"#,
    ];
    let events = lines.iter().flat_map(|line| TranscriptAdapter::Codex.parse_line(&context, line)).collect::<Vec<_>>();
    assert_eq!(events.iter().map(|event| event.category).collect::<Vec<_>>(), vec![
        EvidenceCategory::UserMessage,
        EvidenceCategory::Tool,
        EvidenceCategory::Skill,
        EvidenceCategory::Mcp,
        EvidenceCategory::Subagent,
        EvidenceCategory::Error,
    ]);
    assert!(events.iter().all(|event| event.trust == EvidenceTrust::RelatedContext));
}

#[test]
fn claude_keeps_ambiguous_calls_as_tools_and_redacts_paths() {
    let context = ParseContext::new("watched-2", "claude-code", 30, 180);
    let line = r#"{"type":"assistant","timestamp":"2026-07-22T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/Users/private/project/secret.rs"}}]}}"#;
    let events = TranscriptAdapter::Claude.parse_line(&context, line);
    assert_eq!(events[0].category, EvidenceCategory::Tool);
    assert!(!events[0].excerpt.contains("/Users/private"));
    assert!(events[0].excerpt.chars().count() <= MAX_EXCERPT_CHARS);
}

#[test]
fn unsupported_provider_has_no_adapter() {
    assert!(adapter_for("qoder").is_none());
}
```

- [ ] **Step 2: Run the adapter tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hexa_evidence::adapters::tests -- --nocapture
```

Expected: compilation fails because `hexa_evidence`, `TranscriptAdapter`, and evidence model types do not exist.

- [ ] **Step 3: Add normalized types and adapter implementation**

Create these shared types in `mod.rs`:

```rust
pub(crate) const MAX_EXCERPT_CHARS: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceCategory { UserMessage, AssistantMessage, Tool, Skill, Mcp, Subagent, Error, Verification }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceTrust { SystemFact, AgentReport, RelatedContext }

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EvidenceEventDraft {
    pub event_key: String,
    pub occurred_at: Option<String>,
    pub category: EvidenceCategory,
    pub label: String,
    pub excerpt: String,
    pub byte_start: u64,
    pub byte_end: u64,
    pub work_item_id: Option<String>,
    pub trust: EvidenceTrust,
}

pub(crate) struct ParseContext<'a> {
    pub session_id: &'a str,
    pub provider: &'a str,
    pub byte_start: u64,
    pub byte_end: u64,
}

impl<'a> ParseContext<'a> {
    pub fn new(session_id: &'a str, provider: &'a str, byte_start: u64, byte_end: u64) -> Self {
        Self { session_id, provider, byte_start, byte_end }
    }
}
```

Create `TranscriptAdapter::{Codex, Claude}` in `adapters.rs`. Parse only explicit message roles and function/tool event types. Classify Skill only for `skills.*` or explicit skill events, MCP only for `mcp__*`, and subagent only for explicit collaboration/subagent events. Pass extracted text through `project_user_safe_text`, truncate by Unicode characters, and derive `event_key` from session ID, byte start, category, and source-native call ID when present.

Register `mod hexa_evidence;` in `lib.rs` without adding managed state yet.

- [ ] **Step 4: Run adapter tests and verify GREEN**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hexa_evidence::adapters::tests -- --nocapture
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all adapter tests pass and formatting exits 0.

- [ ] **Step 5: Commit the adapter boundary**

```bash
git add src-tauri/src/hexa_evidence src-tauri/src/lib.rs
git commit -m "feat(hexa): normalize watched session evidence"
```

---

### Task 2: Add the rebuildable incremental SQLite cache

**Files:**
- Modify: `src-tauri/src/hexa_evidence/mod.rs`
- Test: inline `src-tauri/src/hexa_evidence/mod.rs` tests

**Interfaces:**
- Consumes: `EvidenceSource`, `HexaSessionEvidenceRequest`, normalized adapter events, and a cache path.
- Produces: `HexaEvidenceIndex::at`, `index_and_query`, `cleanup_session`, and `HexaSessionEvidencePage`.

- [ ] **Step 1: Write failing cache behavior tests**

Add temp-directory tests:

```rust
#[test]
fn append_only_refresh_indexes_only_new_complete_lines() {
    let fixture = EvidenceFixture::codex();
    fixture.write_lines(&[codex_user("first")]);
    assert_eq!(fixture.query(Default::default()).events.len(), 1);
    fixture.append_raw(&format!("{}\n{}", codex_user("second"), "{partial"));
    let page = fixture.query(Default::default());
    assert_eq!(page.events.iter().map(|event| event.excerpt.as_str()).collect::<Vec<_>>(), vec!["second", "first"]);
    assert_eq!(page.indexed_records, 1);
}

#[test]
fn truncation_rebuilds_without_duplicate_events() {
    let fixture = EvidenceFixture::codex();
    fixture.write_lines(&[codex_user("old one"), codex_user("old two")]);
    fixture.query(Default::default());
    fixture.write_lines(&[codex_user("replacement")]);
    let page = fixture.query(Default::default());
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].excerpt, "replacement");
}

#[test]
fn search_and_pagination_are_session_scoped() {
    let fixture = EvidenceFixture::two_sessions();
    let first = fixture.query_for("watched-1", HexaSessionEvidenceRequest { search: Some("build".into()), page_size: Some(1), ..Default::default() });
    assert_eq!(first.events.len(), 1);
    assert!(first.next_cursor.is_some());
    let second = fixture.query_for("watched-1", HexaSessionEvidenceRequest { search: Some("build".into()), cursor: first.next_cursor, page_size: Some(1), ..Default::default() });
    assert!(second.events.iter().all(|event| event.session_id == "watched-1"));
}

#[test]
fn cleanup_removes_only_the_requested_session() {
    let fixture = EvidenceFixture::two_sessions();
    fixture.index_all();
    fixture.index.cleanup_session("watched-1").unwrap();
    assert!(fixture.all_events("watched-1").is_empty());
    assert!(!fixture.all_events("watched-2").is_empty());
}
```

Also add named tests for malformed lines, maximum excerpt length, unsupported schema rebuild, page-size clamping, invalid FTS input, replaced-file identity, rejection of non-regular or unapproved source paths, FTS-row cleanup during reindex, and owner-only cache permissions on Unix.

- [ ] **Step 2: Run cache tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hexa_evidence::tests -- --nocapture
```

Expected: compilation fails because the cache request, source, page, cursor, and index facade are missing.

- [ ] **Step 3: Add cache schema and incremental transaction logic**

Define these boundaries in `mod.rs`:

```rust
#[derive(Debug, Clone)]
pub(crate) struct EvidenceSource {
    pub canonical_session_id: String,
    pub aliases: Vec<String>,
    pub provider: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HexaSessionEvidenceRequest {
    pub session_id: String,
    pub work_item_id: Option<String>,
    pub search: Option<String>,
    pub cursor: Option<String>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaEvidenceEvent {
    pub id: String,
    pub session_id: String,
    pub occurred_at: Option<String>,
    pub category: EvidenceCategory,
    pub label: String,
    pub excerpt: String,
    pub work_item_id: Option<String>,
    pub trust: EvidenceTrust,
    pub technical_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HexaEvidenceCapability { Available, Unavailable, SourceMissing }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaSessionEvidencePage {
    pub canonical_session_id: String,
    pub provider: String,
    pub capability: HexaEvidenceCapability,
    pub capability_message: String,
    pub indexed_at: Option<String>,
    pub direct_evidence: Vec<HexaEvidenceRef>,
    pub events: Vec<HexaEvidenceEvent>,
    pub next_cursor: Option<String>,
    pub refreshed: bool,
    #[serde(skip)]
    pub indexed_records: usize,
}

pub struct HexaEvidenceIndex {
    db_path: PathBuf,
    write_gate: std::sync::Mutex<()>,
}
```

Create schema version 1 with `schema_meta`, `session_aliases`, `source_files`, `evidence_events`, and FTS5 `evidence_fts`. Use short-lived connections. Store the last complete-line byte offset. Reindex transactionally when identity changes or length shrinks. Bind search terms as parameters after converting trimmed text into quoted literal tokens. Use row-ID cursors, page size 40 by default and 100 maximum.

- [ ] **Step 4: Run cache and adapter tests and verify GREEN**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hexa_evidence -- --nocapture
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all evidence tests pass and repeated queries do not duplicate events.

- [ ] **Step 5: Commit the cache**

```bash
git add src-tauri/src/hexa_evidence
git commit -m "feat(hexa): cache evidence incrementally"
```

---

### Task 3: Resolve watched sessions and expose the read-only Tauri command

**Files:**
- Modify: `src-tauri/src/hexa_evidence/mod.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `HexaWatchStore`, `SessionStore`, and `HexaSessionEvidenceRequest`.
- Produces: `get_hexa_session_evidence(request) -> Result<HexaSessionEvidencePage, String>` and best-effort evidence cleanup after watched-session deletion.

- [ ] **Step 1: Write failing source-resolution and capability tests**

```rust
#[test]
fn resolves_current_and_previous_ids_only_by_exact_match() {
    let watched = watched_session("thread-new", &["thread-old"], "codex");
    let sessions = vec![session("thread-old", Some("/tmp/thread-old.jsonl"))];
    assert_eq!(resolve_source(&watched, &sessions).unwrap().path, PathBuf::from("/tmp/thread-old.jsonl"));
    let unrelated = vec![session("other", Some("/tmp/thread-new-copy.jsonl"))];
    assert!(resolve_source(&watched, &unrelated).is_none());
}

#[test]
fn unsupported_provider_explains_agent_capability() {
    let page = capability_page("watched-1", "qoder", HexaEvidenceCapability::Unavailable, vec![]);
    assert_eq!(page.capability_message, "该 Agent 没有提供可读取的工作轨迹。Hexa 只能展示它上报的状态，这不是 HUMHUM 监控故障。");
}

#[test]
fn supported_provider_with_no_source_is_distinct() {
    let page = capability_page("watched-1", "codex", HexaEvidenceCapability::SourceMissing, vec![]);
    assert_eq!(page.capability_message, "没有找到这个受监控会话的本地工作轨迹。");
}

#[test]
fn discovers_only_an_exact_provider_session_id_when_live_mapping_is_absent() {
    let root = tempfile::tempdir().unwrap();
    write_codex_session(root.path(), "thread-exact", "exact.jsonl");
    write_codex_session(root.path(), "thread-exact-copy", "copy.jsonl");
    let found = discover_provider_source("codex", "thread-exact", root.path()).unwrap();
    assert!(found.to_string_lossy().ends_with("exact.jsonl"));
}

#[test]
fn authoritative_item_state_is_returned_as_agent_report_not_system_fact() {
    let event = work_item_report_event(&work_item("step-1", HexaWorkItemStatus::Completed));
    assert_eq!(event.work_item_id.as_deref(), Some("step-1"));
    assert_eq!(event.trust, EvidenceTrust::AgentReport);
}
```

- [ ] **Step 2: Run resolution tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hexa_evidence::tests::resolves_current_and_previous_ids_only_by_exact_match -- --exact
```

Expected: FAIL because `resolve_source` and capability-page construction are absent.

- [ ] **Step 3: Implement thin command wiring and fail-soft state**

Add this lazy state constructor:

```rust
impl HexaEvidenceIndex {
    pub fn at(humhum_dir: &Path) -> Self {
        Self {
            db_path: humhum_dir.join("hexa").join("evidence-v1.sqlite3"),
            write_gate: std::sync::Mutex::new(()),
        }
    }
}
```

Manage `Arc<HexaEvidenceIndex>` during Tauri setup without opening SQLite. In the command, copy the watched session and matching `SessionStore` metadata while holding their existing locks, then release locks before `spawn_blocking` calls `index_and_query`. When live metadata has no transcript path, search only the approved Codex or Claude root for an exact embedded provider-session ID; reject fuzzy filenames, workspace-only matches, symlinks that escape the root, and multiple exact candidates. Extract explicit evidence from the requested work item and attach it to every response, including unavailable and missing-source responses. Convert the requested work item's authoritative status plus its matching milestones into response-only `agent_report` events; do not write those events to SQLite or upgrade them to `system_fact`.

Register `commands::get_hexa_session_evidence`. Extend `delete_hexa_watched_session` with evidence state; after authoritative deletion succeeds, call `cleanup_session` best-effort and log failure without failing deletion.

- [ ] **Step 4: Run backend integration checks and verify GREEN**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml hexa_evidence -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all commands pass and no SQLite connection is held across an await.

- [ ] **Step 5: Commit backend integration**

```bash
git add src-tauri/src/hexa_evidence/mod.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(hexa): expose watched session evidence"
```

---

### Task 4: Build bounded frontend request state and evidence panel

**Files:**
- Create: `src/hooks/useHexaEvidence.ts`
- Create: `src/hooks/useHexaEvidence.test.ts`
- Create: `src/components/Hub/hexa/HexaEvidencePanel.tsx`
- Create: `src/components/Hub/hexa/HexaEvidencePanel.test.tsx`
- Modify: `src/styles/hub-character-rooms.css`

**Interfaces:**
- Consumes: watched session, selected `HexaWorkItem`, and Tauri `get_hexa_session_evidence`.
- Produces: `useHexaEvidence(sessionId, workItemId)` and `HexaEvidencePanel` with search, retry, close, and pagination.

- [ ] **Step 1: Write failing hook tests**

```typescript
it("replaces search results and appends cursor pages", async () => {
  invokeMock
    .mockResolvedValueOnce(page([event("one")], "20"))
    .mockResolvedValueOnce(page([event("match")], "10"))
    .mockResolvedValueOnce(page([event("older match")], null));
  const view = renderEvidenceHook("session-1", "step-1");
  await view.load();
  await view.search("build");
  await view.loadMore();
  expect(view.current.events.map((event) => event.excerpt)).toEqual(["match", "older match"]);
  expect(invokeMock).toHaveBeenLastCalledWith("get_hexa_session_evidence", {
    request: { session_id: "session-1", work_item_id: "step-1", search: "build", cursor: "10", page_size: 40 },
  });
});

it("ignores an older response after session selection changes", async () => {
  const oldRequest = deferred<HexaSessionEvidencePage>();
  invokeMock.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(page([event("new")], null));
  const view = renderEvidenceHook("session-old", "step-1");
  view.rerender("session-new", "step-2");
  oldRequest.resolve(page([event("old")], null));
  await view.flush();
  expect(view.current.events.map((event) => event.excerpt)).toEqual(["new"]);
});
```

- [ ] **Step 2: Run hook tests and verify RED**

Run:

```bash
npx vitest run src/hooks/useHexaEvidence.test.ts
```

Expected: FAIL because the hook and evidence contracts do not exist.

- [ ] **Step 3: Implement TypeScript contracts and bounded state**

```typescript
export type HexaEvidenceCapability = "available" | "unavailable" | "source_missing";
export type HexaEvidenceCategory = "user_message" | "assistant_message" | "tool" | "skill" | "mcp" | "subagent" | "error" | "verification";
export type HexaEvidenceTrust = "system_fact" | "agent_report" | "related_context";

export interface HexaSessionEvidencePage {
  canonical_session_id: string;
  provider: string;
  capability: HexaEvidenceCapability;
  capability_message: string;
  indexed_at: string | null;
  direct_evidence: HexaEvidenceRef[];
  events: HexaEvidenceEvent[];
  next_cursor: string | null;
  refreshed: boolean;
}
```

The hook loads when both IDs are non-null, trims search text, requests 40 rows, replaces results for initial/search/retry, appends unique IDs for cursor pages, clears state when either ID changes, and ignores stale promises with a request generation counter.

- [ ] **Step 4: Write failing panel tests**

```typescript
it("shows item metadata and distinguishes evidence trust", async () => {
  renderPanel({ page: page([
    event("cargo test 通过", "verification", "system_fact"),
    event("正在运行测试", "assistant_message", "agent_report"),
    event("读取 src/lib.rs", "tool", "related_context"),
  ], null) });
  expect(screen.getByText("直接证据")).toBeTruthy();
  expect(screen.getByText("Agent 自述")).toBeTruthy();
  expect(screen.getByText("相关上下文")).toBeTruthy();
  expect(screen.getByText("怎样才算完成")).toBeTruthy();
});

it("attributes unsupported traces to the agent capability", async () => {
  renderPanel({ page: unavailablePage() });
  expect(screen.getByText("该 Agent 没有提供可读取的工作轨迹。Hexa 只能展示它上报的状态，这不是 HUMHUM 监控故障。")).toBeTruthy();
});
```

Also test search submission, no results, retry, load more, close, collapsed technical source, and no raw path in the primary timeline label.

- [ ] **Step 5: Run panel tests and verify RED**

Run:

```bash
npx vitest run src/components/Hub/hexa/HexaEvidencePanel.test.tsx
```

Expected: FAIL because `HexaEvidencePanel` does not exist.

- [ ] **Step 6: Implement the panel and scoped styles**

Create this component boundary:

```typescript
export function HexaEvidencePanel({
  session,
  item,
  onClose,
}: {
  session: HexaWatchedSession;
  item: HexaWorkItem;
  onClose: () => void;
})
```

Render metadata, capability state, trust summary, search, and timeline. Map categories to `用户要求`, `Agent 回复`, `工具`, `Skill`, `MCP`, `子 Agent`, `错误`, and `验证结果`. Put `technical_source` only inside a closed `<details>`. Add only `.hexa-evidence-*` selectors to `hub-character-rooms.css`, with responsive stacking, visible focus states, and bounded timeline scrolling.

- [ ] **Step 7: Run focused tests and build**

Run:

```bash
npx vitest run src/hooks/useHexaEvidence.test.ts src/components/Hub/hexa/HexaEvidencePanel.test.tsx
npm run build
```

Expected: focused tests and TypeScript/Vite build pass.

- [ ] **Step 8: Commit the evidence panel**

```bash
git add src/hooks/useHexaEvidence.ts src/hooks/useHexaEvidence.test.ts src/components/Hub/hexa/HexaEvidencePanel.tsx src/components/Hub/hexa/HexaEvidencePanel.test.tsx src/styles/hub-character-rooms.css
git commit -m "feat(hexa): show bounded session evidence"
```

---

### Task 5: Connect work-item selection to the evidence panel

**Files:**
- Modify: `src/components/Hub/hexa/HexaWorkflowEditor.tsx`
- Modify: `src/components/Hub/hexa/HexaSessionReport.tsx`
- Modify: `src/components/Hub/hexa/HexaActiveMonitor.test.tsx`

**Interfaces:**
- Consumes: ordered work items and `HexaEvidencePanel`.
- Produces: visible `查看证据` action for every work item; session changes clear selection; editing remains separate.

- [ ] **Step 1: Write failing active-monitor tests**

```typescript
it("opens evidence without entering work-item edit mode", async () => {
  const view = await renderMonitor({ sessions: [watchedSessionWithWorkItem("session-1", "step-1")] });
  await act(async () => buttonByText(view.host, "查看证据").click());
  expect(view.host.querySelector('[aria-label="step-1 工作证据"]')).not.toBeNull();
  expect(view.host.querySelector('.hexa-workflow-form')).toBeNull();
  await dispose(view);
});

it("clears evidence after selecting another watched session", async () => {
  const view = await renderMonitor({ sessions: [
    watchedSessionWithWorkItem("session-1", "step-1"),
    watchedSessionWithWorkItem("session-2", "step-2"),
  ] });
  await act(async () => buttonByText(view.host, "查看证据").click());
  await act(async () => buttonByText(view.host, "session-2").click());
  expect(view.host.querySelector('[aria-label="step-1 工作证据"]')).toBeNull();
  await dispose(view);
});
```

- [ ] **Step 2: Run interaction tests and verify RED**

Run:

```bash
npx vitest run src/components/Hub/hexa/HexaActiveMonitor.test.tsx
```

Expected: FAIL because evidence actions and the panel connection do not exist.

- [ ] **Step 3: Add explicit selection without conflating editing**

Change `HexaWorkflowEditor` props to:

```typescript
{
  session: HexaWatchedSession;
  selectedEvidenceId: string | null;
  onSelectEvidence: (item: HexaWorkItem) => void;
  onMutate: (request: HexaAuditMutationRequest) => Promise<unknown>;
}
```

The row's main action and labeled `查看证据` control call `onSelectEvidence(item)`. Keep the chevron/edit control calling `edit(item)` with title `编辑检查点`; selecting evidence must not create a draft.

In `HexaSessionReportView`, store `selectedEvidenceId`, derive the current item from `session.audit.work_items`, and clear the ID in an effect keyed by `session.session_id`. Render `HexaEvidencePanel` directly below `HexaWorkflowEditor`.

- [ ] **Step 4: Run Hexa tests and build**

Run:

```bash
npx vitest run src/components/Hub/hexa/HexaActiveMonitor.test.tsx src/components/Hub/hexa/HexaEvidencePanel.test.tsx
npm run build
```

Expected: work-item evidence tests pass, editing tests stay green, and build exits 0.

- [ ] **Step 5: Commit UI integration**

```bash
git add src/components/Hub/hexa/HexaWorkflowEditor.tsx src/components/Hub/hexa/HexaSessionReport.tsx src/components/Hub/hexa/HexaActiveMonitor.test.tsx
git commit -m "feat(hexa): open evidence from work items"
```

---

### Task 6: Verify privacy, performance, and regression safety

**Files:**
- Modify only files already listed when a failing verification exposes a scoped defect.

**Interfaces:**
- Consumes: completed feature and approved acceptance criteria.
- Produces: fresh full-suite evidence and a feature-only commit range.

- [ ] **Step 1: Verify no recurring evidence refresh exists**

Run:

```bash
rg -n "setInterval|setTimeout|tokio::time::interval|notify|watcher" src-tauri/src/hexa_evidence src/hooks/useHexaEvidence.ts src/components/Hub/hexa/HexaEvidencePanel.tsx
```

Expected: no evidence-specific recurring timer or filesystem watcher.

- [ ] **Step 2: Verify the full Rust suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0 with zero failed tests.

- [ ] **Step 3: Verify the full frontend suite and build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and the production build exits 0.

- [ ] **Step 4: Verify diff scope and whitespace**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~4..HEAD
```

Expected: no whitespace errors; feature commits contain only files listed in this plan; pre-existing Pet, Overlay, Hush, SDD report, mascot, and `global.css` changes remain outside feature commits.

- [ ] **Step 5: Run a local visual smoke test**

Start the app, open Hexa active monitoring, select a watched Codex session with work items, click `查看证据`, search for a known tool name, load the next page when present, switch sessions, and confirm the panel closes.

Record these observed states in the handoff:

```text
- default Hexa report remains concise;
- evidence opens without edit mode;
- capability message appears for an unsupported Agent;
- no transcript path is visible before technical details open;
- session switching clears the panel;
- no periodic evidence requests appear while the panel is closed.
```

- [ ] **Step 6: Commit any verification-only correction**

If verification required a correction, stage only listed feature files:

```bash
git commit -m "fix(hexa): harden evidence drilldown"
```

If no correction was required, do not create an empty commit.
