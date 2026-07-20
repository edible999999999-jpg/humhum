# HUMHUM Native WeChat Connector Design

Date: 2026-07-20
Status: Approved direction, pending implementation plan

## Summary

HUMHUM will replace its runtime dependency on the third-party `wechat-cli`
installation with a source-controlled, bundled, local-only WeChat connector.
The connector will expose a small DWS-style JSON contract for readiness,
sessions, and message timelines while keeping database keys, administrator
authorization, and raw WeChat data outside Agent processes.

This is a controlled derivative approach:

- vendor only the audited low-level algorithms needed for macOS WeChat 4.x;
- keep HUMHUM-owned command contracts, storage, UI, and release artifacts;
- remove upstream password persistence, updater, companion server, export,
  remote access, and unattended privilege escalation;
- fail closed on unknown WeChat builds and unsupported database schemas.

The first public release remains read-only. It does not send messages, control
the WeChat UI, or expose a general SQL interface.

## Decision Context

The current proof of concept invokes an externally installed `wechat-cli`.
Source review found no message upload in the strict read paths HUMHUM uses, but
the upstream bootstrap stores a sudo password in macOS Keychain to support
unattended key refresh. That is not an acceptable long-term HUMHUM boundary.

DingTalk DWS provides the product model HUMHUM wants:

- a stable readiness and authentication contract;
- bounded, paginated, machine-readable message queries;
- an explicit login/setup flow;
- an integration that can change internally without changing Hush.

Personal WeChat does not provide an equivalent supported local API. A native
connector therefore still needs to obtain local WCDB keys and read the user's
local databases. Owning the connector improves auditability and user
experience, but does not remove the platform-level risks of process-memory
inspection, Full Disk Access, or compatibility work after WeChat updates.

## Goals

1. Bundle a real macOS arm64 WeChat reader with HUMHUM.
2. Read incoming private and group messages from the user's logged-in WeChat.
3. Match the DWS integration quality for status, setup, pagination,
   incremental sync, and actionable errors.
4. Keep all message content, key material, and derived state on the user's Mac.
5. Prevent Agents and child processes from receiving raw database keys.
6. Require an explicit user gesture for every privileged key refresh.
7. Make the high-privilege surface small enough to audit line by line.
8. Preserve the existing Hush presentation and deduplication contracts.

## Non-Goals

- Sending, replying, reacting, deleting, or editing WeChat messages.
- Automating or controlling the WeChat UI.
- Running a bot account, official account, or WeCom webhook.
- Exposing arbitrary SQL, raw XML, CDN credentials, or database paths.
- Exporting complete chat histories.
- Running a localhost HTTP server, MCP server, remote proxy, or cloud service.
- Supporting Windows in the first native release.
- Silently refreshing keys with stored administrator credentials.
- Pretending unknown WeChat versions are compatible.

## Provenance And Licensing

The audited reference sources are:

- `r266-tech/wechat-cli`, reviewed at commit
  `065778319ca4a77debd265e65df913891d49ad58`.
- `r266-tech/wxkey`, reviewed at tag `v1.4.8`, commit
  `9b70eecdde47a7172b19465c3f977c86b6050e8a`.
- Tencent WCDB, loaded locally for read-only encrypted database access.

Both R266 projects are MIT licensed. HUMHUM may modify and redistribute the
necessary source while preserving the copyright and license notices. WCDB
retains its own upstream license and third-party notice.

Copied or materially derived files must include clear provenance comments.
HUMHUM must not imply Tencent, WeChat, R266 Tech, or OpenConnector endorsement.

## OpenConnector Lessons

`oomol-lab/open-connector` does not read personal WeChat chats. Its WeChat
references cover public content search and WeCom integrations, so it cannot
solve WCDB key extraction or local message decoding.

HUMHUM will adopt these architectural patterns:

- stable, inspectable action contracts;
- credentials remain behind a runtime boundary;
- exact capability allowlists;
- encrypted-at-rest secret records with a separate encryption key;
- one-time connection/setup credentials;
- idempotent execution and bounded retries;
- redacted audit records.

HUMHUM will not adopt:

- hosted or self-hosted network gateways;
- provider proxies or arbitrary URL execution;
- dynamic action catalogs;
- OAuth and remote runtime tokens for local WeChat;
- optional plaintext credential storage;
- Node, Docker, MCP, HTTP, or Cloudflare runtime dependencies.

## Architecture

### Implementation Split

