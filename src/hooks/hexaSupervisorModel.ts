import type { AgentStats } from "@/types";
import {
  applyWatchedLifecycle,
  resolveWatchedLifecycleAlerts,
} from "./hexaWatchState";
import type { HexaBridgeSession } from "./hexaBridge";
import type {
  HexaSession,
  HexaAlert,
  HexaMemoryLocation,
  HexaSupervisorNote,
  HexaReadout,
  HexaWatchedSession,
  HexaSupervisorSession,
} from "./useHexaData";
import { t } from "@/lib/i18n";

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

const COMPLETION_EVENT_NAMES = new Set([
  "TaskCompleted",
  "Stop",
  "SessionEnd",
  "TurnCompleted",
  "AssistantTextCompleted",
  "SessionStateChanged",
]);

const TOOL_EVENT_NAMES = new Set([
  "PreToolUse",
  "PostToolUse",
  "ToolStarted",
  "ToolUpdated",
  "ToolCompleted",
  "FileChangeProposed",
  "FileChangeApplied",
]);

function detectAlerts(session: HexaSession): HexaAlert[] {
  const alerts: HexaAlert[] = [];

  if (session.has_pending_permission) {
    alerts.push({
      session_id: session.session_id,
      type: "permission",
      message: t("hexa.alertWaitConfirm"),
    });
  }

  if (session.status === "active") {
    const lastEventTime = new Date(session.last_event_at).getTime();
    if (Date.now() - lastEventTime > 5 * 60 * 1000) {
      alerts.push({
        session_id: session.session_id,
        type: "stalled",
        message: t("hexa.alertNoEvents5m"),
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
        message: t("hexa.alertRepeatCall", { count: last8.length, tool: last8[0] ?? "" }),
      });
    }
  }

  const lastEvents = session.event_names.slice(-10);
  const toolEvents = lastEvents.filter((e) => TOOL_EVENT_NAMES.has(e));
  const completionEvents = lastEvents.filter((e) => COMPLETION_EVENT_NAMES.has(e));
  if (lastEvents.length >= 10 && toolEvents.length <= 1 && completionEvents.length === 0 && session.status === "active") {
    alerts.push({
      session_id: session.session_id,
      type: "low_signal",
      message: t("hexa.alertNoToolProgress"),
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
  const lastTool = session.last_tool_name ? t("hexa.lastTool", { tool: session.last_tool_name }) : t("hexa.noToolReported");
  const eventTrail = session.event_names.slice(-3).join(" -> ") || t("hexa.awaitFirstEvent");

  switch (status) {
    case "waiting":
      return {
        label: "Waiting for confirmation",
        detail: t("hexa.detailWaiting"),
      };
    case "looping":
      return {
        label: "Loop watch",
        detail: t("hexa.detailLooping", { lastTool }),
      };
    case "stalled":
      return {
        label: "Stalled",
        detail: t("hexa.detailStalled"),
      };
    case "idle":
      return {
        label: "Idle after task",
        detail: t("hexa.detailIdle", { trail: eventTrail }),
      };
    case "completed":
      return {
        label: "Completed",
        detail: t("hexa.detailCompleted", { trail: eventTrail }),
      };
    default:
      return {
        label: "Working",
        detail: t("hexa.detailDefault", { lastTool, trail: eventTrail }),
      };
  }
}

function loopStatus(alerts: HexaAlert[]): HexaSupervisorSession["loop_status"] {
  if (alerts.some((a) => a.type === "looping")) return "looping";
  if (alerts.some((a) => a.type === "low_signal" || a.type === "stalled")) return "watch";
  return "clear";
}

function inferCurrentWork(session: HexaSession, status: HexaSupervisorSession["progress_status"]): string {
  if (status === "waiting") return t("hexa.progWaiting");
  if (status === "stalled") return t("hexa.progStalled");
  if (status === "looping") return t("hexa.progLooping", { tool: session.last_tool_name ?? t("hexa.progToolFallback") });
  if (status === "completed") return t("hexa.progCompleted");
  if (status === "idle") return t("hexa.progIdle");
  if (session.last_tool_name) return t("hexa.progUsingTool", { tool: session.last_tool_name });
  const lastEvent = session.event_names[session.event_names.length - 1];
  if (lastEvent) return t("hexa.progProcessing", { event: lastEvent });
  return t("hexa.progAwaitEvent");
}

function inferRecentNeedFit(
  session: HexaSession,
  alerts: HexaAlert[],
): Pick<HexaSupervisorSession, "recent_need_score" | "recent_need_label" | "recent_need_basis"> {
  const recent = session.event_names.slice(-10);
  const completed = recent.filter((e) => COMPLETION_EVENT_NAMES.has(e)).length;
  const toolEvents = recent.filter((e) => TOOL_EVENT_NAMES.has(e)).length;
  const historySignal = Math.min(18, Math.floor(session.event_count / 12) * 3);
  const idleBonus = session.status === "idle" ? 18 : 0;
  const completedBonus = session.status === "completed" ? 18 : 0;
  const pendingPenalty = session.has_pending_permission ? 22 : 0;
  const stallPenalty = alerts.some((a) => a.type === "stalled") ? 24 : 0;
  const loopPenalty = alerts.some((a) => a.type === "looping") ? 28 : 0;
  const lowSignalPenalty = alerts.some((a) => a.type === "low_signal") ? 12 : 0;

  const raw =
    45 +
    Math.min(25, completed * 18) +
    Math.min(24, toolEvents * 4) +
    historySignal +
    idleBonus +
    completedBonus -
    pendingPenalty -
    stallPenalty -
    loopPenalty -
    lowSignalPenalty;
  const score = Math.max(5, Math.min(98, raw));

  const label = score >= 78 ? t("hexa.fitHigh") : score >= 58 ? t("hexa.fitProgress") : score >= 34 ? t("hexa.fitWatch") : t("hexa.fitOff");
  const basis = t("hexa.fitBasis", { completed, tools: toolEvents, alerts: alerts.length });

  return {
    recent_need_score: score,
    recent_need_label: label,
    recent_need_basis: basis,
  };
}

function watchProgressStatus(status: HexaWatchedSession["status"], needUser: boolean): HexaSupervisorSession["progress_status"] {
  if (needUser || status === "waiting") return "waiting";
  if (status === "blocked") return "stalled";
  if (status === "completed") return "completed";
  if (status === "idle") return "idle";
  return "working";
}

function watchedOnlySession(watched: HexaWatchedSession): HexaSession {
  return {
    session_id: watched.session_id,
    client_type: watched.agent,
    cwd: watched.workspace,
    project_name: watched.name,
    started_at: watched.started_at,
    last_event_at: watched.updated_at,
    event_count: 0,
    status: watched.status === "completed" ? "completed" : watched.status === "idle" ? "idle" : "active",
    last_hook_message: watched.current_step ?? watched.blocked_reason,
    last_tool_name: null,
    recent_tools: [],
    event_names: ["HexaWatch"],
    has_pending_permission: false,
    route: null,
  };
}

function trustedWatchScore(watched: HexaWatchedSession): number {
  if (watched.status === "completed") return 88;
  if (watched.status === "working") return 76;
  if (watched.status === "idle") return 68;
  if (watched.need_user || watched.status === "waiting") return 54;
  return 42;
}

function fitLabel(score: number): string {
  if (score >= 78) return t("hexa.fitHigh");
  if (score >= 58) return t("hexa.fitProgress");
  if (score >= 34) return t("hexa.fitWatch");
  return t("hexa.fitOff");
}

function buildStrongOutputs(session: HexaSession, stats: AgentStats | null): HexaSupervisorNote[] {
  const notes: HexaSupervisorNote[] = [];
  const uniqueTools = new Set(session.recent_tools);

  if (session.event_count >= 6) {
    notes.push({ tone: "good", text: t("hexa.outEventsEnough", { count: session.event_count }) });
  }
  if (uniqueTools.size >= 3) {
    notes.push({ tone: "good", text: t("hexa.outToolCoverage", { tools: Array.from(uniqueTools).slice(-3).join(", ") }) });
  }
  if (stats && stats.total_sessions > 0) {
    notes.push({
      tone: "good",
      text: t("hexa.outLocalStats", { count: stats.total_sessions }),
    });
  }
  if (session.status === "completed") {
    notes.push({ tone: "good", text: t("hexa.outCompletedHistory") });
  }

  return notes.length > 0 ? notes : [{ tone: "neutral", text: t("hexa.outNeutral") }];
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
      text: t("hexa.watchNoTranscript"),
    });
  }
  if (!session.cwd) {
    notes.push({ tone: "watch", text: t("hexa.watchNoCwd") });
  }
  if (session.recent_tools.length === 0 && session.status === "active") {
    notes.push({ tone: "watch", text: t("hexa.watchHeartbeatOnly") });
  }

  return notes.length > 0 ? notes : [{ tone: "neutral", text: t("hexa.watchNeutral") }];
}

