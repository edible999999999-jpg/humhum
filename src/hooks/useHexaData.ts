import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentStats } from "@/types";
import type { GitChangeSummary } from "./sessionChangesState";
import { sortHexaSessions } from "./hexaPriority";
import {
  mergeHexaSessions,
  type HexaBridgeApproval,
  type HexaBridgeSession,
  type HexaHookSession,
} from "./hexaBridge";

export type HexaSession = HexaHookSession;

export interface CodexBridgeHealth {
  status: "starting" | "connected" | "codex_missing" | "unsupported" | "disconnected" | "error";
  version: string | null;
  last_connected_at: string | null;
  message: string;
}

export interface CodexRemoteControlState {
  status: "unavailable" | "disabled" | "connecting" | "connected" | "errored";
  server_name: string;
  installation_id: string;
  environment_id: string | null;
  message: string;
}

export interface CodexRemotePairing {
  pairing_code: string;
  manual_pairing_code: string | null;
  environment_id: string;
  expires_at: number;
}

export interface MobileBridgeStatus {
  enabled: boolean;
  url: string | null;
  certificate_fingerprint: string | null;
  paired_devices: number;
  devices: Array<{
    id: string;
    name: string;
    paired_at: string;
    scope: "read" | "control";
  }>;
}

export interface MobilePairingInfo {
  code: string;
  expires_at: number;
  url: string;
  certificate_fingerprint: string;
  scope: "read" | "control";
  android_setup: string;
}

export interface FocusResult {
  strategy: "tmux_pane" | "iterm_session" | "terminal_tty" | "codex_thread" | "cursor_terminal" | "cursor_workspace" | "ghostty_terminal" | "ghostty_workspace" | "application" | "generic_terminal";
  application: string | null;
  exact: boolean;
}

export interface QueuedIntervention {
  id: string;
  thread_id: string;
  message: string;
  created_at: string;
  attempts: number;
  status: "pending" | "sending" | "failed";
  last_error: string | null;
  provider?: "codex" | "claude" | "opencode";
}

