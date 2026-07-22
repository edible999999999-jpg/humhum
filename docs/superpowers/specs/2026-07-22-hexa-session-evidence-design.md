# Hexa Session Evidence Design

**Date:** 2026-07-22
**Status:** Approved direction, pending written-spec review

## Goal

Let a user open any Hexa work item and inspect the real, local session evidence behind its status without turning Hexa's default surface into a raw trace dashboard.

The user-facing flow is:

```text
Hexa human-readable report
└─ Work item
   └─ Evidence detail
      ├─ Direct evidence
      ├─ Related session context
      └─ Agent capability explanation
```

Hexa continues to summarize in plain language first. Evidence is loaded only after the user opens a work item or explicitly opens the session evidence surface.

## Scope

The first release adds:

- a clickable detail view for every Hexa work item;
- work-item description, acceptance criteria, provenance, confidence, and explicit evidence;
- a bounded session timeline for user messages, assistant messages, tools, Skills, MCP calls, subagents, errors, and verification results;
- keyword search inside the selected watched session;
- on-demand, incremental local indexing for actively watched sessions only;
- deep transcript adapters for Codex and Claude-compatible JSONL;
- an explicit capability result for other Agents when no readable transcript is available.

The first release does not add global history search, a new Hexa tab, automatic semantic work-item inference, background transcript polling, cost calculation, session export, or full support for every registered Agent format.

## Product Rules

1. Default Hexa screens remain concise and human-readable.
2. A work-item status and the evidence index have separate responsibilities.
3. Agent reports are not upgraded to verified system facts merely because related transcript activity exists.
4. An integration limitation is described as an Agent capability limitation, not as a Hexa monitoring failure.
5. Only explicitly watched sessions are eligible for evidence indexing.
6. Opening evidence must not start a recurring timer or a permanent filesystem watcher.
7. Private transcript content remains local and is never sent to a model or remote service by this feature.

## Architecture

### Authoritative State

`~/.humhum/hexa-watch.json` remains the authoritative store for goals, work items, milestones, reviews, and explicit evidence references. `SessionStore` remains the live mapping from provider session IDs to transcript paths and hook state.

The evidence database is a derived cache. It must never update a work item's status, progress, review, or explicit evidence. Deleting the database loses no authoritative Hexa state; the database can be rebuilt from eligible local transcripts.

### Evidence Cache

Add an isolated Rust module responsible for the evidence cache. The cache lives at:

```text
~/.humhum/hexa/evidence-v1.sqlite3
```

Its schema has five responsibilities:

- `schema_meta`: schema version and creation metadata;
- `session_aliases`: canonical watched-session ID and provider-native aliases;
- `source_files`: canonical path, provider, file identity, size, modified time, indexed byte offset, and indexing status;
- `evidence_events`: normalized, bounded events associated with one canonical watched session;
- `evidence_fts`: FTS5 content for keyword search over normalized event labels and safe text excerpts.

The database uses a versioned schema. An unsupported schema version is closed, renamed as a recovery artifact, and rebuilt. There is no migration path that can mutate `hexa-watch.json`.

### Session Identity

The evidence request starts with a watched-session ID. Resolution accepts:

1. the current `HexaWatchedSession.session_id`;
2. any `previous_session_ids` recorded during provider-session promotion or resume;
3. an exact matching `SessionStore` session ID;
4. a provider-specific exact transcript filename or embedded session ID, only within the watched session's declared provider and workspace.

Fuzzy goal, display-name, or workspace-only matching is forbidden. When an exact match cannot be established, the response reports that the Agent did not provide a readable trace for this watched session.

### Transcript Adapters

Each provider adapter implements one boundary:

```text
supports(provider, path) -> bool
read_increment(path, offset) -> ParsedIncrement
normalize(record) -> zero or more EvidenceEvent values
```

The first release contains:

- a Codex JSONL adapter;
- a Claude-compatible JSONL adapter;
- an unavailable-capability adapter that returns a user-facing explanation and performs no heuristic parsing.

Provider-specific record shapes stay inside their adapter. The shared indexer contains no Codex- or Claude-specific JSON field tests.

### Normalized Evidence Events

Every normalized event contains:

