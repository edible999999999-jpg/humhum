# HUMHUM Hub Character Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Humi, Hype, Hush, and Hexa Hub modules into four restrained character rooms with signature-symbol navigation, distinct palettes, low-contrast mascot environments, accurate Hype defaults, and a conversation-first Hush inbox without breaking existing local workflows.

**Architecture:** Keep `HubLayout` as the only module router and add a presentation-only room shell shared by all four lazy modules. Put deterministic filtering/grouping logic in small tested helpers, keep all Tauri invokes in their existing modules, and layer a Hub-specific stylesheet after the existing global styles. Runtime mascot artwork is generated as text-free raster assets and remains decorative and read-only.

**Tech Stack:** React 18, TypeScript 5, Lucide React, Vitest, Tauri v2, Rust, CSS, ImageGen, WebP.

## Global Constraints

- Work from `/Users/yuxi/Desktop/my_station/devpod-ai-companion-hub-mascot-design` on `codex/hub-mascot-design`.
- Fetch and rebase onto `origin/main` immediately before implementation and again before final verification.
- Do not edit the dirty main worktree at `/Users/yuxi/Desktop/my_station/devpod-ai-companion`.
- Preserve all existing Tauri command names, payloads, persisted data, loading states, and error paths.
- Do not add cloud calls or write to Obsidian, message sources, or Agent configuration.
- The only new local persistence is Hush UI state in `localStorage`: specially followed conversation IDs and per-conversation read-through timestamps.
- Use `钉钉` consistently in code comments, identifiers visible to users, and UI text. Existing backend protocol names such as `dws` remain unchanged where they are API contracts.
- Use Lucide icons for navigation and familiar controls. Do not draw icons with CSS, text glyphs, emoji, inline SVG, or placeholder art.
- Keep at most one full mascot in each room. Decorative room artwork stays at approximately 8-12% visual contrast behind readable content.
- Keep the 52px title bar and 72px navigation rail. Support the starting `900 x 700` window and widths down to 760px without horizontal page scrolling.
- Respect `prefers-reduced-motion`.
- Do not refactor unrelated inline styles in Humi, Hype, Hush, or Hexa.
- Baseline evidence on `origin/main` at `c55b9bd`: `npm run build` passes; the three focused Hub test files pass 9 tests. Local Node `22.17.1` produces an engine warning because the repo requires `>=22.19.0`.

---

## Task 1: Protect Hype Classification And Personal Scope

**Files:**
- Modify: `src-tauri/src/knowledge_store.rs`
- Create: `src/components/Hub/knowledgePresentation.ts`
- Create: `src/components/Hub/knowledgePresentation.test.ts`

- [ ] **Step 1: Add a failing Rust regression test for `AGENTS.md`**

Add a unit test beside the existing `knowledge_store.rs` classification tests:

```rust
#[test]
fn agents_md_remains_an_agent_inside_a_skills_tree() {
    assert_eq!(
        classify_asset_type(
            "/Users/test/.agents/skills/custom-helper/AGENTS.md",
            "AGENTS.md",
        ),
        "agent",
    );
}
```

- [ ] **Step 2: Run the focused Rust test and confirm it fails**

Run:

```bash
cd src-tauri
cargo test agents_md_remains_an_agent_inside_a_skills_tree
```

Expected: failure showing `left: "skill"` and `right: "agent"`.

- [ ] **Step 3: Fix exact-file precedence**

In `classify_asset_type`, classify exact agent files before path-based skill inference:

```rust
if filename == "skill.md" {
    "skill".to_string()
} else if filename == "agents.md" {
    "agent".to_string()
} else if lower_path.contains("soul") {
    // existing branches continue here
}
```

Keep `CLAUDE.md` and `.cursorrules` as rules and keep `/agents/` path inference after the exact-file checks.

- [ ] **Step 4: Add failing frontend tests for personal inventory**

In `knowledgePresentation.test.ts`, cover:

