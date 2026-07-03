# HumHum

**Your AI Coding Companion as a Desktop Pet**

[中文文档](./README.zh-CN.md)

An open-source desktop companion app featuring **Hum**, a translucent jellyfish (Turritopsis dohrnii — the only creature on Earth that can reverse aging). Hum monitors events from multiple AI coding assistants and narrates them as a podcast-style voice broadcast, so you never have to switch windows just to check what your AI is doing.

<p align="center"><img src="docs/hum-preview.png" alt="HumHum Preview" width="280" /></p>

## Why HumHum?

When you're coding with Claude Code, Codex, or other AI assistants, you constantly switch back to read their output or click "Allow". HumHum turns these events into spoken audio — you just say "confirm" or "reject" without touching the keyboard.

**Key Features:**

- **Voice broadcast** — AI task completions narrated as audio summaries
- **Voice + keyboard confirmation** — Permission requests described aloud; respond by voice, hotkey, or button
- **Multi-client support** — Monitors 6 AI coding assistants simultaneously
- **Rage mode** — Auto-approve all permission requests (for the fearless)
- **Session dashboard** — Hover over Hum to see all active sessions
- **Stats panel** — Token usage, cost estimates, tool call analytics

## Supported AI Assistants

| Assistant | Creature Inside Hum | Color |
|-----------|-------------------|-------|
| Claude Code | Fire Shrimp | Orange |
| Codex | Cloud Puff | Green |
| Qwen Code | Blue Seahorse | Blue |
| Gemini CLI | Crystal Starfish | Cyan |
| Kimi K1 | Moon Jelly | Purple |
| QoderWork | Coral Polyp | Rose |

Each connected assistant appears as a tiny deep-sea creature inside Hum's translucent body.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- Python 3 + `edge-tts` (free TTS)
- System deps for Tauri: see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install & Run

```bash
# Clone
git clone https://github.com/edible999999999-jpg/humhum.git
cd humhum

# Install dependencies
npm install

# Dev mode (compiles Rust + starts Vite)
npm run tauri dev

# (Optional) Free TTS voice bridge
pip3 install edge-tts aiohttp
python3 scripts/edge-tts-bridge.py &
```

### Production Build

```bash
npm run tauri build
# Output in src-tauri/target/release/bundle/
```

### Connect Your AI Assistant

After HumHum starts, right-click the pet → Settings → Connections → click "Connect" next to your assistant. Hooks are installed automatically.

## Architecture

```
AI Assistant Hooks (Claude Code / Codex / Qwen Code / ...)
       │
       ▼
  Hook Script ──→ HumHum Server :31275 (Rust/Hyper)
       │                    │
       ▼                    ▼
  EventBus             StatsStore (token/cost tracking)
       │
       ▼
  LLM Summarizer ──→ Sentence Splitter
                           │
                           ▼
                      TTS Engine (pluggable)
                           │
                           ▼
                      Audio Queue ──→ Hum Jellyfish (PixiJS + Canvas2D)
                                          │
                                          ▼
                                     STT Engine (voice commands)
```

**Tech Stack:** Tauri v2 + React 18 + TypeScript + TailwindCSS + PixiJS v8 + Rust

## Interactions

| Action | Effect |
|--------|--------|
| Double-click | Focus terminal window |
| Right-click | Open settings panel |
| Hover | Show session dashboard |
| Drag | Jet-propulsion movement with bubble particles |

### Keyboard Shortcuts (during permission prompts)

| Key | Action |
|-----|--------|
| Y / Enter | Allow |
| A | Always Allow |
| N / Esc | Deny |
| Space | Pause/resume broadcast |

### Voice Commands

| Command | Trigger words | Action |
|---------|--------------|--------|
| Confirm | "confirm" / "yes" / "确认" | Approve permission |
| Reject | "reject" / "no" / "拒绝" | Deny permission |
| Skip | "skip" / "next" / "跳过" | Skip current broadcast |
| Pause | "pause" / "暂停" | Pause playback |
| Resume | "resume" / "继续" | Resume playback |

## TTS Options

| Provider | Cost | Notes |
|----------|------|-------|
| Edge TTS | Free | Microsoft Edge voices via local bridge (default) |
| OpenAI TTS | $15/M chars | tts-1 model, natural sounding |
| ElevenLabs | Pay-per-use | Best quality, voice cloning |

## Contributing

We'd love your help! HumHum is a young project with lots of room to grow.

### Good First Contributions

- **Add a new AI assistant adapter** — Implement a `ClientProfile` in `src-tauri/src/client_registry.rs`
- **Add a new TTS/STT provider** — Implement the interface in `src/types/index.ts`, register in `src/lib/bootstrap.ts`
- **Design new creature animations** — Add a `draw*` function in `src/engine/AgentCreatures.ts`
- **Improve the rendering engine** — Current: Canvas2D procedural → Goal: Rive .riv animations
- **Add i18n support** — Translate UI text to more languages
- **Write tests** — No test suite yet, everything is welcome
- **Platform support** — Currently macOS-focused, Windows/Linux need love

### How to Contribute

1. Fork this repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `npm run tauri dev` to verify
5. Commit (`git commit -m 'feat: add my feature'`)
6. Push (`git push origin feature/my-feature`)
7. Open a Pull Request

### Project Structure

```
src/                  # React frontend
  components/         # UI components (Pet, Settings, Overlay)
  engine/             # PixiJS rendering engine
  lib/                # Voice pipeline, TTS/STT, audio
  hooks/              # React hooks
  types/              # TypeScript interfaces
src-tauri/src/        # Rust backend
  hook_server.rs      # HTTP server receiving hook events
  commands.rs         # Tauri IPC commands
  config.rs           # App configuration
  session_store.rs    # Active session tracking
  client_registry.rs  # AI assistant profiles
hooks/                # Shell scripts for hook installation
scripts/              # Edge TTS bridge
```

## Spreading the Word

If you find HumHum useful, here's how you can help it grow:

- **Star this repo** to show support
- **Share on Twitter/X** with `#HumHum` — tell people about your setup
- **Write a blog post** or make a video about your workflow with HumHum
- **Post on Hacker News, Reddit (r/programming, r/ClaudeAI), or V2EX**
- **Tell your friends** who use AI coding tools

## Roadmap

- [ ] Windows & Linux support
- [ ] Pre-built binaries / Homebrew tap
- [ ] Rive animation engine (replace Canvas2D)
- [ ] Plugin system for custom event handlers
- [ ] Collaborative mode (share session status with team)
- [ ] More TTS voices and languages

## License

[MIT](LICENSE)

---

<p align="center">
  <em>Built with 🪼 by the HumHum community</em>
</p>
