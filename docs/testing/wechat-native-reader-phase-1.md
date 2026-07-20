# WeChat Native Reader Phase-One Evidence

Date: 2026-07-20
Implementation commit: `f1d25b4`
Platform: macOS 26.0.1 (25A362), arm64

## Toolchain

- Node.js `v23.11.0`
- npm `11.5.2`
- Go `go1.26.5 darwin/arm64`
- rustc `1.96.0`
- Cargo `1.96.0`

## Automated Results

- `go test ./...`: passed all native contract, fixture, reader, WCDB, path, and
  compatibility tests.
- `npm run native:wechat:check`: passed with 131 Go packages inspected and zero
  forbidden dependency or source boundary findings.
- `npm run test:native-boundary`: 3 passed.
- `npm test`: 38 files and 283 Vitest tests passed; 17 fixed Node tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 395 passed, 3 existing
  platform-dependent tests ignored, 0 failed.
- `npm run build`: passed; Vite transformed 3,993 modules.
- `npx tauri build --bundles app`: passed and produced
  `src-tauri/target/release/bundle/macos/HumHum.app`.

`cargo fmt --check` for the whole repository still reports formatting in
pre-existing Android relay files outside this change. Both new WeChat Rust
modules were formatted directly with Rustfmt and pass `git diff --check`.

## Reproducibility And Identity

Two consecutive `npm run native:wechat:build` runs produced the same reader
SHA-256:

`d0815b45a436e04514338436e395b540651b195e40b5e4ed226dc0faef7b2f84`

Bundled WCDB SHA-256:

`bb7602ca165d7edfff58893760f53c2df36202548422c1be517c2de23e224376`

The app contains exactly:

- `Contents/MacOS/humhum-wechat-reader`
- `Contents/Resources/wechat/libWCDB.dylib`
- `Contents/Resources/wechat/native-manifest.json`

The packaged hashes match the manifest. After applying a local outer ad-hoc
bundle seal, `codesign --verify --deep --strict` passed. This proves bundle
integrity for local testing only; it is not Developer ID signing or
notarization.

## Fixture Exercise

The generated reader was run as a one-shot process against only the committed
fictional fixture root.

- `status` returned `liveReadOk: true`.
- `sessions` returned `Fixture Team` and `Fixture Friend`; the unsupported
  fictional official account was excluded.
- `timeline(friend-alpha)` returned two incoming records and one outgoing
  record: text, image summary, and self-authored text.
- The Hush bridge test imported only the incoming text record, skipped the
  outgoing record, and advanced its local cursor.
- Repeating the same bridge sync imported zero new messages, counted one
  duplicate, and kept one inbox record.
- Auto-sync defaults to off.
- Production resolution never searches `PATH` or `~/.local` for
  `wechat-cli`.

No real wxid, message, key, salt, or user database was used.

## Runtime Inspection

A reader process was held open on stdin and inspected by exact PID:

- `lsof -nP -a -p <pid> -iTCP -iUDP`: exit 1, no socket rows.
- `nm -u`: no socket, connect, listen, accept, address-resolution, HTTP, curl,
  or TLS import matched.
- `otool -L`: `libSystem`, `libresolv`, and `CoreFoundation` only. The WCDB
  library is loaded dynamically from the verified bundle resource.

The real local status smoke test on this Mac reported:

- WeChat build `4.0.6:a15e701c68cb`
- compatibility `supported`
- WCDB available `true`
- key coverage `0/2`
- live read `false`
- blocked by `key_coverage_incomplete`

No key or message content was printed.

## Remaining Gates

- Implement and audit the one-shot key helper.
- Store only an encrypted salt-to-key map with a Keychain-backed vault key.
- Bind helper execution to explicit user action and signed release identity.
- Validate real incoming private/group messages on a disposable macOS account.
- Sign with Developer ID, notarize, and repeat bundle/socket/key-leak checks.

Until those gates pass, the product truthfully presents the reader core as
installed but keeps real-message setup disabled.
