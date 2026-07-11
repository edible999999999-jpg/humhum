# HUMHUM Competitive Parity Design

## Objective

Close the useful product gaps between HUMHUM, Ping Island, and Happy while preserving HUMHUM's local-first personal-agent-hub identity. Parity is accepted only when a capability works end to end on the user's Mac; a label, disabled control, or raw data view does not count.

## Product Boundary

HUMHUM remains the foreground interpreter and desktop companion. Competitor features are adopted when they help the user notice, understand, and control agent work. Private local content remains read-only by default, and remote access must never expose an unauthenticated control surface.

## Capability Matrix

| Area | Ping Island | Happy | HUMHUM baseline | Parity direction |
| --- | --- | --- | --- | --- |
| Agent coverage | Broad hook/runtime support | Claude, Codex, Gemini and others through wrappers | Six hook profiles plus Codex app-server and local Pi | Expand verified profiles and expose install health |
| Attention routing | Waiting-first island, sounds, completion and error signals | Push notifications and session inbox | Pet overlays and native notifications | Deduplicate notifications and sort sessions by intervention urgency |
| Exact jump back | TTY, iTerm/Ghostty session, tmux pane, IDE routing | Open the selected remote session | Generic terminal activation | Capture route metadata and focus exact tmux/terminal session with safe fallbacks |
| In-place decisions | Approve, deny, answer questions | Permission controls from mobile/web | Claude hook decisions and Codex app-server approvals | Present all pending actions in the priority queue and keep session-scoped actions |
| Follow-up reliability | Inline follow-up for supported terminal sessions | Ordered outgoing queue, reconnect and offline handling | Codex resume then send | Add explicit delivery state, retryable failures, and stale-thread recovery |
| Remote access | SSH bridge | iOS, Android, web, E2EE relay, self-hosting | Official Codex Remote Control only | Build an authenticated local/LAN bridge before any internet relay |
| Conversation evidence | Transcript backfill and rollout fallback | Full synchronized chat | Local Codex/Claude transcript summaries | Show recent intent and work summaries, raw detail behind disclosure |
| Personal experience | Mascots, sound packs, detached buddy | Voice and attachments | 2D/3D pet, voice, Humi/Hype/Hush | Keep as HUMHUM differentiator and add per-event sound preferences later |

## Delivery Slices

### Slice 1: Local Attention And Exact Return

The hook enriches each event with a `route` object containing available `term_program`, `term_program_version`, `tty`, `tmux`, `tmux_pane`, and process identifiers. `SessionStore` persists the newest non-empty route fields. Hexa sorts active sessions by waiting, failed/stalled, working, idle, then recency. Each session card exposes one icon action that calls a session-aware backend focus command.

On macOS, focus follows this order:

1. Select the exact tmux pane when `tmux_pane` is present.
2. Activate the captured terminal application, including Ghostty and Warp.
3. Use iTerm session or TTY scripting when the identifier is available.
4. Fall back to the existing generic terminal focus.

The command returns a structured result describing which strategy succeeded so Hexa can display honest feedback.

### Slice 2: Reliable Intervention

Codex follow-ups retain the existing resume-before-send repair. The frontend tracks `sending`, `delivered`, and `failed` state per card and keeps failed text for retry. Hook-backed sessions use exact terminal routing rather than typing into whichever terminal happens to be frontmost. Pending approvals remain scoped to their provider thread.

### Slice 3: Secure Mobile Foundation

HUMHUM will not claim Happy parity from the existing Codex-only remote panel. The first remote slice is a local authenticated bridge with pairing, expiring credentials, encrypted transport where available, a bounded outgoing queue, and read/control scopes. Internet relay, push, native iOS/Android packaging, attachments, and voice remote control remain separately verifiable milestones.

## UX Rules

- The default list shows sessions that need the user first, then current work, then recent history.
- Active history is bounded so stale sessions cannot dominate the screen.
- The primary card copy summarizes recent intent and current work; route metadata stays under details.
- Icon controls use tooltips and never change card dimensions while busy.
- Errors name the failed action and preserve a retry path.

## Verification

- Rust unit tests cover route extraction/merge, urgency ordering inputs, tmux target validation, and focus strategy selection.
- Frontend tests cover priority sorting and intervention delivery state.
- Full `cargo test`, `npm test`, and `npm run build` must pass.
- The Tauri app is launched from the latest branch and visually checked at desktop and compact window sizes.
- A real synthetic hook event verifies that route metadata reaches Hexa and the focus command reports a concrete strategy.
