# HUMHUM Competitive Parity Report

Updated: 2026-07-12

Status meanings:

- Complete: verified end to end in HUMHUM.
- Partial: a useful path works, but the competitor has broader coverage.
- Missing: no production path exists yet.

## Ping Island

| Capability | Status | HUMHUM evidence / next gap |
| --- | --- | --- |
| Live Claude/Codex supervision | Complete | Claude hooks plus Codex app-server sessions feed Hexa and the pet. |
| Waiting-first attention view | Complete | Hexa orders waiting, stalled/looping, working, idle, then completed; recency breaks ties. |
| Approve/deny and questions | Complete | Claude hook requests, Codex app-server approvals, and OpenCode `permission.asked` decisions are session scoped. OpenCode replies through its official permission API and preserves the native prompt when HUMHUM is unavailable. |
| Exact jump back | Partial | Hook captures terminal, PID, TTY, tmux pane and iTerm session. Hexa can select an exact tmux pane, iTerm session, allow-listed Terminal.app TTY, Codex desktop task, or a Cursor integrated terminal verified by a one-time extension receipt. At safe Ghostty event boundaries, a uniquely matched workspace is now persisted as its stable terminal ID and later focused directly; unique-workspace fallback remains. Exact Cursor chat selection is still missing. |
| Follow-up from supervisor | Partial | Codex app-server plus known local Claude Code and OpenCode sessions accept follow-ups through provider-scoped durable queues with retry-preserved text. CLI transports use stable session IDs, verified workspaces and noninteractive resume commands; generic terminal typing remains disabled because an unverified target is unsafe. |
| Completion and attention notifications | Complete | Pet overlays and sounds remain ambient, while native macOS notifications can be enabled independently for approvals, questions, completions, and ordinary Agent messages. Legacy configs migrate with all four enabled. |
| Transcript backfill | Complete | Local Codex JSONL and Claude stats/readouts feed history and summaries. |
| Broad client coverage | Partial | Managed profiles include Claude Code, Codex, Qwen Code, Gemini CLI, Kimi, QoderWork, Qoder, CodeBuddy, WorkBuddy, Cursor, GitHub Copilot CLI, OpenCode, Hermes Agent and OpenClaw; local Pi and Wukong watchers also exist. OpenClaw 2026.3.13, Copilot, Cursor 3.10.20 and OpenCode 1.17.18 have installed runtime evidence; Hermes lifecycle/progress delivery is protocol-smoke verified. Deep OpenClaw tool hooks, Hermes/OpenClaw follow-ups and remote variants remain incomplete. |
| SSH remote bridge | Partial | Settings can bootstrap Claude hooks over an already trusted, key-only SSH connection and receive events through a loopback-only reverse tunnel. The remote credential is event-only, stored separately from the local API token, and revoked locally on disconnect. A real remote-host smoke test and multi-host management are still missing. |
| Custom sound packs and per-agent mascot | Complete | HUMHUM imports and auto-discovers OpenPeon/CESP packs with five event categories, previews, per-event controls and built-in fallback. Humi now follows the most recently active Agent with a distinct brand theme and badge across 2D/3D rendering, while Settings supports per-Agent appearance overrides and reset-all. |
| Launch at login | Complete | Settings exposes the native macOS LaunchAgent switch and always reads back system state. Runtime verification created `HumHum.plist` with `RunAtLoad=true`, then disabled it and confirmed clean removal. |

## Happy

