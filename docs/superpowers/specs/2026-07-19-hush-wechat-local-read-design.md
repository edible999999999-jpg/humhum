# Hush WeChat Local Read Design

## Goal

Let Hush show real incoming WeChat messages from the user's local WeChat 4.x
database through `r266-tech/wechat-cli`, while preserving HUMHUM's local-first,
read-only behavior.

## Boundaries

- The connector is disabled until `wechat-cli` is installed and its local key
  bootstrap is complete.
- HUMHUM never receives, stores, or asks for the administrator password.
- Bootstrap runs under visible, one-time `sudo` authorization. HUMHUM removes
  the upstream `r266.wx-mcp.sudo` Keychain item before and after setup instead
  of allowing unattended privilege reuse.
- Only allowlisted read commands may run: `status`, `sessions`, and `timeline`,
  always under `--strict-read-only`.
- Hush imports incoming private and group messages only. Messages sent by the
  local user are ignored.
- No message sending, UI automation, contact mutation, or remote upload is
  included.

## Data Flow

1. Discover `wechat-cli` from the managed install directory or `PATH`.
2. Run strict read-only `status` to expose readiness and setup guidance.
3. On manual or scheduled sync, list up to 100 recently active private/group
   sessions.
4. Read each session's timeline from the initial 24-hour window or the last
   successful sync with a two-minute overlap.
5. Normalize messages into the existing `HushInboxMessage` contract with a
   stable `wechat-cli:` source id and persist them under `~/.humhum/`.
6. Emit the existing Hush message event so the inbox refreshes immediately.

## Product Surface

Hush distinguishes three WeChat states:

- Notification preview: macOS delivered a notification, possibly without text.
- Local history setup required: the CLI exists but local key access is not ready.
- Real messages connected: Hush can read actual message text locally.

The connector panel exposes setup, manual sync, and five-minute automatic sync.
It explains that setup scans WeChat process memory, may restart an ad-hoc signed
shadow copy, and requests one-time local administrator authorization without
persisting the password.

## Failure Handling

- Missing CLI shows installation guidance without pretending WeChat is connected.
- Missing keys or Full Disk Access shows the upstream recovery action.
- Malformed or failed CLI output is rejected and surfaced as a connector error.
- Sync work is bounded by active sessions and message limits; duplicate source
  ids are ignored by the existing Hush store.

## Verification

- Rust tests cover discovery, strict read-only command validation, status
  parsing, session/message parsing, incoming-only normalization, deduplication,
  and incremental windows.
- Frontend tests cover command wiring and truthful connected/setup labels.
- A local smoke test runs `wechat-cli status`, then a real sync when bootstrap
  is available.
