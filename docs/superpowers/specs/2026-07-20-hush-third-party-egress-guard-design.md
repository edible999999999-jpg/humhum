# Hush Third-Party Egress Guard Design

Date: 2026-07-20
Status: Approved direction, implementation pending

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

Blocked in this release:

- AI or Agent provider requests.
- The public Anywhere Relay, including encrypted personal-context responses.
- Mobile LAN personal-context responses.
- Analytics, telemetry, crash reports, logs, and updater requests.
- Network access from the external `wxkey` compatibility helper.
- Network access from the bundled WeChat reader.

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

### User-Visible Status

Hush displays a persistent security row:

> 第三方传输已阻止
>
> 聊天正文仅保存在这台 Mac，不会发送给 AI、Relay、手机或外部服务。

The row is informational, not a toggle. Its status comes from a Tauri command
backed by the compiled policy rather than frontend-only text.

## Errors

- If the macOS network sandbox is unavailable, WeChat setup and reading stop
  with an actionable local error.
- If a future code change adds Hush content to a mobile or Relay projection,
  tests fail before release.
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

## Non-Goals

- Adding a user-controlled privacy-off switch.
- Sending Hush messages to a phone in this release.
- Replacing the temporary upstream key helper in this change.
- Claiming that encrypted third-party transit is equivalent to no transit.
