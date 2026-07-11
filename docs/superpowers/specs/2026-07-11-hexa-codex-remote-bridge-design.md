# Hexa Codex and Remote Bridge Design

## Summary

HUMHUM will adopt the strongest architectural ideas demonstrated by Happy without
turning into a Happy client or depending on Happy's cloud. Hexa will gain a local
Codex runtime bridge backed by `codex app-server`, then expose the same normalized
session and approval model through an optional end-to-end encrypted remote channel.

The local Mac remains the source of truth. Remote devices can observe and intervene
only after explicit pairing, and the relay cannot read conversation content, code,
file changes, or approval details.

## Goals

- Read real Codex session events instead of inferring progress only from hooks.
- Show useful progress, file changes, questions, and approval requests in Hexa.
- Let the user send a follow-up, interrupt a turn, approve or deny a request, and
  resume a Codex thread.
- Preserve the existing hook integrations for Claude Code and compatible agents.
- Reuse one normalized Hexa protocol for both desktop and remote clients.
- Add optional phone and Web access without making cloud connectivity a core
  requirement.
- Keep sensitive content local or end-to-end encrypted.

## Non-Goals

- Reimplement Happy's complete mobile application, hosted account system, voice
  stack, analytics, or multi-tenant infrastructure.
- Make HUMHUM a skin for Happy or require a Happy account.
- Replace Claude hooks during this project.
- Allow unattended remote execution or silently approve dangerous actions.
- Present raw JSON-RPC traffic as the primary Hexa experience.

## Product Experience

Hexa should answer four questions in plain language:

1. What is this Agent doing now?
2. What changed?
3. Does it need me?
4. Can I safely continue from here?

Each Codex session appears as a quiet work stream with a current activity summary,
recent meaningful changes, pending decisions, and a small set of direct actions.
Technical event names, item IDs, process details, and raw payloads remain behind an
explicit details disclosure.

When a remote device is paired, it shows the same interpreted session state in a
mobile layout. The remote surface is an extension of Hexa, not a separate product
model.

## Architecture

The system is split into two layers delivered sequentially.

### Layer 1: Local Codex Bridge

`HexaCodexBridge` is a Rust-owned Tauri service that manages one `codex app-server`
child process over newline-delimited JSON-RPC on stdio. It is responsible for:

- checking Codex availability and protocol compatibility;
- starting, monitoring, and restarting the app-server process;
- initializing the protocol with HUMHUM as the client;
- listing, reading, starting, resuming, and interrupting threads;
- sending turns and answering approval requests;
- mapping provider events into Hexa's normalized model;
- emitting Tauri events to the existing React application.

The bridge does not replace the existing `hook_server`. Hook events continue to
support Claude Code and compatible clients. Codex sessions discovered through the
app-server are merged with hook evidence by provider thread ID, with app-server data
taking precedence for live state and hook/transcript data supplementing statistics.

### Layer 2: Optional Remote Bridge

`HexaRemoteBridge` exposes normalized Hexa events and commands to paired devices.
It consists of:

- a local device identity and key store under `~/.humhum/remote/`;
- a short-lived pairing flow shown by the desktop app;
- an encrypted WebSocket client on the Mac;
- a minimal relay that routes opaque encrypted envelopes;
- a responsive Web client installable on a phone;
- encrypted push notifications containing no readable session content at the
  provider boundary.

The relay is optional. If it is unavailable, local Hexa remains fully functional.

## Normalized Hexa Protocol

Happy's event-envelope approach is useful, but HUMHUM will define a smaller protocol
around its own product needs rather than copying Happy's evolving wire contract.

Every event contains:

- `event_id`: globally unique event identifier;
- `session_id`: stable HUMHUM session identifier;
- `provider`: `codex`, `claude-code`, or another supported Agent;
- `provider_thread_id`: optional provider-native thread identifier;
- `turn_id`: optional active turn identifier;
- `timestamp`: event creation time;
- `kind`: normalized event kind;
- `payload`: kind-specific structured data;
- `sensitivity`: routing and display classification.

Initial event kinds are:

- `session_started`, `session_resumed`, `session_state_changed`;
- `turn_started`, `turn_completed`, `turn_failed`, `turn_interrupted`;
- `assistant_text_delta`, `assistant_text_completed`;
- `reasoning_summary`;
- `tool_started`, `tool_updated`, `tool_completed`;
- `file_change_proposed`, `file_change_applied`;
- `approval_requested`, `approval_resolved`;
- `user_question_requested`, `user_question_resolved`;
- `usage_updated`, `error_reported`.

Provider-specific payloads may be retained locally for diagnostics, but remote and UI
consumers operate on the normalized fields.

## Session State

The existing `SessionStore` will evolve from hook counters into a provider-neutral
session projection. A session records:

- identity, provider, workspace, and project label;
- active, waiting, idle, completed, failed, or disconnected state;
- current turn and current meaningful activity;
- recent tool and file-change summaries;
- pending decisions keyed by a stable approval ID;
- last activity time and connection health;
- optional transcript statistics and memory references.

Codex item IDs must be scoped by provider thread ID because item counters can collide
between parent and sub-agent threads. Approval records must join to their tool or file
item through the same scoped identity.

## Commands

The Tauri command boundary exposes intentional operations rather than generic JSON-RPC:

- list available Codex threads;
- attach to or resume a thread;
- start a new thread in a chosen workspace;
- send a user message;
- interrupt the active turn;
- approve once or deny an approval request;
- answer a structured user question;
- read normalized session details;
- read local bridge health.

