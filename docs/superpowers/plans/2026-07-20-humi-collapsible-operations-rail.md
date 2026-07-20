# Humi Collapsible Operations Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Humi open as a full-width, full-height conversation with its composer 12px from the real window bottom and an optional Codex-style operations sidebar.

**Architecture:** `HumiModule` owns one non-persisted `operationsOpen` state and conditionally mounts the existing `HumiOperationsRail`. Humi’s CSS height chain becomes explicit, while the conversation stage becomes a two-row grid whose scrollable transcript absorbs all extra height and whose composer remains in normal flow.

**Tech Stack:** React 18, TypeScript, Lucide React, CSS Grid, Vitest, Happy DOM, PostCSS.

## Global Constraints

- The operations sidebar is collapsed every time `HumiModule` mounts.
- Sidebar state is never written to `localStorage`, `sessionStorage`, or backend configuration.
- The composer sits 12px from the real Hub window bottom; additional window height belongs only to the transcript.
- The existing `HumiOperationsRail` data and actions remain unchanged.
- Hub navigation and non-Humi rooms are out of scope.
- Existing unrelated changes in knowledge-store and KnowledgeModule files must not be staged or modified.

---

### Task 1: Collapsible Humi Operations Rail

**Files:**
- Modify: `src/components/Hub/HumiModule.tsx`
- Test: `src/components/Hub/HumiModule.test.tsx`

**Interfaces:**
- Produces: local `operationsOpen: boolean`, defaulting to `false`.
- Produces: button labels `展开运行状态` and `收起运行状态`.
- Produces: `HumiOperationsRail` root id `humi-operations-panel`.
- Consumes: the existing `HumiOperationsRail` props and callbacks without changing them.

- [ ] **Step 1: Replace the always-visible test with a failing toggle test**

Update the first operational-controls test to verify the collapsed default and both toggle directions:

```tsx
it("keeps the operations rail collapsed by default and toggles it for this mount", async () => {
  const view = await renderHumiModule();
  const open = buttonByLabel(view.host, "展开运行状态");

  expect(open.getAttribute("aria-expanded")).toBe("false");
  expect(view.host.querySelector("#humi-operations-panel")).toBeNull();
  expect(
    view.host.querySelector('textarea[placeholder="和 Humi 聊聊"]'),
  ).not.toBeNull();

  await act(async () => open.click());

  const close = buttonByLabel(view.host, "收起运行状态");
  expect(close.getAttribute("aria-expanded")).toBe("true");
  expect(view.host.querySelector("#humi-operations-panel")).not.toBeNull();
  expect(view.host.textContent).toContain("实时会话");
  expect(view.host.textContent).toContain("自动确认");
  expect(view.host.textContent).toContain("TTS 播报");
  expect(view.host.textContent).toContain("1.3M");

  await act(async () => close.click());

  expect(view.host.querySelector("#humi-operations-panel")).toBeNull();
  expect(buttonByLabel(view.host, "展开运行状态")).not.toBeNull();
  await dispose(view);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/components/Hub/HumiModule.test.tsx
```

Expected: FAIL because the toggle button does not exist and the operations rail is always mounted.

- [ ] **Step 3: Add the minimal non-persistent toggle**

Add `PanelRight` to the existing Lucide import. In `HumiModule`, initialize local state:

```tsx
const [operationsOpen, setOperationsOpen] = useState(false);
```

Render the button as the first control inside `humi-conversation-stage`:

```tsx
<button
  type="button"
  className="humi-operations-toggle"
  onClick={() => setOperationsOpen((open) => !open)}
  aria-expanded={operationsOpen}
  aria-controls="humi-operations-panel"
  aria-label={operationsOpen ? "收起运行状态" : "展开运行状态"}
  title={operationsOpen ? "收起运行状态" : "展开运行状态"}
>
  <PanelRight size={17} strokeWidth={1.9} aria-hidden="true" />
</button>
```

Expose the open state on the workspace:

```tsx
<div
  className={`humi-workspace ${operationsOpen ? "is-operations-open" : ""}`}
>
```

Conditionally mount the existing rail without changing its props:

```tsx
{operationsOpen && (
  <HumiOperationsRail
    sessions={sessions}
    stats={stats}
    config={appConfig}
    loading={operationsLoading}
    ttsPreviewing={ttsPreviewing}
    message={operationsMessage}
    hexaAttention={hexaAttention}
    onRefresh={() => void refreshOperations()}
    onOpenHexa={() => onOpenHexa(hexaAttention.mostUrgentGoal?.id ?? null)}
    onFocusSession={(session) => void focusSession(session)}
    onToggleAutoConfirm={() => void toggleAutoConfirm()}
    onPreviewTts={() => void previewTts()}
  />
)}
```

Set the existing aside id:

```tsx
<aside
  id="humi-operations-panel"
  className="humi-operations"
  aria-label="Humi 运行状态"
>
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- src/components/Hub/HumiModule.test.tsx
```

Expected: the Humi component tests PASS.

- [ ] **Step 5: Commit the interaction**

```bash
git add src/components/Hub/HumiModule.tsx src/components/Hub/HumiModule.test.tsx
git commit -m "feat(humi): add collapsible operations rail"
```

### Task 2: Full-Height Conversation and Bottom-Aligned Composer

**Files:**
- Modify: `src/styles/hub-character-rooms.css`
- Test: `src/components/Hub/HubVisualContracts.test.tsx`

**Interfaces:**
- Consumes: `.humi-workspace.is-operations-open` from Task 1.
- Produces: an explicit full-height Humi room chain.
- Produces: a two-row `.humi-conversation-stage` layout with a normal-flow composer.
- Produces: a desktop 252px rail and a narrow-window overlay rail.

