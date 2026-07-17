# Hexa Bounded Refresh Design

## Goal

Stop HUMHUM from repeatedly scanning local session history and accumulating overlapping refresh work.

## Refresh policy

- Load the complete Hexa snapshot once when the Hexa data hook mounts.
- Refresh ordinary active-session state only when HUMHUM receives a hook or bridge event.
- Poll only the watched-session store, and only while at least one watched run is active, every 20 seconds.
- Never poll non-watched sessions or historical transcripts.
- Coalesce refresh triggers so at most one refresh of each class is in flight; a trigger received during a refresh schedules at most one follow-up.

## Transcript IO

Codex session discovery must not read an entire JSONL into a `String` to inspect its first records. It will stream at most the first 600 lines. Hexa transcript interpretation will retain its existing one-megabyte tail bound.

## Data flow

The initial full snapshot may discover recent Codex history and build readouts. Subsequent ordinary events update the snapshot without starting a timer. The watched timer fetches only watched agents; it does not rescan session files or rebuild all readouts.

## Verification

Unit tests cover single-flight/coalescing scheduling, watched polling eligibility, the 20-second interval, and bounded Codex line reading. Existing frontend and Rust tests plus production builds must pass.