The first release does not expose an "always allow" remote action. A durable permission
change must be made locally where the user can see its scope.

## Approval Safety

Approval requests are first-class objects, not text inferred from the transcript. Each
request includes the exact provider request ID, session and turn identity, operation
type, human-readable reason, affected command or files, requested scope, and expiry.

Rules:

- default to waiting for the user;
- never approve because a UI or network timeout occurred;
- reject stale responses after the provider request has completed or expired;
- allow only the subset of permissions originally requested;
- display commands and file targets in interpreted form with details available;
- keep approval decisions auditable in the local event log;
- require an unlocked, paired device for remote approval;
- deny remote approvals when device trust, sequence, or session identity is invalid.

## Remote Security Model

Pairing creates a per-device key relationship using a short-lived QR code or numeric
code displayed by the Mac. The remote device stores its private key locally. HUMHUM
stores the paired device public key, name, creation time, and revocation status.

Remote envelopes are encrypted and authenticated before leaving the Mac. The relay
receives only routing identifiers, ciphertext, delivery metadata, and coarse online
state. Replay protection uses monotonically increasing per-device sequence numbers.

Remote commands include the target session, expected session version, unique command
ID, timestamp, and expiry. The Mac validates all fields before forwarding a command to
the local bridge. Approval commands have short expiries and cannot be replayed.

Device revocation is immediate from the desktop app. Revoked devices cannot decrypt
new state or send accepted commands.

## Persistence

Durable local data lives under `~/.humhum/`:

- `hexa/sessions.json`: normalized session snapshots and provider mapping;
- `hexa/events/`: bounded append-only normalized event segments;
- `hexa/codex-bridge.json`: bridge health and compatibility metadata;
- `remote/device-identity.json`: local public identity and protected private key
  reference;
- `remote/paired-devices.json`: trusted device records;
- `remote/outbox/`: bounded encrypted envelopes awaiting delivery.

Sensitive private key material should use macOS Keychain where available. Files must
not contain raw access tokens or unencrypted conversation content intended only for
transient display.

## Failure Handling

- Missing Codex: Hexa explains that Codex is unavailable and keeps other agents alive.
- Unsupported protocol: show a compatibility message and preserve hook-based evidence.
- App-server crash: mark sessions disconnected, restart with backoff, and offer resume.
- Malformed event: log a redacted diagnostic and continue processing later events.
- Lost remote connection: queue a bounded encrypted state delta and reconnect with
  backoff.
- Expired approval: resolve it as expired locally and reject late remote responses.
- Relay outage: disable remote delivery without affecting local operations.
- Key mismatch or replay: reject the command and record a local security event.

## Attribution and Reuse

The implementation may study and adapt patterns from `slopus/happy`, which is MIT
licensed. HUMHUM will prefer independent, smaller implementations against Codex's
official app-server protocol. If source code is directly copied or substantially
adapted, its copyright notice and MIT license attribution must be retained in the
relevant source or third-party notices.

The normalized Hexa protocol is HUMHUM-owned and intentionally narrower than Happy's
session protocol.

## Testing

### Local Bridge

- JSON-RPC framing, request correlation, timeout, and process-exit tests;
- provider-event normalization fixtures for text, tools, files, usage, and errors;
- approval identity, expiry, allow-once, deny, and stale-response tests;
- thread list, start, resume, send, interrupt, and reconnect tests;
- merge tests proving hook statistics cannot overwrite fresher app-server state;
- an end-to-end smoke test against an installed Codex app-server in a disposable
  workspace.

### Remote Bridge

- pairing, encryption, authentication, sequence, expiry, and revocation tests;
- relay tests proving plaintext content is never accepted or stored;
- reconnect and bounded outbox tests;
- remote command authorization and stale-session tests;
- desktop/mobile browser tests for session reading and approval decisions;
- end-to-end testing from a phone-sized client through the relay to a disposable local
  Codex session.

Visual verification covers desktop and phone-sized viewports, long commands, large
file names, disconnected states, and multiple simultaneous approvals without overlap.

## Delivery Phases

### Phase 1: Observe Real Codex Sessions

- app-server lifecycle and compatibility check;
- normalized event model and local projection;
- real session progress in Hexa;
- no intervention commands yet.

### Phase 2: Local Intervention

- send, interrupt, start, and resume;
- first-class approval and question handling;
- local audit records and recovery behavior.

### Phase 3: Secure Remote Read Access

- device identity, pairing, encryption, relay, and phone Web client;
- session state and completion/error notifications;
- no remote write actions yet.

### Phase 4: Secure Remote Intervention

- remote send and interrupt;
- short-lived approval and question responses;
- revocation, replay protection, and end-to-end proof.

Each phase must be independently useful and shippable. Later phases cannot weaken the
local-first behavior or approval rules established earlier.

## Acceptance Criteria

- Hexa can show a live Codex turn from app-server events with meaningful current
  activity, tool, and file-change summaries.
- The user can locally send, interrupt, resume, approve once, deny, and answer a Codex
  question without using a terminal.
- Existing Claude hook sessions and Hush behavior continue to work.
- A paired phone can read encrypted session state while the relay cannot decrypt it.
- A paired phone can submit a short-lived intervention that the Mac authenticates,
  validates, and applies to the intended live session exactly once.
- Revoking a phone prevents all subsequent state access and command acceptance.
- Loss of Codex, the app-server, the relay, or the network degrades visibly without
  crashing HUMHUM or silently changing permissions.