export interface CodexSendReceipt {
  status: "queued" | "delivered";
  turn_id: string | null;
  intervention_id: string;
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

export interface HexaReadout {
  session_id: string;
  project_intent: string;
  recent_user_intent: string;
  agent_current_work: string;
  performance_read: string;
  fit_score: number;
  suggested_nudge: string;
  evidence: string[];
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
  current_work: string;
  recent_need_score: number;
  recent_need_label: string;
  recent_need_basis: string;
  project_intent: string;
  recent_user_intent: string;
  performance_read: string;
  suggested_nudge: string;
  evidence: string[];
  stats: AgentStats | null;
  alerts: HexaAlert[];
  last_seen_ms: number;
  source: "hook" | "codex_bridge";
  bridge: HexaBridgeSession | null;
  current_activity: string | null;
  pending_approvals: HexaBridgeApproval[];
  can_intervene: boolean;
}

const PRIMARY_CLIENTS = new Set(["claude-code", "codex"]);

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  qoderwork: "QoderWork",
  qoder: "Qoder",
  codebuddy: "CodeBuddy",
  workbuddy: "WorkBuddy",
  "qwen-code": "Qwen Code",
  "gemini-cli": "Gemini CLI",
  "kimi-k1": "Kimi K1",
  hermes: "Hermes Agent",
  openclaw: "OpenClaw",
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

export function agentLabel(clientType: string): string {
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
        detail: `会话已结束，已生成复盘摘要。最近事件: ${eventTrail}`,
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

function inferCurrentWork(session: HexaSession, status: HexaSupervisorSession["progress_status"]): string {
  if (status === "waiting") return "等待用户确认";
  if (status === "stalled") return "疑似停滞";
  if (status === "looping") return `重复调用 ${session.last_tool_name ?? "工具"}`;
  if (status === "completed") return "已完成，等待复盘";
  if (status === "idle") return "阶段结束，空闲中";
  if (session.last_tool_name) return `正在使用 ${session.last_tool_name}`;
  const lastEvent = session.event_names[session.event_names.length - 1];
  if (lastEvent) return `处理 ${lastEvent}`;
  return "等待事件";
}

function inferRecentNeedFit(
  session: HexaSession,
  alerts: HexaAlert[],
): Pick<HexaSupervisorSession, "recent_need_score" | "recent_need_label" | "recent_need_basis"> {
  const recent = session.event_names.slice(-10);
  const completed = recent.filter((e) => e === "TaskCompleted" || e === "Stop" || e === "SessionEnd").length;
  const toolEvents = recent.filter((e) => e === "PreToolUse" || e === "PostToolUse").length;
  const pendingPenalty = session.has_pending_permission ? 22 : 0;
  const stallPenalty = alerts.some((a) => a.type === "stalled") ? 24 : 0;
  const loopPenalty = alerts.some((a) => a.type === "looping") ? 28 : 0;
  const lowSignalPenalty = alerts.some((a) => a.type === "low_signal") ? 12 : 0;

  const raw =
    45 +
    Math.min(25, completed * 18) +
    Math.min(24, toolEvents * 4) +
    (session.status === "completed" ? 12 : 0) -
    pendingPenalty -
    stallPenalty -
    loopPenalty -
    lowSignalPenalty;
  const score = Math.max(5, Math.min(98, raw));

  const label = score >= 78 ? "高匹配" : score >= 58 ? "推进中" : score >= 38 ? "需关注" : "偏离/卡住";
  const basis = `近 10 事件: 完成 ${completed} · 工具 ${toolEvents} · 告警 ${alerts.length}`;

  return {
    recent_need_score: score,
    recent_need_label: label,
    recent_need_basis: basis,
  };
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
    notes.push({ tone: "good", text: "会话完成并进入历史列表，已生成可展开的复盘摘要。" });
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
  readoutBySession: Map<string, HexaReadout>,
  source: HexaSupervisorSession["source"] = "hook",
  bridge: HexaBridgeSession | null = null,
): HexaSupervisorSession {
  const stats = statsByClient.get(session.client_type) ?? null;
  const readout = readoutBySession.get(session.session_id) ?? null;
  const alerts = detectAlerts(session);
  const progress_status = inferProgressStatus(session, alerts);
  const progress = progressCopy(session, progress_status);
  const recentNeed = inferRecentNeedFit(session, alerts);
  const fallbackEvidence = [
    `hook events: ${session.event_count}`,
    session.last_tool_name ? `last tool: ${session.last_tool_name}` : "last tool: unknown",
    `status: ${session.status}`,
  ];
  const bridgeStatus = bridge?.status;
  const liveProgressStatus: HexaSupervisorSession["progress_status"] = bridge?.pending_approvals.length
    ? "waiting"
    : bridgeStatus === "working" || bridgeStatus === "starting"
      ? "working"
      : bridgeStatus === "failed" || bridgeStatus === "disconnected"
        ? "stalled"
        : bridgeStatus === "completed"
          ? "completed"
          : bridgeStatus === "idle"
            ? "idle"
            : progress_status;
  const liveProgress = progressCopy(session, liveProgressStatus);

  return {
    session,
    display_name: session.project_name || `${agentLabel(session.client_type)} ${session.session_id.slice(0, 8)}`,
    agent_label: agentLabel(session.client_type),
    priority: PRIMARY_CLIENTS.has(session.client_type) ? "primary" : "compatible",
    progress_status: liveProgressStatus,
    progress_label: liveProgress.label,
    progress_detail: bridge?.current_activity
      ?? (bridgeStatus === "disconnected" ? "Codex 连接暂时中断，hook 记录仍然保留。" : liveProgress.detail),
    loop_status: loopStatus(alerts),
    pending_confirmations: bridge?.pending_approvals.length ?? (session.has_pending_permission ? 1 : 0),
    memory_locations: fallbackMemoryLocations(session),
    strong_outputs: buildStrongOutputs(session, stats),
    watchouts: buildWatchouts(session, alerts, stats),
    current_work: bridge?.current_activity ?? readout?.agent_current_work ?? inferCurrentWork(session, liveProgressStatus),
    recent_need_score: readout?.fit_score ?? recentNeed.recent_need_score,
    recent_need_label: readout
      ? readout.fit_score >= 78
        ? "高匹配"
        : readout.fit_score >= 58
          ? "推进中"
          : readout.fit_score >= 38
            ? "需关注"
            : "偏离/卡住"
      : recentNeed.recent_need_label,
    recent_need_basis: readout
      ? `transcript + hook: ${readout.evidence.slice(0, 2).join(" · ")}`
      : recentNeed.recent_need_basis,
    project_intent: readout?.project_intent ?? (session.project_name ? `${session.project_name} 项目会话` : "项目意图待识别"),
    recent_user_intent: readout?.recent_user_intent ?? "暂未读到最近用户消息，当前仅基于 hook 事件判断。",
    performance_read: readout?.performance_read ?? progress.detail,
    suggested_nudge: readout?.suggested_nudge ?? "让 agent 对照用户目标说明当前进展。",
    evidence: readout?.evidence ?? fallbackEvidence,
    stats,
    alerts,
    last_seen_ms: Date.now() - new Date(session.last_event_at).getTime(),
    source,
    bridge,
    current_activity: bridge?.current_activity ?? null,
    pending_approvals: bridge?.pending_approvals ?? [],
    can_intervene: source === "codex_bridge" && bridgeStatus !== "disconnected" && bridgeStatus !== "failed",
  };
}

export function useHexaData() {
  const [sessions, setSessions] = useState<HexaSession[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [supervisorSessions, setSupervisorSessions] = useState<HexaSupervisorSession[]>([]);
  const [alerts, setAlerts] = useState<HexaAlert[]>([]);
  const [bridgeHealth, setBridgeHealth] = useState<CodexBridgeHealth>({
    status: "starting",
    version: null,
    last_connected_at: null,
    message: "Connecting to local Codex",
  });
  const [remoteControl, setRemoteControl] = useState<CodexRemoteControlState>({
    status: "unavailable",
    server_name: "",
    installation_id: "",
    environment_id: null,
    message: "Codex mobile access is unavailable",
  });
  const [remotePairing, setRemotePairing] = useState<CodexRemotePairing | null>(null);
  const [mobileBridge, setMobileBridge] = useState<MobileBridgeStatus>({
    enabled: false,
    url: null,
    certificate_fingerprint: null,
    paired_devices: 0,
    devices: [],
  });
  const [mobilePairing, setMobilePairing] = useState<MobilePairingInfo | null>(null);
  const [queuedInterventions, setQueuedInterventions] = useState<QueuedIntervention[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchSessions = useCallback(async () => {
    try {
      const [sessionData, statsData, readoutData, bridgeData, healthData, queueData] = await Promise.all([
        invoke<HexaSession[]>("get_all_sessions_history"),
        invoke<AgentStats[]>("get_agent_stats"),
        invoke<HexaReadout[]>("get_hexa_readouts"),
        invoke<HexaBridgeSession[]>("get_hexa_bridge_sessions"),
        invoke<CodexBridgeHealth>("get_codex_bridge_health"),
        invoke<QueuedIntervention[]>("get_intervention_queue"),
      ]);
      const remoteData = await invoke<CodexRemoteControlState>("get_codex_remote_control").catch(() => null);
      const mobileData = await invoke<MobileBridgeStatus>("get_mobile_bridge_status").catch(() => null);
      const statsByClient = new Map(statsData.map((stat) => [stat.client_type, stat]));
      const readoutBySession = new Map(readoutData.map((readout) => [readout.session_id, readout]));
      const merged = mergeHexaSessions(sessionData, bridgeData);
      const mergedSessions = merged.map((item) => item.session);
      const snapshots = merged.map((item) =>
        buildSupervisorSession(item.session, statsByClient, readoutBySession, item.source, item.bridge),
      );
      const allAlerts = snapshots
        .filter((s) => s.session.status !== "completed")
        .flatMap((s) => s.alerts);

      setSessions(mergedSessions);
      setAgentStats(statsData);
      setSupervisorSessions(sortHexaSessions(snapshots));
      setAlerts(allAlerts);
      setBridgeHealth(healthData);
      setQueuedInterventions(queueData);
      if (remoteData) setRemoteControl(remoteData);
      if (mobileData) setMobileBridge(mobileData);
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
    const unlistenBridgeSession = listen("humhum://hexa-session-changed", fetchSessions);
    const unlistenBridgeHealth = listen("humhum://codex-bridge-health", fetchSessions);
    const unlistenRemoteControl = listen<CodexRemoteControlState>(
      "humhum://codex-remote-control-changed",
      (event) => setRemoteControl(event.payload),
    );

    return () => {
      clearInterval(intervalRef.current);
      unlistenHook.then((fn) => fn());
      unlistenTimeout.then((fn) => fn());
      unlistenBridgeSession.then((fn) => fn());
      unlistenBridgeHealth.then((fn) => fn());
      unlistenRemoteControl.then((fn) => fn());
    };
  }, [fetchSessions]);

  const activeSessions = sessions.filter((s) => s.status !== "completed");
  const completedSessions = sessions.filter((s) => s.status === "completed");
  const activeSupervisorSessions = supervisorSessions.filter((s) => s.session.status !== "completed");
  const completedSupervisorSessions = supervisorSessions.filter((s) => s.session.status === "completed");
  const primarySupervisorSessions = supervisorSessions.filter((s) => s.priority === "primary");
  const compatibleSupervisorSessions = supervisorSessions.filter((s) => s.priority === "compatible");

  const sendCodexMessage = useCallback(async (threadId: string, message: string) => {
    try {
      return await invoke<CodexSendReceipt>("hexa_send_codex_message", { threadId, message });
    } finally {
      await fetchSessions();
    }
  }, [fetchSessions]);

  const retryCodexMessage = useCallback(async (interventionId: string) => {
    try {
      return await invoke<CodexSendReceipt>("hexa_retry_codex_message", { interventionId });
    } finally {
      await fetchSessions();
    }
  }, [fetchSessions]);

  const sendClaudeMessage = useCallback(async (sessionId: string, message: string) => {
    try {
      return await invoke<CodexSendReceipt>("hexa_send_claude_message", { sessionId, message });
    } finally {
      await fetchSessions();
    }
  }, [fetchSessions]);

  const retryClaudeMessage = useCallback(async (interventionId: string) => {
    try {
      return await invoke<CodexSendReceipt>("hexa_retry_claude_message", { interventionId });
    } finally {
      await fetchSessions();
    }
  }, [fetchSessions]);

  const sendOpenCodeMessage = useCallback(async (sessionId: string, message: string) => {
    try {
      return await invoke<CodexSendReceipt>("hexa_send_opencode_message", { sessionId, message });
    } finally {
      await fetchSessions();
    }
  }, [fetchSessions]);

  const retryOpenCodeMessage = useCallback(async (interventionId: string) => {
    try {
      return await invoke<CodexSendReceipt>("hexa_retry_opencode_message", { interventionId });
    } finally {
      await fetchSessions();
    }
  }, [fetchSessions]);

  const discardQueuedIntervention = useCallback(async (interventionId: string) => {
    await invoke("discard_queued_intervention", { interventionId });
    await fetchSessions();
  }, [fetchSessions]);

  const interruptCodexTurn = useCallback(async (threadId: string, turnId: string) => {
    await invoke("hexa_interrupt_codex_turn", { threadId, turnId });
    await fetchSessions();
  }, [fetchSessions]);

  const resumeCodexThread = useCallback(async (threadId: string) => {
    await invoke("hexa_resume_codex_thread", { threadId });
    await fetchSessions();
  }, [fetchSessions]);

  const resolveCodexApproval = useCallback(async (
    approvalId: string,
    decision: "allow_once" | "deny",
  ) => {
    await invoke("hexa_resolve_codex_approval", { approvalId, decision });
    await fetchSessions();
  }, [fetchSessions]);

  const focusAgentSession = useCallback(async (sessionId: string) => {
    return invoke<FocusResult>("focus_agent_session", { sessionId });
  }, []);

  const getSessionChangeSummary = useCallback(async (sessionId: string) => {
    return invoke<GitChangeSummary>("get_session_change_summary", { sessionId });
  }, []);

  const enableCodexRemoteControl = useCallback(async () => {
    const state = await invoke<CodexRemoteControlState>("hexa_enable_codex_remote_control");
    setRemoteControl(state);
    setRemotePairing(null);
  }, []);

  const disableCodexRemoteControl = useCallback(async () => {
    const state = await invoke<CodexRemoteControlState>("hexa_disable_codex_remote_control");
    setRemoteControl(state);
    setRemotePairing(null);
  }, []);

  const startCodexRemotePairing = useCallback(async () => {
    const pairing = await invoke<CodexRemotePairing>("hexa_start_codex_remote_pairing");
    setRemotePairing(pairing);
    return pairing;
  }, []);

  const enableMobileBridge = useCallback(async () => {
    const state = await invoke<MobileBridgeStatus>("enable_mobile_bridge");
    setMobileBridge(state);
    setMobilePairing(null);
    return state;
  }, []);

  const disableMobileBridge = useCallback(async () => {
    const state = await invoke<MobileBridgeStatus>("disable_mobile_bridge");
    setMobileBridge(state);
    setMobilePairing(null);
    return state;
  }, []);

  const startMobilePairing = useCallback(async (scope: "read" | "control" = "read") => {
    const pairing = await invoke<MobilePairingInfo>("start_mobile_pairing", { scope });
    setMobilePairing(pairing);
    return pairing;
  }, []);

  const revokeMobileDevices = useCallback(async () => {
    const state = await invoke<MobileBridgeStatus>("revoke_mobile_devices");
    setMobileBridge(state);
    setMobilePairing(null);
    return state;
  }, []);

  const revokeMobileDevice = useCallback(async (deviceId: string) => {
    const state = await invoke<MobileBridgeStatus>("revoke_mobile_device", { deviceId });
    setMobileBridge(state);
    return state;
  }, []);

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
    bridgeHealth,
    remoteControl,
    remotePairing,
    mobileBridge,
    mobilePairing,
    queuedInterventions,
    sendCodexMessage,
    retryCodexMessage,
    sendClaudeMessage,
    retryClaudeMessage,
    sendOpenCodeMessage,
    retryOpenCodeMessage,
    discardQueuedIntervention,
    interruptCodexTurn,
    resumeCodexThread,
    resolveCodexApproval,
    focusAgentSession,
    getSessionChangeSummary,
    enableCodexRemoteControl,
    disableCodexRemoteControl,
    startCodexRemotePairing,
    enableMobileBridge,
    disableMobileBridge,
    startMobilePairing,
    revokeMobileDevices,
    revokeMobileDevice,
  };
}