| Capability | Status | HUMHUM evidence / next gap |
| --- | --- | --- |
| Remote Codex from phone | Partial | Official Codex Remote Control can pair ChatGPT mobile. HUMHUM Mobile Web now shows redacted local Codex, Claude and OpenCode sessions, resolves scoped approvals, and sends provider-verified follow-ups through the same durable ordered queues as Hexa. Internet access remains missing. |
| iOS, Android and web clients | Partial | A responsive HUMHUM Mobile Web page works on the same LAN over HTTPS after explicit one-time read or control pairing. The first visit must trust the generated certificate and can verify its SHA-256 fingerprint in Hexa. Native iOS/Android packaging and internet access remain missing. |
| End-to-end encrypted relay | Missing | No HUMHUM internet relay exists; an unauthenticated LAN shortcut will not be shipped. |
| Self-hosted relay | Missing | Requires protocol, identity, storage and deployment work. |
| Ordered/retryable outgoing messages | Partial | Desktop and mobile Codex, Claude and OpenCode follow-ups use an owner-only persistent queue with strict per-provider/session order, crash recovery, explicit queued/delivered/failed receipts, and retry/discard controls. Future internet transports do not use the queue yet. |
| Push notifications | Missing | Native Mac notifications exist, but no APNs/FCM/Web Push path. |
| Multi-machine sessions | Missing | Local multi-agent sessions work on one Mac; there is no machine registry or presence protocol. |
| Mobile permission controls | Partial | A separately paired control device can inspect bounded Codex, Claude and OpenCode approval summaries and allow once or deny; read-only devices receive 403 and never receive action summaries. Internet delivery remains missing. |
| Voice control | Partial | HUMHUM has local STT/TTS and voice commands, but voice is not connected to a remote session client. |
| Attachments and file review | Partial | Hexa now loads a session-bound local Git change summary on demand: branch, staged/unstaged/untracked state, relative paths, binary markers, and bounded insertion/deletion totals. It never returns absolute paths or source text. Full patch reading, image/file attachments, and encrypted remote review remain missing. |

## HUMHUM Advantages To Preserve

- Humi interprets local activity into user profile, preferences, memory suggestions and next steps.
- Hype indexes local skills, rules, memories, Obsidian notes and agent assets.
- Hush provides a user-approved read-only macOS notification bridge for personal messages.
- The desktop pet, local voice, rage mode and awake mode make supervision ambient instead of dashboard-only.

## Current Verified Tranche

