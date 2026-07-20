# HUMHUM

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/edible999999999-jpg/humhum)](https://github.com/edible999999999-jpg/humhum/releases)

**Let every Agent work around you** — a personal Agent hub for daily life

[中文文档](./README.zh-CN.md)

<p align="center">
  <a href="https://github.com/edible999999999-jpg/humhum/releases/download/v0.3.15-beta.1/HumHum_0.3.15_aarch64.dmg"><strong>Download for macOS</strong></a>
  ·
  <a href="https://github.com/edible999999999-jpg/humhum/releases/latest/download/HumHum_0.3.12_x64-setup.exe"><strong>Download Windows Preview</strong></a>
  ·
  <a href="https://github.com/edible999999999-jpg/humhum/releases/download/v0.3.15-beta.1/HUMHUM-Android-0.3.15-Xiaomi.zip"><strong>Download for Android / Xiaomi</strong></a>
  ·
  <a href="https://yuxilab.cn/intro"><strong>Visit the website</strong></a>
  ·
  <a href="https://github.com/edible999999999-jpg/humhum/releases">Latest Release</a>
</p>

<p align="center"><em>Available for macOS Apple Silicon, Windows 10/11 x64 preview, and Android 8.0+. Linux remains on the roadmap.</em></p>

Windows contributors can use the [Windows development, build, and installation guide](./docs/windows-development.md). The preview installer is unsigned, so Microsoft SmartScreen may require an explicit confirmation. Windows code signing is still required before a formal public release.

---

As Agents multiply, what's really missing isn't another Agent — it's a center that belongs to *you*.

General-purpose Agents made thinking more efficient, and specialized Agents made work more efficient. But your personal life is still scattered across apps, messages, health and diet logs, preferences, and memories. HUMHUM aims to be **the Agent hub for your personal life**: it connects different Agents through a single personal knowledge base, turning the preferences, records, tasks, messages, and life data spread across your phone, computer, and cloud into long-term, reusable personal context.

> The goal isn't to make you manage every Agent — it's to let every Agent work around you.

HUMHUM records and manages sessions across multiple Agents via hooks, extracts your preferences and session memory, understands the line between your work and life, and distills a reusable personal profile into a knowledge base.

## Why the immortal jellyfish

HUMHUM's character is inspired by *Turritopsis dohrnii*, the immortal jellyfish — a creature believed to be able to revert to a younger state within its life cycle. We borrow that image because HUMHUM wants to help you restore the order in your life that apps, messages, tasks, and Agents have quietly worn away. The jellyfish also has many tentacles, which makes it a natural "connector": linking phone, computer, and cloud tools; linking messages, memory, health, diet, and workflows; and linking general and specialized Agents alike.

In an age full of Agents, what you lack isn't just efficiency — it's the emotional value of being understood, accompanied, and gently caught when you're overwhelmed. So HUMHUM isn't a cold robot, nor an automation tool rushing to decide for you. It's more like a quiet, soft, dependable little jellyfish: helping you untangle things when you're flooded with information, and helping you keep your own center while many Agents work in parallel.

## Four roles

HUMHUM centers on a hub window (the HUMHUM Hub), organized around four modules.

### 🪼 Humi — presence and companionship

Humi is the warm personal interpreter and the product's default entry point. It quietly learns from your local Agent activity and answers you in plain language rather than handing you a terminal report. Its default surface is a conversation box, not a config form.

Humi reads local Agent assets (Codex / Claude / Qoder / Pi and project traces) and translates those signals into your profile, current work direction, common skills, preferences, memory suggestions, and gentle next steps. Humi can also voice-summarize what your Agents have done and automatically configure hooks for Claude / Codex / Qoder — so you can confirm the state of your loop workflow without breaking focus. Raw scan details stay behind a "Details" disclosure, never the first thing you see.

### 📚 Hype — a universal Agent knowledge base

Hype manages your personal Agent knowledge base. It isn't another Agent; it's a personal knowledge index that consolidates configuration scattered across phone, computer, and cloud Agents — not just base config, but your preferences, common skills, Agent rules, soul/personality files, memory index, and the hot/cold memory that different Agents form while handling tasks.

This foundation helps different Agents understand you more accurately: how you like things phrased, which workflows you rely on, what should be remembered long-term, and what's only temporary context. Hype is an organizer, but its UI isn't a file manager first — it tells you what the knowledge base *means* and what's missing. Today it can scan Skill / Agent / Soul / Memory / Rule / Config assets, maintain preferences, detect CLAUDE.md / .cursorrules / AGENTS.md rules, and index an Obsidian vault.

### 💬 Hush — organizing your social signals, from your point of view

Hush organizes personal, social, work, and family messages from your perspective. It bridges sources like DingTalk, WeChat, X, and Meta, reorganizing messages into relationship tiers you can actually parse: family, friends, work, interests, and daily signals.

Hush **doesn't speak for you** — it helps you see who genuinely needs a response. A parent's message gets a timely nudge and summary; the warm words in a family group aren't buried under work chatter; the day's most important AI updates on X can be distilled into a light summary. When you want to reply, Hush suggests a warm phrasing — but whether and how to reply is always your call. Local message bridges are read-only by default and require your approval.

> It's not an auto-social tool. It's a personal message helper that guards the warmth of your relationships.

### 🛰️ Hexa — a session-state recorder for parallel Agents

Hexa is your Agent supervisor. It doesn't try to re-orchestrate all your Agents; it helps you see each Agent's progress, conversations awaiting confirmation, strong outputs, and where things are drifting. When multiple Agents work on engineering tasks at once, Hexa records what they did well and flags where they're going off track. It turns complex Agent collaboration from a black box into a process you can understand, control, and review — a caring little steward for parallel work and life.

## Desktop pet

HUMHUM already ships part of its desktop-pet form (the first version was built after the hackathon began, to bring the ideas to life). Humi appears on your desktop as a translucent immortal jellyfish that can voice-summarize what your Agents have done, help you confirm their status at a glance, and auto-configure hooks for Claude / Codex / Qoder. The pet layer is the project's earliest and most mature capability:

- **Voice broadcast** — turns Agent events into natural-language narration so you know what's happening without switching windows
- **Voice / keyboard confirmation** — permission prompts are described aloud; respond by voice, hotkey, or button
- **Multi-client monitoring** — connects Claude Code, Codex, Qwen Code, Gemini CLI, Kimi K1, and QoderWork
- **Rage mode** — auto-approve everything so Agents never wait on you
- **Session dashboard / stats panel** — hover to see active sessions, and view token usage and cost estimates

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 22.19+
- [Rust](https://rustup.rs/) 1.89+
- Python 3 + `edge-tts` (optional, for free voice broadcast)
- System deps for Tauri: see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

On Windows, install Visual Studio 2022 Build Tools with the C++ desktop workload and a Windows SDK. See the [Windows guide](./docs/windows-development.md) for the complete setup.

### Install & Run

Download the latest macOS build from [GitHub Releases](https://github.com/edible999999999-jpg/humhum/releases), or run from source:

```bash
# 1. Clone
git clone https://github.com/edible999999999-jpg/humhum.git
cd humhum

# 2. Install dependencies
npm ci

# 3. Dev mode (compiles Rust + starts Vite)
npm run tauri dev

# 4. (Optional) free TTS voice bridge
pip3 install edge-tts aiohttp
python3 scripts/edge-tts-bridge.py &
```

### Production Build

```bash
npm run tauri build
# Output in src-tauri/target/release/bundle/
```

On Windows, build only the NSIS installer with:

```powershell
npm run tauri build -- --bundles nsis
# Output: src-tauri\target\release\bundle\nsis\*.exe
```

### Open the Hub and connect your Agents

After launch, open the **Hub** from the system tray menu or by right-clicking the pet, then enter the four modules: Humi / Hype / Hush / Hexa. Connect your AI coding assistants from Settings or the Humi page and hooks install automatically:

- **Claude Code** — writes/merges into `~/.claude/settings.json`
- **Codex / Qwen Code / Gemini CLI / Kimi K1** — configured via a unified client registry (JSON / TOML)
- **QoderWork** — watches `~/.qoderwork/logs/sessions/` session logs

### Phone access

The native Android client pairs by scanning the short-lived QR code in Hexa. On the same network it uses certificate-pinned HTTPS directly to the Mac. The invite-only **HUMHUM Anywhere** beta can automatically fall back to a self-hosted opaque relay when the phone is on 5G or another network: session summaries, bounded recent conversation, approvals and short follow-ups stay AES-256-GCM encrypted between the Mac and phone, while the relay stores only bounded ciphertext and credential digests. Read-only/control scope and per-device revocation still apply.

Android 0.3.15 adds a native Living Signals home with distinct Humi, Hype, Hush and Hexa tabs. Optional Health Connect sources provide daily steps, resting heart rate and sleep duration; permissions are requested one source at a time, the phone keeps only a seven-day encrypted delivery queue, and durable encrypted summaries live on the user's Mac. Phones without Health Connect can use the local step counter after explicit permission, while heart rate and sleep remain unavailable instead of being inferred.

### Hush real WeChat messages (experimental)

HUMHUM now includes its own networkless, read-only native reader for recent
private and group messages in the local WeChat 4.x store. The executable accepts
one typed JSON request on stdin and exposes only `status`, `sessions`, and
`timeline`; it has no send, remote companion, updater, shell, or export path.
The bundled reader and WCDB runtime are hash-verified before each launch.

The minimum WCDB compatibility layer was independently reduced from an audited
snapshot of [`r266-tech/wechat-cli`](https://github.com/r266-tech/wechat-cli);
exact source commits and licenses are recorded in
[`native/humhum-wechat/NOTICE.md`](./native/humhum-wechat/NOTICE.md).

The current source preview can use an explicitly installed
`~/.local/share/wechat-cli/wxkey` as a temporary local key provider. The Hush
setup button runs only its `bootstrap` or `setup` action after checking the
executable path and permissions; all key-helper output is discarded. HUMHUM
does not invoke the third-party query CLI, companion server, updater, export,
or SQL surface.

This compatibility path has an important temporary tradeoff: upstream `wxkey`
stores a validated sudo credential in macOS Keychain and writes the WCDB key map
to `~/.config/wxcli/config.json` as an owner-only `0600` file. HUMHUM rejects
symlinks, broad permissions, unknown schemas, and malformed keys before loading
that file, then passes validated keys only to its own reader through stdin. A
future signed HUMHUM helper and Keychain-backed encrypted vault will replace
this compatibility path. Hush imports incoming messages only into the local
inbox and skips messages sent by the user.

Anywhere requires a deployed HTTPS relay and an invite code configured in Hexa. See [Android setup](./docs/android-install.md) and [relay deployment](./relay/README.md). It is currently a self-hosted beta, not a promise that a public HUMHUM endpoint is already online.

## Data & privacy

HUMHUM is local-first — the data on your own machine is its advantage. All durable data is persisted under `~/.humhum/`:

- `config.json` — app configuration (Pi URL/token/model, hook port, TTS/STT, language)
- `local-api-token` — per-install secret used to authenticate the local HTTP API; do not share it
- `knowledge.json` — Hype's rules, Agent assets, and Obsidian index
- `vault/preferences/*.md` and `vault/memory/*.md` — Hype's preference and memory source of truth; back up the whole `vault/` directory
- `stats.json` — token and cost statistics
- `hush-inbox.json` — Hush's local message inbox (up to 2,000 messages)
- `hush/structured-signals.sqlite3` — encrypted, user-approved daily health summaries received from paired phones
- `local-agent-memory.md` — Humi's local Agent memory

Privacy shows up in behavior: HUMHUM does not read private chats or sensitive stores without an explicit action from you; local message bridges are read-only by default; and while raw scan results remain available for debugging, **the interpreted summary is the default product surface**.

## Tech stack

The frontend is React 18 + TypeScript + Vite, with the desktop pet rendered via PixiJS v8 (2D) and Three.js (3D Humi); the desktop shell is Tauri v2 (Rust). Humi conversations use the bundled Pi Agent SDK and its ReAct/tool loop, with the Rust backend providing bounded local-context tools. The backend also provides a local hook server (Hyper, :31275), knowledge-base storage, session and stats stores, the Hush inbox, and watchers/parsers for Claude / Codex / Qoder / Wukong sessions. Voice remains optional through Edge TTS / OpenAI / ElevenLabs and Web Speech / Whisper.

Key code locations: Tauri commands are registered in `src-tauri/src/lib.rs`; local knowledge logic lives in `src-tauri/src/knowledge_store.rs`; Humi's local Agent interpretation is in `src-tauri/src/commands.rs`; Hush message storage is in `src-tauri/src/hush_store.rs`; and the Hub UI modules live in `src/components/Hub/`.

## Project structure

```
src/                    # React frontend
  components/
    Hub/                # The four hub modules (Humi / Hype / Hush / Hexa)
    Pet/                # Desktop jellyfish (PixiJS + Three.js)
    Overlay/            # Permission confirm / notification / completion
    Settings/           # Settings, stats, memory panels
  engine/               # PixiJS / Canvas2D rendering engine
  lib/                  # Voice pipeline, TTS/STT, summarizer, i18n
  hooks/                # React hooks (useHexaData, etc.)
src-tauri/src/          # Rust backend
  lib.rs                # App bootstrap + Tauri command registration
  commands.rs           # IPC commands (hook auto-config, Humi kernel)
  knowledge_store.rs    # Hype knowledge base persistence
  hush_store.rs         # Hush message inbox
  hook_server.rs        # Local HTTP server :31275
  client_registry.rs    # AI assistant client profiles
docs/                   # Design & vision docs
scripts/                # Edge TTS bridge, etc.
```

## Roadmap

- [x] Native Android status, conversation, approval and follow-up access with QR pairing
- [ ] Public hosted HUMHUM Anywhere endpoint and iOS client
- [ ] Cross-device preference and context sync
- [x] Read-only macOS notification bridge for new WeChat and DingTalk messages
- [x] Experimental local wxkey compatibility path for WeChat history
- [ ] Signed key setup for the bundled read-only WeChat history reader
- [x] DingTalk DWS history sync
- [ ] Feishu message bridge through a local or official authorized source
- [ ] Smart permission policies (learning your approval habits)
- [ ] More Agent integrations and an open hook-protocol standard
- [ ] Signed Windows release and full Linux support

## Contributing

HUMHUM is open source and we'd love your help. When adding a feature, ask yourself: "Does this help the user feel more understood and in control?" If the answer is only "it exposes more data," redesign it.

1. Fork this repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Run `npm run tauri dev` to verify
5. Push and open a Pull Request

## License

[MIT](LICENSE)

---

<p align="center"><em>HUMHUM — a personal Agent hub built around you. When you're flooded with information, it helps you slowly untangle it. 🪼</em></p>
