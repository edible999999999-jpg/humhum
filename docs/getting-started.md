# Getting Started with HumHum

## Prerequisites

### macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Node.js (via Homebrew)
brew install node

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install pnpm
npm install -g pnpm
```

### Windows
- Install [Node.js](https://nodejs.org/)
- Install [Rust](https://rustup.rs/)
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 10/11)
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### Linux
```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Install Node.js, Rust, pnpm as above
```

## Installation

```bash
git clone https://github.com/your-org/humhum.git
cd humhum
pnpm install
```

## Running

```bash
pnpm tauri dev
```

This will:
1. Start the Vite dev server on `localhost:1420`
2. Compile the Rust backend
3. Launch the HumHum window

## First Use

1. **Open Settings**: Click the tray icon → Settings, or click the pet avatar
2. **Add API Key**: Enter your OpenAI API key (optional — Edge TTS works without it)
3. **Install Hooks**: Go to the Hooks tab and click "Install Hooks"
4. **Restart Claude Code**: For hooks to take effect

## Testing Without Claude Code

You can simulate events manually:

```bash
# Simulate a task completion
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"Stop","session_id":"test-123","cwd":"/tmp"}'

# Simulate a permission request
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"PermissionRequest","session_id":"test-123","tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}'
```

## Troubleshooting

### "Port 31275 already in use"
Another instance of HumHum may be running. Check System Monitor / Activity Monitor, or change the port in Settings.

### "Hook script not found"
Run `./hooks/install.sh` again to reinstall the hook scripts.

### "TTS not working"
- Edge TTS requires internet connection
- OpenAI TTS requires a valid API key in Settings
- Check the browser console (right-click → Inspect) for errors
