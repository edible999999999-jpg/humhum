# Hype Personal Skills Latest-Main Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the latest Hype index only user-created and explicitly enabled skills, with Chinese explanations, without replacing the latest AgentAsset architecture.

**Architecture:** A focused Rust `skill_index` module owns discovery and presentation policy. `KnowledgeStore` applies that policy while preserving its existing generic assets, and the current React Hype page renders the added optional metadata.

**Tech Stack:** Rust, Serde, Tauri v2, React, TypeScript, Vite

## Global Constraints

- Work from `/Users/yuxi/Desktop/my_station/devpod-ai-companion` at `main`, not a detached Codex worktree.
- Do not modify or revert current Hexa worktree changes.
- Never write source skill or Obsidian files.
- Reject `~/.codex/skills/.system` and `~/.claude/plugins/marketplaces` even when supplied as custom roots.
- Preserve existing Hype review engine, Humi tools, rules, preferences, memory, and Obsidian behavior.

---

### Task 1: Personal Skill Policy

**Files:**
- Create: `src-tauri/src/skill_index.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `discover_skill_sources(home: &Path) -> Vec<SkillSource>`
- Produces: `is_personal_skill_path(path: &Path) -> bool`
- Produces: `chinese_skill_presentation(name: &str, description: &str) -> (Option<String>, String)`

- [ ] Add tests for enabled-only plugin parsing, system/marketplace rejection, source ownership, and Chinese metadata.
- [ ] Run `cargo test skill_index --lib` and confirm unresolved implementation or failed assertions.
- [ ] Implement the smallest policy module that passes the tests.
- [ ] Run `cargo test skill_index --lib` and confirm all focused tests pass.

### Task 2: Latest AgentAsset Integration

**Files:**
- Modify: `src-tauri/src/knowledge_store.rs`

**Interfaces:**
- Extends `AgentAsset` with serde-default optional `ownership`, `display_name_zh`, and `summary_zh`.
- Consumes the Task 1 source and presentation policy.

- [ ] Add tests proving default scans exclude system/marketplace skills while keeping created and enabled skills.
- [ ] Run the focused tests and confirm they fail against the broad-root scanner.
- [ ] Augment scan roots with discovered installed plugins, filter skill paths, and attach Chinese metadata.
- [ ] Add atomic timestamped backup behavior before replacing an existing knowledge file.
- [ ] Run all `knowledge_store` tests and confirm existing vault behavior remains green.

### Task 3: Latest Hype Presentation

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/Hub/KnowledgeModule.tsx`

**Interfaces:**
- Consumes the optional AgentAsset metadata from Task 2.

- [ ] Add the three optional metadata fields to the TypeScript interface.
- [ ] Remove broad cache roots from the default textarea while preserving project/Qoder roots.
- [ ] Make skill search and cards use Chinese title/summary and ownership labels.
- [ ] Keep non-skill cards, review engine, diagnostics, preferences, rules, and Obsidian intact.
- [ ] Run `npm run build` and confirm TypeScript and Vite succeed.

### Task 4: Data Recovery And Verification

**Files:**
- Runtime data: `~/.humhum/knowledge.json`
- Backup: `~/.humhum/knowledge.json.<timestamp>.bak`

**Interfaces:**
- Uses the latest `KnowledgeStore::scan_agent_assets` implementation.

- [ ] Back up the current stale-schema index before any latest-schema write.
- [ ] Run the actual latest scanner with default roots.
- [ ] Assert `agent_assets` exists, personal skill count is bounded, and system/marketplace leakage is zero.
- [ ] Run `cargo test --lib`, `cargo check`, `npm run build`, and rustfmt checks.
- [ ] Review scoped Git status and confirm Hexa files were not modified by this task.
