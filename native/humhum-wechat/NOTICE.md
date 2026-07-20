# HUMHUM Native WeChat Reader Notices

This module is a HUMHUM-owned, local-only, read-only connector. It is not
affiliated with or endorsed by Tencent, WeChat, R266 Tech, or OpenConnector.

## R266 reference implementations

Small portions of WCDB dynamic loading, encrypted database opening,
message-table naming, zstd field decoding, and observed WeChat 4.x schema
interpretation are derived from:

- `r266-tech/wechat-cli` commit
  `065778319ca4a77debd265e65df913891d49ad58`
- `r266-tech/wxkey` commit
  `9b70eecdde47a7172b19465c3f977c86b6050e8a`

Those projects are distributed under the MIT License. The preserved license
is in `third_party/r266/LICENSE`.

HUMHUM removed the upstream network services, updater, command catalog,
write-capable database paths, backup/export paths, shell execution, password
persistence, unattended privilege escalation, and message-send capabilities.

## Tencent WCDB

The reader dynamically loads a checksum-pinned WCDB library for read-only
access to encrypted local databases. WCDB and its bundled third-party
components retain their original terms. The upstream license and component
notices are preserved verbatim in `third_party/wcdb/LICENSE`.

The expected library checksum and audited source revisions are recorded in
`third_party/manifest.json`.
