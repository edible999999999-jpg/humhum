# macOS Awake Mode Design

## Goal

Add an explicit pet skill named "Awake Mode" / "不眠模式" that keeps the Mac display awake and prevents idle system sleep while enabled.

## User Experience

- Settings shows a card beside Rage Mode with the command "陪我守夜".
- The mode is off by default and takes effect immediately when toggled.
- While enabled, HUMHUM reports a calm active state and emits a pet heartbeat every three minutes.
- Closing HUMHUM, disabling the mode, or losing the HUMHUM process releases the assertion.
- Lid close, explicit Lock Screen, and explicit Sleep remain under macOS control.

## Architecture

`WakeGuardState` owns one `/usr/bin/caffeinate` child process. It starts the child with `-d -i -w <HUMHUM_PID>` so display idle sleep and system idle sleep are blocked only while the HUMHUM process exists. Starting is idempotent, stopping kills and reaps the child, and status detects unexpected child exit.

Tauri exposes typed status and set-enabled commands. The setting persists as `ui.awake_mode`; startup restores it only when the user previously enabled it. A three-minute backend interval emits `humhum://awake-mode-pulse` while active so the pet can visibly acknowledge the skill without synthesizing input.

## Safety

- No mouse or keyboard events are generated.
- No `pmset` or permanent system preference is changed.
- Only one caffeinate child may exist.
- The child watches the HUMHUM PID and cannot intentionally outlive the app.
- Unsupported platforms return an unavailable status instead of failing app startup.

## Verification

- Unit tests cover argument construction, idempotent enable, and disable.
- Rust and frontend builds must pass.
- On macOS, `pmset -g assertions` must show the HUMHUM/caffeinate display and idle-sleep assertions while enabled and remove them after disable.
