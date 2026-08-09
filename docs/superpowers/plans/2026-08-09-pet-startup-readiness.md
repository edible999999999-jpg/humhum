# Pet Startup Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HUMHUM consider startup successful only after the desktop pet draws a real frame, recover one failed WebView startup automatically, and stop hidden windows from briefly mounting pet startup logic.

**Architecture:** The frontend reports an idempotent `report_pet_ready` command after the 2D fallback canvas completes its first draw. A small Rust `pet_startup` coordinator owns a two-timeout state machine: the first missing ready signal reloads `main`, the second sends a localized native notification and stops. `App` resolves the Tauri window label synchronously so each window mounts only its own route from the first render.

**Tech Stack:** React 18, TypeScript, Vitest with happy-dom, Tauri 2.11, Rust, `tauri-plugin-notification`.

## Global Constraints

- The automatic recovery timeout is exactly 8 seconds per attempt.
- The application may reload the `main` WebView at most once per process startup.
- A ready signal is emitted only after the 2D fallback canvas completes a draw.
- Hub, settings, and browser-preview routes never emit pet-ready.
- Final failure copy is localized for `zh` and `en` and contains no WebKit, XPC, PID, paths, or JSON.
- Do not change the 3D model, pet gestures, Hub behavior, user configuration, or durable data.
- Do not dynamically create or destroy Hub/settings windows in this phase.

---

### Task 1: Resolve each window route before the first render

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `isTauriRuntime(): boolean` and `getCurrentWindow().label: string`.
- Produces: deterministic first-render routing for `main`, `hub`, and `settings` with no transient `PetWindow` mount in hidden windows.

- [ ] **Step 1: Write the failing first-render routing test**

Extend the hoisted window mock so it can return a Tauri-like window:

```tsx
const mocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn<() => { label: string; hide: () => Promise<void> }>(),
  initBootstrap: vi.fn(() => Promise.resolve()),
}));
```

Add a helper that temporarily marks happy-dom as Tauri, then add a table-driven test:

```tsx
async function renderTauriWindow(label: "hub" | "settings") {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  mocks.getCurrentWindow.mockReturnValue({ label, hide: vi.fn(async () => {}) });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(App));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { host, root };
}

it.each([
  ["hub", "hub-preview"],
  ["settings", "settings-preview"],
] as const)("renders %s without mounting pet bootstrap", async (label, testId) => {
  const { host, root } = await renderTauriWindow(label);
  expect(host.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
  expect(mocks.initBootstrap).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
```

Give the settings mock `data-testid="settings-preview"`. In `afterEach`, delete `window.__TAURI_INTERNALS__`, clear all mocks, and restore `/`.

Use the typed deletion below so TypeScript accepts the cleanup:

```ts
delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/App.test.tsx
```

Expected: both Tauri route cases fail because the current initial state is `main`, so `PetWindow` calls `initBootstrap` before the effect corrects the label.

- [ ] **Step 3: Implement synchronous first-render routing**

Replace the window-label state/effect in `App` with a synchronous value:

```tsx
const windowLabel = runningInTauri ? getCurrentWindow().label : "hub";
```

Keep browser preview behavior unchanged and retain the `useEffect` import because `PetWindow` still uses it.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run src/App.test.tsx
```

Expected: browser preview, Hub first render, and settings first render all pass; `initBootstrap` remains untouched for non-main routes.

- [ ] **Step 5: Commit the routing fix**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "fix: route humhum windows before first render"
```

---

### Task 2: Report exactly one ready signal after the first pet draw

**Files:**
- Create: `src/components/Pet/petFirstFrameSignal.ts`
- Create: `src/components/Pet/petFirstFrameSignal.test.ts`
- Modify: `src/components/Pet/PetCanvas.tsx`
- Modify: `src/components/Pet/PetView.tsx`

**Interfaces:**
- Produces: `PetFirstFrameSignal` with `reportDrawnFrame(): void`.
- Extends: `PetCanvasProps` with optional `onFirstFrame?: () => void`.
- Calls: Tauri command `report_pet_ready` from `PetView` only.

- [ ] **Step 1: Write the failing one-shot signal test**

Create `petFirstFrameSignal.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PetFirstFrameSignal } from "./petFirstFrameSignal";

describe("PetFirstFrameSignal", () => {
  it("reports only the first completed draw", () => {
    const report = vi.fn();
    const signal = new PetFirstFrameSignal(report);
    signal.reportDrawnFrame();
    signal.reportDrawnFrame();
    expect(report).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/components/Pet/petFirstFrameSignal.test.ts
```

Expected: FAIL because `petFirstFrameSignal.ts` and `PetFirstFrameSignal` do not exist.

- [ ] **Step 3: Implement the minimal one-shot signal**

Create `petFirstFrameSignal.ts`:

```ts
export class PetFirstFrameSignal {
  private reported = false;

  constructor(private readonly report: () => void) {}

  reportDrawnFrame(): void {
    if (this.reported) return;
    this.reported = true;
    this.report();
  }
}
```