```ts
expect(isPersonalAgentAsset(asset("/Users/me/.codex/skills/my-skill/SKILL.md"))).toBe(true);
expect(isPersonalAgentAsset(asset("/Users/me/.agents/skills/ali-dws-cli/SKILL.md"))).toBe(true);
expect(isPersonalAgentAsset(asset("/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md"))).toBe(true);
expect(isPersonalAgentAsset(asset("/Users/me/.codex/skills/.system/skill-installer/SKILL.md"))).toBe(false);
expect(isPersonalAgentAsset(asset("/Users/me/.codex/plugins/cache/openai-bundled/browser/skills/control/SKILL.md"))).toBe(false);
expect(isPersonalAgentAsset(asset("/Users/me/.claude/plugins/marketplaces/official/agents/reviewer.md"))).toBe(false);
```

Also test `getAgentAssetSummary` with frontmatter, a Markdown heading, and empty content so dense Hype rows always receive a safe one-line description.

- [ ] **Step 5: Run the frontend helper test and confirm it fails**

Run:

```bash
npx vitest run src/components/Hub/knowledgePresentation.test.ts
```

Expected: import/module failure because the helper does not exist.

- [ ] **Step 6: Implement pure presentation helpers**

Export:

```ts
export function isPersonalAgentAsset(asset: AgentAsset): boolean;
export function getAgentAssetSummary(asset: AgentAsset): string;
```