The reader and one-shot key helper will remain small Go binaries because the
audited Mach-process and WCDB reference implementations are Go, and porting
that sensitive low-level code to another language before achieving fixture
parity would add avoidable security and compatibility risk. HUMHUM will pin
the Go toolchain in development and CI and vendor/checksum native
dependencies. End users do not install Go.

Tauri orchestration, setup-session crypto, Keychain access, encrypted vault
storage, policy enforcement, and Hush integration remain in Rust. This keeps
the privileged/read-only native algorithms isolated from product state and
remote capabilities.

### 1. `humhum-wechat-reader`

An unprivileged, bundled sidecar that performs only local read operations.

Responsibilities:

- inspect compatibility and key coverage;
- load WCDB in read-only mode;
- list private and group sessions;
- read bounded message timelines;
- normalize supported message kinds into a versioned JSON envelope;
- return actionable, structured errors.

It must not contain:

- network listeners or clients;
- update or download code;
- export commands;
- write-capable database operations;
- general SQL execution;
- WeChat UI automation;
- key extraction or privilege escalation.

The process receives its request and required key material through stdin. Raw
keys never appear in arguments, environment variables, stdout, or stderr.
The process exits after each bounded request.

### 2. `humhum-wechat-key-helper`

A small, one-shot macOS helper used only for initial setup and explicit key
refresh.

Responsibilities:

- identify the supported local WeChat process and data root;
- obtain the minimum process-memory access required for key discovery;
- find candidate per-database WCDB keys;
- validate candidates against local encrypted database pages;
- return only a sealed key-map envelope;
- clean temporary state before exit.

It must not:

- save or receive the user's administrator password;
- create a root daemon or LaunchAgent;
- run in the background after setup;
- print keys or message content;
- access the network;
- write WeChat databases;
- refresh itself or download code.

### 3. Rust `WechatNativeBridge`

The Tauri backend owns all orchestration and policy.

Responsibilities:

- verify the bundled sidecar identity and release manifest;
- create and expire setup sessions;
- invoke only exact allowlisted operations;
- pass keys to the reader over stdin;
- enforce timeouts, single-flight probes, pagination, and size limits;
- normalize reader output into `HushStore` payloads;
- import only incoming messages;
- maintain the incremental cursor and overlap window;
- expose Tauri commands to Hush;
- emit redacted audit events.

The bridge will replace the current external executable discovery. A
development-only fallback may remain behind an explicit compile-time feature
until fixture parity is complete. Production builds must not discover or run
arbitrary `wechat-cli` binaries from `PATH`.

### 4. Secret Vault

HUMHUM stores a versioned, AES-256-GCM encrypted key-map envelope under:

```text
~/.humhum/wechat/keys.enc
```

The 256-bit vault key is generated locally and stored separately in macOS
Keychain under a HUMHUM-owned service name. The encrypted file is owner-only,
written atomically, and rejects symbolic links and path escapes.

The vault stores only:

- format version;
- hashed account identity;
- supported WeChat build fingerprint;
- per-database salt-to-key mapping;
- key creation and validation timestamps.

It does not store:

- the Mac administrator password;
- raw message bodies;
- full local database paths;
- exported databases;
- upstream cache snapshots.

Deleting the WeChat connection removes both the encrypted envelope and its
Keychain vault key.

### 5. Hush Integration

The connector has no independent message cache. WeChat databases remain the
source of truth. Hush imports a bounded recent window through the existing
deduplicating local store.

The initial product contract remains:

- initial window: most recent 24 hours;
- incremental overlap: 2 minutes;
- session limit: 100;
- timeline limit: 100 per session per pass;
- private and group chats only;
- incoming messages only;
- no media file copying in the first release;
- auto-sync off until the user explicitly enables it.

The Android companion can see only the projections already allowed by the
existing paired-device capability model. This connector does not add a new
remote endpoint or relay payload.

## Stable Action Contract

The sidecar supports exactly three production actions:

### `status`

Input:

```json
{"version":1,"action":"status"}
```

Output includes:

- connector version;
- WeChat build fingerprint;
- compatibility state;
- key coverage;
- WCDB availability;
- Full Disk Access state when detectable;
- next user action;
- warnings.

### `sessions`

Input:

```json
{
  "version": 1,
  "action": "sessions",
  "types": ["private", "group"],
  "limit": 100
}
```

Output contains stable talker identifiers, safe display names, conversation
kind, and latest timestamp. It does not contain message bodies.

### `timeline`

Input:

```json
{
  "version": 1,
  "action": "timeline",
  "talker": "opaque-local-talker",
  "after": 1784471400,
  "limit": 100,
  "includeMediaPaths": false
}
```

