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

## Security

- The hook server listens on `127.0.0.1` only (localhost)
- API keys are stored locally in `~/.humhum/config.json`
- No data is sent to external services except the TTS/STT/LLM APIs the user configures
- The Tauri capability system restricts filesystem access to specific directories
