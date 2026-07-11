import { mergeHexaSessions, type HexaBridgeSession, type HexaHookSession } from "./hexaBridge";

const hookCodex: HexaHookSession = {
  session_id: "codex-thread",
  client_type: "codex",
  cwd: "/tmp/demo",
  project_name: "demo",
  started_at: "2026-07-11T00:00:00Z",
  last_event_at: "2026-07-11T00:01:00Z",
  event_count: 4,
  status: "active",
  last_hook_message: null,
  last_tool_name: "Bash",
  recent_tools: ["Bash"],
  event_names: ["PreToolUse"],
  has_pending_permission: false,
};

const hookClaude: HexaHookSession = {
  ...hookCodex,
  session_id: "claude-thread",
  client_type: "claude-code",
};

const bridgeCodex: HexaBridgeSession = {
  session_id: "codex-thread",
  provider: "codex",
  provider_thread_id: "codex-thread",
  workspace: "/tmp/demo",
  project_name: "demo",
  status: "working",
  current_turn_id: "turn-1",
  current_activity: "Running tests",
  pending_approvals: [],
  started_at: "2026-07-11T00:00:00Z",
  last_activity_at: "2026-07-11T00:02:00Z",
};

const merged = mergeHexaSessions([hookCodex, hookClaude], [bridgeCodex]);
console.assert(merged.length === 2);
console.assert(merged.find((item) => item.session.client_type === "codex")?.bridge?.current_activity === "Running tests");
console.assert(merged.find((item) => item.session.client_type === "codex")?.session.event_count === 4);
console.assert(merged.find((item) => item.session.client_type === "claude-code") !== undefined);
