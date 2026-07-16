# Hexa Cross-Agent Work Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize provider-neutral work plans into watched Hexa sessions and clearly explain when an Agent lacks structured planning capability.

**Architecture:** Extend the durable Hexa work-item model with provenance and capability metadata, then add one atomic plan-snapshot mutation shared by every provider. CLI and legacy-session fallbacks produce the same canonical model; the React UI renders capability and provenance without provider-specific branching.

**Tech Stack:** Rust, serde, Tauri 2, Node.js CLI scripts, React, TypeScript, Vitest

## Global Constraints

- Native plans are authoritative; Agent reports are explicit; Hexa inference is conservative.
- Unsupported Agents must be identified as lacking structured planning data, not presented as a Hexa failure.
- Non-watched sessions remain unpolled and transcripts are never scanned to infer plans.
- User checkpoints must never be removed by provider plan synchronization.
- Existing persisted data and CLI usage remain compatible.

---

### Task 1: Canonical provenance and capability model

**Files:**
- Modify: `src-tauri/src/hexa_watch_store.rs`

**Interfaces:**
- Produces `HexaWorkItemSource`, `HexaWorkItemConfidence`, `HexaPlanningCapability`, and additive fields on persisted sessions/items.

- [ ] Add failing deserialization tests showing legacy sessions and items receive safe provenance and capability defaults.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml hexa_watch_store::tests::loads_legacy` and confirm the new assertions fail.
- [ ] Add serde-defaulted enums and fields with explicit default functions.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Atomic provider-neutral plan synchronization

**Files:**
- Modify: `src-tauri/src/hexa_watch_store.rs`
- Modify: `src-tauri/src/hook_server.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `HexaPlanSyncRequest { session_id, capability, source_provider, revision, items }` and store method `sync_plan`.
- Exposes `POST /hexa/plan` and Tauri command `sync_hexa_session_plan`.

- [ ] Add failing store tests for idempotent snapshots, user-checkpoint preservation, inferred-item retirement, and unknown providers.
- [ ] Run focused Rust tests and confirm missing synchronization fails.
- [ ] Implement one atomic snapshot synchronizer scoped to provider-owned items.
- [ ] Add the local HTTP endpoint and Tauri command using the same store method and event.
- [ ] Run focused Rust tests and confirm they pass.

### Task 3: Registration, update, and legacy fallback

**Files:**
- Modify: `src-tauri/src/hexa_watch_store.rs`
- Modify: `scripts/hexa-watch.mjs`
- Modify: `scripts/hexa-update.mjs`
- Create: `scripts/hexa-plan.mjs`
- Modify: `package.json`

**Interfaces:**
- `npm run hexa:plan -- --file plan.json` synchronizes a complete Agent-reported snapshot.
- Registration creates one reported goal item; status-only updates maintain one stable inferred/current item.

- [ ] Add failing Rust tests for deterministic legacy migration and stable fallback updates.
- [ ] Add Node tests for plan argument/body normalization.
- [ ] Implement deterministic migration and fallback without transcript reads.
- [ ] Implement JSON plan submission in a reusable script module and wire npm scripts.
- [ ] Run focused Rust and Node tests.

### Task 4: Capability-transparent UI

**Files:**
- Modify: `src/hooks/useHexaData.ts`
- Create: `src/hooks/hexaPlanningCapability.ts`
- Create: `src/hooks/hexaPlanningCapability.test.ts`
- Modify: `src/components/Hub/hexa/HexaSessionReport.tsx`
- Modify: `src/components/Hub/hexa/HexaWorkflowEditor.tsx`

**Interfaces:**
- Produces `planningCapabilityCopy(capability)` and source labels for canonical work items.

- [ ] Add failing Vitest cases for native, reported, inferred, and unavailable capability copy.
- [ ] Run focused Vitest and confirm the module is missing.
- [ ] Add TypeScript model fields and pure copy/label helpers.
- [ ] Render the capability badge, limitation explanation, and item source label.
- [ ] Run focused and existing Hexa tests.

### Task 5: Verification and isolated commit

**Files:**
- Verify only this feature's hunks are staged.

- [ ] Run `npm test` and `npm run build`.
- [ ] Run `npm run test:relay` and the new CLI tests.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo check --manifest-path src-tauri/Cargo.toml`.
- [ ] Inspect staged diff for accidental Hype changes.
- [ ] Commit the cross-Agent Hexa implementation on `main` with a `feat:` message.
