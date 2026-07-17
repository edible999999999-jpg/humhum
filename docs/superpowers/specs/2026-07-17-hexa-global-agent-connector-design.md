# Hexa Global Agent Connector Design

**Date:** 2026-07-17

## Problem

Hexa's watch commands currently live inside the HUMHUM repository as npm scripts. An Agent working in another repository neither sees HUMHUM's project instructions nor has those npm scripts, so it cannot bind its real session or report its plan. Old watched records can then remain marked `working` indefinitely, and the UI continues polling them even though their last Agent update is hours old.

This produces two misleading outcomes:

- an actively running Agent may show zero work items because it never received the reporting protocol;
- a disconnected historical record may still look active and trigger 20-second refreshes.

## Product Outcome

Once HUMHUM is installed, a supported local Agent can join Hexa from any project without adding files or dependencies to that project. The Agent reports its real session identity and structured plan when it has that capability. Hexa polls only fresh, non-terminal watched sessions. A stale session remains available as history but is clearly shown as disconnected.

## Architecture

### 1. User-level CLI

HUMHUM owns a standalone executable at:

```text
~/.humhum/bin/humhum-hexa
```

It supports:

- `watch "<goal>"`: register the provider session and start supervision;
- `update "<progress>"`: refresh status and optionally append work-item evidence;
- `plan --json ...` / `plan --file ...`: replace the Agent-reported plan;
- `complete "<summary>"`: send the final milestone and terminal status;
- `unwatch`: remove the watched record.

The executable contains no project-relative imports and does not require npm packages. It reads the existing local API token and talks only to HUMHUM's loopback API.

State is stored under `~/.humhum/hexa/sessions/<opaque-provider-session-key>.json` when a real Agent session ID is available. Clients that expose no session identity use an opaque workspace-keyed fallback under `~/.humhum/hexa/workspaces/`. No state file is added to the current project. This prevents two concurrent projects or Agent sessions from overwriting one shared record.

### 2. Managed Agent skill

HUMHUM installs a small, clearly marked `humhum-hexa` skill into detected user-level skill roots for Agents that support skills, including Codex, Claude Code, Qoder, and QoderWork.

The skill tells the Agent to:

- bind immediately when the user explicitly requests Hexa supervision;
- use the real provider session ID exposed by its runtime;
- publish its structured plan after binding and whenever that plan changes;
- report meaningful milestones, blockers, user confirmations, and completion;
- never invent work items if the Agent has no structured plan capability;
- tell the user plainly when the Agent integration cannot provide structured work items, because that is an Agent capability limit rather than a Hexa failure.

Managed files include a HUMHUM marker. HUMHUM updates only files containing that marker and refuses to replace user-owned files with the same name.

### 3. Freshness contract

The Agent's latest `watch`, `update`, `plan`, or `complete` call refreshes `updated_at`.

Hexa applies the existing 30-minute freshness window to non-terminal states:

- fresh `starting`, `working`, `waiting`, or `blocked`: active and polled every 20 seconds;
- stale non-terminal record: disconnected history, not polled;
- `completed`: terminal history, not polled.

No background daemon or transcript scanner is introduced. That keeps memory bounded and avoids turning every non-watched conversation into a polling workload.

### 4. UI semantics

The binding instructions use the global executable rather than repository npm scripts. Disconnected sessions use a neutral gray status dot and an explicit `已断开` label. A missing plan continues to show the existing capability explanation rather than fabricated metrics.

## Safety and Compatibility

- The connector writes only under `~/.humhum/` and detected user-level Agent skill directories.
- It never edits the current project.
- It never reads conversation transcripts.
- It never sends data outside the loopback HUMHUM API.
- Installation is idempotent and updates only HUMHUM-managed files.
- Unsupported Agents can still call the CLI directly; the UI and skill copy must state when structured-plan reporting is unavailable.

## Verification

Automated verification covers:

- real session ID selection and per-session state paths;
- command request bodies for watch, update, plan, complete, and unwatch;
- managed skill installation, idempotent upgrade, and refusal to overwrite unmanaged files;
- freshness-aware polling;
- disconnected visual semantics.

An end-to-end test runs the global CLI from a repository other than HUMHUM, syncs a plan, reads the watched record through the local API, completes it, and removes the disposable record.