- Hook route enrichment uses structured JSON serialization and refreshes on app startup.
- Session route data merges without later empty events erasing exact identifiers.
- tmux pane targets are allow-listed before direct process invocation.
- Hexa has a stable crosshair action for returning to the originating session.
- Intervention drafts survive failure and clear only after successful Codex, Claude or OpenCode delivery.
- Codex, Claude and OpenCode interventions persist under `~/.humhum/intervention-queue.json`, preserve provider-scoped session order, recover interrupted sends as retryable failures, and never silently auto-repeat after a crash.
- The localhost API now requires an owner-only token for private data and control routes, disables browser CORS, and keeps only `/health` public.
- Hook debug logging no longer records message payloads and uses owner-only file permissions.
- HUMHUM Mobile Web is explicitly enabled, TLS-only, protected by an expiring eight-character pairing challenge with a five-attempt lockout, and exposes redacted read-only session summaries.
- Mobile device credentials are 64-character random tokens; only SHA-256 digests persist in an owner-only store, and Hexa can revoke all paired devices.
- Runtime mobile verification: Wi-Fi HTTPS URL returned 200, unpaired/wrong tokens returned 401, pairing succeeded, 23 sessions loaded, and neither local paths nor a private message sentinel appeared in the response.
- Launch at Login uses Tauri's native LaunchAgent backend. Enable/status/disable were verified against `~/Library/LaunchAgents/HumHum.plist`; the development-path test entry was removed afterward.
- Cursor uses its current flat `~/.cursor/hooks.json` protocol, Copilot uses a versioned user-level `~/.copilot/hooks/humhum.json`, and OpenCode receives a managed global TypeScript plugin without embedded credentials.
- Hermes Agent now receives an explicitly enabled, HUMHUM-owned plugin at `~/.hermes/plugins/humhum`. Its official CLI-and-Gateway plugin hooks map session start/reset/finalize, user turns, tool start/result, model response and stop into the existing Hexa event model without returning block or context-injection decisions.
- Hermes installation writes only marked `plugin.yaml` and `__init__.py` files, uses atomic same-directory replacement, requires both marked files for connected status, and refuses to remove an unmarked plugin. Delivery reads the current owner-only HUMHUM token and port at runtime, targets only `127.0.0.1`, times out after one second, and uses one FIFO background worker so events remain ordered without delaying Hermes.
- Generated Hermes Python passed syntax compilation. A temporary authenticated HTTP smoke imported the generated plugin, registered all eight callbacks and received ordered `SessionStart`, prompt, tool start, tool failure, model message, stop and `SessionEnd` envelopes with the expected `hermes-` session prefix and workspace. Hermes itself is not installed on this Mac, so this is protocol-level runtime evidence rather than a live model turn; follow-up command delivery is not claimed.
- OpenClaw supervision now installs an owner-marked internal hook at `~/.openclaw/hooks/humhum-openclaw` and merges only `hooks.internal.entries.humhum-openclaw.enabled=true` into the existing config. It subscribes to the official `command`, `message` and `session` families, mapping new/reset/stop, message receive/send, compaction and patch events into Hexa without typed interception powers.
- The generated OpenClaw TypeScript handler runs through a single Promise queue, reads the current HUMHUM port/token at delivery time, posts only to `127.0.0.1`, skips unknown events and missing session IDs, and returns no policy decision. A Node runtime smoke received seven ordered authenticated envelopes and confirmed that a malformed first event produced no session.
- OpenClaw 2026.3.13 is installed locally. After the real HUMHUM install path ran against `~/.openclaw`, `openclaw hooks info humhum-openclaw --json` reported source `openclaw-managed`, all three event families, `eligible:true`, `disabled:false`, and no missing requirements; `openclaw hooks check --json` reported all five discovered hooks eligible. The Gateway remained stopped and was not restarted for testing. A pre-install config backup and recursive semantic comparison confirmed all non-HUMHUM configuration remained unchanged. Install/uninstall tests also prove a config with no prior hook parents is restored exactly.
- Cursor 3.10.20 was detected at `/Applications/Cursor.app`. HUMHUM installed nine user-level steps including `preCompact`; Cursor's own hook-service log reported `Loaded 9 user hook(s)` with the full step list.
- Cursor payload normalization now promotes `conversation_id` to stable `session_id` and the first `workspace_roots` entry to `cwd` without replacing already normalized fields. A real installed hook command accepted a synthetic Cursor request as session `cursor-smoke-20260712-b` and the HUMHUM endpoint returned HTTP 200 without logging its prompt.
- Managed Cursor hooks now install a minimal MIT-licensed `humhum.session-focus` URI extension. It matches integrated terminals using the captured parent PID, allow-listed TTY and canonical workspace, refuses tied/zero-score matches, and reports exact focus only after the extension writes an owner-scoped one-time receipt.
- Cursor's shared-process log confirmed the external extension was added to the default profile, and its extension-host process was running. With no integrated terminal open on the locked desktop, a negative URI smoke produced no receipt, confirming that workspace activation alone cannot create a false exact-focus result; positive terminal focus remains unit/build verified until an integrated terminal is available.
- OpenCode 1.17.18 is installed from its official npm package. Its resolved config reported the managed global TypeScript plugin, and a zero-cost official server `POST /session` smoke emitted a real `SessionStart` with the expected session ID, workspace, runtime token and OpenCode user agent; the disposable session was deleted afterward.
- OpenCode `permission.asked` now blocks through HUMHUM's existing scoped pending channel for up to 125 seconds, then maps allow/deny to the official `once`/`reject` session permission API. Missing HUMHUM responses leave OpenCode's native prompt intact instead of guessing.
- Runtime OpenCode permission verification used the listed free `north-mini-code-free` model with `bash: ask`: allow returned HTTP 200 through HUMHUM and completed `printf humhum-approval-ok`; deny produced OpenCode's user-rejected tool error and did not create the sentinel file. Both sessions, the temporary server and pending requests were removed.
- OpenCode follow-ups now use `opencode run --session <stable-id> --format json -- <message>` only for HUMHUM-known local sessions and canonical workspaces. A runtime transport smoke created a free, zero-cost session, received `OPENCODE-FIRST`, resumed the same ID and received `OPENCODE-RESUMED`, then deleted the disposable session.
- `session.deleted` now maps to `SessionEnd`, preventing removed OpenCode sessions from remaining as live Hexa cards. The installed global plugin was refreshed after verification.
- OpenCode `Stop`/`TaskCompleted` events now leave a session idle; only `SessionEnd` moves it to history. This prevents an ordinary completed turn from producing both live and completed Hexa cards.
- OpenCode follow-up completion is accepted only after a matching `step_finish` JSON event. The child receives the canonical workspace as both its process directory and `PWD`, then is reaped after completion; this fixes the orphaned CLI process observed when mobile follow-up inherited HUMHUM's repository `PWD`.
- Mobile Web now uses one provider-aware follow-up endpoint for Codex, Claude and OpenCode while retaining the legacy Codex route. Runtime HTTPS verification resumed the same OpenCode session, returned `delivered` in six seconds, persisted the new user message, emptied the durable queue, and left no child process. The free model answered from stale context, so transport and model-content correctness are reported separately.
- A synthetic Copilot CLI camelCase event passed through the installed shell hook and appeared as a normalized `github-copilot` session; its private prompt did not appear in the mobile summary.
- Cursor sessions now route through the verified `com.todesktop.230313mzl4w4u92` bundle and their existing absolute workspace path; invalid or missing paths are rejected before launching.
- The SSH bridge validates targets before process launch, requires an existing known-host entry and SSH key, binds both sides of the reverse tunnel to loopback, and authorizes its separate SHA-256 credential only for `/event`.
- Remote Claude installation replaces only HUMHUM-managed hook entries, preserves other hooks, labels incoming sessions with their SSH host, and revokes ingress immediately when disconnected or when tunnel exit is observed.
- SSH bridge limitation: no suitable second host was available for a real remote smoke test; installer, argument boundaries, authorization scope, replacement behavior, and disconnect revocation are covered locally.
- Mobile pairing now records an explicit `read` or `control` scope. Existing device records migrate to read-only, read devices cannot see approval summaries or message controls, and only control credentials reach Codex action routes.
- Mobile Codex follow-ups use the desktop durable intervention queue. Runtime HTTPS verification returned `control` and `read` scopes, control approval reached Codex and returned 409 for a synthetic missing item, read approval returned 403, control malformed message reached parsing with 400, read message returned 403, and revoked tokens returned 401.
- Hexa lists paired devices without exposing token digests, shows each device's read/control scope, and can revoke one device without invalidating the others; revoke-all remains available.
- Native macOS notification preferences are independently configurable for approvals, questions, completions, and ordinary Agent messages without hiding the corresponding desktop-pet activity.
- Settings now imports local folders containing `openpeon.json` and auto-discovers packs under `~/.openpeon/packs` and `~/.claude/hooks/peon-ping/packs`. HUMHUM supports `task.acknowledge`/`session.start`, `input.required`, `task.complete`, `task.error`, and `resource.limit` with `.wav`, `.mp3`, and `.ogg` files.
- Sound pack access is backend-controlled: fixed event names select files, manifest and audio paths are canonicalized under the chosen directory, traversal and escaping symlinks are rejected, and malformed or incomplete packs fall back to the built-in HUMHUM sound instead of going silent.
- `PostToolUseFailure` is now a first-class frontend hook event. Ordinary failures play the error category, while rate, quota, context, usage, token, and resource exhaustion use `resource.limit`.
- Humi now resolves its appearance from the Agent that produced the latest event. Fifteen built-in HUMHUM themes cover the managed clients plus Pi and Wukong; unknown clients safely retain the base Humi appearance.
- Agent appearance overrides persist in `~/.humhum/config.json`. Settings can keep each Agent's automatic theme, assign any other HUMHUM theme, or reset all overrides; the same resolver drives both 2D and 3D badge identity.
- Awake Mode now combines persistent display/system idle assertions with a five-second `UserIsActive` pulse every 120 seconds, restores from saved config, and restarts its long-lived guard if that child exits unexpectedly.
- Runtime power verification observed the persistent `PreventUserIdleDisplaySleep` and `PreventUserIdleSystemSleep` assertions plus pulse PID 94482 reporting `UserIsActive` with a five-second timeout in `pmset`.
- Claude pending permissions are projected to control-scoped mobile devices with full paths reduced to file names. Decisions reuse the desktop pending channel instead of a second execution path.
- Runtime Claude mobile verification showed `Edit · secret-mobile.txt` without a `/Users` path, returned HTTP 200 for deny, and the blocked hook received `behavior: deny`; the test device was then revoked.
- Hexa now resumes a known local Claude Code session through the installed Claude 2.1.185 CLI using its stable UUID and canonical workspace. Messages are argument-separated after `--`, use `dontAsk` noninteractive mode, and remain retryable in the durable queue on timeout, launch failure, or nonzero exit. The command shape and queue lifecycle are unit/build verified; no paid live Claude turn was sent during automated verification.
- Terminal.app routes now normalize only `ttys` plus digits, reject script input, and select the matching AppleScript tab before activating the window. A locked Mac prevented the temporary real-tab smoke test, so this remains unit/build verified rather than runtime verified.
- Ghostty 1.3+ routes now ask its native AppleScript API for terminals whose working directory matches the session's canonical workspace. HUMHUM focuses only when exactly one terminal matches; ambiguity or Automation failure falls back to ordinary app activation instead of guessing. Workspace data is passed through a child-process environment variable rather than interpolated into AppleScript.
- Ghostty 1.3 exposes terminal ID, name and working directory but not child PID or TTY through AppleScript. HUMHUM now captures a stable terminal ID only on `SessionStart` or `UserPromptSubmit` when exactly one terminal has the canonical workspace, preserves that ID across later events, and focuses it before trying workspace fallback. IDs and paths cross the AppleScript boundary through environment variables. Ghostty was not running during final verification, so the live focus action remains unit/build verified.
- Happy's current app exposes an experimental file-diffs sidebar. HUMHUM now provides a privacy-bounded first layer directly in Hexa: an explicit disclosure invokes a session-scoped Tauri command, which runs NUL-delimited Git porcelain/numstat commands with separated arguments, `GIT_OPTIONAL_LOCKS=0`, five-second timeouts, and an 80-file limit.
- Session change summaries reject unknown sessions and missing workspaces, never return absolute paths or file bodies, merge staged and unstaged line counts, flag binary files without reading them, and preserve loaded results while the disclosure is closed. A real temporary Git repository verified staged and untracked files plus relative-path-only output.
- Runtime UI limitation: the latest development binary restarted successfully, but its menu-bar/transparent launch had no visible Hub window during automated screenshot capture. The disclosure layout is TypeScript-build verified; interactive visual QA remains pending until the Hub can be opened on the desktop.
- The release arm64 `HumHum.app` built successfully. Because the locked desktop stalled only Tauri's decorative DMG Finder layout, a standard compressed read-only DMG was generated directly, verified by `hdiutil`, mounted, and its contained app passed strict deep code-sign verification.
- Local release artifact: `src-tauri/target/release/bundle/dmg/HumHum_0.1.0_aarch64.dmg` (43 MB), SHA-256 `01dd56b6b9368ee007b970e291ef181136718aff57b38dc38c4b2e07e6816530`. It includes OpenClaw and Hermes Agent supervision/identity alongside provider-aware mobile follow-ups, OpenCode completion reliability, Ghostty terminal-ID routing, privacy-bounded session change summaries, permissions, sounds, themes, and wake guard. The DMG passed `hdiutil verify`; its read-only mounted app passed strict deep ad-hoc signature verification and contains a thin arm64 executable. It is not Developer ID signed or notarized, so it is not yet a frictionless public download.
- Rust: 116 passed, 3 ignored. Frontend: 25 passed across 13 files. Production frontend build: passed.

## Next Iteration Order

1. Add exact IDE chat routing where the host exposes a stable conversation command, then evaluate OpenClaw typed tool hooks without widening default privileges.
2. Real-host SSH smoke testing, multi-host presence, reconnect controls, and remote cleanup.
3. Extend durable follow-up and permission replies to Hermes and other verified transports.
4. Internet E2EE relay, push, attachments and multi-machine presence.

## Competitor Sources

- Ping Island current feature and OpenPeon/CESP sound-pack documentation: <https://github.com/erha19/ping-island>
- Happy architecture, remote clients, E2EE relay and self-hosting documentation: <https://happy.engineering/docs/>
- OpenCode plugin events, permissions and server API: <https://opencode.ai/docs/plugins/>, <https://opencode.ai/docs/server/>
- Hermes Agent official plugin and hook documentation: <https://hermes-agent.nousresearch.com/docs/developer-guide/plugins>, <https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks>
- OpenClaw official internal and typed plugin hook documentation: <https://docs.openclaw.ai/automation/hooks>, <https://docs.openclaw.ai/plugins/hooks>
