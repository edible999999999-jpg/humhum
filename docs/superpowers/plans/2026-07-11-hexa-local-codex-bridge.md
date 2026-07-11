# Hexa Local Codex Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Hexa directly to `codex app-server` so HUMHUM can observe real Codex threads and locally send, interrupt, resume, approve, deny, and answer questions.

**Architecture:** A Rust `codex_bridge` module owns the app-server subprocess and JSON-RPC transport, while a separate `hexa_protocol` module normalizes provider messages into stable session projections. Tauri commands expose intentional Hexa operations, and the React hook merges bridge sessions with existing hook-based sessions without replacing Claude support.

**Tech Stack:** Rust 2021, Tokio, serde/serde_json, Tauri v2 events and commands, React 19, TypeScript, Vitest-free frontend build checks, Rust unit and integration-style process tests.

## Global Constraints

- The Mac remains the source of truth and local Hexa must work without a network connection.
- Existing Claude hooks, Hush, Humi, and hook-based compatible agents must keep working.
- Raw JSON-RPC, file paths, and provider IDs stay behind explicit details surfaces.
- Approvals default to waiting; timeouts and stale replies never become approvals.
- The first release supports `allow once` and `deny`, not durable `always allow`.
- App-server failure must degrade to existing hook evidence without crashing HUMHUM.
- Directly adapted MIT source must retain attribution; prefer an independent implementation against the official Codex protocol.

## File Map

- Create `src-tauri/src/hexa_protocol.rs`: provider-neutral event, approval, session, and projection logic.
- Create `src-tauri/src/codex_bridge/transport.rs`: newline JSON-RPC request correlation and subprocess I/O.
- Create `src-tauri/src/codex_bridge/protocol.rs`: minimal Codex request and notification types used by HUMHUM.
- Create `src-tauri/src/codex_bridge/mod.rs`: process lifecycle, thread state, event normalization, and command methods.
- Modify `src-tauri/src/lib.rs`: manage bridge state, start it in setup, and register commands.
- Modify `src-tauri/src/commands.rs`: intentional Tauri command wrappers for bridge health, sessions, and actions.
- Modify `src/hooks/useHexaData.ts`: consume normalized bridge sessions and merge them with existing hook sessions.
- Modify `src/components/Hub/HexaModule.tsx`: add bridge health and local intervention controls using existing visual patterns.
- Modify `src/types/index.ts`: shared frontend bridge and approval types if they are used outside the hook.
- Modify `docs/architecture.md`: document app-server data flow and fallback behavior.

---

### Task 1: Provider-Neutral Hexa Projection

**Files:**
- Create: `src-tauri/src/hexa_protocol.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `HexaEvent`, `HexaEventKind`, `HexaSessionProjection`, `HexaApproval`, and `HexaProjectionStore::apply(&HexaEvent)`.
- Produces: `scope_provider_item(thread_id: Option<&str>, item_id: &str) -> String` for collision-free item and approval joins.
- Consumes: no Codex-specific transport types.

- [ ] **Step 1: Add failing projection tests**

Add tests inside `hexa_protocol.rs` that construct normalized events and assert:

```rust
#[test]
fn scopes_item_ids_by_provider_thread() {
    assert_eq!(scope_provider_item(Some("thread-a"), "item-1"), "thread-a:item-1");
    assert_eq!(scope_provider_item(None, "item-1"), "item-1");
}

#[test]
fn approval_resolution_updates_the_matching_session() {
    let mut store = HexaProjectionStore::default();
    store.apply(&event("s1", HexaEventKind::SessionStarted, json!({
        "provider": "codex", "provider_thread_id": "t1", "workspace": "/tmp/demo"
    })));
    store.apply(&event("s1", HexaEventKind::ApprovalRequested, json!({
        "approval_id": "t1:item-1", "operation": "command", "summary": "Run tests"
    })));
    assert_eq!(store.session("s1").unwrap().pending_approvals.len(), 1);

    store.apply(&event("s1", HexaEventKind::ApprovalResolved, json!({
        "approval_id": "t1:item-1", "decision": "deny"
    })));
    assert!(store.session("s1").unwrap().pending_approvals.is_empty());
}

#[test]
fn stale_turn_completion_does_not_finish_a_newer_turn() {
    let mut store = HexaProjectionStore::default();
    store.apply(&event("s1", HexaEventKind::TurnStarted, json!({"turn_id": "new"})));
    store.apply(&event("s1", HexaEventKind::TurnCompleted, json!({"turn_id": "old"})));
    assert_eq!(store.session("s1").unwrap().status, HexaSessionStatus::Working);
}
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd src-tauri && cargo test hexa_protocol --lib`

Expected: compilation fails because `hexa_protocol` types and functions do not exist.

- [ ] **Step 3: Implement the normalized types and projection store**

Implement serde-serializable enums and structs with snake_case wire values. Keep payload parsing inside `HexaProjectionStore::apply`, ignore malformed optional fields, and never clear an active turn when a completion references another turn ID.

The public API must include:

```rust
pub fn scope_provider_item(thread_id: Option<&str>, item_id: &str) -> String;

