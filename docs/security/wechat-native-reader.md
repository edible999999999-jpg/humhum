# WeChat Native Reader Security Boundary

Date: 2026-07-20

## Scope

HUMHUM bundles a local macOS arm64 reader for WeChat 4.x database
compatibility. Phase 1.1 adds an explicit preview-only compatibility path that
can consume keys prepared by a separately installed `r266-tech/wxkey`. The
signed HUMHUM key-setup helper, encrypted key vault, Developer ID signing, and
notarization remain release gates.

The reader accepts one bounded JSON object on stdin, emits one versioned JSON
envelope on stdout, and exits. Production actions are exactly:

- `status`
- `sessions`
- `timeline`

There is no send, reply, export, updater, HTTP server, remote companion, shell,
or arbitrary SQL action.

## Process Boundary

- Request size is limited to 262,144 bytes.
- Unknown fields, trailing JSON, option-like talkers, negative cursors, limits
  above 100, and media-path requests are rejected before database access.
- Key material is accepted only in the stdin request. It is never put in argv,
  environment variables, logs, stdout, or stderr.
- Rust clears the child environment and restores only `HOME`, `TMPDIR`, `LANG`,
  and `LC_ALL`.
- Rust enforces a 45-second timeout, 1 MiB stdout limit, and 16 KiB stderr limit.
- Reader, WCDB, and manifest paths must be regular non-symlink files.
- Reader and WCDB SHA-256 values are checked against the bundled manifest before
  every launch.

## Database Boundary

The WCDB adapter loads only the minimum SQLite/WCDB symbols needed to open,
query, finalize, and close. It opens files read-only and enables
`PRAGMA query_only = ON`.

Allowed SQL begins with `SELECT`, or the schema-inspection form
`PRAGMA TABLE_INFO(...)`. Semicolons and SQL comments are rejected. Production
queries are fixed in source:

- bounded `SessionTable` private/group selection;
- exact table-existence lookup;
- bounded `Name2Id` sender mapping;
- bounded message rows ordered by sequence and local id.

Message table names are generated from WeChat's schema-required lowercase MD5
talker hash and must match `^Msg_[a-f0-9]{32}$`. MD5 is used only for schema
compatibility, not security. Database files must remain under the discovered
account root after symlink resolution.

## Network Boundary

The Go dependency and source gate rejects network, TLS, server, shell, updater,
and write-capable packages or symbols. The built reader imports no socket,
connect, listen, accept, HTTP, curl, or TLS symbol. A live reader held on stdin
was inspected with `lsof`; it owned no TCP or UDP socket.

The reader does not upload message bodies, identifiers, database paths, or
keys. Hush stores normalized incoming messages under `~/.humhum/` and skips
messages sent by the user.

## Provenance

The minimum WCDB compatibility implementation was reduced from audited,
fixed revisions of `r266-tech/wechat-cli` and `r266-tech/wxkey`. Exact
revisions, licenses, and the WCDB checksum are recorded in:

- `native/humhum-wechat/NOTICE.md`
- `native/humhum-wechat/third_party/manifest.json`
- `native/humhum-wechat/third_party/r266/LICENSE`
- `native/humhum-wechat/third_party/wcdb/LICENSE`

## Temporary External Key Provider

The preview setup button may execute exactly one fixed path:

```text
~/.local/share/wechat-cli/wxkey bootstrap
~/.local/share/wechat-cli/wxkey setup
```

The executable must be a regular, non-symlink file with an executable bit and
without group/other write permission. HUMHUM clears its environment, provides
only the current home/user and a fixed system `PATH`, discards stdout/stderr,
enforces an eleven-minute timeout, and never launches the third-party query
CLI. Companion, updater, export, arbitrary SQL, and network actions are not
allowlisted.

The external config is accepted only from
`~/.config/wxcli/config.json`. It must be a regular non-symlink file no larger
than 256 KiB, have no group/other permissions, use schema 2, contain at most 256
entries, and encode every salt/key as fixed lowercase hexadecimal. Validated
keys are passed only to the bundled reader through stdin.

Known temporary risks:

- upstream `wxkey bootstrap` stores a validated administrator credential in a
  wxkey-owned macOS Keychain item for later unattended refresh;
- the external key map is plaintext at rest, protected by Unix mode `0600`;
- upstream creates and ad-hoc signs a user-owned shadow WeChat copy;
- this path depends on a separately installed external binary that HUMHUM does
  not yet bundle or notarize.

HUMHUM does not modify `/Applications/WeChat.app`, print the imported keys, or
use the external query/daemon surfaces. Users who do not accept these temporary
tradeoffs can leave real-history setup disabled and continue using the
notification preview bridge.

## Still Excluded

The bundled reader does not scan process memory, use `sudo`, alter WeChat,
persist keys, start a background privileged process, or expose WeChat data to
Android or HUMHUM Anywhere. Those operations, where needed for the compatibility
preview, remain outside the reader in the explicitly invoked external helper.

The local test bundle is ad-hoc signed for validation only. Ad-hoc signing is
not the Developer ID and notarization gate required for a preview release.
