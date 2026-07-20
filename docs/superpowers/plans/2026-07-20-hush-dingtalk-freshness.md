# Hush DingTalk Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hush fetch current DingTalk messages when the user refreshes, run an immediate read-only sync when authorized auto-sync is enabled, and show dates for non-today conversations.

**Architecture:** Keep DWS consent in the persisted backend configuration. Route the visible Hush refresh through the existing `sync_hush_dws` command when DWS is authenticated, then reload the inbox. Extract a small reusable periodic runner for immediate-then-interval backend work, and move conversation timestamp presentation into the tested `hushPresentation` module.

**Tech Stack:** React 18, TypeScript, Vitest/Happy DOM, Tauri 2, Rust, Tokio.

## Global Constraints

- DWS remains read-only and never sends or replies to messages.
- Auto-sync runs only when `auto_sync_enabled=true` was explicitly persisted.
- A sync or authentication error keeps the existing local inbox intact.
- Current-device auto-sync is enabled only because the user explicitly approved方案 A.
- Unrelated dirty changes in `src-tauri/src/knowledge_store.rs`, `src-tauri/src/skill_index.rs`, and `src/components/Hub/knowledgePresentation.test.ts` must not be staged or modified.

---

### Task 1: Conversation Date Presentation

**Files:**
- Modify: `src/components/Hub/hushPresentation.ts`
- Modify: `src/components/Hub/hushPresentation.test.ts`
- Modify: `src/components/Hub/HushModule.tsx`

**Interfaces:**
- Produces: `formatHushConversationTime(value: string, now?: Date): string`
- Consumes: `HushContactRow` uses the formatter for `contact.lastMessageTime`.

- [ ] **Step 1: Write the failing formatter tests**

Add this import and test block to `hushPresentation.test.ts`:

