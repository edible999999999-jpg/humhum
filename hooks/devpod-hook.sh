#!/bin/bash
# DevPod Hook Script
# Receives Claude Code events from stdin and forwards them to the DevPod local server.
#
# This script is installed into ~/.claude/settings.json as a hook handler.
# When Claude Code triggers an event, this script:
#   1. Reads the JSON payload from stdin
#   2. POSTs it to the DevPod hook server (localhost)
#   3. For PermissionRequest events: waits for user decision and outputs the response
#
# Environment:
#   DEVPod_PORT - DevPod server port (default: 31275)

set -euo pipefail

DEVPod_PORT="${DEVPod_PORT:-31275}"
DEVPod_URL="http://localhost:${DEVPod_PORT}/event"
DEBUG_LOG="/tmp/devpod-hook-debug.log"

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

# Forward to DevPod server
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$DEVPod_URL" \
  --max-time 120 \
  2>/dev/null) || {
  log_debug "curl FAILED (DevPod not running?)"
  if [ "$HOOK_EVENT" = "PermissionRequest" ]; then
    echo "Warning: DevPod not running, PermissionRequest will need manual handling" >&2
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
    echo "Warning: DevPod confirmation timed out" >&2
    exit 0
    ;;
  *)
    log_debug ">>> Unexpected HTTP $HTTP_CODE"
    echo "Warning: DevPod returned HTTP $HTTP_CODE" >&2
    exit 0
    ;;
esac
