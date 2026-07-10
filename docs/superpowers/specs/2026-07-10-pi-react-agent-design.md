# HUMHUM Pi ReAct Agent Architecture

## Goal

Make Pi the single interaction runtime for HUMHUM. Humi should feel like a companion in conversation: it decides when it needs more context, retrieves local evidence through bounded tools, and answers in plain language. The user configures only an API URL, token, and model name.

## Current Problem

The current Ask Humi path calls `run_local_agent_kernel`, which produces heuristic replies in Rust. Pi is only exposed as a separate RPC sidecar in the details area. The result is two competing brains and inaccurate answers. Existing OpenAI configuration is also split across summarization, TTS, and STT settings.

## Proposed Architecture

```text
User message
  -> Pi Agent Runtime (ReAct loop)
  -> HUMHUM local context tools
  -> Pi interprets tool results and continues or answers
  -> conversational response with concise evidence
```

Pi is integrated through its reusable agent runtime/SDK or a bundled Pi runtime, not as a user-installed CLI dependency. The current external `pi --mode rpc` adapter can remain only as a development fallback during migration and must not be the primary product path.

## Configuration

Persist one user-facing Pi provider configuration under `~/.humhum/config.json`:

- `url`: OpenAI-compatible API base URL
- `token`: provider token, stored locally and never returned to the UI in plaintext
- `model_name`: selected model identifier

The settings UI presents these as one compact Agent configuration section. Legacy summarizer API/model fields are migrated into this configuration where possible, then no longer drive Humi answers. TTS and STT remain optional presentation features, not separate Agent brains.

## Tools

The first tool set is deliberately small and read-oriented:

- `get_recent_sessions`: recent local Agent activity and summaries
- `get_agent_skills`: skills and workflows the user relies on
- `get_local_memory`: durable HUMHUM memory and preferences
- `get_project_context`: relevant project instructions and recent traces
- `get_user_preferences`: presentation and workflow preferences
- `save_memory`: explicit confirmation required before persisting a new memory

Tools return interpreted, size-limited context rather than raw filesystem paths or unbounded files. Private messages, destructive commands, file changes, and external writes are outside the initial automatic tool scope and require explicit confirmation.

## ReAct Interaction

The runtime may perform multiple tool calls for one user message. The foreground shows only friendly progress states such as “正在了解你的最近工作” and “正在整理相关信息”. It must not expose hidden chain-of-thought. The final response should explain the conclusion and briefly identify the evidence used without dumping raw diagnostics.

If a tool fails, Pi should continue with the available evidence and say what is missing. If the provider is not configured, unreachable, or rejects the token/model, HUMHUM should show a clear setup error instead of silently falling back to heuristic answers. The legacy local kernel may remain available for diagnostics, but it must not be presented as an equivalent intelligent answer.

## Migration Boundaries

1. Add a single Pi provider configuration and safe migration from current config fields.
2. Expose bounded local-context tools through a Pi runtime adapter.
3. Route Ask Humi through the Pi ReAct runtime.
4. Move the current scan and heuristic kernel behind Details/diagnostics.
5. Simplify settings to URL, token, and model name, with advanced voice settings separate.
6. Remove the external Pi installation requirement from the normal user flow.

## Verification

- Unit tests cover config migration, token redaction, tool result limits, and confirmation requirements for `save_memory`.
- Runtime tests verify that a user question can cause a tool call followed by a conversational answer.
- Failure tests verify clear errors for missing configuration, unreachable URL, invalid token, and unknown model.
- Frontend verification checks that Ask Humi no longer invokes `run_local_agent_kernel` and that the build passes with the simplified configuration shape.
- Manual smoke test uses a local OpenAI-compatible endpoint and confirms the configured URL, token, and model are the only provider values required.

## Success Criteria

- Every normal Humi interaction is controlled by Pi's ReAct loop.
- No user installation of the Pi CLI is required.
- The settings surface has exactly three Agent provider inputs: URL, token, model name.
- Humi answers are generated from Pi plus retrieved local evidence, not hard-coded Rust branches.
- Sensitive values are stored locally and never displayed or included in user-facing diagnostics.
