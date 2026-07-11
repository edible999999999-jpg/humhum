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

async function forward(payload, timeoutMs = 3000) {
  try {
    const token = (await readFile(tokenPath, "utf8")).trim()
    if (!token) return
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "X-HumHum-Token": token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return await response.json().catch(() => null)
  } catch {
    // Observability must never break an OpenCode session.
    return null
  }
}

function permissionTarget(event) {
  const properties = event?.properties || {}
  const permission = typeof properties.permission === "object"
    ? properties.permission
    : typeof properties.request === "object"
      ? properties.request
      : properties
  return {
    sessionID: firstString(properties.sessionID, properties.sessionId, permission.sessionID, permission.sessionId),
    permissionID: firstString(
      properties.permissionID,
      properties.permissionId,
      properties.requestID,
      properties.requestId,
      permission.id,
    ),
    title: firstString(
      permission.title,
      typeof properties.permission === "string" ? properties.permission : "",
      permission.permission,
      permission.type,
      "OpenCode permission",
    ),
    metadata: permission.metadata || properties.metadata || {},
  }
}

function humhumBehavior(response) {
  return response?.hookSpecificOutput?.decision?.behavior
}

const eventNames = {
  "session.created": "SessionStart",
  "session.idle": "Stop",
  "session.error": "PostToolUseFailure",
  "permission.asked": "PermissionRequest",
  "permission.replied": "Notification",
}

export const HumHum = async ({ directory, client }) => ({
  event: async ({ event }) => {
    const hookEventName = eventNames[event.type] || "Notification"
    const permission = event.type === "permission.asked" ? permissionTarget(event) : null
    const response = await forward({
      hook_event_name: hookEventName,
      session_id: sessionID(event),
      cwd: directory,
      tool_name: permission?.title,
      tool_input: permission?.metadata,
      opencode_event: event,
    }, permission ? 125_000 : 3000)
    if (!permission?.sessionID || !permission.permissionID) return
    const behavior = humhumBehavior(response)
    if (behavior !== "allow" && behavior !== "deny") return
    await client.postSessionIdPermissionsPermissionId({
      path: { id: permission.sessionID, permissionID: permission.permissionID },
      body: { response: behavior === "deny" ? "reject" : "once" },
    }).catch(() => undefined)
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