impl HexaProjectionStore {
    pub fn apply(&mut self, event: &HexaEvent);
    pub fn session(&self, session_id: &str) -> Option<&HexaSessionProjection>;
    pub fn sessions(&self) -> Vec<HexaSessionProjection>;
}
```

- [ ] **Step 4: Run projection tests and the existing Rust suite**

Run: `cd src-tauri && cargo test hexa_protocol --lib && cargo test --lib`

Expected: projection tests pass and all existing Rust tests remain green.

- [ ] **Step 5: Commit the projection model**

```bash
git add src-tauri/src/hexa_protocol.rs src-tauri/src/lib.rs
git commit -m "feat(hexa): add normalized session projection"
```

### Task 2: JSON-RPC App-Server Transport

**Files:**
- Create: `src-tauri/src/codex_bridge/transport.rs`
- Create: `src-tauri/src/codex_bridge/protocol.rs`
- Create: `src-tauri/src/codex_bridge/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: normalized event types from Task 1 only at the bridge boundary.
- Produces: `JsonRpcTransport::spawn`, `request`, `respond`, `shutdown`, and a notification receiver.
- Produces: minimal protocol structs for `initialize`, `thread/list`, `thread/read`, `thread/resume`, `thread/start`, `turn/start`, and `turn/interrupt`.

- [ ] **Step 1: Add failing transport tests with a fake child process**

Use the current test executable as a fake newline JSON-RPC peer selected by an environment variable. Tests must prove correlation works when responses arrive out of order, notifications are delivered separately, and process exit rejects pending requests.

```rust
#[tokio::test]
async fn correlates_out_of_order_responses() {
    let mut transport = fake_transport("out-of-order").await;
    let first = transport.request("one", json!({}));
    let second = transport.request("two", json!({}));
    let (a, b) = tokio::join!(first, second);
    assert_eq!(a.unwrap()["method"], "one");
    assert_eq!(b.unwrap()["method"], "two");
}

#[tokio::test]
async fn forwards_server_requests_for_approval() {
    let mut transport = fake_transport("server-request").await;
    let incoming = transport.incoming().recv().await.unwrap();
    assert!(matches!(incoming, IncomingMessage::Request { method, .. } if method == "item/commandExecution/requestApproval"));
}
```

- [ ] **Step 2: Run transport tests and verify RED**

Run: `cd src-tauri && cargo test codex_bridge::transport --lib`

Expected: compilation fails because the transport module is absent.

- [ ] **Step 3: Implement framed stdio JSON-RPC**

Spawn `codex app-server --listen stdio://` with piped stdin/stdout and inherited-null stderr handling through logs. Use an atomic numeric request ID, a pending map of oneshot senders, one stdout reader task, and one stdin writer mutex. Treat a line with `method` and `id` as a server request, `method` without `id` as a notification, and `result` or `error` with `id` as a response.

Expose transport failures as a typed error with safe user-facing text and detailed local logs. Never log full request payloads.

- [ ] **Step 4: Run focused and complete Rust tests**

Run: `cd src-tauri && cargo test codex_bridge::transport --lib && cargo test --lib`

Expected: all tests pass, including pending-request rejection after fake process exit.

- [ ] **Step 5: Commit the transport**

```bash
git add src-tauri/src/codex_bridge src-tauri/src/lib.rs
git commit -m "feat(hexa): add Codex app-server transport"
```

### Task 3: Codex Event Normalization and Bridge Health

**Files:**
- Modify: `src-tauri/src/codex_bridge/mod.rs`
- Modify: `src-tauri/src/codex_bridge/protocol.rs`
- Modify: `src-tauri/src/hexa_protocol.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `CodexBridgeHandle::health() -> CodexBridgeHealth` and `sessions() -> Vec<HexaSessionProjection>`.
- Produces Tauri event: `humhum://hexa-session-changed` with a `HexaSessionProjection` payload.
- Produces Tauri commands: `get_codex_bridge_health` and `get_hexa_bridge_sessions`.

- [ ] **Step 1: Add failing normalization tests**

Use captured minimal JSON fixtures for `thread/started`, `turn/started`, assistant message deltas, command execution start/completion, file changes, token usage, and turn completion.

```rust
#[test]
fn maps_command_approval_to_the_same_scoped_item() {
    let started = normalize("item/started", json!({
        "threadId": "t1", "turnId": "turn-1",
        "item": {"id": "item-3", "type": "commandExecution", "command": ["npm", "test"]}
    })).unwrap();
    let approval = normalize("item/commandExecution/requestApproval", json!({
        "threadId": "t1", "turnId": "turn-1", "itemId": "item-3", "reason": "Run tests"
    })).unwrap();
    assert_eq!(started.payload["item_id"], approval.payload["item_id"]);
    assert_eq!(approval.payload["item_id"], "t1:item-3");
}
```

