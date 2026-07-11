// HUMHUM_OPENCODE_PLUGIN - managed by HUMHUM.
import { readFile } from "node:fs/promises"

const endpoint = "http://127.0.0.1:__HUMHUM_PORT__/event?client=opencode"
const tokenPath = `${process.env.HOME}/.humhum/local-api-token`

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) || ""
}

function sessionID(value) {
  const properties = value?.properties || {}
  return firstString(
    value?.sessionID,
    value?.sessionId,
    properties.sessionID,
    properties.sessionId,
    properties.info?.id,
    properties.session?.id,
  )
}

async function forward(payload) {
  try {
    const token = (await readFile(tokenPath, "utf8")).trim()
    if (!token) return
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "X-HumHum-Token": token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Observability must never break an OpenCode session.
  }
}

const eventNames = {
  "session.created": "SessionStart",
  "session.idle": "Stop",
  "session.error": "PostToolUseFailure",
  // Read-only until HUMHUM can reply through OpenCode's permission API.
  "permission.asked": "Notification",
}

export const HumHum = async ({ directory }) => ({
  event: async ({ event }) => {
    const hookEventName = eventNames[event.type] || "Notification"
    await forward({
      hook_event_name: hookEventName,
      session_id: sessionID(event),
      cwd: directory,
      opencode_event: event,
    })
  },
  "tool.execute.before": async (input, output) => {
    await forward({
      hook_event_name: "PreToolUse",
      session_id: sessionID(input),
      cwd: directory,
      tool_name: input.tool,
      tool_input: output.args,
    })
  },
  "tool.execute.after": async (input, output) => {
    await forward({
      hook_event_name: "PostToolUse",
      session_id: sessionID(input),
      cwd: directory,
      tool_name: input.tool,
      tool_input: input.args,
      tool_output: output,
    })
  },
})
