# Task 1 Report: File-backed Hexa Watch Store

## Scope

Implemented persistent Hexa supervision data in `src-tauri/src/hexa_watch_store.rs` and initialized it during Tauri setup. The existing HTTP and Tauri delete handlers received minimal `Result` handling required by the durable mutation API.

## RED

Command:

```bash
cargo test hexa_watch_store --manifest-path src-tauri/Cargo.toml
```

Result: failed during compilation as expected. The new restart tests reported six `E0599` errors because `HexaWatchStore::load_or_create` did not exist. This was the intended missing-feature failure; no test passed accidentally.

## GREEN

Command:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml && cargo test hexa_watch_store --manifest-path src-tauri/Cargo.toml
```

Result: passed.

```text
running 3 tests
test hexa_watch_store::tests::persists_registered_agent_run_across_restarts ... ok
test hexa_watch_store::tests::persists_run_deletion_across_restarts ... ok
test hexa_watch_store::tests::persists_run_updates_across_restarts ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 207 filtered out
```

Cargo also reported an existing future-incompatibility notice for transitive dependency `block v0.1.6`; it did not affect the test result.

## Changed Files

- `src-tauri/src/hexa_watch_store.rs`
  - Added `HexaWatchedAgent` and serializable snapshot storage.
  - Added `load_or_create`, stable JSON-encoded provider/workspace/name agent keys, and `agents()`.
  - Changed `register`, `update`, and `delete` to return `Result` and persist through a synced temporary file followed by rename before accepting the in-memory mutation.
  - Added temp-backed restart tests for register, update, and delete.
- `src-tauri/src/lib.rs`
  - Loads `~/.humhum/hexa-watch.json` during setup, logs load failures, and falls back to an in-memory store only on failure.
- `src-tauri/src/hook_server.rs`
  - Preserves successful and not-found HTTP behavior; persistence failures now return HTTP 500 instead of emitting non-durable state.
- `src-tauri/src/commands.rs`
  - Propagates persistence failure from the existing Tauri delete command.

## Self-Review

- Register, update, and delete operate on a cloned snapshot, save it successfully, then replace live state; a failed write leaves the live store unchanged.
- The serialized snapshot only contains durable agent/run data; the filesystem path remains process-local.
- Deleting an agent's final run removes that empty agent, matching the current unwatch behavior and preventing blank supervised-agent entries.
- Permission request flows were not changed.

## Concerns

- The save path syncs the temporary file before rename but does not sync the parent directory after rename. Rename is atomic, as required, but a power-loss-hardening follow-up could add directory syncing where supported.
- Invalid or unreadable JSON intentionally triggers the setup warning and in-memory fallback. It does not repair or overwrite the source file automatically, so recovery remains an operator decision.
