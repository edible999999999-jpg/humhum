# Hexa Active Monitoring 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Hexa's existing active-monitoring workbench so explicitly related Agent sessions appear as attempts under one development goal, with product-surface identity and evidence-aware result states, without adding a new top-level tab or requiring an embedded LLM.

**Architecture:** Keep `HexaWatchStore` and every existing session operation intact. Add an isolated `HexaGoalStore` that references watched session IDs, expose it through additive Tauri and loopback APIs, and extend the managed `humhum-hexa` skill/CLI to report goal membership and Agent surface. The frontend joins goals with watched sessions in selectors; a single attempt uses the existing session report, while a multi-attempt goal can open a compact summary in the same report pane.

**Tech Stack:** Tauri v2, Rust/Serde, atomic local JSON files, React 19, TypeScript, Vitest, Node test runner, Lucide React.

## Global Constraints

- Keep exactly two Hexa top-level tabs: `主动监控` and `自动扫描`.
- Do not replace or remove current watched-session reports, workflow editing, reviews, interventions, focus actions, or mobile pairing.
- Preserve `~/.humhum/hexa-watch.json`; goal relationships live in `~/.humhum/hexa-goals.json`.
- A goal-store read failure must not make current active monitoring unavailable.
- Keep existing `humhum-hexa watch`, `update`, `plan`, `complete`, and `unwatch` commands compatible.
- Do not add Pi, a required LLM, cloud storage, or a relay dependency.
- Do not infer a Qoder surface from display names or workspace names alone.
- Agent-reported completion is `unverified`; only deterministic evidence or an explicit user decision may produce a stronger result.
- Do not revert or overwrite unrelated dirty-worktree changes. Re-read each target file before editing and stage only files from the current task.

---

## File Structure

### New files

- `src-tauri/src/hexa_goal_store.rs`: goal, attempt, identity, result, persistence, and compatibility model.
- `src/hooks/hexaGoalMonitoring.ts`: pure joins/selectors for project, goal, and independent-session navigation.
- `src/hooks/hexaGoalMonitoring.test.ts`: selector and summary regression tests.
- `src/components/Hub/hexa/HexaGoalSummary.tsx`: compact cross-attempt report pane.
- `src/components/Hub/hexa/HexaGoalSummary.test.tsx`: component behavior tests.
- `src/components/Hub/hexa/HexaActiveMonitor.test.tsx`: single-session preservation and multi-attempt navigation tests.

### Modified files

- `src-tauri/src/lib.rs`: initialize and register `HexaGoalStore`; register additive Tauri commands.
- `src-tauri/src/commands.rs`: read and mutate goal state without coupling failures to watched sessions.
- `src-tauri/src/hook_server.rs`: additive loopback endpoints for managed-skill goal linking and result reporting.
- `src-tauri/src/hexa_connector.rs`: update the managed skill text and installation assertions.
- `scripts/humhum-hexa.mjs`: surface detection, goal linking, persisted goal ID, and completion result reporting.
- `scripts/humhum-hexa.test.mjs`: CLI compatibility and new protocol tests.
- `src/hooks/useHexaData.ts`: frontend goal types, independent loading state, commands, and change-event refresh.
- `src/components/Hub/hexa/HexaActiveMonitor.tsx`: render goal rows and preserve existing attempt reports.
- `src/components/Hub/HexaModule.tsx`: pass goal data and mutations into active monitoring.
- `src/components/Hub/HumiModule.tsx`: optional compact goal-attention summary and Hexa deep link.
- `src/components/Hub/HumiModule.test.tsx`: preserve existing Humi modules and test the new summary.
- `src/components/Hub/HubLayout.tsx`: pass a callback that opens Hexa from Humi.
- `src/components/Hub/HubLayout.test.tsx`: verify the Humi-to-Hexa route.
- `src/styles/hub-character-rooms.css`: compact goal-row and summary styling using the existing Hexa room tokens.

---

### Task 1: Add The Isolated Rust Goal Store

**Files:**
- Create: `src-tauri/src/hexa_goal_store.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/hexa_goal_store.rs`

**Interfaces:**
- Consumes: watched-session IDs and immutable display metadata supplied by later command/API tasks.
- Produces:
  - `HexaAgentSurface`
  - `HexaAttemptResultStatus`
  - `HexaGoalStatus`
  - `HexaDevelopmentGoal`
  - `HexaGoalAttempt`
  - `HexaGoalLinkRequest`
  - `HexaGoalAttemptContext`
  - `HexaAttemptResultRequest`
  - `HexaGoalAcceptRequest`
  - `HexaGoalStore::{load_or_create, unavailable_at, reload_from_disk, link_attempt, update_attempt_result, accept_attempt, delete_goal, goals}`

- [ ] **Step 1: Write failing persistence and compatibility tests**

Add a `#[cfg(test)]` module to the new file with these exact behavioral cases:

