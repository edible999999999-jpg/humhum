# Architecture

## Overview

HumHum is a Tauri v2 desktop application that bridges AI coding assistants (Claude Code, Codex) with voice-based interaction. It operates as a transparent overlay "desktop pet" that listens for coding events and presents them as podcast-style audio broadcasts.

## Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Code    │────→│  Hook Script     │────→│  HumHum Server  │
│  (CLI Tool)     │stdin│  (Shell)         │HTTP │  (Rust/Tauri)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                           │
                                                     Tauri Event
                                                           │
                                                           ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Voice Command  │←────│  STT Engine      │←────│  Desktop Pet UI │
│  (User speaks)  │     │  (Web Speech /   │     │  (React)        │
│                 │     │   Whisper)       │     │                 │
└────────┬────────┘     └──────────────────┘     └────────┬────────┘
         │                                                │
    Action Handler                                   Event Handler
         │                                                │
         ▼                                                ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Hook Response  │←────│  Audio Queue     │←────│  TTS Engine     │
│  (back to       │     │  (HTML5 Audio)   │     │  (Edge/OpenAI/  │
│   Claude Code)  │     │                  │     │   ElevenLabs)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                   Sentence Splitter
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  LLM Summarizer │
                                                 │  (OpenAI API)   │
                                                 └─────────────────┘
```

## Module Architecture

### Adapter Pattern

TTS, STT, and Summarizer all use an adapter/provider pattern:

```typescript
// Each provider implements a standard interface
interface TTSProvider { ... }
interface STTProvider { ... }
interface Summarizer { ... }

// Registry manages active providers
registerProvider(new OpenAITTSProvider(apiKey));
registerProvider(new EdgeTTSProvider());
setActiveProvider("openai");
```

This allows:
- Easy addition of new providers (community contributions)
- Runtime switching between providers
- Graceful fallback when a provider is unavailable

### Pet State Machine

The desktop pet follows a strict state machine:

```
idle ──→ processing ──→ speaking ──→ idle
                         │
                         └──→ waiting ──→ idle
                         └──→ listening ──→ idle
```

Transitions are validated in `PetStates.ts`. Invalid transitions are logged and ignored.

## Claude Code Integration

HumHum integrates with Claude Code via its [Hooks system](https://code.claude.com/docs/en/hooks):

1. **Hook Installation**: Scripts are registered in `~/.claude/settings.json`
2. **Event Capture**: When Claude Code triggers an event, the hook script reads JSON from stdin
3. **Forwarding**: The script POSTs the JSON to HumHum's local HTTP server
4. **Permission Handling**: For `PermissionRequest`, the server holds the HTTP connection until the user responds (via UI or voice), then returns the decision JSON to the hook script, which outputs it to Claude Code

## Codex App-Server Integration

Hexa connects to the installed Codex CLI through the official `codex app-server`
JSON-RPC v2 protocol over local stdio.

1. **Compatibility**: HUMHUM checks `codex --version` and exposes a calm bridge
   health state when Codex is missing, unsupported, starting, connected, or
   disconnected.
2. **Handshake**: The bridge sends `initialize`, acknowledges with the required
   `initialized` notification, and requests recent non-archived threads.
3. **Projection**: Thread, turn, item, usage, error, approval, and question messages
   are normalized into provider-neutral Hexa session projections.
4. **Intervention**: Tauri commands expose only intentional operations: start,
   resume, send, interrupt, allow once, deny, and answer. The UI cannot send an
   arbitrary JSON-RPC method.
5. **Fallback**: A bridge failure changes the visible health state but does not stop
   Claude hooks, compatible-agent hooks, transcript statistics, Humi, or Hush.

The app-server sends live notifications only for threads subscribed on its connection.
Hexa therefore provides real-time control for threads it starts or resumes. Threads
created by an independent Codex process can appear as recent snapshots, but they must
be resumed through Hexa before HUMHUM treats them as live. The product must not imply
that it can observe another process's private in-flight event stream.

Approval requests are first-class server requests. HUMHUM retains the exact JSON-RPC
request ID locally for at most 120 seconds, rejects stale responses, and maps the UI's
`allow_once` and `deny` choices to Codex's narrow `accept` and `decline` decisions.
Session-wide or durable approval choices are not exposed by the first release.

Run the real, ignored smoke test explicitly on a machine with an installed and
authenticated Codex CLI:

```bash
cd src-tauri
cargo test --test codex_app_server_smoke -- --ignored --nocapture
```

The test uses an ephemeral thread in a temporary workspace and expects the exact
marker `HUMHUM_READY` without modifying a user project.

## Security

- The hook server listens on `127.0.0.1` only (localhost)
- The Codex bridge uses a local child process and stdio; it opens no network listener
- API keys are stored locally in `~/.humhum/config.json`
- No data is sent to external services except the TTS/STT/LLM APIs the user configures
- The Tauri capability system restricts filesystem access to specific directories
