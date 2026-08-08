#!/usr/bin/env bash
# Regenerate the standalone token-dashboard data snapshot from tokscale.
#
# The dashboard (design-qa-assets/token-dashboard.html) is a STATIC snapshot —
# it cannot call tokscale itself, so its numbers are frozen at generation time.
# Re-run this whenever you want fresh audit data, including today's hourly
# breakdown.
#
# Usage: scripts/gen-token-dashboard.sh
set -euo pipefail

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/design-qa-assets"
GRAPH_JSON="$(mktemp)"
HOURLY_JSON="$(mktemp)"
trap 'rm -f "$GRAPH_JSON" "$HOURLY_JSON"' EXIT

echo "→ tokscale graph (full range)…"
npx tokscale@latest graph --output "$GRAPH_JSON" >/dev/null 2>&1

echo "→ tokscale hourly --today…"
npx tokscale@latest hourly --today --json >"$HOURLY_JSON" 2>/dev/null

echo "→ building token-dashboard-data.js…"
node "$(dirname "$0")/build-token-dashboard-data.mjs" \
  "$GRAPH_JSON" "$HOURLY_JSON" "$OUT_DIR"

echo "✓ done. Open design-qa-assets/token-dashboard.html"
