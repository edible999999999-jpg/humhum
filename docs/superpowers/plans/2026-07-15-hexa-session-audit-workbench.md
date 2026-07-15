# Hexa Session Audit Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Hexa's mixed session feed with separate active-monitoring and automatic-scan tabs, and present every actively watched session as a concise, evidence-backed audit report.

**Architecture:** Extend the durable watched-session record with a backward-compatible audit payload and mutate it through one tagged Rust command/API. Derive a user-facing report in pure TypeScript selectors, then render the active tab as project-grouped session navigation plus a focused report. Existing passive sessions, permission handling, remote/mobile controls, and watch commands remain available but are moved into the correct tab or entry panel.

**Tech Stack:** Tauri v2, Rust/Serde, React 18, TypeScript, Vitest, Lucide React.

## Global Constraints

- Hexa observes, records, reviews, reminds, and supports intervention; it never schedules agents or executes workflow nodes.
- A navigation entry represents one registered session. Workspace/project is visual grouping only and never merges session audit state.
- Active monitoring and automatic scanning are separate top-level tabs.
- The report defaults to accurate conclusions; raw logs and evidence stay collapsed.
- Progress percentages exist only when declared work items exist.
- Final review labels are exactly `满意`, `一般`, and `不满意`.
- Existing `hexa:watch`, `hexa:update`, `hexa:unwatch`, permission requests, automatic approval controls, mobile pairing, and passive scan behavior remain compatible.
- The durable store remains `~/.humhum/hexa-watch.json` and retains atomic write and retry behavior.

---

## File Structure

- `src-tauri/src/hexa_watch_store.rs`: durable audit types, DAG validation, and mutation semantics.
- `src-tauri/src/hook_server.rs`: authenticated `/hexa/audit` mutation endpoint.
- `src-tauri/src/commands.rs`: Tauri audit mutation command.
- `src-tauri/src/lib.rs`: command registration.
- `scripts/hexa-update.mjs`: optional agent-reported work-item and milestone updates.
- `src/hooks/useHexaData.ts`: frontend audit types and mutation callbacks.
- `src/hooks/hexaSessionReport.ts`: pure session grouping, report metrics, conclusion, trajectory, and milestone selectors.
- `src/hooks/hexaSessionReport.test.ts`: report behavior tests.
- `src/components/Hub/hexa/HexaActiveMonitor.tsx`: active-tab session navigation and entry panel.
- `src/components/Hub/hexa/HexaSessionReport.tsx`: selected session report and evidence disclosure.
- `src/components/Hub/hexa/HexaWorkflowEditor.tsx`: checkpoint editor and compact DAG path.
- `src/components/Hub/HexaModule.tsx`: top-level tab shell and integration with existing scanned-session UI.

---

### Task 1: Persist Session-Owned Audit Records

**Files:**
- Modify: `src-tauri/src/hexa_watch_store.rs`

**Interfaces:**
- Produces: `HexaSessionAudit`, `HexaAuditMutationRequest`, `HexaAuditMutation`, and `HexaWatchStore::mutate_audit`.
- Preserves: existing JSON snapshots deserialize with `HexaSessionAudit::default()`.

- [ ] **Step 1: Write failing Rust tests for backward compatibility and report records**

Add tests proving an old watched session without `audit` loads with an empty audit, and proving work items, milestones, outputs, interventions, and reviews survive a restart.

```rust
#[test]
fn loads_legacy_run_with_empty_audit() {
    let loaded = load_legacy_snapshot_without_audit();
    assert!(loaded.runs[0].audit.work_items.is_empty());
    assert!(loaded.runs[0].audit.hexa_review.is_none());
}

#[test]
fn persists_session_audit_across_restart() {
    let session = register_session(&dir);
    mutate(&dir, session.session_id, upsert_work_item("verify", vec![]));
    mutate(&dir, session.session_id, set_review(HexaReviewRating::Satisfied));
    let loaded = reload_session(&dir, &session.session_id);
    assert_eq!(loaded.audit.work_items[0].id, "verify");
    assert_eq!(loaded.audit.hexa_review.unwrap().rating, HexaReviewRating::Satisfied);
}
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cargo test hexa_watch_store --manifest-path src-tauri/Cargo.toml`

