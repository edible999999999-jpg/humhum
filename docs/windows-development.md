# Windows development and installation

HUMHUM targets 64-bit Windows 10 and Windows 11. The Windows port is currently a developer preview, so installers produced locally or by CI are unsigned.

## Prerequisites

Install the following tools:

- [Node.js 22.19](https://nodejs.org/) or newer (required by the bundled Pi runtime)
- [Rust 1.89](https://rustup.rs/) or newer with the default MSVC toolchain
- [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** and a Windows 10 or 11 SDK
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (included with current Windows 10 and 11 installations)

Tauri downloads the NSIS packaging tools when needed; a separate NSIS installation is not required.

Optional integrations:

- Install the Windows **OpenSSH Client** optional feature to use Hexa's SSH event bridge.
- Install Tailscale when pairing the Android client through a tailnet. LAN pairing does not require it.
- The mobile bridge generates its TLS identity in-process; OpenSSL is not required.

## Develop and validate

Run these commands in PowerShell from the repository root:

```powershell
npm ci
npm run test:all
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-windows-hooks.ps1
npm run tauri dev
```

The first Rust build can take several minutes while Cargo downloads and compiles dependencies.

## Build an installer

Create an unsigned 64-bit NSIS installer with:

```powershell
npm run tauri build -- --bundles nsis
```

The installer is written to:

```text
src-tauri\target\release\bundle\nsis\*.exe
```

The [Windows CI workflow](../.github/workflows/windows.yml) runs the frontend and relay tests, builds the frontend, checks and tests the Rust backend, validates the PowerShell helpers, builds the same NSIS installer, verifies generated Tauri schemas, and uploads it as a GitHub Actions artifact. It runs for pull requests targeting `main`, pushes to `main`, version tags matching `v*`, and manual dispatches. No signing certificate or repository secret is required.

## Install or uninstall

1. Run the generated `*-setup.exe` file.
2. If Microsoft Defender SmartScreen warns about an unknown publisher, verify that the installer came from your own build or the expected repository workflow before choosing **More info → Run anyway**. Public releases should be code-signed before distribution.
3. Launch HUMHUM from the Start menu. WebView2 will be requested if the runtime is missing.

Uninstall HUMHUM from **Settings → Apps → Installed apps**. User data is intentionally retained under `%USERPROFILE%\.humhum`; remove that directory manually only if you also want to delete local settings and knowledge.

## Test the authenticated local API

HUMHUM creates a per-install token at `%USERPROFILE%\.humhum\local-api-token` on first launch. Every local API route except `/health` requires valid authentication in the `X-HumHum-Token` header. Normal local clients use that exact token; `/event` also accepts the separate, short-lived ingress token owned by an active SSH remote bridge. Keep both token types private and do not print them in build logs or bug reports.

With HUMHUM running, send a harmless completion/stop event from PowerShell:

```powershell
$baseUrl = "http://127.0.0.1:31275"
$tokenFile = Join-Path $HOME ".humhum\local-api-token"
if (-not (Test-Path -LiteralPath $tokenFile)) {
    throw "Start HUMHUM once so it can create $tokenFile"
}

$token = (Get-Content -LiteralPath $tokenFile -Raw -Encoding UTF8).Trim()
$headers = @{ "X-HumHum-Token" = $token }

# Health is intentionally unauthenticated.
Invoke-RestMethod -Method Get -Uri "$baseUrl/health"

$eventBody = @{
    hook_event_name = "Stop"
    session_id = "windows-smoke-test"
    cwd = (Get-Location).Path
    payload = @{}
} | ConvertTo-Json -Depth 5

$response = Invoke-WebRequest `
    -Method Post `
    -Uri "$baseUrl/event?client=codex" `
    -Headers $headers `
    -ContentType "application/json; charset=utf-8" `
    -Body $eventBody `
    -UseBasicParsing

"Event response: HTTP $($response.StatusCode)"
Invoke-RestMethod -Method Get -Uri "$baseUrl/pending" -Headers $headers
```

A missing or altered token should return HTTP `401`; the stop event should return HTTP `204` and appear in HUMHUM.

## Windows real-machine smoke test

Before sharing a Windows installer, verify it on a physical or virtual Windows 10/11 x64 machine:

- [ ] Download the NSIS artifact, install it as a standard user, and launch HUMHUM from the Start menu.
- [ ] Confirm the pet background is transparent, the pet stays above normal windows, can be dragged, and does not create a taskbar button.
- [ ] Open Settings and Hub from the tray menu, close and reopen them, then restart HUMHUM and confirm settings persist.
- [ ] Confirm `%USERPROFILE%\.humhum\local-api-token` exists; run the authenticated API example above and verify an invalid token receives `401`.
- [ ] Install and uninstall at least one Agent hook, restart that Agent, and verify task-completion events reach HUMHUM without a visible PowerShell window.
- [ ] Verify Claude, Codex, Cursor, Copilot, OpenCode, Hermes, or OpenClaw supervision needed by your workflow; `.cmd`/`.bat` tools and helper processes must not flash console windows.
- [ ] Trigger an Agent permission request and test Allow, Always Allow, Deny, and timeout behavior without leaving the Agent blocked.
- [ ] Trigger AskUserQuestion and confirm terminal focus plus answer typing works for Windows Terminal or another supported terminal.
- [ ] From a Cursor session, use Hexa's return-to-session action and confirm the matching integrated terminal is selected when its PID or workspace is unique.
- [ ] Enable Launch at Login, sign out and back in, and confirm HUMHUM starts once without opening an extra console.
- [ ] Pair the Android client over LAN, verify the displayed certificate fingerprint, inspect a redacted session, and revoke the device. If Tailscale is installed, repeat over the tailnet route.
- [ ] If OpenSSH Client is installed, connect and disconnect the SSH event bridge and confirm the tunnel process is cleaned up without a console window.
- [ ] Play and stop a voice notification using Windows system TTS, then repeat with any configured network TTS provider.
- [ ] Exercise idle, processing, speaking, waiting, completed, and error pet states; confirm the 2D renderer still appears when 3D or `OffscreenCanvas` is unavailable.
- [ ] Exit from the tray and confirm the hook server releases port `31275`; relaunch and verify it binds successfully.
- [ ] Uninstall from **Settings → Apps → Installed apps**, confirm the application is removed, and verify local data remains under `%USERPROFILE%\.humhum` as documented.

## Troubleshooting

- **`link.exe` or a Windows SDK is missing:** modify the Visual Studio Build Tools installation and add the C++ desktop workload and SDK.
- **The window is blank or WebView2 cannot start:** install or repair the WebView2 Evergreen Runtime.
- **HUMHUM cannot focus or type into an elevated terminal:** Windows UIPI blocks input from a standard-user app into an administrator process. Run the terminal at the same integrity level as HUMHUM.
- **Network TTS MP3 playback fails on Windows N/KN:** install **Media Feature Pack** from **Settings → Apps → Optional features**, or use the built-in Windows system voice (WAV) fallback.
- **Port 31275 is already in use:** close another HUMHUM instance, or change the hook server port in Settings.
- **The SSH bridge says OpenSSH is missing:** install **OpenSSH Client** from **Settings → Apps → Optional features**, then restart HUMHUM.
- **Android LAN pairing cannot connect:** allow HUMHUM through Windows Defender Firewall on private networks and confirm both devices are on the same LAN. Do not disable certificate fingerprint verification.
- **Awake Mode or the local notification bridge is unavailable:** these two upstream capabilities remain macOS-specific; Windows Launch at Login, Agent supervision, mobile pairing, relay, and notification preferences remain available.
- **A build works in CI but not locally:** confirm `node --version`, `rustc --version`, and that `rustup show active-toolchain` reports an `msvc` toolchain.
