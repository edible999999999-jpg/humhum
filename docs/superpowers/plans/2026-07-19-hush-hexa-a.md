# Hush A and Hexa A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hush reply only to direct conversations and give Hexa a quiet, purpose-built yellow-blue diagnostics background.

**Architecture:** Preserve DWS `single_chat` as an explicit `conversation_kind` on stored Hush messages, enforce the reply rule in Rust, and repeat the guard in the presentation layer so legacy group suggestions cannot leak into the UI. Replace the current literal Hexa scene with a generated raster blueprint background referenced by the shared room shell.

**Tech Stack:** Rust, Serde, React, TypeScript, Vitest, Tauri v2, ImageGen.

## Global Constraints

- Group conversations are observation-only and never show a suggested reply.
- Direct conversations may show a content-aware local suggested reply.
- Unknown conversation types do not show a suggested reply.
- Existing `~/.humhum/hush-inbox.json` records remain readable.
- Hexa uses the established yellow-blue palette with a quiet center for dense UI.
- Do not add cloud services or write user chat content.

---

### Task 1: Hush Conversation Semantics

**Files:**
- Modify: `src-tauri/src/hush_store.rs`
- Test: `src-tauri/src/hush_store.rs`

**Interfaces:**
- Consumes: DWS `single_chat: bool` in the normalized raw payload.
- Produces: `HushInboxMessage.conversation_kind: String` with `direct`, `group`, or `unknown`.

- [ ] **Step 1: Write failing Rust tests**

Add cases proving a group message suppresses even an explicit suggested reply, a direct scheduling question gets a specific reply, and an unknown conversation gets no reply.

- [ ] **Step 2: Verify the Rust tests fail**

Run: `cargo test hush_store::tests --lib`

Expected: failures because `conversation_kind` is not present and replies are still generated without checking `single_chat`.

- [ ] **Step 3: Implement the minimal backend behavior**

Normalize explicit `conversation_kind` or `raw.single_chat`, default legacy values to `unknown`, and call `suggest_reply` only for `direct` messages.

- [ ] **Step 4: Verify the Rust tests pass**

Run: `cargo test hush_store::tests --lib`

Expected: all Hush store tests pass.

### Task 2: Hush Legacy UI Guard

**Files:**
- Modify: `src/components/Hub/hushPresentation.ts`
- Modify: `src/components/Hub/HushModule.tsx`
- Test: `src/components/Hub/hushPresentation.test.ts`
- Test: `src/components/Hub/HushModule.test.ts`

**Interfaces:**
- Consumes: `conversation_kind` and legacy `raw.single_chat`.
- Produces: `getHushChatScope()` and `getVisibleHushSuggestedReply()`.

- [ ] **Step 1: Write failing Vitest cases**

Add direct, group, and unknown scope cases, including a persisted group message that still contains an old suggested reply.

- [ ] **Step 2: Verify the Vitest cases fail**

Run: `npm test -- --run src/components/Hub/hushPresentation.test.ts src/components/Hub/HushModule.test.ts`

Expected: failures because the scope helpers and legacy display guard do not exist.

- [ ] **Step 3: Implement and use the presentation guard**

Render a conversation-type badge and use `getVisibleHushSuggestedReply()` in both the inbox debug row and conversation detail.

- [ ] **Step 4: Verify the Vitest cases pass**

Run: `npm test -- --run src/components/Hub/hushPresentation.test.ts src/components/Hub/HushModule.test.ts`

Expected: all targeted frontend tests pass.

### Task 3: Hexa Diagnostics Background

**Files:**
- Create: `public/mascots/hub-backgrounds/hexa-room-v2.png`
- Modify: `src/components/Hub/HubRoom.tsx`
- Modify: `src/styles/hub-character-rooms.css`
- Test: `src/components/Hub/HubRoom.test.tsx`

**Interfaces:**
- Consumes: generated 3:2 yellow-blue diagnostics artwork.
- Produces: the existing `/mascots/hub-backgrounds/...` room background contract.

- [ ] **Step 1: Write a failing room-shell test**

Require Hexa to reference `/mascots/hub-backgrounds/hexa-room-v2.png`.

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- --run src/components/Hub/HubRoom.test.tsx`

Expected: failure while the old `hexa-room.webp` path is still rendered.

- [ ] **Step 3: Save and wire the generated asset**

Copy the selected ImageGen output into the project, update the room map, and tune Hexa-only image positioning or opacity if the rendered workbench needs it.

- [ ] **Step 4: Verify the room-shell test passes**

Run: `npm test -- --run src/components/Hub/HubRoom.test.tsx`

Expected: the Hexa v2 background contract passes.

### Task 4: Verification and Visual QA

**Files:**
- Verify all modified files and generated screenshots.

**Interfaces:**
- Consumes: completed Hush and Hexa changes.
- Produces: passing automated checks and a native Hub screenshot comparison.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all Vitest and Node tests pass.

- [ ] **Step 2: Build the frontend**

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Check Rust**

Run: `cargo check`

Expected: success with no new warnings.

- [ ] **Step 4: Inspect the native app**

Restart Tauri, capture Hexa and Hush at the same 900x700 viewport, compare Hexa before/after, and confirm content remains readable and mobile pairing expansion is not pushed below the usable viewport.
