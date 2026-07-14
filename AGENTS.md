# AGENTS.md

This file guides AI coding agents working on HUMHUM.

## Product Position

HUMHUM is a personal Agent hub for the Agent era.

It is not another dashboard, not another generic assistant, and not a tool that asks users to manage every config file themselves. HUMHUM quietly reads local user-owned context, agent files, sessions, skills, memories, rules, app signals, and project traces, then turns that evidence into usable personal knowledge.

The product promise is simple:

> Let every Agent work around the user, while the user stays calm and in control.

## Core Principle

HUMHUM may collect and index technical evidence in the background, but the foreground experience must explain what it means for the user.

Do not expose raw internals by default:

- Do not lead with asset counts, file paths, roots, JSON, YAML, or tool tables.
- Do not make users read scan diagnostics unless they explicitly open details.
- Do not treat "found many files" as product value.

Do expose interpreted personal knowledge:

- What kind of work the user seems to be doing.
- Which skills and workflows they rely on.
- Which preferences should become durable memory.
- Which repeated mistakes, risks, or unfinished loops need gentle attention.
- What the next small useful action should be.

## Product Roles

### Humi

Humi is the warm personal interpreter.

It quietly learns from the user's local agent activity and answers in plain language. Humi should feel like a calm companion who understands the user's rhythm, not a terminal report. Its default surface is a conversation box, not a form.

Humi may use:

- `~/.humhum/knowledge.json`
- `~/.humhum/stats.json`
- `~/.humhum/local-agent-memory.md`
- scanned Codex, Claude, Qoder, Pi, and project assets
- local session summaries and tool usage

Humi should translate those signals into:

- user profile
- working direction
- common skills
- preferences
- memory suggestions
- soft next steps

### Hype

Hype manages the user's personal Agent knowledge base.

It indexes skills, agent rules, YAML configs, memory, soul/personality files, Obsidian notes, and project instructions. Hype is an organizer, but its UI should not be a file manager first. It should show what the knowledge base means and what is missing.

### Hush

Hush organizes personal, social, work, and family messages from the user's point of view.

It should not secretly reply for the user. It helps the user see who matters, what needs attention, and how to reply warmly if they choose. Local message bridges must be user-approved and read-only by default.

### Hexa

Hexa is the user's Agent supervisor.

It does not try to become another multi-agent orchestration framework. It shows what different Agents are doing, which conversations need confirmation, what went well, what drifted, and what should be remembered for future work.

#### Hexa Watch Protocol

When the user says a session should be "重点监控", "加入 Hexa", "让 Hexa 看着这轮", "watch this session", or similar, the current agent should bind itself to Hexa without asking the user to copy curl commands.

Use:

```bash
npm run hexa:watch -- "<one-sentence goal for this session>"
```

Then keep Hexa updated at meaningful milestones:

```bash
npm run hexa:update -- "<current progress, blocker, or next step>"
```

If the watched session should be removed:

```bash
npm run hexa:unwatch
```

These commands read `~/.humhum/local-api-token`, call the local Hexa API, and store the current watched session id in `.humhum/hexa-watch-session.json`. Do not ask non-technical users to edit JSON or run the raw HTTP API unless debugging.

## Design Direction

The UI should match the Humi character: soft, bright, translucent, gentle, and personal.

Preferred qualities:

- warm white, pale blue, soft lavender, mint, and peach
- roomy conversation surfaces
- rounded but not childish controls
- minimal visible metrics
- gentle cards for "what I noticed", "what I remember", and "next step"
- debug details hidden behind an explicit disclosure

Avoid:

- dark hacker dashboards
- dense tables
- terminal-first UI
- neon cyberpunk panels
- exposing raw local paths as primary content
- making the user configure roots before they can get value

## Technical Boundaries

- Keep local-first behavior. User-owned machine data is the advantage.
- Keep privacy visible in behavior: do not silently read private chats or sensitive stores without explicit user action.
- Persist durable HUMHUM data under `~/.humhum/`.
- Keep scan results available for debugging, but make interpreted summaries the default product surface.
- Prefer small, focused changes that reinforce the product principle.

## Common Commands

```bash
npm install
npm run tauri dev
npm run build
npm run tauri build
```

Rust backend commands live in `src-tauri/`. Frontend code lives in `src/`.

## Engineering Notes

- Tauri commands are registered in `src-tauri/src/lib.rs`.
- Local knowledge logic lives in `src-tauri/src/knowledge_store.rs`.
- Humi local agent interpretation lives in `src-tauri/src/commands.rs`.
- Hush message storage lives in `src-tauri/src/hush_store.rs`.
- Hub UI modules live in `src/components/Hub/`.

When adding a feature, ask: "Does this help the user feel understood and in control?" If the answer is only "it exposes more data", redesign it.