- [ ] **Step 2: Run normalization tests and verify RED**

Run: `cd src-tauri && cargo test codex_bridge::tests::maps --lib`

Expected: tests fail because notification normalization is not implemented.

- [ ] **Step 3: Implement lifecycle, compatibility, and notification mapping**

Initialize with HUMHUM client metadata, list recent threads, read active thread state, and map only protocol fields needed by the normalized model. Bridge health wire states are `starting`, `connected`, `codex_missing`, `unsupported`, `disconnected`, and `error`, with `last_connected_at` and a safe `message`.

Start the bridge during Tauri setup. On failure, retain health state and retry with bounded exponential backoff capped at 30 seconds. Do not terminate the app.

- [ ] **Step 4: Register read-only Tauri commands and run tests**

Run: `cd src-tauri && cargo test --lib && cargo check`

Expected: all tests pass and Tauri command registration compiles.

- [ ] **Step 5: Commit observation support**

```bash
git add src-tauri/src/codex_bridge src-tauri/src/hexa_protocol.rs src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat(hexa): observe live Codex sessions"
```

### Task 4: Local Codex Intervention

**Files:**
- Modify: `src-tauri/src/codex_bridge/mod.rs`
- Modify: `src-tauri/src/codex_bridge/protocol.rs`
- Modify: `src-tauri/src/hexa_protocol.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces Tauri commands: `hexa_start_codex_thread`, `hexa_resume_codex_thread`, `hexa_send_codex_message`, `hexa_interrupt_codex_turn`, `hexa_resolve_codex_approval`, and `hexa_answer_codex_question`.
- Consumes exact live `thread_id`, `turn_id`, request ID, and approval expiry from the projection store.

- [ ] **Step 1: Add failing action and approval tests**

Tests must prove that send uses the attached thread, interrupt rejects a stale turn ID, approval accepts only `allow_once` or `deny`, late decisions are rejected, and duplicate decisions are idempotently rejected.

```rust
#[tokio::test]
async fn rejects_an_expired_approval_without_writing_a_response() {
    let bridge = fake_bridge_with_expired_approval("approval-1").await;
    let error = bridge.resolve_approval("approval-1", ApprovalDecision::AllowOnce).await.unwrap_err();
    assert!(matches!(error, CodexBridgeError::ApprovalExpired));
    assert_eq!(bridge.fake_transport().response_count(), 0);
}

#[tokio::test]
async fn interrupt_requires_the_current_turn() {
    let bridge = fake_bridge_with_turn("thread-1", "turn-new").await;
    let error = bridge.interrupt("thread-1", "turn-old").await.unwrap_err();
    assert!(matches!(error, CodexBridgeError::StaleTurn));
}
```

- [ ] **Step 2: Run intervention tests and verify RED**

Run: `cd src-tauri && cargo test codex_bridge::tests::action --lib`

Expected: tests fail because bridge action methods are absent.

- [ ] **Step 3: Implement intentional action methods**

Validate non-empty messages and workspace paths. Resume and start must update the provider-to-HUMHUM session mapping before a turn is sent. Approval responses must reference the original JSON-RPC request ID and use the narrow provider decision corresponding to `allow_once` or `deny`. Remove a pending approval only after the response write succeeds.

- [ ] **Step 4: Register action commands and run the Rust suite**

Run: `cd src-tauri && cargo test --lib && cargo check`

Expected: all tests pass and no command accepts arbitrary JSON-RPC methods or payloads.

- [ ] **Step 5: Commit local intervention**

```bash
git add src-tauri/src/codex_bridge src-tauri/src/hexa_protocol.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(hexa): control local Codex sessions"
```

### Task 5: Merge Live Bridge State into Hexa

**Files:**
- Modify: `src/hooks/useHexaData.ts`
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: `CodexBridgeHealth`, `HexaSessionProjection`, and the intentional commands from Tasks 3-4.
- Produces: existing `HexaSupervisorSession[]` enriched with `source`, `current_activity`, `pending_approvals`, `can_intervene`, and provider IDs hidden from default rendering.

- [ ] **Step 1: Extract and test a pure merge function in Rust-backed frontend build scope**

Because the project has no frontend test runner, implement `mergeHexaSessions(hookSessions, bridgeSessions)` as an exported pure TypeScript function and first add compile-time fixtures in `src/hooks/useHexaData.ts` guarded by a development-only assertion helper. The behavior must prefer bridge status and current activity for matching Codex provider thread IDs while preserving hook statistics and non-Codex sessions.

The fixture must assert:

```ts
const merged = mergeHexaSessions([hookCodex, hookClaude], [bridgeCodex]);
console.assert(merged.length === 2);
console.assert(merged.find((item) => item.session.client_type === "codex")?.current_activity === "Running tests");
console.assert(merged.find((item) => item.session.client_type === "claude-code") !== undefined);
```

- [ ] **Step 2: Run TypeScript build and verify RED**

Run: `npm run build`

Expected: TypeScript compilation fails because bridge types and `mergeHexaSessions` do not exist.

- [ ] **Step 3: Implement bridge loading, event subscriptions, and merge behavior**

Load health and sessions through Tauri commands, subscribe to `humhum://hexa-session-changed`, and update projections by `session_id`. Deduplicate hook Codex sessions only when a stable provider thread ID match exists; otherwise retain both rather than guessing.