function buildSupervisorSession(
  session: HexaSession,
  statsByClient: Map<string, AgentStats>,
  readoutBySession: Map<string, HexaReadout>,
  source: HexaSupervisorSession["source"] = "hook",
  bridge: HexaBridgeSession | null = null,
  watched: HexaWatchedSession | null = null,
): HexaSupervisorSession {
  const effectiveSession = watched ? applyWatchedLifecycle(session, watched.status) : session;
  const stats = statsByClient.get(effectiveSession.client_type) ?? null;
  const readout = readoutBySession.get(effectiveSession.session_id) ?? null;
  const detectedAlerts = detectAlerts(effectiveSession);
  const alerts = watched
    ? resolveWatchedLifecycleAlerts(detectedAlerts, watched)
    : detectedAlerts;
  const progress_status = inferProgressStatus(effectiveSession, alerts);
  const progress = progressCopy(effectiveSession, progress_status);
  const recentNeed = inferRecentNeedFit(effectiveSession, alerts);
  const fallbackEvidence = [
    `hook events: ${effectiveSession.event_count}`,
    effectiveSession.last_tool_name ? `last tool: ${effectiveSession.last_tool_name}` : "last tool: unknown",
    `status: ${effectiveSession.status}`,
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
  const liveProgress = progressCopy(effectiveSession, liveProgressStatus);
  const watchedProgressStatus = watched ? watchProgressStatus(watched.status, watched.need_user) : null;
  const watchedProgress = watchedProgressStatus ? progressCopy(effectiveSession, watchedProgressStatus) : null;
  const watchScore = watched ? trustedWatchScore(watched) : null;
  const pendingConfirmations = Math.max(
    effectiveSession.has_pending_permission ? 1 : 0,
    bridge?.pending_approvals.length ?? 0,
  );

  return {
    session: effectiveSession,
    display_name: watched?.name || effectiveSession.project_name || `${agentLabel(effectiveSession.client_type)} ${effectiveSession.session_id.slice(0, 8)}`,
    agent_label: watched ? agentLabel(watched.agent) : agentLabel(effectiveSession.client_type),
    priority: PRIMARY_CLIENTS.has(effectiveSession.client_type) ? "primary" : "compatible",
    progress_status: watchedProgressStatus ?? liveProgressStatus,
    progress_label: watchedProgress?.label ?? liveProgress.label,
    progress_detail: watched?.blocked_reason
      ?? watched?.current_step
      ?? bridge?.current_activity
      ?? (bridgeStatus === "disconnected" ? t("hexa.bridgeDisconnected") : liveProgress.detail),
    loop_status: loopStatus(alerts),
    pending_confirmations: pendingConfirmations,
    memory_locations: fallbackMemoryLocations(effectiveSession),
    strong_outputs: watched
      ? [{ tone: "good", text: t("hexa.trustedJoined") }, ...buildStrongOutputs(effectiveSession, stats)]
      : buildStrongOutputs(effectiveSession, stats),
    watchouts: watched?.blocked_reason
      ? [{ tone: "watch", text: watched.blocked_reason }, ...buildWatchouts(effectiveSession, alerts, stats)]
      : buildWatchouts(effectiveSession, alerts, stats),
    current_work: watched?.current_step ?? bridge?.current_activity ?? readout?.agent_current_work ?? inferCurrentWork(effectiveSession, liveProgressStatus),
    recent_need_score: watchScore ?? readout?.fit_score ?? recentNeed.recent_need_score,
    recent_need_label: watchScore ? fitLabel(watchScore) : readout ? fitLabel(readout.fit_score) : recentNeed.recent_need_label,
    recent_need_basis: watched
      ? `agent declared: ${watched.confidence ?? "trusted watch"}`
      : readout
        ? `transcript + hook: ${readout.evidence.slice(0, 2).join(" · ")}`
        : recentNeed.recent_need_basis,
    project_intent: watched?.goal ?? readout?.project_intent ?? (effectiveSession.project_name ? t("hexa.projectSession", { project: effectiveSession.project_name }) : t("hexa.projectIntentTbd")),
    recent_user_intent: readout?.recent_user_intent ?? t("hexa.noRecentUserMsg"),
    performance_read: readout?.performance_read ?? progress.detail,
    suggested_nudge: watched?.need_user
      ? t("hexa.nudgeNeedsUser")
      : readout?.suggested_nudge ?? t("hexa.nudgeDefault"),
    evidence: watched ? [`watched: ${watched.status}`, ...(readout?.evidence ?? fallbackEvidence)] : readout?.evidence ?? fallbackEvidence,
    stats,
    alerts,
    last_seen_ms: Date.now() - new Date(watched?.updated_at ?? session.last_event_at).getTime(),
    source,
    bridge,
    watched,
    current_activity: watched?.current_step ?? bridge?.current_activity ?? null,
    pending_approvals: bridge?.pending_approvals ?? [],
    can_intervene: !!bridge && bridgeStatus !== "disconnected" && bridgeStatus !== "failed",
  };
}

export {
  PRIMARY_CLIENTS,
  CLIENT_LABELS,
  MEMORY_PATHS,
  COMPLETION_EVENT_NAMES,
  TOOL_EVENT_NAMES,
  detectAlerts,
  fallbackMemoryLocations,
  inferProgressStatus,
  progressCopy,
  loopStatus,
  inferCurrentWork,
  inferRecentNeedFit,
  watchProgressStatus,
  watchedOnlySession,
  trustedWatchScore,
  fitLabel,
  buildStrongOutputs,
  buildWatchouts,
  buildSupervisorSession,
};
