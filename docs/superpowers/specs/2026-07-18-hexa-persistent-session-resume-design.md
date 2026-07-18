# Hexa Persistent Session Resume Design

## Problem

A watched Codex thread can be marked `completed` and then continue receiving new
turns. Hexa currently treats `completed` as terminal, so the new turn does not
reactivate the existing watch. At the same time, an older inferred watch in the
same workspace can remain non-completed and become the default report, showing
zero verifiable work items.

## Chosen behavior

The watch remains bound to the same Codex thread. A newer `TurnStarted` or
`PlanUpdated` event reactivates a completed watch as `working`; an old replayed
event does not. Startup recovery may inspect a completed watched thread so a
plan written after the previous Hexa completion is not missed. The same
recovery is reused by the active-watch refresh.

Expired inferred watches remain available as history, but they are not treated
as active when Hexa chooses the default report.

## Alternatives considered

1. Create a new watched run for every Codex turn. This preserves round-level
   history, but the current model uses `session_id` as both watch identity and
   provider thread identity, so duplicate runs would make routing ambiguous.
2. Reopen every completed watch during application startup. This is simple but
   falsely marks genuinely finished sessions as active.
3. Reactivate only on newer work evidence and ignore expired inferred watches
   for default selection. This keeps the existing identity model and avoids
   fabricated activity, so it is the selected approach.

## Data flow

1. Codex emits a live turn or plan event, or startup rebuilds a plan event from
   the transcript using its original timestamp.
2. Hexa compares that event timestamp with the watched session's `updated_at`.
3. If the event represents new work and is newer, Hexa changes `completed` to
   `working`, clears stale blocking/confirmation state, then synchronizes the
   plan normally.
4. Successful turn completion returns the watch to `idle` and completes only
   active native-plan items.
5. An `idle` watch remains actively monitored every 20 seconds. Each refresh
   asks the Codex bridge to list current threads and recover only matching
   watched transcripts; unmonitored and expired records do not trigger polling.
6. The frontend chooses a recent active report first, then a non-expired idle or
   completed report; an expired working placeholder never wins by default.

## Error handling

Malformed timestamps are not considered proof of newer work. Session-started
events alone never reactivate a completed watch. Failed or interrupted turns do
not complete active work items.

## Tests

- A newer `TurnStarted` reactivates a completed bound watch.
- An older recovered plan does not reactivate a completed watch.
- A newer plan reactivates and replaces the current Codex plan.
- Startup considers an exact completed watch eligible for transcript recovery.
- An idle watched session continues the existing 20-second active-watch refresh.
- Refreshing the thread list does not downgrade a working watch to idle.
- Default report selection skips an expired inferred watch.