```rust
#[test]
fn links_multiple_agent_surfaces_to_one_goal_and_restores_them() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();

    let first = store.link_attempt(link_request(
        Some("goal-hush"),
        "session-codex",
        HexaAgentSurface::CodexDesktop,
    ), attempt_context("codex")).unwrap();
    store.link_attempt(link_request(
        Some(&first.id),
        "session-worker",
        HexaAgentSurface::QoderWorker,
    ), attempt_context("qoder")).unwrap();

    let restored = HexaGoalStore::load_or_create(directory.path()).unwrap();
    assert_eq!(restored.goals().len(), 1);
    assert_eq!(restored.goals()[0].attempts.len(), 2);
}

#[test]
fn old_or_missing_goal_files_do_not_change_hexa_watch_storage() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("hexa-watch.json"),
        r#"{"agents":{"legacy":{"provider":"qoder","runs":[]}}}"#,
    ).unwrap();

    let store = HexaGoalStore::load_or_create(directory.path()).unwrap();
    assert!(store.goals().is_empty());
    assert!(directory.path().join("hexa-watch.json").exists());
}

#[test]
fn corrupt_goal_storage_returns_an_error_without_touching_watch_storage() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("hexa-goals.json"), "{broken").unwrap();
    std::fs::write(directory.path().join("hexa-watch.json"), "{}").unwrap();

    assert!(HexaGoalStore::load_or_create(directory.path()).is_err());
    assert_eq!(
        std::fs::read_to_string(directory.path().join("hexa-watch.json")).unwrap(),
        "{}",
    );
}

#[test]
fn agent_completion_remains_unverified_until_user_acceptance() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
    let goal = store.link_attempt(link_request(
        Some("goal-hush"),
        "session-codex",
        HexaAgentSurface::CodexDesktop,
    ), attempt_context("codex")).unwrap();

    let completed = store.update_attempt_result(HexaAttemptResultRequest {
        goal_id: goal.id.clone(),
        session_id: "session-codex".into(),
        result_status: HexaAttemptResultStatus::Unverified,
        evidence: vec![],
    }).unwrap();
    assert_eq!(completed.attempts[0].result_status, HexaAttemptResultStatus::Unverified);

    let accepted = store.accept_attempt(HexaGoalAcceptRequest {
        goal_id: goal.id,
        session_id: "session-codex".into(),
    }).unwrap();
    assert_eq!(accepted.accepted_attempt_id.as_deref(), Some("session-codex"));
    assert_eq!(accepted.attempts[0].result_status, HexaAttemptResultStatus::Accepted);
}

#[test]
fn deleting_a_goal_never_deletes_watched_session_storage() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("hexa-watch.json"), r#"{"agents":{}}"#).unwrap();
    let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
    let goal = store.link_attempt(link_request(
        None,
        "session-codex",
        HexaAgentSurface::CodexDesktop,
    ), attempt_context("codex")).unwrap();

    store.delete_goal(&goal.id).unwrap();
    assert!(store.goals().is_empty());
    assert!(directory.path().join("hexa-watch.json").exists());
}
```

The helper `link_request` must build a request with title `修复 Hush 消息分类`, project key `repo:/work/humhum`, and no branch/worktree. `attempt_context(family)` returns `HexaGoalAttemptContext { agent_family: family.into(), workspace: Some("/work/humhum".into()) }`.

- [ ] **Step 2: Run the focused Rust test and confirm the red state**

Run:

```bash
cd src-tauri
cargo test hexa_goal_store::tests --lib
```

Expected: compilation fails because `hexa_goal_store` and its types do not exist.

- [ ] **Step 3: Implement the model and atomic persistence**

