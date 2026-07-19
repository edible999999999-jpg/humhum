# Hexa Active Monitoring 2.0 Design

**Date:** 2026-07-19
**Status:** Approved direction, pending written-spec review

## Product Decision

Hexa will not add a separate "Development Tasks" tab. The existing `主动监控` view will evolve from a session-centered monitor into a goal-centered development workbench while preserving all current single-session operations.

The user-facing model is:

```text
项目
└─ 开发目标
   ├─ Codex Desktop attempt
   ├─ Qoder IDE attempt
   └─ Qoder Worker verification attempt
```

`Mission` remains an internal architecture term. The UI uses `开发目标`. A monitored session is one `attempt` under a goal. A goal may have one attempt, in which case the current UI remains effectively unchanged.

## Problem

Hexa can currently show what one watched Agent session is doing, but it cannot reliably answer:

- whether multiple sessions are solving the same user goal;
- which Qoder product surface produced a session;
- which branch or worktree belongs to each attempt;
- whether an Agent's completion claim has system evidence;
- which attempt failed, was superseded, or should be accepted;
- what remains after all participating sessions become idle or complete.

Adding a parallel task screen would duplicate the existing goal, workflow, evidence, and review surfaces. The product should improve active monitoring instead of creating a second task system.

## Product Boundary

Hexa remains a local supervisor and audit workbench. It does not become an Agent runtime or an autonomous orchestrator.

Agents are responsible for reasoning and structured semantic reporting. HumHum is responsible for:

- durable identity;
- goal and attempt relationships;
- deterministic system facts;
- evidence provenance;
- attention routing;
- result comparison and user review.

HumHum does not require Pi or another embedded model. Optional LLM analysis is deferred and must never overwrite deterministic evidence.

## Preserved Behavior

The following existing functionality remains available and keeps its current meaning:

- the `主动监控` and `自动扫描` top-level tabs;
- watched-session navigation and project grouping;
- current session reports and workflow editing;
- Hexa review and user review;
- permission decisions and follow-up messages;
- exact return to the originating Agent session;
- mobile QR pairing and mobile control;
- active-monitor empty, loading, disconnected, and error states;
- existing `watch`, `update`, `plan`, `complete`, and `unwatch` commands;
- current `~/.humhum/hexa-watch.json` records.

No Humi, Hype, or Hush data is rewritten as part of this feature.

## Information Architecture

### Automatic Scan

`自动扫描` remains the passive discovery layer for hook, log, bridge, and transcript sessions. Passive records are not treated as trusted development goals.

A discovered session may be promoted into active monitoring or linked to a goal, but Hexa must require an explicit user or managed-skill action before treating that relationship as authoritative.

### Active Monitoring

The active-monitor navigation remains a project-grouped workbench. Within a project:

- sessions with no goal relationship continue to render as independent legacy sessions;
- sessions linked to one goal render beneath a shared goal row;
- clicking an attempt opens the existing single-session report;
- clicking a goal row opens a concise cross-attempt summary in the same report pane;
- a comparison action appears only when a goal has at least two attempts.

The navigation hierarchy is rendered as compact rows, not nested cards.

### Single-Attempt Goal

A goal with one attempt should not add visual ceremony. The current session name, provider, status, report, operations, workflow, and evidence remain dominant. A small goal label provides the relationship without changing the interaction model.

### Multi-Attempt Goal

A goal with multiple attempts shows:

- goal title and success criteria;
- attempt count;
- number verified, failed, blocked, and still working;
- Agent family and product surface for each attempt;
- branch or worktree when available;
- result status and strongest evidence;
- accepted attempt, when the user has selected one.

The cross-attempt summary does not duplicate transcripts, full workflows, permission controls, or message composers. Those remain in the selected attempt's existing report.

## Humi Integration

Humi remains the Hub home and overall guide. It may show one compact Hexa summary such as:

> 一个开发目标等待确认，两个 Agent 正在工作，一个验证失败。

Selecting the summary opens the relevant goal inside Hexa active monitoring. Humi does not become a second development dashboard.

## Canonical Model

### Agent Runtime Identity

Provider family and product surface are separate dimensions:

```text
family: codex | qoder | claude | opencode | ...
surface: codex_desktop | codex_cli |
         qoder_ide | qoder_cli | qoder_worker |
         terminal | remote_worker | unknown
```

Identity also carries:

- native session or thread ID;
- device ID when available;
- workspace;
- runtime version when available;
- source confidence.

Older records deserialize with `surface = unknown`. Hexa never guesses a specific surface from a display name alone.

### Development Goal

```text
HexaDevelopmentGoal
- id
- project_key
- title
- success_criteria[]
- status
- attempt_refs[]
- accepted_attempt_id?
- created_at
- updated_at
```

Goal status is derived from its attempts and explicit user decisions. It does not replace per-session execution status.

### Attempt Reference

```text
HexaAttemptRef
- id
- session_id
- agent_identity
- branch?
- worktree?
- result_status
- evidence_refs[]
- linked_at
- completed_at?
```

Execution and result are separate:

- execution status: the existing `starting`, `working`, `waiting`, `idle`, `completed`, or `blocked`;
- result status: `unverified`, `verified`, `failed`, `superseded`, or `accepted`.

An Agent reporting completion changes execution status but does not produce `verified`. Verification requires deterministic evidence or an explicit user review.

### Evidence Trust

Evidence has three trust tiers:

1. `system_fact`: Git state, command exit code, test result, build result, timestamp, permission resolution, or merge state captured by HumHum.
2. `agent_report`: a structured goal, plan, milestone, output, or completion report submitted by the active Agent.
3. `ai_inference`: optional later analysis, always labeled and never used to replace a system fact.

