# Pi ReAct Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HUMHUM's normal Humi conversation run through the official Pi Agent SDK with bounded local-context tools and only three user-facing provider fields: URL, token, and model name.

**Architecture:** Use `@earendil-works/pi-agent-core` for the ReAct/tool loop and `@earendil-works/pi-ai` for a dynamically created OpenAI-compatible provider. The React surface owns the Pi conversation session and renders friendly progress events; Tauri commands remain the authority for local scanning, memory, and confirmation-gated writes. The old external Pi CLI and heuristic kernel remain diagnostics only during this migration.

**Tech Stack:** React 18, TypeScript, Vite, Tauri 2, Rust, `@earendil-works/pi-agent-core@0.80.6`, `@earendil-works/pi-ai@0.80.6`, TypeBox.

## Global Constraints

- The user configures only `URL`, `Token`, and `model_name` for the Agent provider.
- Pi is integrated as a bundled SDK dependency; the normal user flow must not require a globally installed `pi` command.
- Local context tools return bounded interpreted evidence and never expose raw paths by default.
- `save_memory`, private-message access, file changes, destructive commands, and external writes require explicit confirmation.
- Do not expose hidden chain-of-thought; show only short progress states and an evidence-grounded answer.
- Preserve the existing voice/STT features as optional presentation features.

---

### Task 1: Add the Pi provider configuration and migration

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src/types/index.ts`
- Test: `src-tauri/src/config.rs` unit tests

**Interfaces:**
- Produces `AppConfig.pi.url: String`, `AppConfig.pi.token: Option<String>`, and `AppConfig.pi.model_name: String`.
- Loads legacy `summarizer.api_base`, `summarizer.model`, and `api_keys.openai` into Pi defaults when Pi fields are absent.

- [ ] **Step 1: Write failing Rust tests** for default Pi values and legacy migration, asserting that a legacy config gets `pi.url == summarizer.api_base`, `pi.model_name == summarizer.model`, and `pi.token == api_keys.openai`.
- [ ] **Step 2: Run `cargo test config`** and verify the new tests fail because `AppConfig.pi` does not exist.
- [ ] **Step 3: Add `PiConfig` with serde defaults and migration-aware deserialization** while retaining legacy fields for voice/summarizer compatibility.
- [ ] **Step 4: Update the TypeScript `AppConfig` interface** to match the serialized Rust shape.
- [ ] **Step 5: Run `cargo test config` and `npm run build`** and verify both pass.
- [ ] **Step 6: Commit** with `feat: add unified pi provider config`.

### Task 2: Add Pi SDK provider and local context tools

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/pi/runtime.ts`
- Create: `src/lib/pi/tools.ts`
- Create: `src/lib/pi/types.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/commands.rs` unit tests for bounded tool payloads

**Interfaces:**
- `createHumiPiRuntime(config, callbacks)` returns a Pi `Agent` configured with a custom OpenAI-compatible provider.
- `buildHumiTools()` returns tools named `get_recent_sessions`, `get_agent_skills`, `get_local_memory`, `get_project_context`, `get_user_preferences`, and `save_memory`.
- Tauri commands return JSON-safe, size-limited tool payloads; `save_memory` rejects calls without an explicit confirmation flag.

- [ ] **Step 1: Add failing Rust tests** for result size limits and `save_memory` rejection without confirmation.
- [ ] **Step 2: Run the focused Rust tests** and verify they fail because the bounded tool helpers are missing.
- [ ] **Step 3: Add Tauri tool commands** that reuse existing session, knowledge, stats, and memory stores, redact paths, cap text lengths, and return interpreted summaries.
- [ ] **Step 4: Register the new commands** in `src-tauri/src/lib.rs`.
- [ ] **Step 5: Install the official Pi SDK packages** at version `0.80.6`.
- [ ] **Step 6: Implement `createHumiPiRuntime`** using `createProvider`, `openAICompletionsApi`, a runtime model built from the configured URL/model name, and the configured token passed only at request time.
- [ ] **Step 7: Implement Pi tools** using TypeBox schemas and Tauri `invoke`; map tool execution events to friendly progress callbacks.
- [ ] **Step 8: Run focused Rust tests and `npm run build`** and verify both pass.
- [ ] **Step 9: Commit** with `feat: add pi runtime context tools`.