- [ ] **Step 1: Add failing CSS contract tests**

Add a helper that returns the final matching rule, so late room overrides are tested:

```ts
function lastSelectorRule(root: Root, selector: string): Rule | undefined {
  let match: Rule | undefined;
  root.walkRules((rule) => {
    if (rule.selectors.includes(selector)) match = rule;
  });
  return match;
}
```

Add the layout contract:

```ts
describe("Humi full-height conversation contract", () => {
  it("fills the room and gives extra height to the transcript above a normal-flow composer", () => {
    const room = lastSelectorRule(
      characterRoomStyleRoot,
      '.hub-room[data-room="humi"] .hub-room-content',
    );
    const stage = lastSelectorRule(
      characterRoomStyleRoot,
      ".humi-conversation-stage",
    );
    const transcript = lastSelectorRule(
      characterRoomStyleRoot,
      ".humi-transcript",
    );
    const composer = lastSelectorRule(
      characterRoomStyleRoot,
      ".humi-composer-shell",
    );

    expect(declaration(room, "height")).toBe("100%");
    expect(declaration(stage, "display")).toBe("grid");
    expect(declaration(stage, "grid-template-rows")).toBe(
      "minmax(0, 1fr) auto",
    );
    expect(declaration(transcript, "overflow-y")).toBe("auto");
    expect(declaration(composer, "position")).toBe("relative");
    expect(declaration(composer, "bottom")).toBeUndefined();
  });

  it("uses one column by default and adds the fixed rail only when open", () => {
    const closed = lastSelectorRule(characterRoomStyleRoot, ".humi-workspace");
    const open = lastSelectorRule(
      characterRoomStyleRoot,
      ".humi-workspace.is-operations-open",
    );

    expect(declaration(closed, "grid-template-columns")).toBe(
      "minmax(0, 1fr)",
    );
    expect(declaration(open, "grid-template-columns")).toBe(
      "minmax(0, 1fr) 252px",
    );
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
npm test -- src/components/Hub/HubVisualContracts.test.tsx
```

Expected: FAIL because the room has no explicit height, the workspace always reserves 252px, and the composer is absolutely positioned.

- [ ] **Step 3: Implement the full-height desktop layout**

Update the late Humi room overrides:

```css
.hub-room[data-room="humi"] .hub-room-content {
  height: 100%;
  min-height: 0;
  padding: 0;
}

.humi-workspace {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.humi-workspace.is-operations-open {
  grid-template-columns: minmax(0, 1fr) 252px;
}

.humi-conversation-stage {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  padding: 44px 36px 12px;
}

.humi-transcript {
  width: min(760px, 100%);
  min-height: 0;
  overflow-y: auto;
  gap: 30px;
  padding: 28px 0 24px;
}

.humi-composer-shell {
  position: relative;
  inset: auto;
  width: auto;
  margin: 0;
  padding: 0;
  background: transparent;
}
```

Add the toggle styling:

```css
.humi-operations-toggle {
  position: absolute;
  z-index: 7;
  top: 42px;
  right: 18px;
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(83, 101, 120, 0.14);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.88);
  color: #4b5663;
  box-shadow: 0 5px 14px rgba(63, 76, 92, 0.06);
  cursor: pointer;
}

.humi-operations-toggle:hover {
  background: rgba(255, 255, 255, 0.98);
  color: #298da8;
}

.humi-operations-toggle:focus-visible {
  outline: 2px solid rgba(41, 141, 168, 0.48);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Add the narrow-window overlay**

Inside the existing `@media (max-width: 760px)` block:

```css
.humi-workspace.is-operations-open {
  grid-template-columns: minmax(0, 1fr);
}

.humi-operations {
  position: absolute;
  inset: 0 0 0 auto;
  width: min(292px, calc(100% - 56px));
  box-shadow: -12px 0 28px rgba(57, 68, 82, 0.12);
}

.humi-conversation-stage {
  padding-right: 18px;
  padding-left: 18px;
}
```

In the reduced-motion block, include `.humi-operations` and `.humi-operations-toggle` with animation and transition disabled.

- [ ] **Step 5: Run focused tests and production build**

Run:

```bash
npm test -- src/components/Hub/HumiModule.test.tsx src/components/Hub/HubVisualContracts.test.tsx
npm run build
```

Expected: both Vitest files PASS, the fixed Node contract suite PASS, and Vite production build succeeds.

- [ ] **Step 6: Commit the layout**

```bash
git add src/styles/hub-character-rooms.css src/components/Hub/HubVisualContracts.test.tsx
git commit -m "fix(humi): fill the Hub window below chat"
```

### Task 3: Final Verification and App Handoff

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: Task 1 interaction and Task 2 layout.
- Produces: verified source state and a locally installed application for visual review.

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
npm test
```

Expected: all Vitest and fixed Node tests PASS.

- [ ] **Step 2: Check formatting and change scope**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the intended Humi commits plus unrelated user-owned changes remain.

- [ ] **Step 3: Build, sign, and install the macOS app**

Run the existing Tauri build. If the known DMG packaging script fails after producing `HumHum.app`, use the successfully built app bundle, apply an ad-hoc deep signature, verify it, back up the installed app, and replace `/Applications/HumHum.app`.

- [ ] **Step 4: Open Humi and inspect the result**

Verify:

- Humi opens with no operations sidebar.
- The composer is approximately 12px from the actual window bottom.
- Extra height appears above the composer in the scrollable transcript.
- The top-right button opens and closes the operations sidebar.
- The desktop rail reaches the actual bottom edge.