The first release implements the first two tiers only.

## Storage And Compatibility

Existing watched-session storage remains:

```text
~/.humhum/hexa-watch.json
```

Goal relationships use an isolated additive store:

```text
~/.humhum/hexa-goals.json
```

The goal store references existing session IDs and evidence IDs. It does not copy or rewrite transcripts. Failure to load the goal store must fall back to the current session-grouped active-monitor view and surface a retryable goal-grouping error.

Deleting a goal never deletes watched sessions. Deleting a watched session leaves a bounded historical attempt reference marked unavailable until the user removes or archives it.

All writes are atomic through temporary-file replacement. Unknown fields and older records use Serde defaults.

## Managed Skill And CLI Protocol

The existing global `humhum-hexa` connector remains the integration point. Existing commands stay compatible. New optional fields allow an Agent to create or join a goal and report evidence:

```bash
humhum-hexa watch \
  --goal "修复 Hush 消息分类" \
  --goal-id "goal-optional" \
  --surface "qoder_worker"

humhum-hexa update \
  --status working \
  --step "运行 Rust 回归测试"

humhum-hexa complete \
  --summary "完成分类修复" \
  --verification-file "verification.json"
```

The managed skill instructs supported Agents to:

1. bind the real provider session;
2. create or join a goal only when explicitly requested or when a goal ID was supplied;
3. synchronize structured plans when available;
4. report meaningful milestones, blockers, and outputs;
5. attach deterministic command evidence when the runtime exposes it;
6. complete with an honest summary and leave the result unverified when evidence is absent.

The connector stores the chosen goal ID in its existing per-session state so later updates do not rely on fuzzy title matching.

## Qoder Product Surfaces

Qoder is one Agent family with distinct runtime surfaces:

- `qoder_ide`
- `qoder_cli`
- `qoder_worker`
- `unknown`

Surface evidence is accepted in descending order:

1. explicit managed-skill or launcher identity;
2. reliable hook/runtime metadata;
3. validated parent-process or product-specific session metadata;
4. `unknown`.

Workspace naming alone is not authoritative. Existing `qoder` and `qoderwork` records remain readable and map to the family with a backward-compatible surface.

## Result And Comparison Rules

- A completed Agent report without system evidence is `unverified`.
- A non-zero verification command is `failed` evidence, even if the Agent reports success.
- Passing a command proves only that command, not the whole user goal.
- `accepted` is an explicit user decision and is stored separately from Hexa's recommendation.
- `superseded` keeps history and evidence; it is never silently deleted.
- Hexa does not automatically merge, delete, or reset branches.
- Comparison summarizes evidence and stated approaches; it does not fabricate missing rationale.

## Error Handling

- Goal store unavailable: preserve current watched sessions and show retry.
- Unknown Agent surface: display the family plus `端类型待确认`.
- Missing branch or worktree: omit the field rather than infer it.
- Missing verification: show `已完成，尚未验证`.
- Conflicting Agent report and system fact: show both and prioritize the system fact.
- Orphan attempt reference: preserve its last known metadata and offer removal.
- Duplicate goal joins: de-duplicate by goal ID and session ID.

## Rollout

1. Add the compatible goal and runtime-identity model.
2. Extend the managed skill and CLI with optional goal/surface/evidence fields.
3. Add goal grouping to active-monitor selectors without changing the existing default rendering.
4. Add the goal summary and comparison state for multi-attempt goals.
5. Add the compact Humi attention summary.

Each slice must keep the existing active-monitor and automatic-scan tests passing.

## Verification Contract

Automated verification must cover:

- loading current `hexa-watch.json` fixtures unchanged;
- missing, valid, and corrupt `hexa-goals.json`;
- old Qoder records defaulting safely;
- explicit Qoder IDE, CLI, and Worker identity;
- one goal containing attempts from different Agents and surfaces;
- single-attempt rendering matching the existing active-monitor behavior;
- multi-attempt grouping without merging session reports;
- Agent-completed but unverified results;
- deterministic failure overriding a success report;
- accepted and superseded attempt history;
- goal deletion preserving watched sessions;
- goal-store failure preserving active monitoring;
- existing mobile pairing, intervention, focus, workflow, and review tests.

Required completion checks:

```text
npm test
npm run build
cargo test
cargo fmt --check
cargo check
git diff --check
```

Visual QA must compare the current active-monitor reference and the new single-attempt state at the same viewport before accepting the implementation.

## Acceptance Criteria

The feature is accepted only when:

1. Hexa still has two top-level tabs: `主动监控` and `自动扫描`.
2. A current single watched session remains usable without learning a new task concept.
3. Two explicitly linked sessions appear under one development goal.
4. Codex Desktop, Codex CLI, Qoder IDE, Qoder CLI, and Qoder Worker can be distinguished when reliable identity is available.
5. The user can open every attempt's unchanged session report.
6. Hexa distinguishes Agent completion from verified completion.
7. The user can mark one attempt accepted without deleting the others.
8. No LLM is required for the core workflow.
9. Goal-store failures cannot make existing active monitoring unavailable.
10. Existing persisted data and current Hexa operations remain backward compatible.

## Non-Goals

- A third `开发任务` tab
- Agent scheduling or autonomous delegation
- An embedded Pi or other always-on inference model
- Automatic branch merging, deletion, or reset
- Full terminal, IDE, or chat-client replacement
- Automatic semantic grouping of unrelated historical conversations
- Background LLM analysis of transcripts
- Cloud storage or a required relay service
