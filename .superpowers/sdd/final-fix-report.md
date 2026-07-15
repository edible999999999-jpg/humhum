# HUMHUM Hexa Final Fix Report

## Scope

Fixed the complete final-review findings on `main` from base `2ef7f57` without changing permission request flow, auto-confirm controls, mobile panels, orchestration, or passive bridge separation.

## RED

### Durable store read health

Command:

```bash
cargo test hexa_watch_store::tests::rejects_non_not_found_read_failures --manifest-path src-tauri/Cargo.toml -- --exact --nocapture
```

Expected failure:

```text
assertion failed: result.is_err()
test result: FAILED. 0 passed; 1 failed
```

The deterministic target made `hexa-watch.json` a directory. The old implementation converted that non-`NotFound` read failure into a healthy empty store.

Command:

```bash
cargo test hexa_watch_store::tests::unhealthy_store_blocks_mutation_and_recovers_on_retry --manifest-path src-tauri/Cargo.toml -- --exact
```

Expected failure:

```text
error[E0599]: no associated function or constant named `unavailable_at`
```

The recovery test proved that the store had no API for retaining an unhealthy path, blocking mutation, and retrying disk load after the target was repaired.

### Frontend lifecycle, identity, presence, need fit, and deletion

Command:

```bash
npm test -- --run src/hooks/hexaAgentOverview.test.ts src/hooks/hexaWatchState.test.ts
```

Expected result: 13 failed and 5 passed.

The failures demonstrated:

- overview identity was reconstructed as `provider + workspace` instead of using the Rust Agent key and metadata;
- a fresh completed run made a stale active run appear online;
- a completed-only Agent exposed a completed `currentRun` and appeared online;
- Agent run metrics/history could not consume the Agent-level boundary;
- current-only need-fit selection did not exist;
- watched lifecycle projection, authoritative buckets, watched alert filtering, and permission preservation did not exist;
- retryable delete failure state did not exist.

## GREEN

### 1. Authoritative watched lifecycle

- Added a pure watched lifecycle projection that maps watched `completed`/`idle`/active states onto the effective hook session while preserving `has_pending_permission` independently.
- Supervisor snapshots now carry that effective session, so `session.status`, active/completed buckets, alert aggregation, and `SessionCard` completion all agree with the watched run.
- Passive hook lifecycle alerts are discarded for matched watched runs. Permission alerts remain independent, and a watched `blocked` run contributes the authoritative stalled alert.
- Watched `need_user` continues to drive watched progress/attention but is not converted into a permission request.

### 2. Agent online state

- `currentRun` is the latest non-completed run only.
- Online state and `lastHeartbeat` derive from that run's heartbeat using the inclusive 10-minute window.
- Completed-only Agents have no current run and are offline.
- A fresh completion cannot revive a stale non-completed run.

### 3. Durable Agent identity at the Tauri boundary

- Added and registered `get_hexa_watched_agents`, returning Rust `HexaWatchedAgent` objects with key, provider, name, workspace, created/updated timestamps, and runs.
- Preserved `get_hexa_watched_sessions` compatibility.
- `useHexaData` now fetches and caches Agent objects, preserving the last successful Agent snapshot on errors.
- Runs are flattened only for supervisor matching/projection.
- Agent overview identity and display metadata now come from the durable Agent object.

### 4. Unhealthy I/O and retry recovery

- Malformed JSON still logs and recovers as an empty durable store.
- `NotFound` still represents an empty store.
- Every other read error returns `Err`.
- Tauri watch reads reload from disk and return the read error.
- Register, update, and delete reload before mutation, so an unreadable path cannot be overwritten.
- Startup retains the path as unavailable; later UI polling or Retry re-attempts disk load and recovers without restarting HUMHUM.
- Deterministic Rust tests use a directory at the expected file path and verify the sentinel remains untouched.

### 5. Visible retryable deletion failure

- `SessionCard` keeps delete pending/error state in a reducer.
- A failed delete renders an inline `role="alert"` message.
- The delete control is re-enabled, changes its tooltip to retry guidance, and clears the old error when retried.
- Console-only delete failure handling was removed.

### 6. Current-only average need fit

- Added a pure selector that includes one current watched run per Agent.
- It also includes current non-completed discovered hook/bridge sessions.
- Durable watched history and completed discovered history no longer affect the page average.

## Verification

Focused Rust suite:

```text
cargo test hexa_watch_store --manifest-path src-tauri/Cargo.toml
8 passed; 0 failed
```

Focused frontend suite:

```text
npm test -- --run src/hooks/hexaAgentOverview.test.ts src/hooks/hexaWatchState.test.ts src/hooks/hexaBridge.test.ts src/hooks/hexaPriority.test.ts
4 files passed; 22 tests passed
```

Required build and checks:

```text
cargo fmt --manifest-path src-tauri/Cargo.toml
exit 0

npm run build
3976 modules transformed; built in 13.30s; exit 0

cargo check --manifest-path src-tauri/Cargo.toml
Finished dev profile; exit 0
```

Independent read-only Codex review inspected the uncommitted diff against all six findings and returned `ready` with no blocking findings.

## Concerns

- Vite retains the existing warning for chunks larger than 500 kB.
- Cargo retains the existing future-incompatibility warning for transitive dependency `block v0.1.6`.
- Verification is automated; no live Tauri visual pass was required for this final-fix scope.
