import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentStats } from "@/types";

export interface HexaSession {
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
}

export interface HexaAlert {
  session_id: string;
  type: "stalled" | "looping" | "permission" | "low_signal";
  message: string;
}

export interface HexaMemoryLocation {
  label: string;
  path: string;
  exists: boolean;
  description: string;
}

export interface HexaSupervisorNote {
  tone: "good" | "watch" | "neutral";
  text: string;
}

export interface HexaSupervisorSession {
  session: HexaSession;
  display_name: string;
  agent_label: string;
  priority: "primary" | "compatible";
  progress_status: "working" | "waiting" | "looping" | "stalled" | "idle" | "completed";
  progress_label: string;
  progress_detail: string;
  loop_status: "clear" | "watch" | "looping";
  pending_confirmations: number;
  memory_locations: HexaMemoryLocation[];
  strong_outputs: HexaSupervisorNote[];
  watchouts: HexaSupervisorNote[];
  stats: AgentStats | null;
  alerts: HexaAlert[];
  last_seen_ms: number;
}

const PRIMARY_CLIENTS = new Set(["claude-code", "codex"]);

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  qoderwork: "QoderWork",
  "qwen-code": "Qwen Code",
  "gemini-cli": "Gemini CLI",
  "kimi-k1": "Kimi K1",
  wukong: "Wukong",
};

const MEMORY_PATHS: Record<string, HexaMemoryLocation[]> = {
  "claude-code": [
    {
      label: "Claude projects",
      path: "~/.claude/projects",
      exists: true,
      description: "Local JSONL transcripts used for Claude Code usage and replay.",
    },
    {
      label: "Claude rules",
      path: "CLAUDE.md / AGENTS.md",
      exists: true,
      description: "Project instructions that shape each coding turn.",
    },
  ],
  codex: [
    {
      label: "Codex sessions",
      path: "~/.codex/sessions",
      exists: true,
      description: "Local JSONL sessions used for Codex progress and token stats.",
    },
    {
      label: "Codex instructions",
      path: "AGENTS.md / ~/.codex",
      exists: true,
      description: "Repo and user-level guidance read before implementation.",
    },
  ],
};

function detectAlerts(session: HexaSession): HexaAlert[] {
  const alerts: HexaAlert[] = [];

  if (session.has_pending_permission) {
    alerts.push({
      session_id: session.session_id,
      type: "permission",
      message: "等待用户确认",
    });
  }

  if (session.status !== "completed") {
    const lastEventTime = new Date(session.last_event_at).getTime();
    if (Date.now() - lastEventTime > 5 * 60 * 1000) {
      alerts.push({
        session_id: session.session_id,
        type: "stalled",
        message: "超过 5 分钟无新事件",
      });
    }
  }

  if (session.recent_tools.length >= 8) {
    const last8 = session.recent_tools.slice(-8);
    const unique = new Set(last8);
    if (unique.size === 1) {
      alerts.push({
        session_id: session.session_id,
        type: "looping",
        message: `连续 ${last8.length} 次调用 ${last8[0]}`,
      });
    }
  }

  const lastEvents = session.event_names.slice(-10);
  const toolEvents = lastEvents.filter((e) => e === "PreToolUse" || e === "PostToolUse");
  if (lastEvents.length >= 10 && toolEvents.length <= 1 && session.status === "active") {
    alerts.push({
      session_id: session.session_id,
      type: "low_signal",
      message: "最近事件缺少工具进展",
    });
  }

  return alerts;
}

function agentLabel(clientType: string): string {
  return CLIENT_LABELS[clientType] ?? clientType;
}

function fallbackMemoryLocations(session: HexaSession): HexaMemoryLocation[] {
  const base = MEMORY_PATHS[session.client_type] ?? [
    {
      label: "Hook session",
      path: session.cwd ?? "local hook payload",
      exists: Boolean(session.cwd),
      description: "Compatible event stream retained by HumHum session history.",
    },
  ];

  if (!session.cwd) return base;

  return [
    ...base,
    {
      label: "Workspace",
      path: session.cwd,
      exists: true,
      description: "Current working directory reported by the agent hook.",
    },
  ];
}

function inferProgressStatus(
  session: HexaSession,
  alerts: HexaAlert[],
): HexaSupervisorSession["progress_status"] {
  if (session.status === "completed") return "completed";
  if (session.has_pending_permission) return "waiting";
  if (alerts.some((a) => a.type === "looping")) return "looping";
  if (alerts.some((a) => a.type === "stalled")) return "stalled";
  if (session.status === "idle") return "idle";
  return "working";
}

function progressCopy(session: HexaSession, status: HexaSupervisorSession["progress_status"]) {
  const lastTool = session.last_tool_name ? `最近工具: ${session.last_tool_name}` : "尚未报告工具调用";
  const eventTrail = session.event_names.slice(-3).join(" -> ") || "等待首个事件";

  switch (status) {
    case "waiting":
      return {
        label: "Waiting for confirmation",
        detail: "会话正卡在权限或问题确认上，需要用户决策后才能继续。",
      };
    case "looping":
      return {
        label: "Loop watch",
        detail: `工具调用疑似重复。${lastTool}`,
      };
    case "stalled":
      return {
        label: "Stalled",
        detail: "最近没有收到事件，可能在长任务、终端等待或已经脱离 hook 视野。",
      };
    case "idle":
      return {
        label: "Idle after task",
        detail: `任务阶段已收尾，最近事件: ${eventTrail}`,
      };
    case "completed":
      return {
        label: "Completed",
        detail: `会话已结束，可用于复盘。最近事件: ${eventTrail}`,
      };
    default:
      return {
        label: "Working",
        detail: `${lastTool}。最近事件: ${eventTrail}`,
      };
  }
}

