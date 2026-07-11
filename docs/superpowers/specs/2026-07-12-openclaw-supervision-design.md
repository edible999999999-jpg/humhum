# OpenClaw Supervision Design

## Goal

Give HUMHUM the same coarse OpenClaw supervision surface currently exposed by Ping Island, while keeping installation explicit, local-only, observational, and reversible.

## Integration

HUMHUM manages one OpenClaw internal hook directory:

- `~/.openclaw/hooks/humhum-openclaw/HOOK.md`
- `~/.openclaw/hooks/humhum-openclaw/handler.ts`

`HOOK.md` subscribes to the official `command`, `message`, and `session` event families. HUMHUM merges only `hooks.internal.entries.humhum-openclaw.enabled = true` into `~/.openclaw/openclaw.json`. Existing configuration and hook entries remain untouched.

Both generated files contain `HUMHUM_OPENCLAW_HOOK`. Uninstall validates all existing managed files before removing either, deletes only HUMHUM's activation entry, and removes parent objects only when they become empty.

## Event Mapping

| OpenClaw event | HUMHUM event |
| --- | --- |
| `command:new`, `command:reset` | `SessionStart` |
| `command:stop` | `SessionEnd` |
| `message:received` | `UserPromptSubmit` |
| `message:sent` | `Stop` |
| `session:compact:before` | `PreCompact` |
| `session:compact:after`, `session:patch` | `Notification` |

The handler resolves the stable session key/id from documented event and context fields, prefixes it with `openclaw-`, and includes a workspace only when OpenClaw supplies one. No synthetic session is created when an identifier is absent.

## Delivery And Privacy

The TypeScript handler reads `~/.humhum/config.json` and `~/.humhum/local-api-token` at delivery time, then posts normalized JSON to `127.0.0.1`. A single in-process Promise queue preserves event order. A one-second timeout and catch-all failure handling ensure a stopped HUMHUM app cannot fail OpenClaw.

The hook observes user and assistant message previews that OpenClaw already provides to the hook event. It does not read OpenClaw credentials, invoke tools, alter prompts, block events, start the Gateway, or send follow-up messages.

## Verification

Tests cover registry metadata, owner-safe install/uninstall, config preservation, activation status, event normalization, missing-session rejection, TypeScript transpilation, and authenticated ordered loopback delivery. On this Mac, OpenClaw 2026.3.13 supplies installed-runtime evidence through `openclaw hooks list/check`; the Gateway is not started solely for testing.
