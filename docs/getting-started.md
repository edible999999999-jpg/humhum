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

```

### Windows

- Install [Node.js 22.19](https://nodejs.org/) or newer
- Install [Rust 1.89](https://rustup.rs/) or newer
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 10/11)
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** and a Windows 10 or 11 SDK
- Follow the complete [Windows development, installer, and smoke-test guide](./windows-development.md)

### Linux
```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Install Node.js and Rust as above
```

## Installation

```bash
git clone https://github.com/edible999999999-jpg/humhum.git
cd humhum
npm ci
```

## Running

```bash
npm run tauri dev
```

This will:
1. Start the Vite dev server on `localhost:1420`
2. Compile the Rust backend
3. Launch the HumHum window

## First Use

1. **Open Settings**: Open the tray menu → Settings
2. **Add API Key**: Enter your OpenAI API key (optional — Edge TTS works without it)
3. **Install Hooks**: In Connections, click Connect for each Agent you use
4. **Restart the Agent CLI**: This lets it reload the updated hook configuration

## Testing Without Claude Code

You can simulate events manually:

### macOS/Linux

```bash
HUMHUM_TOKEN="$(cat "$HOME/.humhum/local-api-token")"

# Simulate a task completion
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -H "X-HumHum-Token: $HUMHUM_TOKEN" \
  -d '{"hook_event_name":"Stop","session_id":"test-123","cwd":"/tmp"}'

# Simulate a permission request
curl -X POST http://localhost:31275/event \
  -H "Content-Type: application/json" \
  -H "X-HumHum-Token: $HUMHUM_TOKEN" \
  -d '{"hook_event_name":"PermissionRequest","session_id":"test-123","tool_name":"Bash","tool_input":{"command":"ls /tmp"}}'
```

### Windows PowerShell

The short example below sends one event. For authenticated health, invalid-token, pending-event, install, and uninstall checks, use the [complete Windows smoke test](./windows-development.md#test-the-authenticated-local-api).

```powershell
$token = (Get-Content -LiteralPath (Join-Path $HOME ".humhum\local-api-token") -Raw).Trim()
$headers = @{ "X-HumHum-Token" = $token }
$body = @{
    hook_event_name = "Stop"
    session_id = "test-123"
    cwd = $PWD.Path
} | ConvertTo-Json

Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:31275/event" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body
```

HumHum creates the per-install token on first launch. Keep it private; normal local requests to every endpoint except `/health` authenticate with that value in `X-HumHum-Token`. An active SSH remote bridge uses its own ingress token for `/event`.

## Troubleshooting

### "Port 31275 already in use"
Another instance of HumHum may be running. Check Task Manager on Windows or Activity Monitor on macOS, or change the port in Settings.

### "Hook script not found"
Reconnect the client from HUMHUM Settings. For a manual reinstall, run `./hooks/install.sh` on macOS/Linux or `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\hooks\install.ps1` on Windows.

### "TTS not working"
- Edge TTS uses its optional local bridge and falls back to the operating-system voice
- OpenAI TTS requires a valid API key in Settings
- Check the browser console (right-click → Inspect) for errors
