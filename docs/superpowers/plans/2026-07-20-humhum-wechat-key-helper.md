# HUMHUM WeChat Key Helper Implementation Plan

Date: 2026-07-20
Status: Paused after a user-directed compatibility-path reprioritization

## Goal

Complete the missing local-only key path for the bundled WeChat reader:

```text
explicit setup gesture
  -> user-owned shadow WeChat copy
  -> one-shot privileged memory scan
  -> sealed setup result
  -> Keychain-backed encrypted vault
  -> reader stdin
  -> bounded Hush import
```

The implementation must not modify `/Applications/WeChat.app`, retain an
administrator password, run a privileged daemon, print database keys, or add
network capabilities.

On 2026-07-20 the user prioritized immediate local connectivity. HUMHUM added a
temporary, explicitly documented adapter for an already installed fixed-path
`wxkey` while preserving this plan as the replacement path. The compatibility
adapter does not weaken the bundled reader boundary, but its upstream Keychain
credential and plaintext `0600` key map remain known temporary risks.

## Fixed Reference

Only the following low-level algorithms are eligible for source derivation:

- `r266-tech/wxkey` commit
  `9b70eecdde47a7172b19465c3f977c86b6050e8a`
- `r266-tech/wechat-cli` commit
  `065778319ca4a77debd265e65df913891d49ad58`

`jackwener/wx-cli` is not a build or runtime dependency. Its GitHub repository
became unavailable during implementation and its broader daemon, export,
password persistence, and decrypted-cache architecture is outside HUMHUM's
security boundary.

## Tasks

1. Add failing tests for the helper request/result contract and source/binary
   boundary.
2. Vendor the minimum Mach VM, WCDB page verification, and bounded scan logic
   with preserved MIT provenance.
3. Implement a one-shot helper that reads an owner-only setup request, scans
   one exact PID and account root, validates every returned key, writes only an
   AES-GCM sealed result, and exits.
4. Extend the deterministic native build and release manifest with the helper.
5. Add a Rust setup coordinator that creates the user-owned shadow app,
   launches it, requests one macOS administrator authorization, decrypts and
   validates the sealed result, and removes setup material.
6. Store the validated key map in `~/.humhum/wechat/keys.enc`, encrypted with a
   random key kept in macOS Keychain.
7. Load the vault for every reader request and pass keys only through stdin.
8. Enable the Hush setup flow with accurate progress and recovery copy.
9. Verify fixtures, no-network gates, source and binary identity, app build,
   and a real local WeChat status/session/timeline read without printing
   private message content.
10. Commit and push the tested build.

## Exit Criteria

- Helper source and binary contain no networking, updater, listener, password
  storage, shell interpreter, or daemon capability.
- The privileged process receives no key or password via arguments,
  environment variables, stdout, or stderr.
- Unknown WeChat hashes, unexpected PIDs, unsafe paths, incomplete coverage,
  invalid envelopes, and signature/hash mismatches fail closed.
- The vault file is encrypted, owner-only, atomic, and useless without its
  separate Keychain key.
- A successful local verification proves non-zero sessions and message rows
  through the bundled reader while test logs reveal no raw keys or message
  bodies.