- [ ] **Step 4: Run the signal test and verify GREEN**

Run:

```bash
npx vitest run src/components/Pet/petFirstFrameSignal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire the signal to the real canvas draw and Tauri command**

In `PetCanvas`, add `onFirstFrame?: () => void`, keep the latest callback in a ref, construct one `PetFirstFrameSignal` per component lifecycle, and call `reportDrawnFrame()` immediately after:

```ts
ctx!.drawImage(offscreen, 0, 0);
```

The reporter must invoke the current callback ref so a React rerender does not duplicate or stale the callback.

In `PetView`, add a stable callback:

```tsx
const reportPetReady = useCallback(() => {
  invoke("report_pet_ready").catch((error) => {
    console.error("[PetView] Could not report pet readiness:", error);
  });
}, []);
```

Pass it as `<PetCanvas onFirstFrame={reportPetReady} ... />`. Do not call the command from `App`, `PetWindow`, component mount, or 3D `onReady`.

- [ ] **Step 6: Run the focused test and frontend typecheck**

Run:

```bash
npx vitest run src/components/Pet/petFirstFrameSignal.test.ts
npx tsc --noEmit
```

Expected: both pass.

- [ ] **Step 7: Commit the frontend ready signal**

```bash
git add src/components/Pet/petFirstFrameSignal.ts src/components/Pet/petFirstFrameSignal.test.ts src/components/Pet/PetCanvas.tsx src/components/Pet/PetView.tsx
git commit -m "fix: report humhum pet first frame"
```

---

### Task 3: Add a bounded native startup recovery state machine

**Files:**
- Create: `src-tauri/src/pet_startup.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `PetStartupState::default()`, `mark_ready() -> bool`, and `next_action() -> PetStartupAction`.
- Produces: Tauri command `report_pet_ready(State<Arc<PetStartupState>>)`.
- Produces: `start_watchdog(AppHandle, Arc<PetStartupState>, String)`.

- [ ] **Step 1: Write failing Rust state-machine tests**

Create `pet_startup.rs` with the desired test module first:

```rust
#[cfg(test)]
mod tests {
    use super::{PetStartupAction, PetStartupState};

    #[test]
    fn ready_before_timeout_completes_without_recovery() {
        let state = PetStartupState::default();
        assert!(state.mark_ready());
        assert!(!state.mark_ready());
        assert_eq!(state.next_action(), PetStartupAction::Complete);
    }

    #[test]
    fn missing_ready_reloads_once_then_notifies_once() {
        let state = PetStartupState::default();
        assert_eq!(state.next_action(), PetStartupAction::Reload);
        assert_eq!(state.next_action(), PetStartupAction::NotifyFailure);
        assert_eq!(state.next_action(), PetStartupAction::Complete);
    }

    #[test]
    fn ready_after_reload_stops_the_second_recovery() {
        let state = PetStartupState::default();
        assert_eq!(state.next_action(), PetStartupAction::Reload);
        assert!(state.mark_ready());
        assert_eq!(state.next_action(), PetStartupAction::Complete);
    }

    #[test]
    fn failure_copy_is_localized_without_internal_terms() {
        let (zh_title, zh_body) = super::failure_notification_copy("zh");
        let (en_title, en_body) = super::failure_notification_copy("en");
        assert!(zh_title.contains("本体"));
        assert!(zh_body.contains("显示本体"));
        assert!(en_title.contains("Pet"));
        assert!(en_body.contains("Show HumHum"));
        for copy in [zh_title, zh_body, en_title, en_body] {
            assert!(!copy.contains("WebKit"));
            assert!(!copy.contains("PID"));
            assert!(!copy.contains("XPC"));
        }
    }
}
```

Declare `mod pet_startup;` in `lib.rs` so the new test module compiles as part of `cargo test --lib`.

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run:

```bash
cd src-tauri && cargo test --lib pet_startup::tests
```

Expected: FAIL because the state, action enum, methods, and copy function are not defined.

- [ ] **Step 3: Implement the minimal thread-safe state machine**

Use a `Mutex` because startup transitions are rare and must be atomic:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PetStartupAction {
    Complete,
    Reload,
    NotifyFailure,
}

#[derive(Debug, Default)]
struct PetStartupStatus {
    ready: bool,
    recovery_stage: u8,
}

#[derive(Debug, Default)]
pub struct PetStartupState {
    inner: std::sync::Mutex<PetStartupStatus>,
}
```

`mark_ready` sets `ready` and returns `true` only for the first report. `next_action` returns `Complete` when ready; otherwise stage `0` becomes `1` and returns `Reload`, stage `1` becomes `2` and returns `NotifyFailure`, and stage `2` returns `Complete`. Recover a poisoned mutex with `into_inner()` so a diagnostic path cannot panic the application.

Implement `failure_notification_copy(language)` with these exact messages:

```rust
"zh" => (
    "HUMHUM 本体没有成功显示",
    "HUMHUM 仍在菜单栏运行。请点“显示本体”，或重启 HUMHUM。",
),
_ => (
    "HUMHUM Pet did not appear",
    "HUMHUM is still running in the menu bar. Choose “Show HumHum” or restart HUMHUM.",
),
```

- [ ] **Step 4: Run the focused Rust tests and verify GREEN**

Run:

```bash
cd src-tauri && cargo test --lib pet_startup::tests
```

Expected: all four tests pass.

- [ ] **Step 5: Add the command and bounded watchdog effects**

Add:

```rust
pub const PET_READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