- stable event ID;
- canonical watched-session ID;
- provider;
- timestamp when supplied by the source;
- category: `user_message`, `assistant_message`, `tool`, `skill`, `mcp`, `subagent`, `error`, or `verification`;
- concise label;
- bounded text excerpt;
- source path and byte range;
- optional explicit work-item ID;
- trust: `system_fact`, `agent_report`, or `related_context`.

Raw JSON blobs are not stored. Message and tool-result excerpts are capped before insertion. Secrets matching existing redaction rules are removed before text reaches SQLite.

Tool classification follows explicit source metadata first. Name-based fallback may distinguish `skill`, `mcp`, or `subagent` only when the record contains an unambiguous namespace or event type. Ambiguous calls remain `tool`.

## Incremental Indexing

Indexing occurs only when the frontend requests evidence for a watched session or requests the next page after the source changed.

For each eligible source file:

1. validate that it is a regular file and is inside an approved provider root or is the exact `SessionStore.transcript_path`;
2. read its identity, size, and modified time;
3. skip parsing when identity, size, and modified time match the cached state;
4. continue from the last complete-line byte offset when the same file only grew;
5. discard that file's derived events and reindex from byte zero when it was truncated, replaced, or rewritten;
6. commit events and file state in one SQLite transaction.

File identity uses platform metadata where available, together with canonical path, size, and modified time. Size and modified time alone are not treated as sufficient after truncation or replacement.

Only one evidence indexing operation may write at a time. Database work is performed in bounded blocking tasks; a `rusqlite::Connection` is never held across an async await. Read requests use short-lived connections and cursor pagination.

## Evidence Trust And Work-Item Association

Evidence is presented in three groups:

1. **Direct evidence**: an existing `HexaEvidenceRef`, an event carrying the exact work-item ID, or a deterministic verification result explicitly attached to the item.
2. **Related context**: events from the same watched session near the item's active interval or returned by the user's search. These help investigation but do not prove completion.
3. **Agent report**: status, milestone, or output submitted by the Agent without deterministic verification.

Time proximity alone never creates direct evidence. The indexer does not change work-item completion. Hexa may display `Agent 已报告完成，证据待补` when a completed item lacks direct or deterministic evidence.

## Backend Interface

Add one read-only Tauri command:

```text
get_hexa_session_evidence(request) -> HexaSessionEvidencePage
```

The request contains:

- watched session ID;
- optional work-item ID;
- optional trimmed search text;
- optional opaque cursor;
- page size capped by the backend.

The response contains:

- canonical session ID and provider;
- capability: `available`, `unavailable`, or `source_missing`;
- a plain-language capability message;
- index freshness time;
- direct evidence references from Hexa state;
- normalized events for the requested page;
- next cursor when more events exist;
- whether the source changed and was incrementally refreshed.

FTS queries are built with parameter binding and escaped terms. Invalid search syntax returns an empty result with a safe message rather than executing raw FTS syntax.

## Frontend Design

### Work-Item Interaction

`HexaWorkflowEditor` keeps its existing edit behavior. Each row also exposes a clear `查看证据` action. Selecting it opens one evidence panel below the workflow in the existing report pane; it does not navigate to a new top-level page.

The panel shows:

- work-item title and status;
- description and acceptance criteria when supplied;
- source and confidence labels;
- a summary of direct evidence, Agent reports, and related context;
- a search field scoped to the selected watched session;
- a paginated timeline with category, time, concise excerpt, and trust label;
- `加载更多` when a cursor is present.

Closing the panel releases its event list from React state. Switching watched sessions clears the selected work item, query, cursor, and results.

### Empty And Capability States

- No explicit evidence and no transcript events: `这个工作项还没有可核验的证据。`
- Supported Agent but missing source: `没有找到这个受监控会话的本地工作轨迹。`
- Unsupported integration: `该 Agent 没有提供可读取的工作轨迹。Hexa 只能展示它上报的状态，这不是 HUMHUM 监控故障。`
- Index read failure: retain explicit Hexa evidence and show a retry action for transcript context.
- Search with no results: explain that no matching session evidence was found without changing the work-item state.

The panel never displays a raw local path as its primary label. Source paths and byte ranges are available only inside a collapsed technical-details disclosure.

