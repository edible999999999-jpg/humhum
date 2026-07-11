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
HUMHUM_CLIENT="${HUMHUM_CLIENT:-}"
HUMHUM_EVENT="${HUMHUM_EVENT:-}"
HUMHUM_REMOTE_HOST="${HUMHUM_REMOTE_HOST:-}"
DEBUG_LOG="${HUMHUM_DEBUG_LOG:-/tmp/humhum-hook-debug.log}"
TOKEN_FILE="${HUMHUM_TOKEN_FILE:-${HOME}/.humhum/local-api-token}"
touch "$DEBUG_LOG" 2>/dev/null || true
chmod 600 "$DEBUG_LOG" 2>/dev/null || true

while [ "$#" -gt 0 ]; do
  case "$1" in
    --client)
      HUMHUM_CLIENT="${2:-}"
      shift 2
      ;;
    --client=*)
      HUMHUM_CLIENT="${1#--client=}"
      shift
      ;;
    --event)
      HUMHUM_EVENT="${2:-}"
      shift 2
      ;;
    --event=*)
      HUMHUM_EVENT="${1#--event=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ -n "$HUMHUM_CLIENT" ]; then
  HUMHUM_URL="http://localhost:${HUMHUM_PORT}/event?client=${HUMHUM_CLIENT}"
else
  HUMHUM_URL="http://localhost:${HUMHUM_PORT}/event"
fi

log_debug() {
  echo "[$(date '+%H:%M:%S')] $1" >> "$DEBUG_LOG"
}

# Read the JSON payload from stdin
PAYLOAD=$(cat)

if [ -z "$PAYLOAD" ]; then
  echo "Error: No payload received on stdin" >&2
  exit 1
fi

# Capture the route back to the exact terminal session. Hook stdin is a pipe, so
# ask the parent process for its controlling TTY and keep environment hints too.
PARENT_TTY=$(ps -p "$PPID" -o tty= 2>/dev/null | xargs || true)
PAYLOAD=$(printf '%s' "$PAYLOAD" | \
  HUMHUM_PARENT_TTY="$PARENT_TTY" HUMHUM_PARENT_PID="$PPID" HUMHUM_EVENT="$HUMHUM_EVENT" HUMHUM_REMOTE_HOST="$HUMHUM_REMOTE_HOST" python3 -c '
import json, os, sys

payload = json.load(sys.stdin)
event_name = os.environ.get("HUMHUM_EVENT", "").strip()
if event_name and not payload.get("hook_event_name"):
    payload["hook_event_name"] = event_name

for source, target in (
    ("sessionId", "session_id"),
    ("toolName", "tool_name"),
    ("toolArgs", "tool_input"),
):
    if target not in payload and source in payload:
        payload[target] = payload[source]
route = payload.get("route") if isinstance(payload.get("route"), dict) else {}

def put(name, value):
    if value is not None:
        value = str(value).strip()
    if value:
        route[name] = value

put("term_program", os.environ.get("TERM_PROGRAM"))
put("term_program_version", os.environ.get("TERM_PROGRAM_VERSION"))
put("tty", os.environ.get("HUMHUM_PARENT_TTY"))
put("tmux", os.environ.get("TMUX"))
put("tmux_pane", os.environ.get("TMUX_PANE"))
put("iterm_session_id", os.environ.get("ITERM_SESSION_ID"))
remote_host = os.environ.get("HUMHUM_REMOTE_HOST", "").strip()
if remote_host:
    route["transport"] = "ssh"
    route["remote_host"] = remote_host

parent_pid = os.environ.get("HUMHUM_PARENT_PID", "").strip()
if parent_pid.isdigit():
    route["parent_pid"] = int(parent_pid)

if route:
    payload["route"] = route
json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
')

HOOK_EVENT=$(echo "$PAYLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null || echo "unknown")
SESSION_ID=$(echo "$PAYLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || echo "unknown")
log_debug "=== Hook invoked: $HOOK_EVENT ==="
log_debug "Client: ${HUMHUM_CLIENT:-default}"
log_debug "Session: ${SESSION_ID:-unknown}"

# Forward to HumHum server
HUMHUM_TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\r\n' || true)
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-HumHum-Token: ${HUMHUM_TOKEN}" \
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
    if [ "$HOOK_EVENT" = "PermissionRequest" ] && [ -n "$BODY" ]; then
      log_debug ">>> Writing to stdout: $BODY"
      echo "$BODY"
    else
      log_debug ">>> No hook output needed"
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
