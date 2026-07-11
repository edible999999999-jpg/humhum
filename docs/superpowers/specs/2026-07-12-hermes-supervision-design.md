# Hermes Agent Supervision Design

## Goal

Let HUMHUM observe Hermes Agent sessions in Hexa with the same local-first lifecycle and progress signals already used for Claude-compatible clients. Installation remains explicit and reversible.

## Chosen Integration

HUMHUM installs an official Hermes Python plugin at `~/.hermes/plugins/humhum/`. The plugin registers Hermes lifecycle hooks with `ctx.register_hook`, which works in both CLI and Gateway sessions. Gateway-only hooks and session-file polling are intentionally excluded.

The managed directory contains:

- `plugin.yaml`, declaring the supported hook names.
- `__init__.py`, containing a small observational bridge.

Both files carry a HUMHUM ownership marker. Installation replaces only this dedicated directory's managed files. Uninstallation refuses to remove files without that marker and removes the directory only when empty.

## Event Flow

The plugin sends JSON directly to HUMHUM's existing loopback `/event` endpoint. It reads the current hook port and token from `~/.humhum/config.json` for each delivery, so an app restart or port change does not require reinstalling the plugin.

Hermes events map to normalized HUMHUM events:

| Hermes hook | HUMHUM event |
| --- | --- |
| `on_session_start` | `SessionStart` |
| `pre_llm_call` | `UserPromptSubmit` |
| `pre_tool_call` | `PreToolUse` |
| `post_tool_call` | `PostToolUse` or `PostToolUseFailure` |
| `post_llm_call` | `Notification` |
| `on_session_end` | `Stop` |
| `on_session_finalize` | `SessionEnd` |
| `on_session_reset` | `SessionStart` |

Session IDs are prefixed with `hermes-` to avoid collisions. The plugin keeps only transient in-process state needed to deduplicate session start and associate the latest assistant response.

## Privacy And Failure Behavior

The plugin is observational. It never returns a block or context-injection response and therefore cannot approve, reject, or modify Hermes actions. It sends working directory, user prompt, assistant response, tool name, structured tool arguments, and success/error status to the local HUMHUM loopback service only. No remote endpoint is used.

Delivery runs on a daemon thread with a short timeout. Missing configuration, malformed payloads, a stopped HUMHUM app, and network errors are swallowed. A broken bridge must never break or delay Hermes.

## Product Surface

Hermes appears in the existing supported-client settings list with an explicit enable toggle. Once enabled, its events appear in Hexa through the existing normalized session model. This first increment is supervision only: sending follow-up commands into Hermes is not claimed.

## Verification

Automated tests cover:

- registry metadata and supported event declarations;
- generated manifest and Python source;
- owner-safe install, update, and uninstall behavior;
- refusal to remove an unmanaged plugin;
- Python syntax compilation;
- a local HTTP smoke test that invokes generated callbacks and validates normalized event envelopes.

The full Rust and frontend suites, production frontend build, release bundle, code-sign verification, and DMG verification run before the capability is reported complete.