Output contains bounded normalized messages with stable local/source IDs,
timestamps, sender labels, direction, kind, and human-readable text.

Unknown actions, fields, enum values, excessive limits, option-like talker
values, and trailing input are rejected before database access.

## Privileged Setup Flow

1. The user clicks `准备微信读取` in Hush.
2. Rust creates a five-minute setup session with a random identifier and an
   ephemeral public/private encryption key pair.
3. Only the setup identifier and public key are written to an owner-only setup
   directory.
4. HUMHUM opens Terminal with an absolute command for the bundled helper.
5. Terminal uses the standard macOS `sudo` prompt. HUMHUM never reads the
   password.
6. The helper verifies:
   - the setup session is unexpired;
   - the invoking user and home directory are consistent;
   - the output path stays inside the setup directory;
   - the HUMHUM bundle and helper satisfy the release signing requirement.
7. The helper obtains and validates WCDB keys.
8. The helper encrypts the key map to the ephemeral public key and atomically
   writes a sealed result. Progress output contains no secrets.
9. Rust decrypts the result in memory, writes the encrypted vault, removes the
   setup directory, and zeroizes transient key buffers where practical.
10. The privileged process exits. No reusable root credential remains.

Cancellation, timeout, app exit, or invalid sealed output removes the setup
session and commits no keys.

## Signing And Privilege Boundary

Running a user-writable, ad-hoc signed binary through `sudo` can create a local
privilege-escalation surface. The current local HUMHUM build is ad-hoc signed
and has no Team Identifier. Therefore:

- native key extraction may be developed and tested locally with explicit
  developer warnings;
- it must not be enabled as a normal public release feature while the bundle
  is only ad-hoc signed;
- public release requires Developer ID signing and notarization of the app and
  bundled helpers;
- Rust verifies the helper CodeDirectory identity before opening Terminal;
- the elevated helper revalidates the expected Team Identifier and designated
  requirement before scanning memory;
- the release workflow records helper hashes and source provenance.

If signing requirements are not satisfied, the UI reports that the native
reader build is not trusted and does not offer privileged setup.

## Compatibility Policy

The connector maintains an explicit compatibility table keyed by:

- macOS architecture;
- WeChat version and executable fingerprint;
- known database schema family;
- WCDB ABI version.

Known builds run normally. Unknown builds:

- may run non-sensitive diagnostics;
- must not scan memory or accept cached keys as valid;
- return `unsupported_wechat_build`;
- preserve the existing vault without modifying it;
- present a clear compatibility message in Hush.

Adding a compatible build requires sanitized fixture evidence and a reviewed
compatibility entry. There is no remote kill switch and no phone-home check.

## Error Model

Errors use stable codes and safe user-facing next actions:

- `reader_not_bundled`
- `reader_identity_invalid`
- `full_disk_access_required`
- `wechat_not_running`
- `wechat_not_logged_in`
- `unsupported_wechat_build`
- `setup_expired`
- `privileged_setup_cancelled`
- `key_scan_timeout`
- `key_coverage_incomplete`
- `key_validation_failed`
- `vault_unavailable`
- `wcdb_unavailable`
- `schema_unsupported`
- `query_timeout`
- `malformed_reader_output`

Error details must not contain raw keys, message bodies, full paths, process
memory, API credentials, or command environments.

Retry behavior is bounded:

- status probes are single-flight;
- setup never retries privilege escalation automatically;
- read operations may retry once only for a transient database lock;
- unknown compatibility and key-validation failures never retry
  automatically.

## Audit Model

HUMHUM records only bounded metadata:

- action name;
- connector/build version;
- start and finish time;
- success or stable error code;
- examined/imported/duplicate counts;
- whether privileged setup was explicitly requested.

Audit records never include:

- raw action input;
- talker IDs;
- display names;
- message content;
- key or salt material;
- database paths;
- administrator credentials.

## Build And Supply-Chain Controls

The native connector source lives in the HUMHUM repository under a dedicated
directory with preserved upstream notices. Runtime installation does not curl
or download executables.

The build must:

- use a pinned toolchain in CI;
- vendor or checksum all native dependencies;
- generate an SBOM and third-party notice;
- fail when reader/helper dependencies include network packages;
- scan binaries for forbidden network, update, shell, and server symbols;
- produce deterministic action-schema snapshots;
- sign and notarize public macOS artifacts;
- publish checksums for the app, DMG, reader, helper, and WCDB library.

OpenConnector code is not required at runtime. Its patterns are adopted at the
design level; any direct Apache-2.0 code reuse must be separately attributed.

