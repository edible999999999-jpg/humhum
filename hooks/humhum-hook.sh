#!/bin/bash
# HumHum Hook Script
# Receives Claude Code events from stdin and forwards them to the HumHum local server.
#
# This script is installed into ~/.claude/settings.json as a hook handler.
# When Claude Code triggers an event, this script:
#   1. Reads the JSON payload from stdin
#   2. POSTs it to the HumHum hook server (localhost)
#   3. For PermissionRequest events: waits for user decision and outputs the response
#
# Environment:
#   HUMHUM_PORT - HumHum server port (default: 31275)

set -euo pipefail

HUMHUM_PORT="${HUMHUM_PORT:-31275}"
HUMHUM_URL="http://localhost:${HUMHUM_PORT}/event"
DEBUG_LOG="/tmp/humhum-hook-debug.log"

log_debug() {
  echo "[$(date '+%H:%M:%S')] $1" >> "$DEBUG_LOG"
}

# Read the JSON payload from stdin
PAYLOAD=$(cat)

if [ -z "$PAYLOAD" ]; then
  echo "Error: No payload received on stdin" >&2
  exit 1
fi

HOOK_EVENT=$(echo "$PAYLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null || echo "unknown")
log_debug "=== Hook invoked: $HOOK_EVENT ==="
log_debug "STDIN payload (first 200 chars): ${PAYLOAD:0:200}"

# Forward to HumHum server
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$HUMHUM_URL" \
  --max-time 120 \
  2>/dev/null) || {
  log_debug "curl FAILED (HumHum not running?)"
  if [ "$HOOK_EVENT" = "PermissionRequest" ]; then
    echo "Warning: HumHum not running, PermissionRequest will need manual handling" >&2
  fi
  exit 0
}

# Split response body and HTTP status code
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

log_debug "HTTP_CODE=$HTTP_CODE"
log_debug "BODY=$BODY"

# Handle response based on status code
case "$HTTP_CODE" in
  200)
    if [ -n "$BODY" ]; then
      log_debug ">>> Writing to stdout: $BODY"
      echo "$BODY"
    else
      log_debug ">>> Empty body, nothing to output"
    fi
    exit 0
    ;;
  204)
    log_debug ">>> 204 No Content"
    exit 0
    ;;
  504)
    log_debug ">>> 504 Timeout"
    echo "Warning: HumHum confirmation timed out" >&2
    exit 0
    ;;
  *)
    log_debug ">>> Unexpected HTTP $HTTP_CODE"
    echo "Warning: HumHum returned HTTP $HTTP_CODE" >&2
    exit 0
    ;;
esac
