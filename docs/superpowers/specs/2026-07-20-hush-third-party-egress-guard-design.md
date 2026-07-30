# Hush Third-Party Egress Guard Design

## 2026-07-30 Controlled Mobile Preview Amendment

The product decision has advanced from the release described below. A paired
phone is now allowed to receive a bounded Hush preview only when that individual
device was explicitly paired with the separate `personal_context` capability.
The exception is limited to at most 8 redacted message summaries and excludes
raw message objects, attachments, local paths, reply credentials, and connector
configuration.

LAN delivery remains certificate-pinned. Anywhere delivery remains
end-to-end encrypted between the Mac and the paired phone, so Relay stores and
forwards ciphertext only. Model providers, Agent transports, public APIs, logs,
and unpaired or non-authorized devices remain outside the boundary. Hush refresh
is an explicit user action; it does not authorize automatic replies, and every
reply still crosses the existing per-message confirmation flow.

Date: 2026-07-20
Status: Implemented (policy v2)

## Goal

Hush message bodies must remain on the user's Mac by default. Reading a local
message must not create a path that can send its sender, chat name, preview,
body, raw record, or database material to a third party.

This control is mandatory and fail-closed. It is not a preference that ordinary
application settings can disable.

## Trust Boundary

Allowed in this release:

- HUMHUM's local Hush inbox and desktop UI.
- The loopback-only local hook API, protected by its existing local token.
- Local read-only WeChat and DingTalk ingestion.
- One reply sent to the exact WeChat or DingTalk conversation only after the
  user reviews the recipient and content and explicitly confirms that send.

Blocked in this release:

- AI or Agent provider requests.
- The public Anywhere Relay, including encrypted personal-context responses.
- Mobile LAN personal-context responses.
- Analytics, telemetry, crash reports, logs, and updater requests.
- Network access from the external `wxkey` compatibility helper.
- Network access from the bundled WeChat reader.
- Background replies, bulk replies, automatic replies, and any reply target
  supplied by the frontend instead of derived from a stored local message.

A paired phone is user-owned rather than a third party, but Hush messages will
still be excluded from all mobile responses in this release. A future
`hush_messages` pairing capability may allow explicit end-to-end delivery to a
specific paired device. It must remain separate from the broader
`personal_context` capability and default to off.

## Enforcement

### Process Network Sandbox

On macOS, both `wxkey` and `humhum-wechat-reader` run through the fixed system
binary `/usr/bin/sandbox-exec` with a static profile that allows their existing
local behavior and denies all network operations.

The sandbox command:

- uses no shell;
- accepts no user-controlled profile or executable path;
- preserves the current stdin-only key request boundary;
- keeps helper stdout and stderr unavailable to HUMHUM logs;
- fails closed if the system sandbox binary is missing or unsafe.

The existing helper path, key-file permission, schema, size, identity, and
timeout checks remain in force.

### Remote Projection

`mobile_personal_context` no longer reads `HushStore`. Its serialized `inbox`
field remains present for protocol compatibility but is always empty.

Both direct mobile HTTP responses and Anywhere command responses reuse this
same empty projection. Relay wake messages remain minimal and contain no Hush
content.

No Hush record is passed to a remote model provider. A source-boundary test
prevents provider and Relay modules from importing `HushStore` or reading
`hush-inbox.json`.

### Confirmed Reply Boundary

Reply suggestions are generated locally from a small deterministic policy.
Clicking **本地起草** makes no Tauri request and invokes no AI provider.

For both platforms, the frontend sends only the local Hush message id and the
edited body to the Tauri command. The backend reloads that message and derives
the recipient from trusted local source metadata. It rejects group messages,
notification-only previews, missing DingTalk open ids, and unresolved WeChat
internal ids.

Preparation creates a random, single-use confirmation id bound to one recipient
and one body. It expires after 120 seconds. The frontend never receives the
opaque DingTalk recipient id.

- DingTalk sends through an exact `dws chat message send` command assembled by
  HUMHUM. The body travels over stdin rather than process arguments and no
  shell is involved.
- WeChat opens the resolved direct conversation and inserts a draft through a
  fixed macOS automation script. Final confirmation opens a system dialog over
  WeChat with **取消** as the default. Only the explicit **确认发送** action
  presses Return.

Reply command errors never include message bodies, recipient ids, CLI output,
or platform credentials.

### User-Visible Status

Hush displays a persistent security row:

> 第三方传输已阻止
>
> 聊天正文仅保存在这台 Mac，不会发送给 AI、Relay、手机或其他第三方；
> 只有你逐条确认的回复会送往对应的微信或钉钉会话。

The row is informational, not a toggle. Its status comes from a Tauri command
backed by the compiled policy rather than frontend-only text.

## Errors

- If the macOS network sandbox is unavailable, WeChat setup and reading stop
  with an actionable local error.
- If a future code change adds Hush content to a mobile or Relay projection,
  tests fail before release.
- Expired or reused confirmation ids fail closed and require a fresh review.
- An unresolved recipient never falls back to a displayed name or arbitrary
  frontend target.
- No error includes message text, contact names, database keys, salts, local
  message identifiers, or administrator credentials.

## Verification

Implementation follows test-driven development:

1. A runner test must first prove the reader is not launched through a
   network-denying sandbox.
2. A setup test must first prove `wxkey` is not launched through that sandbox.
3. A mobile projection test must first prove a Hush fixture reaches the
   serialized mobile inbox.
4. A privacy-status UI test must first fail because the enforced status is not
   rendered.
5. Production code is then changed until those tests pass.
6. Full frontend, Rust, boundary, production build, and macOS runtime checks
   must pass.
7. Reply tests prove local drafting makes no provider call, unsafe message
   types are rejected, target ids are not serialized, and confirmation ids are
   expiring and single-use.

## Non-Goals

- Adding a user-controlled privacy-off switch.
- Sending Hush message bodies to a phone in this release.
- Replying to group chats, sending attachments, or unattended reply rules.
- Replacing the temporary upstream key helper in this change.
- Claiming that encrypted third-party transit is equivalent to no transit.
