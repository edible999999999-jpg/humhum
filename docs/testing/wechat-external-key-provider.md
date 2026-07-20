# WeChat External Key Provider Evidence

Date: 2026-07-20
Platform: macOS 26.0.1, arm64

## Fixed Inputs

- `r266-tech/wechat-cli` source commit:
  `065778319ca4a77debd265e65df913891d49ad58`
- Installed query client version: `1.6.20`
- Bundled WCDB SHA-256:
  `bb7602ca165d7edfff58893760f53c2df36202548422c1be517c2de23e224376`
- Local WeChat version: `4.0.6`
- Local WeChat executable SHA-256 prefix: `a15e701c68cb`

The alternative `huohuoer/wechat-cli` candidate was rejected because its key
scanner can print raw encryption keys and stores a broader decrypted cache.
`jackwener/wx-cli` and `ylytdeng/wechat-decrypt` were unavailable from GitHub
during this verification following DMCA takedowns, so they are not reproducible
dependencies.

## Real Local Verification

No contact name, wxid, message body, database key, or complete salt was retained
in this evidence.

- First bootstrap reached the supported shadow WeChat path but began before the
  user session entered the app, so no database key was found.
- After entering the shadow WeChat session, `wxkey setup` validated 16 of 17
  local database keys within its three-minute scan window.
- Required `session.db` and `message_0.db` keys were both validated.
- External strict-read-only status returned `live_read_ok: true`.
- External strict-read-only sessions returned 100 bounded private/group rows.
- A five-message timeline smoke test returned five non-empty message rows and
  did not print their content.
- The HUMHUM bundled reader accepted the validated map only through stdin and
  changed from key coverage `0/2` to `2/2`, with `liveReadOk: true`.

## Automated Results

- Frontend: 38 files, 283 tests passed; 17 fixed Node tests passed.
- Rust: 397 passed, 3 existing platform-dependent tests ignored, 0 failed.
- New tests prove external key configs reject broad permissions, symlinks,
  unknown schemas, and malformed entries.
- Hush bridge tests prove status, sessions, and timeline requests all receive
  the validated map without adding keys to command arguments.
- UI tests prove setup is an explicit enabled action and invokes only the
  existing Tauri setup command.

## Remaining Risk

This is a usability bridge, not the final secret design. The installed upstream
helper keeps its sudo credential in macOS Keychain and its key map in an
owner-only plaintext file. The replacement remains a HUMHUM-owned one-shot
helper plus a Keychain-backed encrypted vault.
