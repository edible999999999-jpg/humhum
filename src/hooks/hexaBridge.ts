export interface HexaHookSession {
  session_id: string;
  client_type: string;
  cwd: string | null;
  project_name: string | null;
  started_at: string;
  last_event_at: string;
  event_count: number;
  status: "active" | "idle" | "completed";
  last_hook_message: string | null;
  last_tool_name: string | null;
  recent_tools: string[];
  event_names: string[];
  has_pending_permission: boolean;
  route: {
    term_program: string | null;
    term_program_version: string | null;
    tty: string | null;
    tmux: string | null;
    tmux_pane: string | null;
    iterm_session_id: string | null;
    parent_pid: number | null;
    transport: string | null;
    remote_host: string | null;
  } | null;
}

export interface HexaBridgeApproval {
  approval_id: string;
  operation: "command" | "file_change" | "mcp_tool" | "other";
  summary: string;
  reason: string | null;
  expires_at: string | null;
}

export interface HexaBridgeSession {
  session_id: string;
  provider: string;
  provider_thread_id: string | null;
  workspace: string | null;
  project_name: string | null;
  status: "starting" | "working" | "waiting" | "idle" | "completed" | "failed" | "disconnected";
  current_turn_id: string | null;
  current_activity: string | null;
  pending_approvals: HexaBridgeApproval[];
  started_at: string;
  last_activity_at: string;
}

export interface MergedHexaSession {
  session: HexaHookSession;
  source: "hook" | "codex_bridge";
  bridge: HexaBridgeSession | null;
}

function bridgeStatus(status: HexaBridgeSession["status"]): HexaHookSession["status"] {
  if (status === "completed") return "completed";
  if (status === "idle") return "idle";
  return "active";
}

function bridgeOnlySession(bridge: HexaBridgeSession): HexaHookSession {
  return {
    session_id: bridge.session_id,
    client_type: bridge.provider,
    cwd: bridge.workspace,
    project_name: bridge.project_name,
    started_at: bridge.started_at,
    last_event_at: bridge.last_activity_at,
    event_count: 0,
    status: bridgeStatus(bridge.status),
    last_hook_message: bridge.current_activity,
    last_tool_name: null,
    recent_tools: [],
    event_names: [],
    has_pending_permission: bridge.pending_approvals.length > 0,
    route: null,
  };
}

export function mergeHexaSessions(
  hookSessions: HexaHookSession[],
  bridgeSessions: HexaBridgeSession[],
): MergedHexaSession[] {
  const mergedHooks = new Set<number>();
  const merged: MergedHexaSession[] = bridgeSessions.map((bridge) => {
    const stableThreadId = bridge.provider_thread_id ?? bridge.session_id;
    const hookIndex = hookSessions.findIndex(
      (hook, index) =>
        !mergedHooks.has(index) &&
        hook.client_type === "codex" &&
        hook.session_id === stableThreadId,
    );
    if (hookIndex < 0) {
      return { session: bridgeOnlySession(bridge), source: "codex_bridge", bridge };
    }

    mergedHooks.add(hookIndex);
    const hook = hookSessions[hookIndex]!;
    return {
      source: "codex_bridge",
      bridge,
      session: {
        ...hook,
        cwd: bridge.workspace ?? hook.cwd,
        project_name: bridge.project_name ?? hook.project_name,
        last_event_at: bridge.last_activity_at,
        status: bridgeStatus(bridge.status),
        last_hook_message: bridge.current_activity ?? hook.last_hook_message,
        has_pending_permission: bridge.pending_approvals.length > 0 || hook.has_pending_permission,
      },
    };
  });

  hookSessions.forEach((session, index) => {
    if (!mergedHooks.has(index)) {
      merged.push({ session, source: "hook", bridge: null });
    }
  });

  return merged.sort(
    (left, right) =>
      new Date(right.session.last_event_at).getTime() - new Date(left.session.last_event_at).getTime(),
  );
}
