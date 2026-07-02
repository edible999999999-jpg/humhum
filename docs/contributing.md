# Contributing to HumHum

Thank you for your interest in contributing! HumHum is an open-source project and we welcome contributions of all kinds.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `pnpm install`
4. Start development: `pnpm tauri dev`

## Development Workflow

### Frontend (React/TypeScript)
- Source: `src/`
- Hot reload via Vite
- TailwindCSS for styling

### Backend (Rust/Tauri)
- Source: `src-tauri/src/`
- Changes require restart of `pnpm tauri dev`

### Hook Scripts
- Source: `hooks/`
- Test with: `echo '{"hook_event_name":"Stop","session_id":"test"}' | ./hooks/humhum-hook.sh`

## Adding a New TTS Provider

1. Create a new file in `src/lib/tts/` (e.g., `my-tts.ts`)
2. Implement the `TTSProvider` interface from `src/types/index.ts`
3. Export the provider class
4. Register it in the app initialization

Example:

```typescript
import type { TTSProvider, TTSOptions, Voice } from "@/types";

export class MyTTSProvider implements TTSProvider {
  readonly name = "My TTS";
  readonly providerId = "my-tts";

  async synthesize(text: string, options?: TTSOptions): Promise<ArrayBuffer> {
    // Your TTS implementation
  }

  async getVoices(): Promise<Voice[]> {
    // Return available voices
  }

  isAvailable(): boolean {
    // Check if this provider can be used
  }
}
```

## Adding Voice Commands

Edit `src/lib/voice-command/commands.ts` to add new trigger phrases or commands.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `style:` Formatting changes
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

## Code Review

All contributions go through code review. Please:
- Keep PRs focused on a single concern
- Include a clear description of what and why
- Ensure `pnpm tauri dev` starts without errors
- Add types for any new interfaces or data structures
