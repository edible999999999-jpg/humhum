import { describe, expect, it } from "vitest";
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

describe("mergeHexaSessions", () => {
  it("combines bridge activity with matching hook evidence without dropping other agents", () => {
    const merged = mergeHexaSessions([hookCodex, hookClaude], [bridgeCodex]);
    const codex = merged.find((item) => item.session.client_type === "codex");

    expect(merged).toHaveLength(2);
    expect(codex?.bridge?.current_activity).toBe("Running tests");
    expect(codex?.session.event_count).toBe(4);
    expect(merged.some((item) => item.session.client_type === "claude-code")).toBe(true);
  });
});
