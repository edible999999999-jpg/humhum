# Hype Logical Skill Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one Hype row per logical skill, with deduplicated recent session usage and physical copies available in an expandable detail view.

**Architecture:** Rust continues to persist physical `AgentAsset` records, but each skill asset can carry bounded `SkillUsageEvidence` extracted from recent Codex transcripts. A focused TypeScript presentation function groups physical assets by normalized skill name, merges session evidence, detects content variants, and feeds a dedicated logical-skill row without changing preferences, rules, memory, or Obsidian behavior.

**Tech Stack:** Rust, Serde, Tauri v2, React, TypeScript, Vitest, existing Hype CSS.

## Global Constraints

- Same normalized skill names form one logical skill even when paths, Agents, or contents differ.
- Distinct usage is keyed by `(agent_id, session_id)` and repeated references keep the newest `used_at`.
- Installed copies with no explicit transcript evidence contribute zero sessions.
- Main skill rows sort by latest real use, then newest modification time, then name.
- Session evidence is bounded to the existing 80 recent Codex transcript files and stores no transcript content.
- Existing `knowledge.json` files remain readable through Serde defaults.
- Preferences, rules, memory, Obsidian, Hexa, and permission confirmation behavior remain unchanged.

---

### Task 1: Preserve Per-Session Skill Evidence

**Files:**
- Modify: `src-tauri/src/skill_index.rs`
- Modify: `src-tauri/src/knowledge_store.rs`
- Test: `src-tauri/src/skill_index.rs`

**Interfaces:**
- Produces: `SkillUsageEvidence { session_id, agent_id, session_path, workspace, used_at }`
- Produces: `SkillSource.usage_evidence: Vec<SkillUsageEvidence>`
- Produces: `AgentAsset.usage_evidence: Vec<SkillUsageEvidence>`

- [ ] **Step 1: Write failing Rust tests for session identity and deduplication**

Add a transcript with `session_meta`, `cwd`, and two calls to the same skill, then assert:

```rust
assert_eq!(sources[0].usage_evidence.len(), 1);
assert_eq!(sources[0].usage_evidence[0].session_id, "session-new");
assert_eq!(
    sources[0].usage_evidence[0].workspace.as_deref(),
    Some("/Users/me/project")
);
assert_eq!(
    sources[0].usage_evidence[0].used_at.as_deref(),
    Some("2026-07-20T09:30:00+00:00")
);
```

Add two transcript files referencing the same skill and assert two evidence entries sorted newest first.

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run:

```bash
cd src-tauri
cargo test skill_index::tests::session_ -- --nocapture
```

Expected: compilation or assertions fail because `usage_evidence` does not exist.

- [ ] **Step 3: Add the backward-compatible evidence model**

In `skill_index.rs`, define:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillUsageEvidence {
    pub session_id: String,
    pub agent_id: String,
    pub session_path: String,
    pub workspace: Option<String>,
    pub used_at: Option<String>,
}
```

Add `usage_evidence: Vec<SkillUsageEvidence>` to `SkillSource`. Parse the first `session_meta` record for `payload.id` and `payload.cwd`; fall back to the transcript filename stem for the session ID. Merge repeated references by `(agent_id, session_id)`, keeping the newest timestamp, then sort evidence newest first.

In `knowledge_store.rs`, add:

```rust
#[serde(default, skip_serializing_if = "Vec::is_empty")]
pub usage_evidence: Vec<SkillUsageEvidence>,
```

to `AgentAsset`, initialize it in `parse_agent_asset`, and copy the matched source evidence during `scan_agent_assets_with_home`.

- [ ] **Step 4: Run focused Rust tests and verify GREEN**

Run:

```bash
cd src-tauri
cargo test skill_index::tests::session_ -- --nocapture
```

Expected: all matching tests pass.

- [ ] **Step 5: Commit the evidence layer**

```bash
git add src-tauri/src/skill_index.rs src-tauri/src/knowledge_store.rs
git commit -m "feat(hype): preserve skill session evidence"
```

### Task 2: Group Physical Assets Into Logical Skills

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/Hub/knowledgePresentation.ts`
- Test: `src/components/Hub/knowledgePresentation.test.ts`

**Interfaces:**
- Consumes: `AgentAsset.usage_evidence`
- Produces: `normalizeLogicalSkillName(name: string): string`
- Produces: `groupLogicalSkills(assets: AgentAsset[]): LogicalSkill[]`
- Produces: `filterLogicalSkills(skills: LogicalSkill[], query: string): LogicalSkill[]`

- [ ] **Step 1: Write failing TypeScript grouping tests**

Create two `AgentAsset` values named `humhum_hexa` and `HumHum-Hexa` from different Agents and paths. Give them overlapping session evidence and different content. Assert:

```ts
const [skill] = groupLogicalSkills([codexCopy, claudeCopy]);
expect(skill.key).toBe("humhum-hexa");
expect(skill.copies).toHaveLength(2);
expect(skill.sessions.map((session) => session.session_id)).toEqual([
  "newest-session",
  "older-session",
]);
expect(skill.session_count).toBe(2);
expect(skill.agent_count).toBe(2);
expect(skill.has_multiple_versions).toBe(true);
```