```ts
import { formatHushConversationTime } from "./hushPresentation";

describe("Hush conversation time labels", () => {
  const now = new Date(2026, 6, 20, 12, 0, 0);
  const localIso = (year: number, month: number, day: number, hour: number, minute: number) =>
    new Date(year, month, day, hour, minute, 0).toISOString();

  it.each([
    [localIso(2026, 6, 20, 11, 8), "11:08"],
    [localIso(2026, 6, 19, 13, 27), "昨天 13:27"],
    [localIso(2026, 6, 17, 13, 27), "7月17日"],
    [localIso(2025, 11, 31, 23, 59), "2025/12/31"],
    ["invalid-time", "invalid-time"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatHushConversationTime(value, now)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the formatter test and verify RED**

Run:

```bash
npm test -- src/components/Hub/hushPresentation.test.ts
```

Expected: FAIL because `formatHushConversationTime` is not exported.

- [ ] **Step 3: Implement the minimal date-aware formatter**

Add to `hushPresentation.ts`:

```ts
export function formatHushConversationTime(
  value: string,
  now: Date = new Date(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const valueStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (dayStart.getTime() - valueStart.getTime()) / 86_400_000,
  );
  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
```

Import it into `HushModule.tsx`, replace `formatTime(contact.lastMessageTime)` in `HushContactRow`, and add `title={new Date(contact.lastMessageTime).toLocaleString()}` to the `<time>` element.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npm test -- src/components/Hub/hushPresentation.test.ts src/components/Hub/HushModule.test.ts
```

Expected: both Vitest files and the fixed Node contract suite PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/components/Hub/hushPresentation.ts src/components/Hub/hushPresentation.test.ts src/components/Hub/HushModule.tsx
git commit -m "fix(hush): show dates for stale conversations"
```

### Task 2: Real DingTalk Refresh

**Files:**
- Modify: `src/components/Hub/HushModule.tsx`
- Modify: `src/components/Hub/HushModule.test.ts`
- Modify: `src/styles/hub-character-rooms.css`

**Interfaces:**
- Produces: header refresh behavior that calls `sync_hush_dws` when `dwsStatus.authenticated === true`.
- Consumes: existing `syncDws`, `fetchInbox`, `fetchDwsStatus`, `dwsSyncing`, and `connectorError`.

- [ ] **Step 1: Write the failing real-refresh interaction test**

Add this Happy DOM test to `HushModule.test.ts`:

```ts
it("uses the header refresh to sync authenticated DingTalk messages", async () => {
  let finishSync: ((report: unknown) => void) | undefined;
  const syncResult = new Promise((resolve) => {
    finishSync = resolve;
  });
  invokeMock.mockImplementation((command: string) => {
    if (command === "get_hush_dws_status") {
      return Promise.resolve({
        state: "ready",
        message: "ready",
        executable_source: "wukong",
        executable_path: "/Users/example/.real/.bin/dws/bin/dws",
        authenticated: true,
        auto_sync_enabled: true,
        sync_interval_minutes: 5,
        last_success_at: null,
        last_attempt_at: null,
        syncing: false,
        pending_sync: false,
      });
    }
    if (command === "sync_hush_dws") return syncResult;
    return Promise.resolve(defaultInvoke(command));
  });
  const view = await renderHushModule();
  invokeMock.mockClear();

  const refresh = view.host.querySelector<HTMLButtonElement>(
    'button[aria-label="同步并刷新钉钉消息"]',
  );
  expect(refresh).not.toBeNull();
  await act(async () => {
    refresh?.click();
    await Promise.resolve();
  });

  expect(invokeMock).toHaveBeenCalledWith("sync_hush_dws");
  expect(refresh?.disabled).toBe(true);
  expect(refresh?.querySelector("svg")?.classList.contains("is-spinning")).toBe(true);

  await act(async () => {
    finishSync?.({
      conversations: 1,
      examined_messages: 1,
      imported_messages: 1,
      duplicate_messages: 0,
      pages: 1,
      partial: false,
      next_cursor: null,
    });
    await syncResult;
    await Promise.resolve();
  });

  expect(invokeMock).toHaveBeenCalledWith("get_hush_inbox");
  expect(invokeMock).toHaveBeenCalledWith("get_hush_dws_status");
  expect(refresh?.disabled).toBe(false);
  await disposeHushModule(view);
});
```

- [ ] **Step 2: Run the interaction test and verify RED**

Run:

```bash
npm test -- src/components/Hub/HushModule.test.ts
```

Expected: FAIL because the header button still has `aria-label="刷新 Hush 会话"` and only invokes `get_hush_inbox`.

- [ ] **Step 3: Route the header button through real sync**

In `HushModule.tsx`, add:

```ts
const refreshHush = useCallback(async () => {
  if (dwsStatus?.authenticated) {
    await syncDws();
    return;
  }
  await fetchInbox();
}, [dwsStatus?.authenticated, fetchInbox, syncDws]);
```

Change the header button to:

```tsx
<button
  type="button"
  className="hush-header-refresh"
  onClick={() => void refreshHush()}
  disabled={dwsSyncing}
  aria-label="同步并刷新钉钉消息"
  title={dwsStatus?.authenticated ? "同步并刷新钉钉消息" : "刷新本地消息"}
>
  <RefreshCw
    className={dwsSyncing ? "is-spinning" : ""}
    size={16}
    strokeWidth={1.8}
    aria-hidden="true"
  />
</button>
```

Keep `syncDws` error handling unchanged so failed synchronization retains the current inbox.

- [ ] **Step 4: Add bounded refresh motion**

Extend the existing Hush spinner selectors in `hub-character-rooms.css`:

```css
.hush-header-refresh .is-spinning,
.hush-status-action .is-spinning {
  animation: hush-spin 850ms linear 120;
}
```

In the existing `@media (prefers-reduced-motion: reduce)` block, use the same combined selector with `animation: none`.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
npm test -- src/components/Hub/HushModule.test.ts
```

Expected: Hush module tests and Node contract tests PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/components/Hub/HushModule.tsx src/components/Hub/HushModule.test.ts src/styles/hub-character-rooms.css
git commit -m "fix(hush): refresh current DingTalk messages"
```

### Task 3: Immediate Authorized Auto-Sync

**Files:**
- Modify: `src-tauri/src/dws_hush_bridge.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `run_immediately_then_interval(period: Duration, task: F)`.
- Consumes: the existing DWS config check, `DwsHushBridge::sync`, Hush store, and `humhum://hush-message` event emission.

- [ ] **Step 1: Write the failing paused-time scheduler test**

Add a Tokio test beside the DWS bridge tests:

```rust
#[tokio::test(start_paused = true)]
async fn periodic_task_runs_immediately_then_waits_for_the_interval() {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = calls.clone();
    let task = tokio::spawn(run_immediately_then_interval(
        Duration::from_secs(300),
        move || {
            observed.fetch_add(1, Ordering::SeqCst);
            std::future::ready(())
        },
    ));

    tokio::task::yield_now().await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(299)).await;
    tokio::task::yield_now().await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(1)).await;
    tokio::task::yield_now().await;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    task.abort();
}
```

- [ ] **Step 2: Run the scheduler test and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml periodic_task_runs_immediately_then_waits_for_the_interval
```

Expected: FAIL because `run_immediately_then_interval` does not exist.

- [ ] **Step 3: Implement and wire the scheduler**

Add to `dws_hush_bridge.rs`:

```rust
pub(crate) async fn run_immediately_then_interval<F, Fut>(
    period: Duration,
    mut task: F,
) where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    let mut interval = tokio::time::interval(period);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await;
    loop {
        task().await;
        interval.tick().await;
    }
}
```

Replace the DWS background loop in `lib.rs` with `run_immediately_then_interval(Duration::from_secs(300), || async { ... }).await`. Inside the closure, keep the current checks so no sync occurs when `auto_sync_enabled` is false or another sync is running.

- [ ] **Step 4: Run Rust tests and verify GREEN**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml periodic_task_runs_immediately_then_waits_for_the_interval
cargo test --manifest-path src-tauri/Cargo.toml dws_hush_bridge
```