function loopStatus(alerts: HexaAlert[]): HexaSupervisorSession["loop_status"] {
  if (alerts.some((a) => a.type === "looping")) return "looping";
  if (alerts.some((a) => a.type === "low_signal" || a.type === "stalled")) return "watch";
  return "clear";
}

function buildStrongOutputs(session: HexaSession, stats: AgentStats | null): HexaSupervisorNote[] {
  const notes: HexaSupervisorNote[] = [];
  const uniqueTools = new Set(session.recent_tools);

  if (session.event_count >= 6) {
    notes.push({ tone: "good", text: `已记录 ${session.event_count} 个工作事件，复盘材料足够。` });
  }
  if (uniqueTools.size >= 3) {
    notes.push({ tone: "good", text: `工具覆盖较丰富: ${Array.from(uniqueTools).slice(-3).join(", ")}。` });
  }
  if (stats && stats.total_sessions > 0) {
    notes.push({
      tone: "good",
      text: `已有 ${stats.total_sessions} 个本地统计会话，可对比成本、token 和工具习惯。`,
    });
  }
  if (session.status === "completed") {
    notes.push({ tone: "good", text: "会话完成并进入历史列表，适合做结束复盘。" });
  }

  return notes.length > 0 ? notes : [{ tone: "neutral", text: "已有基础事件流，等待更多工具和完成事件形成结论。" }];
}

function buildWatchouts(
  session: HexaSession,
  alerts: HexaAlert[],
  stats: AgentStats | null,
): HexaSupervisorNote[] {
  const notes: HexaSupervisorNote[] = alerts.map((alert) => ({ tone: "watch", text: alert.message }));

  if (!stats && PRIMARY_CLIENTS.has(session.client_type)) {
    notes.push({
      tone: "watch",
      text: "还没有读到本地 transcript 统计，结束会话后成本与 token 复盘会更完整。",
    });
  }
  if (!session.cwd) {
    notes.push({ tone: "watch", text: "hook 未报告 cwd，项目定位和 memory 归因会偏弱。" });
  }
  if (session.recent_tools.length === 0 && session.status === "active") {
    notes.push({ tone: "watch", text: "当前只有事件心跳，暂时看不到具体工具推进。" });
  }

  return notes.length > 0 ? notes : [{ tone: "neutral", text: "暂未看到明显跑偏信号。" }];
}

function buildSupervisorSession(
  session: HexaSession,
  statsByClient: Map<string, AgentStats>,
): HexaSupervisorSession {
  const stats = statsByClient.get(session.client_type) ?? null;
  const alerts = detectAlerts(session);
  const progress_status = inferProgressStatus(session, alerts);
  const progress = progressCopy(session, progress_status);

  return {
    session,
    display_name: session.project_name || `${agentLabel(session.client_type)} ${session.session_id.slice(0, 8)}`,
    agent_label: agentLabel(session.client_type),
    priority: PRIMARY_CLIENTS.has(session.client_type) ? "primary" : "compatible",
    progress_status,
    progress_label: progress.label,
    progress_detail: progress.detail,
    loop_status: loopStatus(alerts),
    pending_confirmations: session.has_pending_permission ? 1 : 0,
    memory_locations: fallbackMemoryLocations(session),
    strong_outputs: buildStrongOutputs(session, stats),
    watchouts: buildWatchouts(session, alerts, stats),
    stats,
    alerts,
    last_seen_ms: Date.now() - new Date(session.last_event_at).getTime(),
  };
}

export function useHexaData() {
  const [sessions, setSessions] = useState<HexaSession[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [supervisorSessions, setSupervisorSessions] = useState<HexaSupervisorSession[]>([]);
  const [alerts, setAlerts] = useState<HexaAlert[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchSessions = useCallback(async () => {
    try {
      const [sessionData, statsData] = await Promise.all([
        invoke<HexaSession[]>("get_all_sessions_history"),
        invoke<AgentStats[]>("get_agent_stats"),
      ]);
      const statsByClient = new Map(statsData.map((stat) => [stat.client_type, stat]));
      const snapshots = sessionData.map((session) => buildSupervisorSession(session, statsByClient));
      const allAlerts = snapshots
        .filter((s) => s.session.status !== "completed")
        .flatMap((s) => s.alerts);

      setSessions(sessionData);
      setAgentStats(statsData);
      setSupervisorSessions(snapshots);
      setAlerts(allAlerts);
    } catch {
      // Hub may open before the backend is ready.
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    intervalRef.current = setInterval(fetchSessions, 3000);

    const unlistenHook = listen("humhum://hook-event", () => {
      fetchSessions();
    });
    const unlistenTimeout = listen("humhum://permission-timeout", () => {
      fetchSessions();
    });

    return () => {
      clearInterval(intervalRef.current);
      unlistenHook.then((fn) => fn());
      unlistenTimeout.then((fn) => fn());
    };
  }, [fetchSessions]);

  const activeSessions = sessions.filter((s) => s.status !== "completed");
  const completedSessions = sessions.filter((s) => s.status === "completed");
  const activeSupervisorSessions = supervisorSessions.filter((s) => s.session.status !== "completed");
  const completedSupervisorSessions = supervisorSessions.filter((s) => s.session.status === "completed");
  const primarySupervisorSessions = supervisorSessions.filter((s) => s.priority === "primary");
  const compatibleSupervisorSessions = supervisorSessions.filter((s) => s.priority === "compatible");

  return {
    sessions,
    activeSessions,
    completedSessions,
    agentStats,
    supervisorSessions,
    activeSupervisorSessions,
    completedSupervisorSessions,
    primarySupervisorSessions,
    compatibleSupervisorSessions,
    alerts,
  };
}