Create these public types with `snake_case` Serde encoding and safe defaults:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaAgentSurface {
    CodexDesktop,
    CodexCli,
    QoderIde,
    QoderCli,
    QoderWorker,
    Terminal,
    RemoteWorker,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaAttemptResultStatus {
    #[default]
    Unverified,
    Verified,
    Failed,
    Superseded,
    Accepted,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaGoalStatus {
    #[default]
    Active,
    Waiting,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaGoalAttempt {
    pub session_id: String,
    pub agent_family: String,
    #[serde(default)]
    pub surface: HexaAgentSurface,
    pub workspace: Option<String>,
    pub branch: Option<String>,
    pub worktree: Option<String>,
    #[serde(default)]
    pub result_status: HexaAttemptResultStatus,
    #[serde(default)]
    pub evidence: Vec<crate::hexa_watch_store::HexaEvidenceRef>,
    pub linked_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaDevelopmentGoal {
    pub id: String,
    pub project_key: String,
    pub title: String,
    #[serde(default)]
    pub success_criteria: Vec<String>,
    #[serde(default)]
    pub status: HexaGoalStatus,
    #[serde(default)]
    pub attempts: Vec<HexaGoalAttempt>,
    pub accepted_attempt_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaGoalLinkRequest {
    pub goal_id: Option<String>,
    pub project_key: String,
    pub title: String,
    #[serde(default)]
    pub success_criteria: Vec<String>,
    pub session_id: String,
    #[serde(default)]
    pub surface: HexaAgentSurface,
    pub branch: Option<String>,
    pub worktree: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HexaGoalAttemptContext {
    pub agent_family: String,
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaAttemptResultRequest {
    pub goal_id: String,
    pub session_id: String,
    pub result_status: HexaAttemptResultStatus,
    #[serde(default)]
    pub evidence: Vec<crate::hexa_watch_store::HexaEvidenceInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaGoalAcceptRequest {
    pub goal_id: String,
    pub session_id: String,
}
```

Use this snapshot shape, `Uuid::new_v4()` for missing IDs, and the same temporary-file-plus-rename pattern already used by `HexaWatchStore`:

```json
{
  "goals": {
    "goal-hush": {
      "id": "goal-hush",
      "project_key": "repo:/work/humhum",
      "title": "修复 Hush 消息分类",
      "success_criteria": [],
      "status": "active",
      "attempts": [],
      "accepted_attempt_id": null,
      "created_at": "2026-07-19T00:00:00Z",
      "updated_at": "2026-07-19T00:00:00Z"
    }
  }
}
```

`link_attempt(request, context)` must de-duplicate by `(goal_id, session_id)`. `accept_attempt` must set the selected attempt to `Accepted` and change a previously accepted attempt to `Superseded`. Recompute `HexaGoalStatus` after every mutation: `Completed` when an accepted attempt exists, `Waiting` when all available attempts are terminal but none is accepted, and `Active` otherwise.

- [ ] **Step 4: Initialize goal state without coupling it to watched-session startup**

In `src-tauri/src/lib.rs`, add:

```rust
mod hexa_goal_store;
```

During app setup, attempt `HexaGoalStore::load_or_create(&hexa_watch_dir)`. On failure, log the error and manage `HexaGoalStore::unavailable_at(&hexa_watch_dir)`. Do not change `HexaWatchStore` initialization or its error handling.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd src-tauri
cargo test hexa_goal_store::tests --lib
```

Expected: all new goal-store tests pass.

- [ ] **Step 6: Commit the isolated store**

```bash
git add src-tauri/src/hexa_goal_store.rs src-tauri/src/lib.rs
git commit -m "feat(hexa): add isolated development goal store"
```

---

### Task 2: Expose Additive Goal Commands And Loopback APIs

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/hook_server.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/hexa_goal_store.rs`
- Test: `src-tauri/src/hook_server.rs`

**Interfaces:**
- Consumes: Task 1 `HexaGoalStore` request and response types.
- Produces Tauri commands:
  - `get_hexa_development_goals() -> Vec<HexaDevelopmentGoal>`
  - `link_hexa_goal_attempt(request) -> HexaDevelopmentGoal`
  - `update_hexa_attempt_result(request) -> HexaDevelopmentGoal`
  - `accept_hexa_goal_attempt(request) -> HexaDevelopmentGoal`
  - `delete_hexa_development_goal(goal_id) -> Vec<HexaDevelopmentGoal>`
- Produces loopback endpoints:
  - `POST /hexa/goal/link`
  - `POST /hexa/goal/result`

- [ ] **Step 1: Add failing command/store integration tests**

Add a store test proving reload failures keep the in-memory snapshot:

```rust
#[test]
fn reload_failure_keeps_the_last_successful_goal_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
    store.link_attempt(link_request(
        Some("goal-hush"),
        "session-codex",
        HexaAgentSurface::CodexDesktop,
    ), attempt_context("codex")).unwrap();
    std::fs::write(directory.path().join("hexa-goals.json"), "{broken").unwrap();

    assert!(store.reload_from_disk().is_err());
    assert_eq!(store.goals().len(), 1);
}
```

Add a hook-server test that serializes an agent result request with `result_status = accepted` and verifies `agent_result_status_allowed` returns false, while `unverified`, `failed`, and `superseded` return true.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
cd src-tauri
cargo test hexa_goal_store::tests --lib
cargo test hook_server::tests::agent_result_status --lib
```

Expected: failures because reload preservation and endpoint validation are not implemented.

- [ ] **Step 3: Add Tauri commands**

Implement commands in `commands.rs` using a separate `State<'_, Arc<Mutex<HexaGoalStore>>>`. Each successful mutation emits:

```rust
app.emit("humhum://hexa-goal-changed", &updated)
    .map_err(|error| format!("Emit error: {error}"))?;
```

`get_hexa_development_goals` must attempt `reload_from_disk`; if reload fails, return the error without clearing in-memory data. Deletion emits the deleted goal ID and returns the remaining goals.

- [ ] **Step 4: Register the commands**

Add all five command names to the existing `tauri::generate_handler!` list in `lib.rs`. Do not reorder or remove existing commands.

- [ ] **Step 5: Add managed-Agent loopback endpoints**

In `hook_server.rs`, add route cases for `/hexa/goal/link` and `/hexa/goal/result`. Reuse local API token authentication and bounded JSON body parsing.

Before linking, look up the watched session by `request.session_id`. Reject unknown sessions with `404`. Fill `agent_family` and `workspace` from the watched session rather than trusting duplicates in the request.

For `/hexa/goal/result`, enforce:

```rust
fn agent_result_status_allowed(status: &HexaAttemptResultStatus) -> bool {
    matches!(
        status,
        HexaAttemptResultStatus::Unverified
            | HexaAttemptResultStatus::Failed
            | HexaAttemptResultStatus::Superseded
    )
}
```

An Agent cannot mark itself `Verified` or `Accepted`.

- [ ] **Step 6: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test hexa_goal_store::tests --lib
cargo test hook_server::tests --lib
```

Expected: all focused goal and hook-server tests pass.

- [ ] **Step 7: Commit the APIs**

```bash
git add src-tauri/src/commands.rs src-tauri/src/hook_server.rs src-tauri/src/lib.rs src-tauri/src/hexa_goal_store.rs
git commit -m "feat(hexa): expose development goal APIs"
```

---

### Task 3: Extend The Managed Skill And CLI

**Files:**
- Modify: `scripts/humhum-hexa.mjs`
- Modify: `scripts/humhum-hexa.test.mjs`
- Modify: `src-tauri/src/hexa_connector.rs`
- Test: `scripts/humhum-hexa.test.mjs`
- Test: `src-tauri/src/hexa_connector.rs`

**Interfaces:**
- Consumes: Task 2 loopback endpoints.
- Produces:
  - `resolveAgentSurface(options, environment, context) -> string`
  - state fields `goal_id` and `surface`
  - `watch --goal-id --surface --success-criteria`
  - `complete --result --evidence-label --evidence-location`

- [ ] **Step 1: Add failing CLI tests for Qoder surfaces and goal persistence**

Add:

```javascript
test("distinguishes explicit Qoder IDE CLI and Worker surfaces", () => {
  assert.equal(resolveAgentSurface({ surface: "qoder_ide" }, {}, { provider: "qoder" }), "qoder_ide");
  assert.equal(
    resolveAgentSurface({}, { HUMHUM_AGENT_SURFACE: "qoder_worker" }, { provider: "qoder" }),
    "qoder_worker",
  );
  assert.equal(resolveAgentSurface({}, {}, { provider: "qoder" }), "unknown");
  assert.equal(resolveAgentSurface({}, {}, { provider: "qoderwork" }), "qoder_worker");
});
```

Extend the existing end-to-end CLI test so `watch` uses:

```javascript
await runCli([
  "watch",
  "修好跨项目监控",
  "--goal-id",
  "goal-hush",
  "--surface",
  "codex_desktop",
  "--success-criteria",
  "npm test 通过|cargo check 通过",
], options);
```

Assert request order begins with:

```javascript
["/hexa/register", "/hexa/update", "/hexa/goal/link"]
```

Assert the saved state contains `goal_id: "goal-hush"` and `surface: "codex_desktop"`. After `complete`, assert `/hexa/goal/result` receives `result_status: "unverified"`.

- [ ] **Step 2: Run Node tests and verify failure**

Run:

```bash
node --test scripts/humhum-hexa.test.mjs
```

Expected: failure because `resolveAgentSurface` and goal endpoint calls do not exist.

- [ ] **Step 3: Implement conservative surface resolution**

Export:

```javascript
export function resolveAgentSurface(options = {}, environment = {}, context = {}) {
  const explicit = clean(options.surface) ?? clean(environment.HUMHUM_AGENT_SURFACE);
  if (explicit) return explicit;
  if (context.provider === "qoderwork") return "qoder_worker";
  return "unknown";
}
```

Do not infer IDE or CLI from workspace paths.

- [ ] **Step 4: Link a watched session to a goal**

After the existing `/hexa/update` call in `watch`, call `/hexa/goal/link` with:

```javascript
{
  goal_id: clean(flags["goal-id"]),
  project_key: `repo:${workspace}`,
  title: goal,
  success_criteria: (clean(flags["success-criteria"]) ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean),
  session_id: updated.session_id,
  surface,
  branch: clean(flags.branch),
  worktree: clean(flags.worktree),
}
```

Persist the returned goal ID and resolved surface alongside the watched-session state. If goal linking fails, report ``Hexa session registered, but goal linking failed: ${error.message}`` and keep the watched session state; do not delete or roll back the session.

- [ ] **Step 5: Report completion without self-verification**

After the current `complete` audit calls, post:

```javascript
{
  goal_id: state.goal_id,
  session_id: state.session_id,
  result_status: clean(flags.result) ?? "unverified",
  evidence,
}
```

Allow only `unverified`, `failed`, or `superseded` in the CLI. Reject `verified` and `accepted` before sending.

- [ ] **Step 6: Update the installed managed skill**

Revise `MANAGED_SKILL` in `hexa_connector.rs` to explain:

- HumHum is not another Agent.
- Use the real provider session ID.
- Set `--surface qoder_ide`, `qoder_cli`, or `qoder_worker` only when the runtime identity is known.
- Reuse a supplied `--goal-id`; do not fuzzy-match titles.
- Before asking the user for a decision while work remains, report
  `--status waiting --need-user --blocked-reason "<decision needed>"`; after
  the user responds, immediately return to `--status working`. A conversational
  question alone is not a Hexa confirmation signal.
- Agent completion is unverified until evidence or user acceptance exists.
- Never invent test results or mark itself accepted.

Update installer tests to assert those terms, the explicit waiting-for-user
command, and the `/hexa/goal` command behavior are present.

- [ ] **Step 7: Run CLI and connector tests**

Run:

```bash
node --test scripts/humhum-hexa.test.mjs
cd src-tauri
cargo test hexa_connector::tests --lib
```

Expected: all CLI and connector tests pass.

- [ ] **Step 8: Commit the connector protocol**

```bash
git add scripts/humhum-hexa.mjs scripts/humhum-hexa.test.mjs src-tauri/src/hexa_connector.rs
git commit -m "feat(hexa): report goals through managed skills"
```

---

### Task 4: Add Frontend Goal State And Pure Monitoring Selectors

**Files:**
- Create: `src/hooks/hexaGoalMonitoring.ts`
- Create: `src/hooks/hexaGoalMonitoring.test.ts`
- Modify: `src/hooks/useHexaData.ts`
- Test: `src/hooks/hexaGoalMonitoring.test.ts`
- Test: `src/hooks/hexaWatchState.test.ts`

**Interfaces:**
- Consumes: Tauri `HexaDevelopmentGoal[]` and existing `HexaWatchedSession[]`.
- Produces:
  - TypeScript mirrors of all Task 1 public types.
  - `HexaMonitoringProject`
  - `HexaMonitoringGoalEntry`
  - `HexaMonitoringSessionEntry`
  - `buildActiveMonitoringProjects(sessions, goals)`
  - `buildGoalSummary(goal, sessions)`
  - hook state `developmentGoals`, `goalDataState`, `retryGoalData`
  - mutations `acceptGoalAttempt`, `deleteDevelopmentGoal`

- [ ] **Step 1: Write failing selector tests**

Create fixtures and these tests:

```typescript
it("keeps one unlinked session as the existing independent row", () => {
  const projects = buildActiveMonitoringProjects([watchedSession()], []);
  expect(projects[0].entries).toEqual([
    expect.objectContaining({ kind: "session", sessionId: "session-1" }),
  ]);
});

it("groups linked Codex and Qoder Worker attempts without merging reports", () => {
  const sessions = [
    watchedSession({ session_id: "codex-1", provider: "codex" }),
    watchedSession({ session_id: "worker-1", provider: "qoder" }),
  ];
  const goals = [developmentGoal({
    attempts: [
      attempt("codex-1", "codex", "codex_desktop"),
      attempt("worker-1", "qoder", "qoder_worker"),
    ],
  })];

  const projects = buildActiveMonitoringProjects(sessions, goals);
  const entry = projects[0].entries[0];
  expect(entry.kind).toBe("goal");
  if (entry.kind !== "goal") throw new Error("expected goal");
  expect(entry.attempts.map((item) => item.session.session_id)).toEqual(["codex-1", "worker-1"]);
});

it("does not hide sessions when goal data is missing or stale", () => {
  const projects = buildActiveMonitoringProjects(
    [watchedSession({ session_id: "session-1" })],
    [developmentGoal({ attempts: [attempt("missing", "qoder", "qoder_worker")] })],
  );
  expect(projects.flatMap((project) => project.entries)).toEqual([
    expect.objectContaining({ kind: "session", sessionId: "session-1" }),
  ]);
});

it("treats completed-without-evidence as unverified", () => {
  const summary = buildGoalSummary(
    developmentGoal({
      attempts: [attempt("session-1", "codex", "codex_desktop", "unverified")],
    }),
    [watchedSession({ session_id: "session-1", status: "completed" })],
  );
  expect(summary.counts).toEqual({
    total: 1,
    working: 0,
    verified: 0,
    failed: 0,
    unverified: 1,
  });
});
```

- [ ] **Step 2: Run selector tests and confirm failure**

Run:

```bash
npx vitest run src/hooks/hexaGoalMonitoring.test.ts
```

Expected: failure because the module does not exist.

- [ ] **Step 3: Implement pure joins and summaries**

Use session workspace as the project key fallback. Preserve current active-before-completed and newest-first ordering inside every goal. Never synthesize a watched session for an orphan attempt.

Use this discriminated union:

```typescript
export type HexaMonitoringEntry =
  | {
      kind: "goal";
      key: string;
      goal: HexaDevelopmentGoal;
      attempts: Array<{ attempt: HexaGoalAttempt; session: HexaWatchedSession }>;
      updatedAt: string;
    }
  | {
      kind: "session";
      key: string;
      sessionId: string;
      session: HexaWatchedSession;
      updatedAt: string;
    };
```

- [ ] **Step 4: Fetch goal state independently**

In `useHexaData.ts`, add `developmentGoals` and `goalDataState`. Fetch `get_hexa_development_goals` with its own `Promise.allSettled` result. A rejected goal request must keep the previous successful goal snapshot and must not change `watchDataState`.

Listen to `humhum://hexa-goal-changed` and refresh goal data only. Add:

```typescript
const acceptGoalAttempt = useCallback(async (goalId: string, sessionId: string) => {
  const updated = await invoke<HexaDevelopmentGoal>("accept_hexa_goal_attempt", {
    request: { goal_id: goalId, session_id: sessionId },
  });
  setDevelopmentGoals((current) =>
    current.map((goal) => goal.id === updated.id ? updated : goal)
  );
  return updated;
}, []);
```

Add an equivalent deletion mutation and return the new state and actions from the hook.

- [ ] **Step 5: Run frontend hook tests**

Run:

```bash
npx vitest run src/hooks/hexaGoalMonitoring.test.ts src/hooks/hexaWatchState.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit frontend state**

```bash
git add src/hooks/hexaGoalMonitoring.ts src/hooks/hexaGoalMonitoring.test.ts src/hooks/useHexaData.ts src/hooks/hexaWatchState.test.ts
git commit -m "feat(hexa): join goals with watched sessions"
```

---

### Task 5: Upgrade The Existing Active-Monitor Workbench

**Files:**
- Create: `src/components/Hub/hexa/HexaGoalSummary.tsx`
- Create: `src/components/Hub/hexa/HexaGoalSummary.test.tsx`
- Create: `src/components/Hub/hexa/HexaActiveMonitor.test.tsx`
- Modify: `src/components/Hub/hexa/HexaActiveMonitor.tsx`
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `src/styles/hub-character-rooms.css`
- Test: `src/components/Hub/hexa/HexaGoalSummary.test.tsx`
- Test: `src/components/Hub/hexa/HexaActiveMonitor.test.tsx`
- Test: `src/hooks/hexaSessionReport.test.ts`

**Interfaces:**
- Consumes: Task 4 monitoring projects, summaries, goal data state, and mutations.
- Produces:
  - unchanged single-session report selection;
  - goal-row selection in the same report pane;
  - compact `HexaGoalSummary`;
  - explicit Agent-surface labels;
  - optional `focusGoalId` selection for a Humi deep link;
  - comparison content only for goals with at least two available attempts.

- [ ] **Step 1: Write failing component tests**

The active-monitor test must prove:

```tsx
it("preserves the existing session report for one independent session", async () => {
  render(<ActiveMonitorFixture sessions={[watchedSession()]} goals={[]} />);
  expect(screen.getByLabelText("选中会话监督报告")).toBeInTheDocument();
  expect(screen.queryByText("比较结果")).not.toBeInTheDocument();
});

it("renders one development goal with distinct attempt surfaces", async () => {
  render(<ActiveMonitorFixture sessions={twoSessions()} goals={[twoAttemptGoal()]} />);
  expect(screen.getByText("修复 Hush 消息分类")).toBeInTheDocument();
  expect(screen.getByText("Codex Desktop")).toBeInTheDocument();
  expect(screen.getByText("Qoder Worker")).toBeInTheDocument();
});

it("opens the unchanged session report when an attempt is selected", async () => {
  const user = userEvent.setup();
  render(<ActiveMonitorFixture sessions={twoSessions()} goals={[twoAttemptGoal()]} />);
  await user.click(screen.getByRole("button", { name: /Codex Desktop/ }));
  expect(screen.getByLabelText("选中会话监督报告")).toHaveTextContent("Codex attempt");
});
```

The goal-summary test must assert:

- `已完成，尚未验证` for an unverified completed attempt;
- `测试失败` for a failed attempt;
- no message composer, permission button, or workflow editor;
- `采用此结果` calls `onAccept(goalId, sessionId)`;
- compare copy does not appear with fewer than two available attempts.

- [ ] **Step 2: Run focused component tests and confirm failure**

Run:

```bash
npx vitest run \
  src/components/Hub/hexa/HexaActiveMonitor.test.tsx \
  src/components/Hub/hexa/HexaGoalSummary.test.tsx
```

Expected: failure because goal-aware components and props do not exist.

- [ ] **Step 3: Refactor navigation selection without changing reports**

Replace `selectedSessionId` with:

```typescript
type ActiveSelection =
  | { kind: "session"; id: string }
  | { kind: "goal"; id: string };
```

Build navigation through `buildActiveMonitoringProjects`. Project rows remain collapsible. Goal rows expand to compact attempt rows. Independent sessions use the current `hexa-session-nav-item` markup.

When a session or attempt is selected, render the current `HexaSessionReportView` and `renderOperations` dock unchanged. When a goal is selected, render only `HexaGoalSummary`.

Accept `focusGoalId?: string | null`. When it identifies an available goal, select that goal and expand its project group. Ignore unknown IDs without clearing the current valid selection.

- [ ] **Step 4: Implement the compact goal summary**

`HexaGoalSummary` must show:

- title and success criteria;
- total/working/verified/failed/unverified counts;
- one row per available attempt;
- family/surface label, branch/worktree when present, execution status, result status, and strongest evidence;
- `查看会话` and user-only `采用此结果` actions;
- an orphan indicator for unavailable historical attempts.

Use a surface-label function with exact copy:

```typescript
const SURFACE_LABELS: Record<HexaAgentSurface, string> = {
  codex_desktop: "Codex Desktop",
  codex_cli: "Codex CLI",
  qoder_ide: "Qoder IDE",
  qoder_cli: "Qoder CLI",
  qoder_worker: "Qoder Worker",
  terminal: "终端 Agent",
  remote_worker: "远程 Worker",
  unknown: "端类型待确认",
};
```

- [ ] **Step 5: Wire HexaModule without changing top-level tabs**

Pass `developmentGoals`, `goalDataState`, `acceptGoalAttempt`, and `deleteDevelopmentGoal` from `useHexaData` into `HexaActiveMonitor`. Keep the existing `active`/`scanned` segmented control unchanged.

- [ ] **Step 6: Add restrained Hexa styling**

Append narrowly scoped `.hexa-goal-*` styles. Reuse the current Hexa yellow/blue tokens, 8px-or-less radii, current nav width, and current report pane. Do not add nested cards, decorative blobs, or a new background.

Goal and attempt rows must use stable grid columns so status labels cannot resize navigation. Add focus-visible states and ensure 900x700 and compact window layouts do not overlap.

- [ ] **Step 7: Run focused frontend tests**

Run:

```bash
npx vitest run \
  src/hooks/hexaGoalMonitoring.test.ts \
  src/hooks/hexaSessionReport.test.ts \
  src/components/Hub/hexa/HexaActiveMonitor.test.tsx \
  src/components/Hub/hexa/HexaGoalSummary.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 8: Commit the workbench**

```bash
git add \
  src/components/Hub/hexa/HexaGoalSummary.tsx \
  src/components/Hub/hexa/HexaGoalSummary.test.tsx \
  src/components/Hub/hexa/HexaActiveMonitor.tsx \
  src/components/Hub/hexa/HexaActiveMonitor.test.tsx \
  src/components/Hub/HexaModule.tsx \
  src/styles/hub-character-rooms.css \
  src/hooks/hexaSessionReport.test.ts
git commit -m "feat(hexa): group active attempts by development goal"
```

---

### Task 6: Add A Compact Humi Attention Summary

**Files:**
- Modify: `src/components/Hub/HumiModule.tsx`
- Modify: `src/components/Hub/HumiModule.test.tsx`
- Modify: `src/components/Hub/HubLayout.tsx`
- Modify: `src/components/Hub/HubLayout.test.tsx`
- Test: `src/components/Hub/HumiModule.test.tsx`
- Test: `src/components/Hub/HubLayout.test.tsx`

**Interfaces:**
- Consumes: `get_hexa_development_goals`, `get_hexa_watched_sessions`, and the existing Hub tab setter.
- Produces: one compact Humi status row and a goal-aware callback to open Hexa.

- [ ] **Step 1: Add failing Humi and routing tests**

Add a goal fixture to the Humi invoke mock and assert:

```tsx
expect(await screen.findByText("1 个开发目标需要注意")).toBeInTheDocument();
expect(screen.getByText("1 个验证失败")).toBeInTheDocument();
```

In `HubLayout.test.tsx`, click the Humi development summary and assert the Hexa module is rendered with the most urgent goal selected. Keep existing Humi chat, sessions, auto-confirm, TTS, and token-stat assertions.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run \
  src/components/Hub/HumiModule.test.tsx \
  src/components/Hub/HubLayout.test.tsx
```

Expected: failure because Humi has no goal summary or Hexa callback.

- [ ] **Step 3: Add the Humi summary without creating a dashboard**

Add `onOpenHexa: (goalId: string | null) => void` to `HumiModuleProps`. Fetch goals and watched sessions with the existing Humi refresh cycle, using independent failure fallback `[]`. Derive:

- goals needing attention: failed attempts, unverified completed attempts, blocked/waiting live sessions, or no accepted attempt after all attempts complete;
- failed result count.

Select the most urgent goal in this order: failed, blocked/waiting, completed but unverified, then newest update. Render one keyboard-accessible row in the existing operations area:

```tsx
<button
  type="button"
  className="humi-hexa-summary"
  onClick={() => onOpenHexa(mostUrgentGoal?.id ?? null)}
>
  <Wrench size={15} aria-hidden="true" />
  <span>{attentionCount} 个开发目标需要注意</span>
  <small>{failedCount} 个验证失败</small>
</button>
```

Do not render a list of attempts or duplicate Hexa controls.

- [ ] **Step 4: Wire Hub navigation**

In `HubLayout.tsx`, keep `hexaFocusGoalId` state. Pass a callback that stores the selected goal ID and calls `setActive("hexa")`. Pass that ID through `HexaModule` to `HexaActiveMonitor` as `focusGoalId`. Do not change the default active tab from Humi.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run \
  src/components/Hub/HumiModule.test.tsx \
  src/components/Hub/HubLayout.test.tsx
```

Expected: both files pass and all pre-existing Humi assertions remain green.

- [ ] **Step 6: Commit the Humi summary**

```bash
git add \
  src/components/Hub/HumiModule.tsx \
  src/components/Hub/HumiModule.test.tsx \
  src/components/Hub/HubLayout.tsx \
  src/components/Hub/HubLayout.test.tsx
git commit -m "feat(humi): surface Hexa goal attention"
```

---

### Task 7: Full Regression And Visual Verification

**Files:**
- Modify only if verification exposes a defect in files already listed above.
- Evidence: `tmp/hexa-active-monitoring-2/`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: test, build, Rust, and same-viewport visual evidence.

- [ ] **Step 1: Run all JavaScript and frontend tests**

Run:

```bash
npm test
```

Expected: every Vitest and Node test passes with zero failures.

- [ ] **Step 2: Run the production frontend build**

Run:

```bash
npm run build
```

Expected: exit code `0`; existing Vite chunk-size warnings are allowed.

- [ ] **Step 3: Run Rust formatting and complete tests**

Run:

```bash
cd src-tauri
cargo fmt --check
cargo test
cargo check
```

Expected: all commands exit `0`; pre-existing dead-code and future-incompatibility warnings may remain.

- [ ] **Step 4: Verify diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Confirm unrelated pre-existing dirty files were not reverted or staged.

- [ ] **Step 5: Capture the preserved single-session state**

Launch the latest Tauri app, open Hexa `主动监控`, and capture a 900x700 screenshot with one independent watched session to:

```text
tmp/hexa-active-monitoring-2/single-attempt.png
```

Place it beside the existing active-monitor reference at the same viewport. Confirm:

- the two top-level tabs are unchanged;
- navigation and report widths match;
- the existing report actions remain available;
- no goal comparison appears.

- [ ] **Step 6: Capture the multi-attempt state**

Use disposable local goal/session fixtures with Codex Desktop and Qoder Worker attempts. Capture:

```text
tmp/hexa-active-monitoring-2/multi-attempt.png
```

Confirm:

- the development goal is one compact navigation group;
- both product surfaces are visibly distinct;
- result states are readable;
- selecting an attempt restores the existing report;
- selecting the goal opens only the compact summary;
- QR pairing expansion still overlays without shifting the workbench.

- [ ] **Step 7: Review the combined visual comparison**

Create:

```text
tmp/hexa-active-monitoring-2/reference-comparison.png
```

with the current reference, new single-attempt state, and new multi-attempt state at equal size. Inspect the combined image for layout drift, overlaps, typography, spacing, radii, contrast, and background continuity. Fix visible defects and rerun the focused component tests after every fix.

- [ ] **Step 8: Commit only final verification fixes**

If verification required code changes:

```bash
git add \
  src-tauri/src/hexa_goal_store.rs \
  src-tauri/src/commands.rs \
  src-tauri/src/hook_server.rs \
  src-tauri/src/lib.rs \
  src-tauri/src/hexa_connector.rs \
  scripts/humhum-hexa.mjs \
  scripts/humhum-hexa.test.mjs \
  src/hooks/useHexaData.ts \
  src/hooks/hexaGoalMonitoring.ts \
  src/hooks/hexaGoalMonitoring.test.ts \
  src/components/Hub/hexa/HexaActiveMonitor.tsx \
  src/components/Hub/hexa/HexaActiveMonitor.test.tsx \
  src/components/Hub/hexa/HexaGoalSummary.tsx \
  src/components/Hub/hexa/HexaGoalSummary.test.tsx \
  src/components/Hub/HexaModule.tsx \
  src/components/Hub/HumiModule.tsx \
  src/components/Hub/HumiModule.test.tsx \
  src/components/Hub/HubLayout.tsx \
  src/components/Hub/HubLayout.test.tsx \
  src/styles/hub-character-rooms.css
git commit -m "fix(hexa): finish active monitoring regression checks"
```

Do not commit `tmp/` evidence unless the user explicitly requests repository evidence.