## Testing Strategy

### Unit Tests

- strict action/input allowlist;
- stable JSON envelopes and error codes;
- malformed and oversized input rejection;
- schema mapping for supported message kinds;
- incoming-only filtering;
- cursor overlap and deduplication;
- path containment and symbolic-link rejection;
- setup-session expiry and single use;
- encryption round trips and tamper rejection;
- secret redaction;
- unknown build fail-closed behavior.

### Native Fixture Tests

Use generated or irreversibly sanitized database fixtures only:

- supported encrypted WCDB page samples;
- wrong-key and partial-key coverage;
- known schema variants;
- direct and group conversations;
- text, image summary, file summary, quote, and unsupported message kinds;
- pagination and timestamp boundaries.

No real user messages, wxids, keys, salts, or databases are committed.

### Process And Security Tests

- reader receives no parent API keys or unrelated environment variables;
- key material never appears in argv, stdout, stderr, logs, crash reports, or
  audit files;
- sidecar does not open network sockets;
- repeated status polls spawn at most one reader;
- helper cannot write outside the setup directory;
- setup cancellation leaves no vault mutation;
- production setup refuses ad-hoc or mismatched signatures;
- auto-sync remains opt-in;
- removing the connection deletes local secret state.

### Integration Tests

- Hush status transitions from unavailable to setup-required to ready;
- initial 24-hour sync and incremental sync;
- duplicate suppression across overlap windows;
- unread/private/group presentation;
- UI remains responsive through timeouts and partial coverage;
- desktop build still works when native connector is unavailable;
- Android projections do not gain unrequested capabilities.

### Manual Release Gate

On a clean test Mac:

1. Install the signed/notarized DMG.
2. Confirm no external CLI or Go toolchain is required.
3. Grant only the documented macOS permissions.
4. Complete one explicit setup prompt.
5. Read a known incoming private and group message.
6. Confirm no send/reply capability exists.
7. Inspect processes, sockets, Keychain items, logs, and `~/.humhum`.
8. Reboot and confirm no privileged daemon or stored sudo credential exists.
9. Remove the connection and verify local connector secrets are gone.

## Delivery Phases

### Phase 1: Contract And Reader Core

- create the source-controlled native module;
- define schemas and fixtures;
- port read-only WCDB loading and known message parsing;
- implement `status`, `sessions`, and `timeline`;
- add no-network and provenance checks;
- keep existing external bridge available only in development.

### Phase 2: HUMHUM Secret Vault

- implement Keychain-backed vault key management;
- implement encrypted key-map storage;
- pass keys to reader through stdin;
- replace external executable discovery in production;
- integrate status and sync with Hush.

### Phase 3: One-Shot Key Helper

- port the minimum key scan and page validation logic;
- implement sealed setup sessions;
- add explicit Terminal authorization;
- implement compatibility and signing checks;
- test on supported WeChat builds.

### Phase 4: Signed Preview

- sign and notarize the app and helpers;
- run the clean-Mac release gate;
- ship as an opt-in preview with auto-sync off;
- retain a local disable/removal action.

### Phase 5: Default Local Connector

- remove the production dependency on third-party `wechat-cli`;
- publish the compatibility matrix, SBOM, checksums, and security notes;
- make the native connector the normal Hush WeChat path.

## Acceptance Criteria

The native connector is ready for a signed preview only when:

1. A clean Mac can install HUMHUM and read real incoming private and group
   messages without installing an external CLI.
2. No administrator password is stored or read by HUMHUM.
3. No key material appears in command lines, environment variables, output,
   logs, audit records, or plaintext files.
4. The reader and helper have no network capability in source and process
   tests.
5. Unknown WeChat builds fail closed.
6. Production privileged setup rejects ad-hoc and mismatched signatures.
7. The app creates no root daemon and leaves no unattended privilege path.
8. Auto-sync is off until explicitly enabled.
9. Existing Hush, DWS, Android pairing, and desktop tests continue to pass.
10. License notices, SBOM, binary hashes, signing, and notarization evidence
    are published with the release.

## Known Residual Risks

- Process-memory inspection and Full Disk Access remain sensitive operations.
- WeChat updates may invalidate key discovery or database parsing.
- A compromised user account can access data already available to that user.
- Code signing reduces helper replacement risk but does not make local
  decryption risk-free.
- This integration is not an official WeChat API and may carry compatibility
  or account-policy risk.

HUMHUM will present these limitations plainly and will not describe the
connector as risk-free or officially supported.
