# Hexa Persistent Agent Supervision Design

## Problem

Hexa currently registers watched sessions into an in-memory `HashMap`. A HUMHUM restart erases every registration. The frontend also converts command failures into empty arrays, so a broken data connection is presented as a valid zero-session state.

## Product Model

Hexa remains a supervisor, not an agent orchestrator.

- A **watched agent** is a durable local identity: stable id, provider, display name, workspace, creation time, and latest activity.
- A **work run** is one supervised task under that identity: goal, status, current step, blocker, user-attention flag, timestamps, and completion outcome.
- Registering from the same workspace and provider reuses the watched agent while creating or resuming a run.
- Restarting HUMHUM reloads agents and runs from `~/.humhum/hexa-watch.json`.
- Passive hook and transcript sessions stay separate and lower-confidence.

## User Experience

The first useful content in Hexa is the supervised Agent area. Each Agent row shows provider, online state, current goal, current step, last heartbeat, and run counts. Selecting it reveals a compact detail view with total work, completed, blocked, success rate, current run, and recent work history.

The setup command remains available below the supervised list. Empty and error states are distinct:

- No registered agents: explain how to register.
- Backend still starting: keep existing data and show reconnecting.
- Watch-store command failed: show a visible retryable error; never replace known data with zero.

## Storage And Lifecycle

`HexaWatchStore::load_or_create(&Path)` owns serialization. Register, update, and delete persist before returning success. Writes use a temporary file followed by rename to avoid partial JSON. Invalid files do not crash the app; they produce an empty store plus a logged warning.

Statuses are `starting`, `working`, `waiting`, `idle`, `completed`, and `blocked`. An Agent is online when its latest non-completed run has a recent heartbeat; otherwise it is shown as offline while its history remains.

## Scope

This version does not start providers, schedule tasks, bind skills, or change permission requests. It establishes the durable supervision model and the Harness-inspired overview/detail information architecture.

## Verification

- Rust tests prove register/update/delete persistence and restart recovery.
- TypeScript tests prove failed refreshes preserve the last successful watch snapshot.
- `npm run build`, focused frontend tests, `cargo test hexa_watch_store`, and `cargo check` must pass.