#[tauri::command]
pub fn report_pet_ready(state: tauri::State<'_, std::sync::Arc<PetStartupState>>) {
    if state.mark_ready() {
        log::info!("pet-startup-ready");
    }
}
```

Implement `start_watchdog` using `tauri::async_runtime::spawn`. After each 8-second sleep, ask `next_action()` exactly once. On `Reload`, log `pet-startup-timeout reload-attempt=1`, call `show()` and `reload()` on `main`, and continue to the second timeout. On `NotifyFailure`, log `pet-startup-failed`, send the localized notification with `NotificationExt`, and return. On `Complete`, log recovery duration when a reload occurred and return. If `main` is missing or `show`/`reload` fails, log the concrete error and continue to the bounded final notification; never loop.

- [ ] **Step 6: Wire managed state, language, command registration, and watchdog start**

In `lib.rs`:

1. Create and `manage` an `Arc<PetStartupState>` at the beginning of setup, before frontend commands can arrive.
2. Capture `config.ui.language.clone()` before moving config into its managed mutex.
3. Start the watchdog after `setup_tray(app)?` so the recovery notification can honestly reference the menu bar.
4. Register `pet_startup::report_pet_ready` in `generate_handler!`.

Do not add readiness fields to `AppConfig` or persist recovery stage to disk.

- [ ] **Step 7: Run Rust format, lint, and tests**

Run:

```bash
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --locked -- -D warnings
cd src-tauri && cargo test --lib
```

Expected: all commands pass with no warnings.

- [ ] **Step 8: Commit the native recovery coordinator**

```bash
git add src-tauri/src/pet_startup.rs src-tauri/src/lib.rs
git commit -m "fix: recover a missing humhum pet webview"
```

---

### Task 4: Run full gates, install the app bundle, and verify the user-visible outcome

**Files:**
- No new source files.
- Verify all files changed in Tasks 1-3.

**Interfaces:**
- Consumes: repository `verify` skill and Tauri app-only bundling.
- Produces: a locally installed HUMHUM whose visible pet, not merely its PID, is verified.

- [ ] **Step 1: Run the repository verify skill selection**

Run:

```bash
git diff --name-only origin/main...HEAD
```

The expected selection is frontend typecheck, frontend unit tests, and Rust fmt/clippy/test because `src/**`, frontend tests, and `src-tauri/**` changed.

- [ ] **Step 2: Run every selected quality gate**

Run independently so all failures are collected:

```bash
npx tsc --noEmit
npm test
cd src-tauri && cargo fmt --check && cargo clippy --locked -- -D warnings && cargo test --lib
```

Expected: all selected gates pass.

- [ ] **Step 3: Build only the macOS application bundle**

Run:

```bash
npm run tauri build -- --bundles app
```

Expected: `src-tauri/target/release/bundle/macos/HumHum.app` is created successfully without invoking the unrelated DMG bundler.

- [ ] **Step 4: Replace the local application safely and launch it**

Terminate the existing HUMHUM, preserve the current app at a fixed backup path, install the new `.app`, and open it:

```bash
pkill -TERM -x humhum 2>/dev/null || true
test ! -e /private/tmp/HumHum.app.pre-pet-startup-readiness
mv /Applications/HumHum.app /private/tmp/HumHum.app.pre-pet-startup-readiness
/usr/bin/ditto src-tauri/target/release/bundle/macos/HumHum.app /Applications/HumHum.app
open /Applications/HumHum.app
```

Do not delete the backup during this task. If the fixed backup path already exists, stop and choose a new explicit backup name before moving the installed app.

- [ ] **Step 5: Verify visible readiness instead of process-only readiness**

Within 8 seconds of launch, verify all of the following:

```text
- the humhum process exists;
- the main window exists and its bounds intersect the active display;
- a screen capture visibly contains the Humi pet inside the main window bounds;
- the pet accepts a drag or click interaction;
- logs contain pet-startup-ready;
- logs do not contain a second reload attempt or pet-startup-failed.
```

Also open Hub and Settings once and confirm neither action duplicates the pet or starts another pet bootstrap. If first launch recovery is naturally triggered, verify there is exactly one `reload-attempt=1` followed by `pet-startup-ready`.

- [ ] **Step 6: Inspect repository state and summarize evidence**

Run:

```bash
git status -sb
git log --oneline -5
```

Report the exact gate results, installed app path, visible readiness evidence, and any remaining second-phase work. Do not claim success from PID or window existence alone.
