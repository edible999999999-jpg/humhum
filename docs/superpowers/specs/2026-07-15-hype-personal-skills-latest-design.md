# Hype Personal Skills On Latest Main

## Context

The previous implementation was built from detached commit `5f197d0`, while the active project is `main` at `4932414`. The latest Hype stores local knowledge as `AgentAsset` records and already integrates Obsidian, preferences, rules, Humi tools, and AI-assisted context review. The fix must extend that architecture instead of replacing it.

## User Outcome

Hype's default scan shows only skills the user created or explicitly enabled through an installed Codex/Claude plugin. It does not list Codex system skills, plugin marketplace repositories, or disabled plugin caches. Skill cards lead with a Chinese name and plain-language Chinese purpose while retaining the original name and file evidence in details.

## Architecture

Create `src-tauri/src/skill_index.rs` as the source-policy boundary. It parses enabled Codex plugins, resolves their installed cache version, identifies personal skill paths, and supplies local Chinese presentation metadata. `KnowledgeStore::scan_agent_assets` keeps the existing generic `AgentAsset` flow but augments default roots with enabled plugin roots and rejects system or marketplace skill paths.

`AgentAsset` gains backward-compatible optional metadata: `ownership`, `display_name_zh`, and `summary_zh`. Non-skill assets remain unchanged. Existing Humi tools, AI review, rules, Obsidian, and custom roots continue to consume the same collection.

## Source Policy

- Created: `~/.claude/skills`, `~/.agents/skills`, and `~/.codex/skills` excluding `.system`.
- Installed: direct Claude plugin directories excluding `marketplaces`, plus Codex plugins whose `~/.codex/config.toml` entry has `enabled = true`.
- Default asset roots may still include project and Qoder locations for non-skill knowledge.
- `~/.codex/plugins/cache`, `~/.codex/vendor_imports/skills`, and broad `~/.claude` are not exposed as default roots.
- A caller-provided custom root can contribute a skill, but known system and marketplace paths are always rejected.

## Data Safety

The scanner remains read-only toward source skill files. Before rebuilding `~/.humhum/knowledge.json`, HUMHUM creates a timestamped backup. Saving preserves the latest `KnowledgeData` schema. The stale `agent_skills` field from the detached implementation is ignored during load and disappears only after the backup exists and the latest scanner successfully writes `agent_assets`.

## UI

The existing Hype asset tab remains in place and retains its review engine. Default copy becomes user-facing Chinese. Skill cards show ownership, Chinese title and summary, with the original English name beneath. Search includes both Chinese fields. Counts distinguish personal skills without hiding other current knowledge asset types.

## Verification

Rust tests cover enabled-plugin parsing, path rejection, source discovery, and Chinese presentation. A real scan assertion confirms zero marketplace/system leakage and populated Chinese summaries. Run `cargo test --lib`, `cargo check`, and `npm run build`. Existing unrelated warnings are recorded but not changed.