Use normalized lower-case paths. Include user skill roots and `openai-curated-remote`; exclude `.system`, `openai-bundled`, `openai-primary-runtime`, and marketplace inventories. Do not infer personal ownership from `agent_id`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run src/components/Hub/knowledgePresentation.test.ts
cd src-tauri && cargo test agents_md_remains_an_agent_inside_a_skills_tree
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/knowledge_store.rs src/components/Hub/knowledgePresentation.ts src/components/Hub/knowledgePresentation.test.ts
git commit -m "fix(hype): classify personal agent assets accurately"
```

## Task 2: Generate Runtime Character-Room Artwork

**Files:**
- Create: `public/mascots/hub-backgrounds/humi-room.webp`
- Create: `public/mascots/hub-backgrounds/hype-room.webp`
- Create: `public/mascots/hub-backgrounds/hush-room.webp`
- Create: `public/mascots/hub-backgrounds/hexa-room.webp`

- [ ] **Step 1: Measure the runtime slot**

Use the real Hub content area: starting window `900 x 700`, minus 52px title bar, 72px rail, and 48px horizontal content padding. Generate in a 3:2 landscape family at `1536 x 1024` or larger so the artwork can crop safely.

- [ ] **Step 2: Generate Humi's text-free background with ImageGen**

Prompt requirements:

```text
Text-free operational app background, pearly white with pale aqua and restrained lilac. Abstract only: oversized headset arcs entering from the top and side, two soft closed crescent eyes in unused negative space, tiny blush marks, a very subtle scalloped jellyfish fringe at the bottom. No full mascot, no UI, no words, no cards, no icons. Keep the center-left and lower-center very quiet for a dense chat transcript. Soft translucent resin material, low contrast, bright neutral lighting, 3:2 landscape.
```

- [ ] **Step 3: Generate Hype's text-free background with ImageGen**

Prompt requirements:

```text
Text-free operational knowledge-workspace background, pearl white with orange-red energy accents and organized purple structure. Abstract mascot cues only: two antenna arcs at the upper edge, tiny excited eye glints and a small open smile pushed into unused upper-right space, subtle tentacle or shelf rhythms aligning horizontal rows. No full mascot, no UI, no words, no cards, no icons. Keep the central list and left search column quiet and highly readable. Soft translucent resin material, low contrast, 3:2 landscape.
```

- [ ] **Step 4: Generate Hush's text-free background with ImageGen**

Prompt requirements:

```text
Text-free quiet inbox background, pale mint green with warm orange attention accents, a restrained DingTalk blue cue and a restrained WeChat green cue. Abstract worried eyes and protective tentacle arcs at very low contrast. Include exactly one small shy jellyfish mascot peeking from behind the far right edge near the lower half, leaving the scrollbar and message text zone clear. No UI, no words, no cards, no icons. Calm bright neutral lighting, translucent resin material, 3:2 landscape.
```

- [ ] **Step 5: Generate Hexa's text-free background with ImageGen**

Prompt requirements:

```text
Text-free Agent supervision workspace background, pearl white with clear yellow and sky-blue accents. Abstract round-glasses arcs, a black wrench or tool-arm silhouette at the far outer edge, and a subtle blueprint grid aligned to columns and timelines. Include no more than one small yellow-and-blue technical mascot near an unused top corner. No UI, no words, no cards, no icons. Keep the central two-column workbench quiet and readable, low contrast translucent resin material, 3:2 landscape.
```

- [ ] **Step 6: Optimize the returned images**

After each ImageGen call, immediately pass the exact absolute output path from
that tool result to `cwebp`:

```bash
mkdir -p public/mascots/hub-backgrounds
cwebp -q 82 -m 6 "$IMAGEGEN_OUTPUT_PATH" -o public/mascots/hub-backgrounds/humi-room.webp
```

Repeat the command with the returned Hype, Hush, and Hexa paths and their
matching destination filenames. Set `IMAGEGEN_OUTPUT_PATH` to a real tool output
before each run; do not invent or guess generated-image paths.

- [ ] **Step 7: Validate image dimensions and weight**

Run:

```bash
sips -g pixelWidth -g pixelHeight public/mascots/hub-backgrounds/*.webp
du -h public/mascots/hub-backgrounds/*.webp
```

Expected: all four decode, are landscape, and each is below approximately 1.2MB.

- [ ] **Step 8: Visually inspect each WebP**

Use `view_image` on all four outputs. Reject and regenerate any image containing text, UI chrome, multiple full mascots, a central high-contrast face, or a crop that puts mascot features under the primary content zone.

- [ ] **Step 9: Commit**

```bash
git add public/mascots/hub-backgrounds
git commit -m "assets: add Hub character room backgrounds"
```

## Task 3: Build The Shared Room Shell And Signature Navigation

**Files:**
- Create: `src/components/Hub/HubRoom.tsx`
- Create: `src/components/Hub/HubRoom.test.tsx`
- Create: `src/components/Hub/HubNavigation.tsx`
- Create: `src/components/Hub/HubNavigation.test.tsx`
- Create: `src/styles/hub-character-rooms.css`
- Modify: `src/components/Hub/HubLayout.tsx`
- Modify: `src/components/Hub/HubLayout.test.tsx`

- [ ] **Step 1: Add failing room-shell tests**

Render `HubRoom` with `renderToStaticMarkup` and assert:

- `data-room="humi"` is present;
- `/mascots/hub-backgrounds/humi-room.webp` is used;
- the decorative image has `alt=""` and `aria-hidden="true"`;
- children appear inside `.hub-room-content`.

- [ ] **Step 2: Add failing navigation tests**

Render each `HubNavigationItem` and assert:

- Humi contains the Lucide microphone;
- Hype contains antenna and alert symbols in the same stable wrapper;
- Hush contains an eye inside a clipped wrapper;
- Hexa contains a wrench;
- every button has `type="button"`, an accessible label, a visible text label, and a theme-state dot;
- active state uses `aria-current="page"`;
- no portrait image or letter monogram is rendered.

- [ ] **Step 3: Run tests and confirm they fail**

```bash
npx vitest run src/components/Hub/HubRoom.test.tsx src/components/Hub/HubNavigation.test.tsx
```

Expected: module import failures.

- [ ] **Step 4: Implement `HubRoom`**

Use:

```ts
export type HubRoomId = "humi" | "hype" | "hush" | "hexa";

export interface HubRoomProps {
  room: HubRoomId;
  children: ReactNode;
  className?: string;
}
```

Render one decorative `<img>` plus a content wrapper. Do not add data fetching or module-specific actions.

- [ ] **Step 5: Implement signature navigation**

Use Lucide `Mic2`, `Antenna`, `CircleAlert`, `Eye`, and `Wrench`. Hype crossfades between real Lucide icons. Hush clips the real `Eye` icon behind the rail edge. Hexa's wrench stays black while its state dot uses yellow/blue.

Use:

```ts
export interface HubNavigationItemProps {
  room: HubRoomId;
  label: string;
  active: boolean;
  signalActive?: boolean;
  onSelect: () => void;
}
```

- [ ] **Step 6: Integrate the new navigation into `HubLayout`**

Keep lazy imports and window controls unchanged. Add `data-active-room={active}` to `.hub-panel`, add an accessible label to `<nav>`, and replace `H/Y/S/X` with `HubNavigationItem`.

Import `../../styles/hub-character-rooms.css` once from `HubLayout.tsx`.

- [ ] **Step 7: Implement stable motion and focus styles**

In `hub-character-rooms.css`:

- keep symbol wrappers at 24px square;
- cap visible radius at 8px;
- Hype crossfade takes 140-180ms;
- Hush slides 3-5px, blinks once, and stays clipped;
- Hexa rotates no more than 12 degrees;
- active/hover effects do not move labels or resize buttons;
- add `:focus-visible`;
- disable nonessential transitions and animation in `prefers-reduced-motion`.

- [ ] **Step 8: Update the existing window-control test only where imports moved**

Do not weaken its assertions.

- [ ] **Step 9: Run focused tests**

```bash
npx vitest run src/components/Hub/HubRoom.test.tsx src/components/Hub/HubNavigation.test.tsx src/components/Hub/HubLayout.test.tsx
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/Hub/HubRoom.tsx src/components/Hub/HubRoom.test.tsx src/components/Hub/HubNavigation.tsx src/components/Hub/HubNavigation.test.tsx src/components/Hub/HubLayout.tsx src/components/Hub/HubLayout.test.tsx src/styles/hub-character-rooms.css
git commit -m "feat(hub): add character room shell and navigation"
```

## Task 4: Apply The Humi Conversation Room

**Files:**
- Modify: `src/components/Hub/HumiModule.tsx`
- Modify: `src/components/Hub/HubLayout.tsx`
- Modify: `src/components/Hub/HubNavigation.tsx`
- Modify: `src/styles/hub-character-rooms.css`
- Modify: `src/components/Hub/HubNavigation.test.tsx`

- [ ] **Step 1: Extend the navigation test with Humi activity**

Assert that `signalActive` adds a sound-wave state class while preserving the same 24px symbol wrapper.

- [ ] **Step 2: Connect real Humi activity to the rail**

Add an optional presentation callback:

```ts
interface HumiModuleProps {
  onActivityChange?: (active: boolean) => void;
}
```

Call it from an effect derived from the existing `kernelLoading` state. `HubLayout` owns the boolean and passes it to Humi's `HubNavigationItem`. Do not add another request state or timer.

- [ ] **Step 3: Wrap Humi in `HubRoom room="humi"`**

Keep the existing single Humi sprite by the title. It is the room's only full mascot. Convert only the top-level transcript, composer, message-row, and details-panel structural styles to named classes.

- [ ] **Step 4: Establish conversation hierarchy**

- keep assistant messages mostly unframed;
- use one restrained lilac tint for user/current response rows;
- anchor the composer visually at the bottom;
- replace the text arrow with Lucide `ArrowUp`;
- keep the send button's existing handler, disabled state, label, and Enter behavior;
- keep details collapsed by default.

Do not add attachment or microphone controls unless they call an existing real action.

- [ ] **Step 5: Run focused tests and build**

```bash
npx vitest run src/components/Hub/HubNavigation.test.tsx
npm run build
```

Expected: pass; existing engine and chunk-size warnings may remain.

- [ ] **Step 6: Commit**

```bash
git add src/components/Hub/HumiModule.tsx src/components/Hub/HubLayout.tsx src/components/Hub/HubNavigation.tsx src/components/Hub/HubNavigation.test.tsx src/styles/hub-character-rooms.css
git commit -m "feat(humi): apply focused conversation room"
```

## Task 5: Make Hype Search-First And Personal By Default

**Files:**
- Modify: `src/components/Hub/KnowledgeModule.tsx`
- Modify: `src/components/Hub/knowledgePresentation.ts`
- Modify: `src/components/Hub/knowledgePresentation.test.ts`
- Modify: `src/styles/hub-character-rooms.css`

- [ ] **Step 1: Add a failing scope-filter test**

Add a mixed asset list and assert `filterAgentAssets(assets, "mine", query)`:

- keeps custom, `.agents`, and installed `openai-curated-remote` skills such as Superpowers;
- excludes bundled, system, and marketplace inventory;
- searches name, description/content, source, type, agent, path, and tags;
- returns all matches when scope is `"all"`.

- [ ] **Step 2: Implement the pure filter**

Export:

```ts
export type AgentAssetScope = "mine" | "all";
export function filterAgentAssets(
  assets: AgentAsset[],
  scope: AgentAssetScope,
  query: string,
): AgentAsset[];
```

- [ ] **Step 3: Wrap Hype in `HubRoom room="hype"`**

Keep all current invokes and review-engine logic. Add a compact room heading and put the existing Hype review panel below the primary inventory controls.

- [ ] **Step 4: Make search the first action**

At the top of the room:

- render a Lucide `Search` field spanning the available width;
- render a compact icon-only `RefreshCw` button with tooltip and accessible label;
- dispatch refresh to the active real workflow: assets scan, rule scan, Obsidian scan, or `fetchData`;
- keep errors and scan summaries adjacent to this toolbar.

Remove duplicate search inputs from the assets and Obsidian panels after the shared search works.

- [ ] **Step 5: Add personal/all scope**

Default assets to `"mine"` and expose a compact segmented control for `我安装和创建的` and `全部扫描结果`. Keep the advanced root editor and diagnostics available, but move them behind the existing advanced/details affordance so 800+ inventory rows do not dominate the first viewport.

- [ ] **Step 6: Convert the primary inventory to dense rows**

Use one list surface with separators. Each asset row exposes:

- name;
- one-line `getAgentAssetSummary` output;
- source/agent;
- asset type;
- modified time when available.

Do not use a card grid. Keep preference editing, rules, Obsidian hot/cold state, wiki links, tasks, and delete/priority actions functional.

- [ ] **Step 7: Run focused tests and build**

```bash
npx vitest run src/components/Hub/knowledgePresentation.test.ts
npm run build
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/Hub/KnowledgeModule.tsx src/components/Hub/knowledgePresentation.ts src/components/Hub/knowledgePresentation.test.ts src/styles/hub-character-rooms.css
git commit -m "feat(hype): focus knowledge room on personal assets"
```

## Task 6: Make Hush Conversation-First With Special Attention

**Files:**
- Create: `src/components/Hub/hushPresentation.ts`
- Create: `src/components/Hub/hushPresentation.test.ts`
- Modify: `src/components/Hub/HushModule.tsx`
- Modify: `src/components/Hub/HushModule.test.ts`
- Modify: `src/styles/hub-character-rooms.css`

- [ ] **Step 1: Add failing grouping and attention tests**

Test pure helpers for:

- chronological message ordering inside the selected conversation;
- grouping adjacent messages from the same sender/platform into one cluster;
- retaining separate clusters when sender or platform changes;
- filtering contacts by `all`, `attention`, and `unread`;
- serializing and parsing the versioned attention/read-through state;
- returning empty attention IDs and read-through data for malformed local storage.

- [ ] **Step 2: Implement pure Hush presentation helpers**

Export:

```ts
export type HushFilter = "all" | "attention" | "unread";
export interface HushMessageGroup {
  id: string;
  sender: string;
  platform: string;
  chat: string | null;
  messages: HushInboxMessage[];
  startedAt: string;
  endedAt: string;
}
export interface HushConversationState {
  attentionIds: string[];
  readThrough: Record<string, string>;
}
export function groupHushMessages(messages: HushInboxMessage[]): HushMessageGroup[];
export function isHushContactUnread(
  contact: DerivedContact,
  state: HushConversationState,
): boolean;
export function filterHushContacts(
  contacts: DerivedContact[],
  filter: HushFilter,
  state: HushConversationState,
): DerivedContact[];
export function parseHushConversationState(raw: string | null): HushConversationState;
export function serializeHushConversationState(state: HushConversationState): string;
```

Move shared presentation interfaces from `HushModule.tsx` only when needed by the helpers; keep invoke payload shapes unchanged.

- [ ] **Step 3: Persist special attention locally**

Use storage key:

```ts
const HUSH_CONVERSATION_STATE_KEY = "humhum:hush:conversation-state:v1";
```

Initialize once. Update `attentionIds` when the user clicks the star. Update a
conversation's `readThrough` timestamp to its latest message time when that
conversation is selected. Never write to 钉钉, WeChat, or the backend inbox.

- [ ] **Step 4: Wrap Hush in `HubRoom room="hush"`**

Keep connector, notification, 钉钉 login/sync, and truth panels. Place them in a compact collapsible status area above the inbox so the conversation list remains the first operational surface.

- [ ] **Step 5: Add filters and source identity**

Add `全部`, `特别关注`, and `未读` segmented filters. Contact rows retain latest-time descending order and show:

- 钉钉 blue or WeChat green source cue;
- conversation name;
- grouped latest preview;
- timestamp;
- unread/importance indicator;
- icon-only `Star` control with accessible pressed state.

The star button must stop propagation so it does not unexpectedly change the selected conversation.

- [ ] **Step 6: Replace one-card-per-message rendering with clusters**

Render `groupHushMessages(selectedContact.messages)` in chronological order. Use one sender/timestamp header per cluster and unframed message lines beneath it. Keep limited-preview warnings and suggested replies attached to their real messages.

The generated Hush background contains the room's one peeking mascot; do not add another portrait.

- [ ] **Step 7: Run focused tests**

```bash
npx vitest run src/components/Hub/HushModule.test.ts src/components/Hub/hushPresentation.test.ts
```

Expected: all ordering, conversation identity, grouping, and attention tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/Hub/HushModule.tsx src/components/Hub/HushModule.test.ts src/components/Hub/hushPresentation.ts src/components/Hub/hushPresentation.test.ts src/styles/hub-character-rooms.css
git commit -m "feat(hush): group conversations and add special attention"
```

## Task 7: Apply The Hexa Supervision Room

**Files:**
- Modify: `src/components/Hub/HexaModule.tsx`
- Modify: `src/components/Hub/hexa/HexaActiveMonitor.tsx`
- Modify: `src/styles/hub-character-rooms.css`
- Modify: `src/components/Hub/HexaMobilePairingCard.test.tsx`

- [ ] **Step 1: Add a presentation assertion to the existing Hexa test**

Keep the QR behavior tests. Add a static-render assertion that the compact mobile affordance retains an accessible label and real `QrCode`/`Smartphone` icon while no longer requiring a large default dashboard card.

- [ ] **Step 2: Wrap Hexa in `HubRoom room="hexa"`**

Keep `useHexaData`, polling, bridge health, action handlers, intervention queues, confirmations, delete, focus, change summary, and remote/mobile pairing behavior unchanged.

- [ ] **Step 3: Tighten the default workbench**

- keep watched Agents as the primary tab;
- preserve the existing two-column `HexaActiveMonitor`;
- make goal, current step, milestones, blockers, confirmations, heartbeat, and evidence the strongest hierarchy;
- convert the four auto-scan metric cards into one compact summary strip;
- keep statuses text-labeled so color is not the only signal.

- [ ] **Step 4: Demote mobile pairing without removing it**

Keep the existing pairing component and actions, but present the closed/default state as a compact secondary affordance in the heading. Only the active QR state may expand to the current bounded panel.

- [ ] **Step 5: Apply Hexa theme structure**

Use yellow for waiting/decision accents, sky blue for progress/structure, neutral text, and the black wrench in the rail. The room background supplies the only full mascot. Do not recolor client identity indicators because they carry existing meaning.

- [ ] **Step 6: Run focused tests and build**

```bash
npx vitest run src/components/Hub/HexaMobilePairingCard.test.tsx src/hooks/hexaAgentOverview.test.ts src/hooks/hexaPriority.test.ts
npm run build
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/Hub/HexaModule.tsx src/components/Hub/hexa/HexaActiveMonitor.tsx src/components/Hub/HexaMobilePairingCard.test.tsx src/styles/hub-character-rooms.css
git commit -m "feat(hexa): apply focused supervision room"
```

## Task 8: Responsive, Accessibility, And Visual QA

**Files:**
- Modify: `src/styles/hub-character-rooms.css`
- Modify only if a discovered issue requires it: files changed in Tasks 3-7
- Create: `docs/design/hub-character-system/implementation/humi-900x700.png`
- Create: `docs/design/hub-character-system/implementation/hype-900x700.png`
- Create: `docs/design/hub-character-system/implementation/hush-900x700.png`
- Create: `docs/design/hub-character-system/implementation/hexa-900x700.png`

- [ ] **Step 1: Verify stable shell dimensions**

At `900 x 700`, `1100 x 760`, and `760 x 700`, confirm:

- title bar remains 52px;
- navigation rail remains 72px;
- the active room does not horizontally scroll;
- navigation symbols and labels do not shift on hover;
- long names and paths wrap or ellipsize without leaving their containers.

- [ ] **Step 2: Verify each room's first viewport**

Use the user's in-app browser for any browser-based local inspection. For the real Tauri-only Hub state, use the running Tauri window rather than adding a new product route.

Capture each module at `900 x 700` and save the four screenshots at the exact paths listed above.

- [ ] **Step 3: Compare references and implementation together**

For each room, create a side-by-side comparison using the approved reference under `docs/design/hub-character-system/` and its implementation screenshot. Inspect the combined comparison with `view_image`.

Fix:

- mascot contrast above 12%;
- mascot features behind body text;
- image stretching or broken crops;
- card-heavy layouts;
- incorrect palette separation;
- overlapping text, controls, scrollbars, or peeking Hush;
- missing 钉钉 blue or WeChat green cues.

- [ ] **Step 4: Verify keyboard and reduced motion**

Keyboard through all four rail items, Hype search/refresh, Hush filters/star, and Hexa primary controls. Confirm focus is visible.

With reduced motion enabled, confirm Hype crossfade, Hush blink/slide, Humi wave, Hexa rotation, and room crossfade are disabled or effectively static.

- [ ] **Step 5: Verify 200% zoom**

At the minimum supported width, check navigation labels, search, Hush two-pane fallback, Hexa workbench stacking, and all icon-button tooltips/labels.

- [ ] **Step 6: Run the full frontend suite**

```bash
npm test
npm run build
```

Expected: all tests pass and production build completes. Record any pre-existing chunk-size warning without treating it as a redesign failure.

- [ ] **Step 7: Run Rust verification because Task 1 touched Rust**

```bash
cd src-tauri
cargo check
```

Expected: pass.

- [ ] **Step 8: Confirm the worktree only contains intended files**

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors and no unrelated user files.

- [ ] **Step 9: Commit final QA fixes and evidence**

```bash
git add src/styles/hub-character-rooms.css docs/design/hub-character-system/implementation
git commit -m "test(hub): verify character rooms across modules"
```

If visual QA required a source fix, add only that exact already-planned Hub file
to the first command; do not stage the whole `src/components/Hub` directory.

## Task 9: Final Integration Review

**Files:**
- Review all files changed by Tasks 1-8

- [ ] **Step 1: Fetch without blindly rebasing**

```bash
git fetch origin main
git status --short --branch
git log --oneline --left-right HEAD...origin/main
```

If `origin/main` advanced, inspect incoming Hub/Hype/Hush/Hexa changes first, then rebase and resolve only the current branch's changes.

- [ ] **Step 2: Re-run the required verification after any rebase**

```bash
npm test
npm run build
cd src-tauri && cargo check
```

- [ ] **Step 3: Review against the approved design spec**

Check every requirement in `docs/superpowers/specs/2026-07-18-hub-character-rooms-design.md`, especially:

- signature navigation instead of portraits;
- at most one full mascot per room;
- 8-12% decorative contrast;
- Hype personal scope and search prominence;
- Hush latest-time order, grouped messages, source colors, and special attention;
- Hexa workbench priority;
- no external API or source writes.

- [ ] **Step 4: Prepare merge report**

Report:

- final data/presentation helpers;
- changed files grouped by shell, room, asset, and Rust fix;
- `npm test`, `npm run build`, and `cargo check` results;
- visual screenshot paths;
- Node engine/chunk warnings;
- rebase or merge risks against the then-current `origin/main`.
