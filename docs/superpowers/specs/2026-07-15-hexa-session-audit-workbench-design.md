# Hexa Session Audit Workbench Design

## Purpose

Turn Hexa's actively supervised sessions into concise, evidence-backed reports. The primary screen must answer what the session is solving, how far it has progressed, what matters, whether it has drifted, and what the user should do next. Raw event volume, token totals, and hook details are supporting evidence, not the main product.

Hexa remains a supervisor. It observes, records, reviews, reminds, and supports intervention. It does not schedule agents or become a multi-agent orchestrator.

## Information Architecture

Hexa has two top-level tabs:

1. `主动监控`: the default tab for sessions explicitly registered with Hexa.
2. `自动扫描`: passively discovered hook, transcript, and bridge sessions.

The tabs have separate content and counts. Passive sessions never appear inside the active monitoring report.

### Active Monitoring Layout

The active tab uses a two-column workbench.

- Left navigation: one entry per registered session. Sessions are visually grouped by workspace or project, but each session keeps an independent goal, workflow, evidence, audit trail, and verdict.
- Right report: the selected session's current report. The report is the dominant surface and does not reuse the existing long `SessionCard` feed.
- Primary entry action: `新增主动监控`, containing the registration command, mobile connection, and connection health. It is available from the active tab header and becomes the active tab's empty state when no sessions exist.

Completed sessions remain selectable as history but are visually separated from live sessions inside each project group.

### Automatic Scan Layout

The automatic tab keeps passive sessions grouped by agent and sorted by latest activity. Its purpose is discovery and lightweight observation. It may offer an action to promote a discovered session into active supervision, but passive inference is never presented as a trusted active audit.

## Active Session Report

The report is ordered by user value, not implementation detail.

### 1. Problem Being Solved

Show a concise statement of the current user problem, the original goal, and any explicit success criteria. The original goal remains visible so later activity can be checked for drift. A later user goal change is recorded as a revision instead of silently replacing history.

### 2. Current State

Show the session status, latest heartbeat, current work item, next step, and whether user action is needed. Do not show a heuristic percentage unless it is computed from declared work items. Progress is:

`completed work items / total work items`

Failed items are shown separately and never counted as completed.

### 3. Report Metrics

The first report row contains:

- Total work items
- Completed work items
- Failed work items
- Human interventions
- Pending confirmations

Human intervention counts explicit user messages sent through Hexa, permission decisions, and recorded manual corrections. It does not count passive viewing or automatic refreshes.

### 4. Accurate Conclusions

Show no more than the most important conclusions:

- Current progress: what has actually been completed
- Important outputs: decisions, files, commands, validation results, or deliverables
- Risks and drift: activity that does not map to the goal or a workflow item
- Next action: the next meaningful step or the decision required from the user

Every conclusion includes one or more evidence references. Evidence is collapsed by default and can point to a source session, file, command result, hook event, approval, or timestamped workflow update.

### 5. Goal Alignment

Hexa compares actual activity with the original goal and declared workflow. Alignment uses three operational states:

- `主线内`: activity maps to the goal or an active workflow item
- `需留意`: the mapping is weak, evidence is missing, or a detour may be justified
- `已偏离`: repeated activity conflicts with the goal or continues outside all accepted work items

The UI shows a compact goal-to-work trajectory rather than a raw event list. Drift requires cited evidence and cannot be inferred solely from inactivity, elapsed time, or event count.

### 6. Workflow Checkpoints

Each active session may have a user-editable DAG of supervision checkpoints. A checkpoint contains:

- Stable ID and title
- Optional description and acceptance criteria
- Status: `pending`, `in_progress`, `completed`, or `failed`
- Dependency IDs
- Evidence references
- Started, updated, and completed timestamps

Users can add, rename, reorder, connect, or remove checkpoints. Agents can report progress against checkpoint IDs through the watch update interface. Hexa validates dependency references and rejects cycles. It never launches or schedules a checkpoint; the DAG is a review contract and visual progress model.

The first version renders a compact dependency path and provides an edit mode. It does not implement a general workflow automation engine.

### 7. Review Result

The final review uses three outcomes:

- `满意`: the central goal is met with sufficient evidence and no material unresolved drift
- `一般`: useful output exists, but there are omissions, rework, weak evidence, or temporary drift
- `不满意`: the central goal is not solved, material errors remain, or the session ended while substantially off goal

Hexa's review and the user's explicit review are stored separately. Hexa must include reasons and evidence. The user may select the same three outcomes and add an optional note. Hexa never presents inferred sentiment as an explicit user review.

## Summary Log And Evidence

Hexa records structured audit events, but the report does not display all events. The visible activity section contains only milestone events that change the user's understanding:

- Goal created or revised
- Workflow item started, completed, or failed
- Important output produced
- Human intervention or permission decision
- Blocker or drift detected
- Stage or final review recorded

Routine heartbeats, repeated tool calls, and low-value hooks remain in the evidence layer. The report defaults to a compact trajectory and a short milestone timeline. Users can expand evidence or return to the original session when verification is needed.

## Persistent Data Model

Each `HexaWatchedSession` gains a session-owned audit record:

- `goal_revisions`
- `success_criteria`
- `work_items`
- `audit_events`
- `important_outputs`
- `human_interventions`
- `hexa_review`
- `user_review`

Existing fields remain backward compatible. Older registrations are migrated in memory to an empty workflow and an `审核中` report state. Their previous status, goal, and timestamps are preserved.

The local store remains `~/.humhum/hexa-watch.json`, written atomically. Read failures retain cached data and surface a retryable error instead of overwriting the store.

## Data Inputs

The report uses evidence in descending trust order:

1. Explicit active-session updates and workflow item reports
2. User interventions and permission decisions routed through Hexa
3. Matched bridge or hook events for the exact session
4. Transcript references for the exact session
5. Passive inference, clearly labeled and never used alone for a final negative verdict

Registration and update commands remain agent-readable. Additional commands support workflow item mutation, milestone reporting, and final review without breaking existing `hexa:watch`, `hexa:update`, or `hexa:unwatch` usage.

## Error And Empty States

- No active sessions: show the binding and mobile connection entry, not a blank dashboard.
- Active store unavailable: retain the last successful report and show retry status.
- No workflow: show the current goal and invite the user or agent to add checkpoints; do not invent completion percentages.
- Insufficient evidence: show `审核中` or `证据不足` as report state, not `不满意`.
- Deleted session: remove it from navigation and select the next live session, then the newest completed session.

## Testing

- Rust store tests cover backward compatibility, workflow persistence, cycle rejection, audit events, interventions, and reviews.
- TypeScript selector tests cover project grouping without session merging, live/history sorting, report metrics, visible milestone selection, alignment states, and three-level verdict display.
- Component tests cover the two top-level tabs, session navigation, active empty state, report selection, workflow editing, and evidence expansion.
- `npm run build`, focused Vitest suites, `cargo test`, `cargo fmt --check`, and `cargo check` are required before integration.

## Non-Goals

- Scheduling or dispatching work to agents
- Automatically executing DAG nodes
- Showing every hook or transcript line in the default report
- Replacing the original agent transcript
- Using token count, event count, or elapsed time as a proxy for user satisfaction