Expected: scheduler and DWS bridge tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src-tauri/src/dws_hush_bridge.rs src-tauri/src/lib.rs
git commit -m "fix(hush): sync DingTalk immediately on launch"
```

### Task 4: Verification, Current-Device Enablement, and Installation

**Files:**
- Modify local config: `/Users/yuxi/.humhum/hush-dws.json`
- Build artifact: `src-tauri/target/release/bundle/macos/HumHum.app`
- Install artifact: `/Applications/HumHum.app`

**Interfaces:**
- Consumes: completed frontend and Rust behavior.
- Produces: a running `0.3.15` app with current-device DWS auto-sync enabled.

- [ ] **Step 1: Run focused and full verification**

```bash
npm test -- src/components/Hub/hushPresentation.test.ts src/components/Hub/HushModule.test.ts
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all commands exit 0; the known dead-code warnings may remain, but no test or build fails.

- [ ] **Step 2: Enable current-device auto-sync while the app is stopped**

Quit HUMHUM, change only `auto_sync_enabled` from `false` to `true` in `/Users/yuxi/.humhum/hush-dws.json`, restart, and confirm the persisted field remains `true`.

- [ ] **Step 3: Build and install the application**

```bash
npm run tauri build
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/HumHum.app
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/HumHum.app
```

Back up the current `/Applications/HumHum.app`, copy the verified new app into the same path, and open it.

- [ ] **Step 4: Verify the original symptom**

Confirm:

```bash
jq 'map(select(.platform == "dingtalk")) | map(.received_at) | max' /Users/yuxi/.humhum/hush-inbox.json
```

The returned time must be from the current DWS window, the visible top conversation must match the latest conversation time, and messages before today must display a date.

- [ ] **Step 5: Commit the completed implementation without unrelated files**

```bash
git status --short
git log -4 --oneline
```

Confirm the three pre-existing unrelated files remain unstaged and every Hush/DWS implementation commit contains only its planned files.