- [ ] **Step 4: Add restrained Hexa controls**

Show a small bridge state near the Hexa heading. For a selected live Codex session, provide familiar icon buttons for interrupt and resume with tooltips, a compact message composer, and explicit `Allow once` / `Deny` actions on pending decision rows. Keep raw commands, paths, IDs, and protocol details in the existing disclosure area.

- [ ] **Step 5: Run frontend and Rust verification**

Run: `npm run build && cd src-tauri && cargo test --lib`

Expected: frontend builds and the complete Rust test suite passes.

- [ ] **Step 6: Commit the Hexa experience**

```bash
git add src/hooks/useHexaData.ts src/components/Hub/HexaModule.tsx src/types/index.ts
git commit -m "feat(hexa): add live Codex intervention UI"
```

### Task 6: End-to-End Smoke Test and Documentation

**Files:**
- Create: `src-tauri/tests/codex_app_server_smoke.rs`
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/plans/2026-07-11-hexa-local-codex-bridge.md`

**Interfaces:**
- Consumes the public bridge lifecycle and normalized session APIs.
- Produces an ignored real-Codex smoke test that runs only when explicitly requested.

- [ ] **Step 1: Add an ignored real app-server smoke test**

```rust
#[tokio::test]
#[ignore = "requires an installed and authenticated Codex CLI"]
async fn observes_a_disposable_codex_thread() {
    let workspace = tempfile::tempdir().unwrap();
    let bridge = TestCodexBridge::start(workspace.path()).await.unwrap();
    let session = bridge.start_thread(workspace.path()).await.unwrap();
    bridge.send_message(&session.thread_id, "Reply with exactly: HUMHUM_READY").await.unwrap();
    let completed = bridge.wait_for_completion(Duration::from_secs(90)).await.unwrap();
    assert!(completed.assistant_text.contains("HUMHUM_READY"));
}
```

- [ ] **Step 2: Run the smoke test and capture the initial failure**

Run: `cd src-tauri && cargo test --test codex_app_server_smoke -- --ignored --nocapture`

Expected before final wiring: failure identifying the missing public test harness or an app-server compatibility mismatch, not a silent pass.

- [ ] **Step 3: Complete the public test harness and architecture documentation**

Document the app-server path, normalized projection, hook fallback, approval flow, local-only security boundary, compatibility health states, and exact smoke command. Keep Happy attribution in the design document unless production source is substantially adapted.

- [ ] **Step 4: Run all automated verification**

Run:

```bash
npm run build
cd src-tauri && cargo fmt --check
cd src-tauri && cargo test --lib
cd src-tauri && cargo check
```

Expected: all commands exit zero. Existing dependency deprecation and bundle-size warnings may remain, but no new errors are accepted.

- [ ] **Step 5: Run the real Codex smoke test**

Run: `cd src-tauri && cargo test --test codex_app_server_smoke -- --ignored --nocapture`

Expected: a disposable thread completes with `HUMHUM_READY`, or the bridge reports a precise installed-Codex compatibility/authentication blocker without affecting normal app startup.

- [ ] **Step 6: Start HUMHUM and verify the live UI**

Run: `npm run tauri dev`

Verify: Hexa shows connected bridge health, a live Codex session, meaningful progress, and working local intervention controls at desktop and narrow phone-like widths without overlap.

- [ ] **Step 7: Commit verification and documentation**

```bash
git add src-tauri/tests/codex_app_server_smoke.rs docs/architecture.md docs/superpowers/plans/2026-07-11-hexa-local-codex-bridge.md
git commit -m "test(hexa): verify local Codex bridge"
```

## Follow-Up Plan Boundary

After this plan passes its real local smoke test, write a separate implementation plan for the secure remote layer. That plan will cover device identity, Keychain storage, pairing, end-to-end encryption, replay protection, opaque relay, mobile Web client, push notifications, revocation, and remote intervention. It must consume the normalized Hexa protocol from this plan rather than exposing Codex JSON-RPC remotely.
