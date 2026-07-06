# Contributing to HumHum

Thanks for your interest in HumHum! This guide will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- Python 3 + `edge-tts` (optional, for free TTS)
- Tauri system deps: see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Getting Started

```bash
git clone https://github.com/edible999999999-jpg/humhum.git
cd humhum
npm install
npm run tauri dev
```

### Useful Commands

```bash
npm run tauri dev          # Dev mode (Vite + Rust)
npm run tauri build        # Production build
npx tsc --noEmit           # TypeScript type check
cargo fmt --check          # Rust formatting check (in src-tauri/)
cargo clippy               # Rust lints (in src-tauri/)
cargo test                 # Rust tests (in src-tauri/)
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run tauri dev` to verify everything works
4. Commit with a descriptive message (see below)
5. Open a Pull Request

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new TTS provider for Azure
fix: correct token counting for cached inputs
docs: update architecture diagram
refactor: simplify hook installation logic
```

### Code Style

- **TypeScript/React**: 2-space indent, no semicolons required (follow existing patterns)
- **Rust**: `cargo fmt` standard formatting (4-space indent)
- Run `cargo clippy` before submitting — CI will check this

## Good First Contributions

- **Add a new AI assistant adapter** — Implement a `ClientProfile` in `src-tauri/src/client_registry.rs`
- **Add a new TTS/STT provider** — Implement the interface in `src/types/index.ts`, register in `src/lib/bootstrap.ts`
- **Design new creature animations** — Add a `draw*` function in `src/engine/AgentCreatures.ts`
- **Improve the rendering engine** — Current: Canvas2D procedural. Goal: Rive .riv animations
- **Write tests** — Frontend tests (vitest) and Rust tests are both welcome
- **Platform support** — Currently macOS-focused; Windows/Linux need love

## Project Structure

```
src/                  # React frontend
  components/         # UI components (Pet, Settings, Overlay)
  engine/             # PixiJS rendering engine
  lib/                # Voice pipeline, TTS/STT, audio
  types/              # TypeScript interfaces
src-tauri/src/        # Rust backend
  hook_server.rs      # HTTP server receiving hook events
  commands.rs         # Tauri IPC commands
  config.rs           # App configuration
  session_store.rs    # Active session tracking
  stats_store.rs      # Token/cost statistics
  client_registry.rs  # AI assistant profiles
hooks/                # Shell hook script
scripts/              # Edge TTS bridge
```

## Architecture Overview

See `CLAUDE.md` for detailed architecture documentation, including the voice pipeline, event flow, permission handling, and rendering engine internals.

## Questions?

Open an issue or start a discussion — we're happy to help!