### Task 3: Route Ask Humi through the Pi ReAct loop

**Files:**
- Modify: `src/components/Hub/HumiModule.tsx`
- Modify: `src/lib/pi/runtime.ts`
- Create: `src/lib/pi/prompt.ts`
- Test: `src/lib/pi/runtime.test.ts`

**Interfaces:**
- `askHumi(prompt, config, callbacks)` starts or reuses one Pi `Agent` session and returns the final assistant text.
- `callbacks.onProgress(label)` receives only user-safe progress labels.
- `callbacks.onEvidence(items)` receives summarized evidence cards.

- [ ] **Step 1: Add Vitest and write a failing runtime test** using Pi's faux provider to prove a prompt can request a context tool and then produce a final answer.
- [ ] **Step 2: Run the test** and verify it fails because `askHumi` is not wired.
- [ ] **Step 3: Implement the ReAct prompt and runtime session** with a system instruction that makes Humi conversational, evidence-bound, and confirmation-aware.
- [ ] **Step 4: Replace the Ask Humi button handler** so it invokes `askHumi` instead of `run_local_agent_kernel`.
- [ ] **Step 5: Keep local scanning available under Details** and remove its result from the primary answer path.
- [ ] **Step 6: Render progress labels, final answer, and concise evidence cards** without showing tool arguments, raw paths, or hidden reasoning.
- [ ] **Step 7: Run the runtime test and `npm run build`** and verify both pass.
- [ ] **Step 8: Commit** with `feat: route humi conversation through pi`.

### Task 4: Simplify the settings surface

**Files:**
- Modify: `src/components/Settings/SettingsPanel.tsx`
- Modify: `src/lib/i18n/translations.ts`
- Modify: `src/types/index.ts` only if labels need type alignment

**Interfaces:**
- The primary Agent settings section edits `config.pi.url`, `config.pi.token`, and `config.pi.model_name`.
- Existing voice/STT controls remain available under advanced presentation settings.

- [ ] **Step 1: Add a failing `src/lib/pi/settings.test.ts` test** that renders the settings model and asserts the primary Agent form exposes exactly URL, token, and model name.
- [ ] **Step 2: Run `npx vitest run src/lib/pi/settings.test.ts`** and verify it fails against the current settings form.
- [ ] **Step 3: Replace the primary OpenAI/summarizer form** with a single soft-styled Pi Agent card and password-style token input.
- [ ] **Step 4: Add validation** for non-empty URL and model name, and trim a trailing slash from the URL before saving.
- [ ] **Step 5: Keep legacy fields out of the main form** while preserving them for migration and voice compatibility.
- [ ] **Step 6: Run the focused Vitest test and `npm run build`** and verify both pass.
- [ ] **Step 7: Commit** with `feat: simplify pi agent settings`.

### Task 5: Verify and document the migration

**Files:**
- Modify: `docs/pi-sidecar.md`
- Modify: `README.md` if the old setup is documented there
- Test: repository build and focused Rust tests

- [ ] **Step 1: Update documentation** to state that Pi SDK is bundled, the user enters URL/token/model name, and the external CLI sidecar is diagnostic-only.
- [ ] **Step 2: Run `cargo test`** and record the result.
- [ ] **Step 3: Run `npm run build`** and record the result.
- [ ] **Step 4: Run `npm run tauri build`** and distinguish compile success from any existing DMG bundling issue.
- [ ] **Step 5: Inspect `git diff --check` and `git status`** for accidental secrets, raw token logging, or unrelated files.
- [ ] **Step 6: Commit** with `docs: document bundled pi runtime`.