Also assert that an installed copy with no evidence has `session_count === 0` and that search matches a session workspace.

- [ ] **Step 2: Run the focused TypeScript test and verify RED**

Run:

```bash
npx vitest run src/components/Hub/knowledgePresentation.test.ts
```

Expected: fail because logical-skill interfaces and functions are missing.

- [ ] **Step 3: Add frontend types and grouping functions**

Add to `src/types/index.ts`:

```ts
export interface SkillUsageEvidence {
  session_id: string;
  agent_id: string;
  session_path: string;
  workspace?: string | null;
  used_at?: string | null;
}

export interface LogicalSkill {
  key: string;
  name: string;
  display_name_zh?: string | null;
  summary: string;
  copies: AgentAsset[];
  sessions: SkillUsageEvidence[];
  latest_used_at?: string | null;
  latest_modified_at?: string | null;
  session_count: number;
  agent_count: number;
  has_multiple_versions: boolean;
}
```

Add `usage_evidence?: SkillUsageEvidence[]` to `AgentAsset`.

Implement `normalizeLogicalSkillName` with Unicode normalization, lowercase matching, and collapsed space/underscore/hyphen separators. `groupLogicalSkills` must deduplicate sessions by `(agent_id, session_id)`, keep the newest evidence, sort sessions descending, detect content variants using normalized content strings, and sort logical skills by real use, modification time, then name. `filterLogicalSkills` searches names, summaries, Agents, paths, and session workspaces.

- [ ] **Step 4: Run focused TypeScript tests and verify GREEN**

Run:

```bash
npx vitest run src/components/Hub/knowledgePresentation.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the presentation model**

```bash
git add src/types/index.ts src/components/Hub/knowledgePresentation.ts src/components/Hub/knowledgePresentation.test.ts
git commit -m "feat(hype): group logical skills"
```

### Task 3: Render Logical Skill Rows And Expandable Evidence

**Files:**
- Modify: `src/components/Hub/KnowledgeModule.tsx`
- Modify: `src/styles/hub-character-rooms.css`
- Test: `src/components/Hub/KnowledgeModule.test.tsx`

**Interfaces:**
- Consumes: `groupLogicalSkills`, `filterLogicalSkills`, and `LogicalSkill`
- Produces: `LogicalSkillRow({ skill }: { skill: LogicalSkill })`

- [ ] **Step 1: Write a failing Hype component test**

Return two same-name skill assets from the mocked `get_knowledge_data` command. Assert that Hype renders one skill title, the summary says `2 个 Agent`, expanding the row shows both source paths, and the newest session appears before the older session.

- [ ] **Step 2: Run the Hype component test and verify RED**

Run:

```bash
npx vitest run src/components/Hub/KnowledgeModule.test.tsx
```

Expected: duplicate skill rows remain and no session evidence section exists.

- [ ] **Step 3: Replace raw skill rows with logical rows**

In `KnowledgeModule.tsx`:

- filter scope over physical assets first;
- group only `asset_type === "skill"` with `groupLogicalSkills`;
- filter grouped skills with `filterLogicalSkills`;
- preserve existing raw `AgentAssetRow` rendering for non-skill assets;
- change tab and inventory counts to logical skill count plus non-skill count;
- render a `LogicalSkillRow` with recent session count, distinct Agent count, latest use, and a multiple-version badge;
- in the expanded region, render `最近使用会话` first and `安装来源` second.

Use `used_at` descending order from the presentation model. For absent evidence display `未发现使用记录`; do not derive a usage count from copies or modification dates.

- [ ] **Step 4: Add compact evidence styles**

Add `.hype-skill-*` rules to `hub-character-rooms.css` using the existing 8px radius, grid columns, restrained borders, and responsive breakpoint. Keep evidence rows unframed inside the existing expanded area and prevent long paths or workspace names from resizing the layout.

- [ ] **Step 5: Run focused component and presentation tests**

Run:

```bash
npx vitest run src/components/Hub/KnowledgeModule.test.tsx src/components/Hub/knowledgePresentation.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Commit the Hype UI**

```bash
git add src/components/Hub/KnowledgeModule.tsx src/components/Hub/KnowledgeModule.test.tsx src/styles/hub-character-rooms.css
git commit -m "feat(hype): show logical skill session history"
```

### Task 4: Full Verification And Delivery

**Files:**
- Verify only; modify files only for failures caused by Tasks 1-3.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a clean, pushed `main` branch and a running current dev build.

- [ ] **Step 1: Run all frontend tests**

```bash
npm test -- --run
```

Expected: zero failed tests.

- [ ] **Step 2: Build the frontend**

```bash
npm run build
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 3: Check Rust**

```bash
cd src-tauri
cargo fmt --check
cargo check
```

Expected: exit code 0; existing unrelated warnings may remain.

- [ ] **Step 4: Verify the repository and start the current app**

```bash
git diff --check
git status --short --branch
npm run tauri dev
```

Expected: only intentional commits remain, the current main-directory binary listens on `127.0.0.1:31275`, and Hype shows logical skills.

- [ ] **Step 5: Push main**

```bash
git push origin main
```

Expected: `main -> main` succeeds and local `main` matches `origin/main`.
