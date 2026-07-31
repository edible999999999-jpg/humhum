# Tokscale Attribution

HUMHUM uses `tokscale-core` for local Codex and Claude Code transcript token
parsing.

- Project: https://github.com/junhoyeo/tokscale
- Pinned revision: `5678d0a6bc0ee3be39b09543abf373a29b33a692`
- License: MIT
- Copyright: Copyright (c) 2025 Junho Yeo

Only the local Rust parsing library is linked. HUMHUM does not call Tokscale's
leaderboard submission flow and does not upload local usage data to Tokscale.

The full MIT license text is checked in at
`docs/third-party/licenses/TOKSCALE-LICENSE.txt`.
