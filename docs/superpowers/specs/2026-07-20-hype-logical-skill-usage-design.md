# Hype Logical Skill Usage

## Context

Hype currently stores every discovered `SKILL.md` as an `AgentAsset` whose identity is its absolute file path. A single logical skill can therefore appear several times when Claude, Codex, Qoder, a plugin cache, or a project workspace each has a copy. The current session scan keeps only the newest timestamp for a physical skill path and discards the session identity, so the UI cannot distinguish installations from real use or show which sessions used a skill.

## User Outcome

The Hype skill list contains one row per logical skill. The row summarizes the latest real use, the number of distinct sessions that used it, and the number of Agents where it is available. Expanding the row shows recent sessions in descending order, followed by installed copies and any version differences. File copies do not inflate skill or usage counts.

## Logical Identity

The primary grouping key is the normalized skill name:

- trim surrounding whitespace;
- apply Unicode-compatible lowercase matching;
- collapse runs of spaces, underscores, and hyphens to a single hyphen;
- use the directory name as a fallback when frontmatter has no name.

Skills with the same normalized name belong to one logical skill even when their paths, Agents, or contents differ. HUMHUM preserves every physical copy as source evidence. Different content hashes set `has_multiple_versions` without splitting the main row.

## Data Model

Keep `AgentAsset` as the persisted physical-asset record for compatibility. Add optional session-use evidence to skill assets:

```text
SkillUsageEvidence
  session_id
  agent_id
  session_path
  workspace
  used_at
```

The scanner records one evidence item per logical `(agent_id, session_id)` pair and keeps the newest `used_at` when the same session references the skill repeatedly. A deterministic fallback derived from the transcript path is used only when a provider transcript has no explicit session ID. An installed copy with no evidence remains available but contributes zero sessions.

The frontend derives `LogicalSkill` groups from skill assets:

```text
LogicalSkill
  key
  name
  display name and summary
  copies[]
  sessions[]
  latest_used_at
  agent_count
  has_multiple_versions
```

This keeps the persisted schema backward compatible while making grouping independently testable.

## Scanning Flow

1. Collect recent supported session transcripts.
2. Parse real skill tool calls together with transcript identity, provider, workspace when available, and event time.
3. Attach evidence to the matching physical skill asset.
4. Merge evidence from repeated references and copied assets by logical skill key.
5. Persist physical assets and evidence in `knowledge.json`.
6. Build logical skill rows in the presentation layer.

Only explicit skill references count as usage. Catalog text, installed files, generic tool calls, and an asset file's modification time do not create a session-use record.

## Hype UI

The skill tab renders logical skills rather than raw skill assets.

Each collapsed row shows:

- skill name and plain-language description;
- latest use time, or `未发现使用记录`;
- `N 个会话` when real evidence exists;
- `N 个 Agent` based on distinct source Agents;
- a compact multiple-version warning when content differs.

Expanding a row shows:

1. `最近使用会话`: distinct sessions sorted newest first, with Agent, workspace or session label, and time;
2. `安装来源`: physical copies grouped by Agent, with path and ownership;
3. version evidence only when hashes differ.

Search operates on logical name, Chinese display text, Agent names, workspaces, and source paths. The main list sorts by latest real use descending, then modification time for never-used skills, then name. Unknown and invalid dates remain at the bottom.

## Compatibility And Limits

- Preferences, rules, memory, Obsidian, and Hype review-engine behavior remain unchanged.
- Existing `knowledge.json` files load with empty usage evidence.
- The first refresh rebuilds evidence from the bounded recent transcript window; it does not claim lifetime usage.
- The UI labels the metric as `最近会话` so users are not misled into reading it as all-time usage.
- No transcript content beyond the small evidence fields is persisted.

## Testing

Rust tests cover session identity extraction, repeated-reference deduplication, newest timestamp selection, and evidence attachment. TypeScript tests cover name normalization, logical grouping across paths and Agents, distinct-session counts, multiple-version detection, search, and descending session order. Verification runs the focused tests, the full frontend suite, `npm run build`, and `cargo check`.
