# Pi ReAct Runtime

## Product path

HUMHUM bundles the official Pi Agent SDK. Normal Humi conversations do not require a globally installed `pi` command and do not start an external Pi process.

```text
Humi conversation
  -> @earendil-works/pi-agent-core Agent loop
  -> bounded HUMHUM context tools
  -> @earendil-works/pi-ai OpenAI-compatible provider
  -> conversational answer
```

The user configures only three Agent fields in Settings:

- `URL`: OpenAI-compatible API base URL
- `Token`: provider token stored under `~/.humhum/config.json`
- `model_name`: provider model identifier

Pi's Agent loop decides whether local context is needed and can call the read-only tools registered by HUMHUM. The UI shows short progress labels, not hidden reasoning, raw paths, tool arguments, or tokens.

## Context tools

The first tool set is intentionally narrow:

- `get_recent_sessions`
- `get_agent_skills`
- `get_local_memory`
- `get_project_context`
- `get_user_preferences`

Tauri owns these commands and returns bounded, interpreted JSON. `save_memory` is a separate confirmation-gated command and is not silently executed by the Agent.

## Legacy CLI adapter

The Rust `pi_sidecar` module and commands such as `start_pi_session` remain for compatibility with older diagnostics and event experiments. They are not part of the normal Humi answer path. A missing `pi` executable must not prevent bundled Pi Agent conversations from working.

## Security boundary

Pi itself is not a sandbox. HUMHUM's initial automatic tools are read-oriented and redact local paths. File changes, shell commands, private messages, memory writes, and external writes require a separate explicit confirmation flow before they are added.
