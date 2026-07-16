# Hexa Cross-Agent Work Items Design

## Goal

Let Hexa monitor meaningful work items across Codex, Claude Code, Qoder, OpenCode, Cursor, Hermes, OpenClaw, and future Agents without pretending every Agent exposes the same planning capability.

## Product rule

Hexa owns one provider-neutral work-item model. Provider adapters translate native plans when available. Agents may also submit the same model explicitly. When neither is available, Hexa maintains one conservative inferred current-work item instead of inventing a detailed plan.

The UI must distinguish the source of every work item:

- **Agent plan:** copied from a native structured plan or task event.
- **Agent report:** explicitly submitted through the Hexa protocol or CLI.
- **Hexa summary:** conservatively inferred from the current status.
- **User checkpoint:** created by the user in Hexa.
- **Historical migration:** created once from a legacy watched session.

## Capability transparency

Each watched session exposes a planning capability state:

- `native`: the Agent supplies structured plan/task events.
- `reported`: the Agent or integration submits structured Hexa work items.
- `inferred`: no structured plan is available; Hexa can only maintain a conservative current-work summary.
- `unavailable`: the integration provides neither structured work items nor enough status to infer one.

When capability is `inferred` or `unavailable`, Hexa must clearly state that the current Agent or integration does not provide structured planning data. It must not describe this as a Hexa monitoring failure. The message must also explain what Hexa can still observe and how the user or Agent can improve the result.

Example:

> 当前 Agent 没有提供结构化工作计划。Hexa 只能根据它上报的当前状态整理进展，无法确认完整任务列表。

## Canonical work-item model

Existing work-item fields remain compatible. Add provenance metadata:

- `source`: `native_plan | agent_report | hexa_inferred | user | legacy_migration`
- `source_provider`: optional provider identifier
- `source_item_id`: optional stable native item identifier
- `confidence`: `authoritative | reported | inferred`

Old persisted work items deserialize with safe defaults: `source = agent_report` and `confidence = reported`.

## Provider-neutral ingestion

Add a bulk plan synchronization mutation to Hexa's local protocol. It accepts a complete snapshot of work items for one watched session, its capability state, and an optional provider revision. Synchronization is idempotent by `(source_provider, source_item_id)` or the submitted Hexa ID.

The endpoint is available to every integration; it does not contain provider-specific conditionals. Provider adapters map native events into this request.

The existing single-item audit mutation remains available for UI editing and compatibility.

## Three ingestion tiers

### Native structured plan

When an integration can observe native task/plan events, it synchronizes the complete plan immediately. Native items are authoritative. Missing items in a newer complete snapshot are retired only within the same provider-owned source; user checkpoints are never removed.

### Explicit Agent report

`hexa:watch` and `hexa:update` accept a JSON plan snapshot or ergonomic repeated work-item arguments. A registration without a supplied plan creates one reported initial item from the declared goal, so a newly watched session never starts with an unexplained zero-item report.

### Conservative fallback

If no structured plan exists, Hexa uses exactly one stable `hexa-current` item. Status updates change that item's title/description/status rather than appending new items. Once a native or explicitly reported plan arrives, the inferred item is retired.

Hexa never scans transcripts or periodically reads Agent history to invent plans.

## Lifecycle mapping

- Registration creates or synchronizes the initial work representation.
- Working updates mark the inferred/current reported item `in_progress`.
- Completed updates mark it `completed` and record a milestone.
- Blocked updates retain `in_progress` and expose the blocker separately.
- Failed updates mark the current item `failed`.
- Structured plan snapshots override only work owned by their source.

All mutations persist atomically and emit `humhum://hexa-session-changed`. The existing 20-second watched poll remains a lightweight recovery path, not the primary synchronization mechanism.

## Legacy migration

On loading a watched session with no work items, create one `legacy_migration` item from its goal and current step. This migration is deterministic and idempotent. It must not overwrite later user or Agent-authored items.

## UI

The watched-session report shows:

- a planning capability badge;
- a concise capability explanation when structured data is absent;
- source labels on work items;
- no generic “Hexa failed to monitor” message when the limitation belongs to the Agent integration.

User-created checkpoints continue to coexist with provider-owned plans.

## Compatibility

The protocol is provider-neutral and additive. Existing watch/update commands continue to work. Existing stored sessions and work items migrate through serde defaults and the one-time legacy initializer. Unsupported Agents remain monitorable at the inferred-status tier.

## Testing

Tests must cover:

- legacy session and legacy work-item deserialization;
- idempotent bulk plan synchronization;
- provider snapshots not deleting user checkpoints;
- stable single inferred item across repeated status changes;
- inferred item retirement when structured data arrives;
- capability-state and source-label UI copy;
- Codex, Claude-compatible, and unknown-provider fixtures producing the same canonical model;
- event emission and persistence after synchronization.