## Privacy And Lifecycle

- Indexing is limited to explicitly watched sessions.
- Only bounded, redacted excerpts are stored; raw JSON is not duplicated.
- Removing a watched session deletes its aliases, FTS rows, normalized events, and unreferenced source-file state from the cache.
- A startup maintenance pass may remove cache rows whose watched-session ID no longer exists, but it does not scan transcript roots.
- Cache files use owner-only filesystem permissions where supported.
- The feature performs no network requests.

## Performance Bounds

- No recurring evidence poll or filesystem watcher.
- Default page size is 40 events; maximum page size is 100.
- Stored text excerpts are capped at 1,000 Unicode characters per event.
- Tool-result payloads are summarized from already bounded text fields and are never stored as complete command output.
- The frontend retains only the selected evidence panel's loaded pages.
- Search is scoped to one canonical watched session in the first release.

## Failure Isolation

Evidence cache initialization failure must not prevent HumHum startup, active monitoring, work-item editing, intervention, or review. The command returns capability and retry information while the existing Hexa report continues to use authoritative state.

A malformed transcript record is skipped and counted in an internal diagnostic. One malformed line cannot invalidate earlier indexed events or the rest of the file. Provider-adapter failures cannot modify the watched-session store.

## File Boundaries

Implementation must keep responsibilities isolated:

- Rust evidence models and cache/index lifecycle in a new focused module;
- provider adapters in a dedicated evidence-adapter module tree;
- one narrow Tauri command registered through the existing command surface;
- frontend request state in a dedicated hook;
- evidence presentation in a new Hexa component;
- `HexaWorkflowEditor` only emits work-item selection;
- `HexaSessionReport` only owns which item is selected and renders the evidence component.

No unrelated refactor of `commands.rs`, `HexaModule`, Humi, Hype, or Hush is part of this work.

## Testing

Rust tests use synthetic JSONL fixtures and temporary directories. They cover:

- Codex and Claude normalization;
- category classification with ambiguous calls remaining ordinary tools;
- exact current and previous-session ID resolution;
- rejection of fuzzy workspace-only matches;
- append-only incremental indexing;
- truncation and file replacement reindexing;
- malformed-line tolerance;
- redaction and excerpt bounds;
- cursor pagination and session-scoped search;
- unsupported and missing-source capability responses;
- watched-session deletion cleanup;
- corrupt or unsupported cache schema recovery;
- evidence-cache failure isolation from authoritative Hexa state.

Frontend tests cover:

- every work item exposing a `查看证据` action;
- opening, switching, and closing the evidence panel;
- direct evidence, related context, and Agent report labels;
- capability and missing-source copy;
- search, empty results, retry, and pagination;
- clearing loaded events when the selected session changes;
- work-item editing and existing Hexa report behavior remaining unchanged.

Required completion checks are:

```text
npm test
npm run build
cargo test
cargo fmt --check
cargo check
git diff --check
```

## Acceptance Criteria

1. The user can open evidence from every visible Hexa work item.
2. The detail identifies what the work item is, its acceptance condition, provenance, confidence, and status.
3. Codex and Claude watched sessions expose a bounded normalized timeline when an exact local transcript is available.
4. Timeline entries distinguish messages, tools, Skills, MCP calls, subagents, errors, and verification results when the source contains authoritative type information.
5. Search returns only evidence from the selected canonical watched session.
6. Direct evidence, Agent reports, and related context are visibly distinct.
7. Related context cannot verify or complete a work item.
8. Unsupported Agents show the capability message and retain their reported Hexa status.
9. Opening and searching evidence starts no recurring timer or global scan.
10. App restart preserves the derived index, and deleting the index causes a safe on-demand rebuild.
11. Stopping supervision removes the session's cached evidence without changing other sessions.
12. Evidence-index failure cannot break the existing Hexa report or work-item editing.

## Non-Goals

- A global AgentLens-style dashboard
- Cross-session or cross-project search
- Background indexing of passive sessions
- Inferring a complete work plan from transcript text
- Automatically changing work-item status or Hexa review
- Storing complete raw transcripts in SQLite
- Cloud synchronization or remote analysis
- Cost and token pricing
- Session export
- Full support for every Agent transcript format in the first release