Expected: compile failure because the audit types and `mutate_audit` do not exist.

- [ ] **Step 3: Add the durable audit types with Serde defaults**

Implement these public shapes and add `#[serde(default)] pub audit: HexaSessionAudit` to `HexaWatchedSession`:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HexaSessionAudit {
    #[serde(default)] pub goal_revisions: Vec<HexaGoalRevision>,
    #[serde(default)] pub success_criteria: Vec<String>,
    #[serde(default)] pub work_items: Vec<HexaWorkItem>,
    #[serde(default)] pub milestones: Vec<HexaMilestone>,
    #[serde(default)] pub important_outputs: Vec<HexaEvidenceRef>,
    #[serde(default)] pub interventions: Vec<HexaIntervention>,
    pub hexa_review: Option<HexaReview>,
    pub user_review: Option<HexaReview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaWorkItemStatus { Pending, InProgress, Completed, Failed }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaAlignment { OnTrack, Watch, OffTrack }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaReviewRating { Satisfied, Average, Unsatisfied }
```

`HexaEvidenceRef` contains `kind`, `label`, optional `location`, and `observed_at`. `HexaWorkItem` contains `id`, `title`, optional description/acceptance criteria, status, `depends_on`, evidence, and timestamps. `HexaMilestone` contains `id`, `summary`, optional work-item ID, alignment, evidence, and timestamp. `HexaIntervention` contains `id`, kind, summary, and timestamp. `HexaReview` contains rating, summary, evidence, and timestamp.

- [ ] **Step 4: Implement tagged audit mutations and DAG validation**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaAuditMutationRequest {
    pub session_id: String,
    #[serde(flatten)]
    pub mutation: HexaAuditMutation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum HexaAuditMutation {
    ReviseGoal { goal: String, success_criteria: Vec<String> },
    UpsertWorkItem { work_item: HexaWorkItemInput },
    RemoveWorkItem { work_item_id: String },
    AppendMilestone { milestone: HexaMilestoneInput },
    AppendOutput { output: HexaEvidenceInput },
    RecordIntervention { intervention: HexaInterventionInput },
    SetHexaReview { review: HexaReviewInput },
    SetUserReview { review: HexaReviewInput },
}
```

`mutate_audit` reloads before mutation, rejects missing sessions, rejects unknown dependencies and graph cycles, timestamps server-owned fields, persists atomically, and returns the updated session. Removing a referenced work item returns an error rather than silently rewriting the DAG.

- [ ] **Step 5: Add RED/GREEN tests for invalid dependencies and cycles**

```rust
assert!(store.mutate_audit(upsert_work_item("b", vec!["missing"])).is_err());
upsert("a", vec![]);
upsert("b", vec!["a"]);
assert!(store.mutate_audit(upsert_work_item("a", vec!["b"])).is_err());
```

Run: `cargo test hexa_watch_store --manifest-path src-tauri/Cargo.toml`

Expected: all focused tests pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src-tauri/src/hexa_watch_store.rs
git commit -m "feat(hexa): persist session audit records"
```

---

### Task 2: Expose Audit Mutations To Agents And The UI

**Files:**
- Modify: `src-tauri/src/hook_server.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `scripts/hexa-update.mjs`

**Interfaces:**
- Consumes: `HexaWatchStore::mutate_audit` from Task 1.
- Produces: POST `/hexa/audit`, Tauri command `mutate_hexa_session_audit`, and optional `hexa:update` audit flags.

- [ ] **Step 1: Write failing request/store tests**

Add `#[tokio::test] async fn hexa_audit_endpoint_persists_and_rejects_cycles()` to `hook_server.rs`'s test module. Build requests with the existing local-token request helper, call the main request router, assert the first upsert returns 200 with the updated session, then submit a cyclic dependency, assert 400, and reload the store to prove the rejected item was not persisted.

- [ ] **Step 2: Run the test and verify RED**

Run: `cargo test hexa_audit --manifest-path src-tauri/Cargo.toml`

Expected: failure because `/hexa/audit` and the command do not exist.

- [ ] **Step 3: Add the Tauri command**

```rust
#[tauri::command]
pub async fn mutate_hexa_session_audit(
    state: State<'_, Arc<Mutex<HexaWatchStore>>>,
    app: AppHandle,
    request: HexaAuditMutationRequest,
) -> Result<HexaWatchedSession, String> {
    let updated = state.lock().map_err(lock_error)?.mutate_audit(request)?;
    app.emit("humhum://hexa-session-changed", &updated).map_err(emit_error)?;
    Ok(updated)
}
```

Register it in `lib.rs` without changing permission-request commands.

- [ ] **Step 4: Add the authenticated HTTP endpoint**

Route POST `/hexa/audit` through the existing local-token middleware. Parse `HexaAuditMutationRequest`, map validation failures to 400, missing sessions to 404, storage failures to 500, emit `humhum://hexa-session-changed`, and return the updated session.

- [ ] **Step 5: Extend `hexa:update` without breaking positional use**

Support these optional flags:

```text
--work-item-id <id>
--work-item-title <title>
--work-status pending|in_progress|completed|failed
--depends-on <comma-separated-ids>
--milestone <summary>
--alignment on_track|watch|off_track
--evidence-label <label>
--evidence-location <path-or-session-ref>
```

The existing `npm run hexa:update -- "当前进展"` request remains unchanged. When work-item flags are present, post exactly one `upsert_work_item` mutation. When `--milestone` is present, post exactly one `append_milestone` mutation after the work-item mutation. Write the last returned session to `.humhum/hexa-watch-session.json`.

- [ ] **Step 6: Verify and commit Task 2**

Run:

```bash
cargo test hexa --manifest-path src-tauri/Cargo.toml
node --check scripts/hexa-update.mjs
```

Expected: all Hexa tests pass and the script parses.

```bash
git add src-tauri/src/hook_server.rs src-tauri/src/commands.rs src-tauri/src/lib.rs scripts/hexa-update.mjs
git commit -m "feat(hexa): expose session audit updates"
```

---

### Task 3: Derive A Concise User Report

**Files:**
- Create: `src/hooks/hexaSessionReport.ts`
- Create: `src/hooks/hexaSessionReport.test.ts`
- Modify: `src/hooks/useHexaData.ts`

**Interfaces:**
- Produces: `groupWatchedSessions`, `buildHexaSessionReport`, and `selectVisibleMilestones`.
- Produces frontend audit types matching Rust serialization.

- [ ] **Step 1: Write failing selector tests**

Cover these behaviors:

```ts
it("groups by workspace without merging sessions", () => {
  const groups = groupWatchedSessions([run("a", "/repo"), run("b", "/repo")]);
  expect(groups[0].sessions.map((item) => item.session_id)).toEqual(["b", "a"]);
});

it("does not invent progress when no work items exist", () => {
  expect(buildHexaSessionReport(run("a")).progress).toBeNull();
});

it("counts only explicit work and interventions", () => {
  const report = buildHexaSessionReport(runWithAudit());
  expect(report.metrics).toEqual({ total: 4, completed: 2, failed: 1, interventions: 3 });
});

it("shows only important milestones by default", () => {
  expect(selectVisibleMilestones(noisyMilestones())).toHaveLength(5);
});
```

Also test live-before-history sorting, current problem from the latest goal revision, next action selection, off-track evidence requirements, and the three Chinese review labels.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run src/hooks/hexaSessionReport.test.ts`

Expected: failure because the module does not exist.

- [ ] **Step 3: Add matching frontend types and mutation callback**

Extend `HexaWatchedSession` with `audit: HexaSessionAudit`. Add:

```ts
const mutateHexaSessionAudit = useCallback(async (request: HexaAuditMutationRequest) => {
  await invoke<HexaWatchedSession>("mutate_hexa_session_audit", { request });
  await refresh();
}, [refresh]);
```

Return it from `useHexaData`. Existing refresh generation and cached-error behavior remain unchanged.

- [ ] **Step 4: Implement the pure report model**

```ts
export interface HexaSessionReport {
  sessionId: string;
  problem: string;
  progress: { completed: number; total: number; percent: number } | null;
  currentItem: HexaWorkItem | null;
  nextAction: string;
  alignment: "on_track" | "watch" | "off_track";
  metrics: { total: number; completed: number; failed: number; interventions: number };
  outputs: HexaEvidenceRef[];
  risks: HexaMilestone[];
  milestones: HexaMilestone[];
  hexaVerdict: HexaVerdictView | null;
  userVerdict: HexaVerdictView | null;
}
```

No-workflow progress is `null`. Alignment defaults to `watch` when evidence is insufficient, never to `off_track`. Visible milestones include only goal revisions, state-changing work-item events, outputs, interventions, blockers, drift, and reviews; routine heartbeats are filtered.

- [ ] **Step 5: Run tests and commit Task 3**

Run: `npm test -- --run src/hooks/hexaSessionReport.test.ts`

Expected: all report tests pass.

```bash
git add src/hooks/hexaSessionReport.ts src/hooks/hexaSessionReport.test.ts src/hooks/useHexaData.ts
git commit -m "feat(hexa): derive evidence-backed session reports"
```

---

### Task 4: Build The Active Monitoring Workbench

**Files:**
- Create: `src/components/Hub/hexa/HexaActiveMonitor.tsx`
- Create: `src/components/Hub/hexa/HexaSessionReport.tsx`
- Modify: `src/components/Hub/HexaModule.tsx`
- Test: `src/hooks/hexaSessionReport.test.ts`

**Interfaces:**
- Consumes: watched sessions, report selectors, existing focus/delete callbacks, and the existing remote/mobile/watch entry panels.
- Produces: two top-level Hexa tabs and session-level report navigation.

- [ ] **Step 1: Add failing view-model tests for selection and tab counts**

Add pure helpers to `hexaSessionReport.ts` and tests proving:

```ts
expect(resolveSelectedSession(groups, null)?.session_id).toBe("latest-live");
expect(resolveSelectedSession(groups, "deleted")?.session_id).toBe("latest-live");
expect(tabCounts(watched, scanned)).toEqual({ active: 3, scanned: 12 });
```

Run the focused test and verify the new assertions fail.

- [ ] **Step 2: Implement the top segmented navigation**

In `HexaModule`, add `activeSection: "watched" | "scanned"` defaulting to `watched`. Render a restrained segmented control under the module header:

```tsx
<HexaSectionTabs
  value={activeSection}
  watchedCount={watchedSessions.length}
  scannedCount={scannedSessions.length}
  onChange={setActiveSection}
/>
```

The watched branch contains no passive `SessionCard`. The scanned branch contains the existing discovered groups and passive history. Existing scanned-session inference behavior stays unchanged.

- [ ] **Step 3: Implement session navigation and report shell**

`HexaActiveMonitor` renders a responsive grid with stable tracks:

```css
grid-template-columns: minmax(210px, 280px) minmax(0, 1fr);
```

The left navigation groups sessions by workspace label, shows live sessions before completed sessions, and includes status, problem label, and heartbeat. Selecting a session changes only the right report. At narrow widths the navigation becomes a horizontal scroll list above the report.

The report starts with problem, status, current item, next action, alignment, and the five metric readouts: total, completed, failed, interventions, pending confirmations. It shows at most three outputs, three risks, and five milestones before disclosure controls.

- [ ] **Step 4: Move binding and mobile connection into the watched entry**

Add a `新增主动监控` command in the watched-tab header. It toggles one unframed entry region containing the existing `WatchCommandPanel`, `RemoteAccessPanel`, and `HumHumMobilePanel`. When no watched sessions exist, this region is open by default and replaces the report empty state.

Do not duplicate these panels in the scanned tab.

- [ ] **Step 5: Preserve operational controls**

The selected report keeps focus-session, delete-watch, pending approval, intervention, and per-session auto-confirm controls. Secondary technical evidence remains collapsed. Deleting the selected session chooses the next live session, then the newest completed session.

- [ ] **Step 6: Verify and commit Task 4**

Run:

```bash
npm test -- --run src/hooks/hexaSessionReport.test.ts src/hooks/hexaAgentOverview.test.ts src/hooks/hexaWatchState.test.ts
npm run build
```

Expected: all focused tests and the production frontend build pass.

```bash
git add src/components/Hub/hexa/HexaActiveMonitor.tsx src/components/Hub/hexa/HexaSessionReport.tsx src/components/Hub/HexaModule.tsx src/hooks/hexaSessionReport.ts src/hooks/hexaSessionReport.test.ts
git commit -m "feat(hexa): add active session audit workbench"
```

---

### Task 5: Add The Supervision Workflow Editor

**Files:**
- Create: `src/components/Hub/hexa/HexaWorkflowEditor.tsx`
- Modify: `src/components/Hub/hexa/HexaSessionReport.tsx`
- Modify: `src/hooks/hexaSessionReport.ts`
- Test: `src/hooks/hexaSessionReport.test.ts`

**Interfaces:**
- Consumes: `mutateHexaSessionAudit` from Task 3.
- Produces: compact checkpoint path and explicit edit mode; never executes nodes.

- [ ] **Step 1: Write failing graph tests**

Test topological display order, parallel checkpoints, failed nodes, unresolved dependencies, and no-workflow copy.

```ts
expect(orderWorkflow([item("verify", ["build"]), item("build", [])]).map(i => i.id))
  .toEqual(["build", "verify"]);
```

Run the focused test and verify RED.

- [ ] **Step 2: Implement compact read mode**

Render checkpoints as fixed-size rows/nodes with status icon, title, dependencies, and evidence count. Use connectors only to communicate dependencies. No drag canvas, zoom surface, or decorative workflow diagram is required for v1.

- [ ] **Step 3: Implement explicit edit mode**

Users can add a checkpoint, edit title/description/acceptance criteria, choose dependencies from existing IDs, change status, or remove an unreferenced checkpoint. Save calls one audit mutation and shows pending, success, and retryable error states. Cancel restores the durable snapshot.

- [ ] **Step 4: Add final review controls**

At session completion, render `满意`, `一般`, and `不满意` as a segmented user-review control plus optional note. Hexa review is read-only and visibly distinct. Both reviews show their evidence/reason only when expanded.

- [ ] **Step 5: Verify and commit Task 5**

Run:

```bash
npm test -- --run src/hooks/hexaSessionReport.test.ts
npm run build
```

Expected: workflow tests and build pass.

```bash
git add src/components/Hub/hexa/HexaWorkflowEditor.tsx src/components/Hub/hexa/HexaSessionReport.tsx src/hooks/hexaSessionReport.ts src/hooks/hexaSessionReport.test.ts
git commit -m "feat(hexa): add supervision checkpoints and reviews"
```

---

### Task 6: Integrate, Verify, And Run The Latest App

**Files:**
- Modify only files required by integration failures found in this task.

**Interfaces:**
- Verifies the full watched-session lifecycle without changing permission-request semantics.

- [ ] **Step 1: Exercise a real watched session**

Run:

```bash
npm run hexa:watch -- "验证主动监控报告、工作项、偏离和最终评价" --name "Hexa 报告测试"
npm run hexa:update -- "正在建立验收检查点" --work-item-id plan --work-item-title "建立验收检查点" --work-status in_progress
```

Confirm `~/.humhum/hexa-watch.json` contains one session-owned audit record and preserves it after restart.

- [ ] **Step 2: Run all required gates**

```bash
npm test -- --run src/hooks/hexaSessionReport.test.ts src/hooks/hexaAgentOverview.test.ts src/hooks/hexaWatchState.test.ts src/hooks/hexaBridge.test.ts src/hooks/hexaPriority.test.ts
npm run build
cargo test hexa --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: all commands exit 0. Existing Vite chunk-size and `block v0.1.6` future-compatibility warnings may remain but no new warnings are introduced.

- [ ] **Step 3: Perform native Tauri review**

Start `npm run tauri dev` from `/Users/yuxi/Desktop/my_station/devpod-ai-companion`. Confirm:

- `主动监控` opens by default.
- `自动扫描` contains no watched sessions.
- Two watched sessions in one workspace remain separate navigation entries.
- The report shows no invented progress without work items.
- Adding a workflow item updates metrics and trajectory.
- Only milestone summaries are visible until evidence is expanded.
- Mobile pairing and binding command are reachable from `新增主动监控`.
- Permission and auto-confirm controls still operate per session.

- [ ] **Step 4: Final review and integration**

Review the complete diff for regressions in permission handling, refresh ordering, cached watched data, mobile pairing, and passive session grouping. Commit any verified integration fix separately, fetch `origin/main`, integrate non-destructively, rerun affected gates, push `main`, and leave the latest native app running for user review.
