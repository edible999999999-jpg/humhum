# Wake Guard Test Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flaky fixed-delay Wake Guard restart assertion with a bounded condition wait that verifies eventual self-healing.

**Architecture:** Keep `WakeGuardState` production behavior unchanged. The existing restart test will repeatedly invoke the public reconciliation path until it observes a new child PID, with a two-second outer timeout and a ten-millisecond polling interval.

**Tech Stack:** Rust 1.89, Tokio 1 with process/time support, Cargo test.

## Global Constraints

- Do not modify production Wake Guard behavior.
- Remove the temporary `/bin/ps` diagnostic and its output.
- Poll every 10ms for no longer than 2 seconds.
- Always disable the guard before the test returns successfully.
- Continue the Hush freshness plan after this baseline blocker is green.

---

### Task 1: Condition-Based Restart Test

**Files:**
- Modify: `src-tauri/src/wake_guard.rs:227-252`
- Test: `src-tauri/src/wake_guard.rs`

**Interfaces:**
- Consumes: `WakeGuardState::with_program`, `set_enabled`, `reconcile_desired_state`, and `set_enabled(false)`.
- Produces: deterministic `enabled_guard_restarts_after_its_child_exits` coverage without any new production interface.

- [ ] **Step 1: Restore and verify the failing test**

Remove the temporary `Command::new("/bin/ps")` diagnostic block so the test is back to its original fixed 100ms delay and `assert_ne!(first, second)`.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml wake_guard::tests::enabled_guard_restarts_after_its_child_exits -- --exact --nocapture
```

Expected: FAIL at `assert_ne!` with the same first and second PID. This is the RED evidence already reproduced twice before diagnostic instrumentation.

- [ ] **Step 2: Replace the fixed delay with a bounded condition wait**

Replace the body after obtaining `first` with:

```rust
let second = tokio::time::timeout(std::time::Duration::from_secs(2), async {
    loop {
        let status = guard.reconcile_desired_state(true).await.unwrap();
        if let Some(process_id) = status.process_id.filter(|process_id| *process_id != first) {
            break process_id;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
})
.await
.expect("wake guard did not restart its exited child within 2 seconds");

assert_ne!(first, second);
guard.set_enabled(false).await.unwrap();
```

- [ ] **Step 3: Verify GREEN once**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml wake_guard::tests::enabled_guard_restarts_after_its_child_exits -- --exact --nocapture
```

Expected: PASS with no diagnostic process output.

- [ ] **Step 4: Verify stability across ten fresh runs**

Run:

```bash
for run in {1..10}; do
  cargo test --manifest-path src-tauri/Cargo.toml wake_guard::tests::enabled_guard_restarts_after_its_child_exits -- --exact
done
```

Expected: all 10 runs exit 0.

- [ ] **Step 5: Verify the Wake Guard module**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml wake_guard::tests
```

Expected: 3 non-ignored Wake Guard tests pass and the real macOS assertion test remains ignored.

- [ ] **Step 6: Commit only the test fix**

```bash
git add src-tauri/src/wake_guard.rs
git diff --cached --check
git commit -m "test(awake): wait for guard restart condition"
```
