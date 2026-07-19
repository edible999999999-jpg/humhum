import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentStats, AppConfig } from "@/types";
import type { GitChangeSummary } from "./sessionChangesState";
import { sortHexaSessions } from "./hexaPriority";
import { normalizeMobileRelayConfig, type MobileRelayConfigValue } from "./mobileRelayConfig";
import type { HexaPlanningCapability, HexaWorkItemSource } from "./hexaPlanningCapability";
import {
  WATCHED_REFRESH_INTERVAL_MS,
  createCoalescedRefresh,
  watchedRefreshAction,
} from "./hexaRefreshPolicy";
import {
  applyWatchedLifecycle,
  partitionSupervisorSessions,
  resolveOrderedWatchRefresh,
  resolveWatchRefresh,
  resolveWatchedLifecycleAlerts,
  type WatchDataState,
  type WatchRefresh,
} from "./hexaWatchState";
import type { HexaDevelopmentGoal } from "./hexaGoalMonitoring";
import {
  excludePassiveHistorySessions,
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
  lan_url: string | null;
  tailnet_url: string | null;
  certificate_fingerprint: string | null;
  pairing_active: boolean;
  paired_devices: number;
  devices: Array<{
    id: string;
    name: string;
    paired_at: string;
    scope: "read" | "control";
    presence_mode: "foreground" | "monitoring" | null;
    last_seen_at: string | null;
  }>;
  relay_status: "disabled" | "connected" | "retrying" | "errored";
  relay_url: string | null;
}

export type MobileRelayConfig = MobileRelayConfigValue;

export interface MobilePairingInfo {
  code: string;
  expires_at: number;
  url: string;
  certificate_fingerprint: string;
  scope: "read" | "control";
  network: "lan" | "tailnet";
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

export interface HexaEvidenceRef {
  id: string;
  kind: string;
  label: string;
  location: string | null;
  observed_at: string;
}

export interface HexaEvidenceInput {
  kind: string;
  label: string;
  location: string | null;
}

export type HexaWorkItemStatus = "pending" | "in_progress" | "completed" | "failed";

export interface HexaWorkItem {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: HexaWorkItemStatus;
  depends_on: string[];
  evidence: HexaEvidenceRef[];
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
  source?: HexaWorkItemSource;
  source_provider?: string | null;
  source_item_id?: string | null;
  confidence?: "authoritative" | "reported" | "inferred";
}

export interface HexaWorkItemInput {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: HexaWorkItemStatus;
  depends_on: string[];
  evidence: HexaEvidenceInput[];
}

export type HexaAlignment = "on_track" | "watch" | "off_track";

export interface HexaGoalRevision {
  id: string;
  goal: string;
  success_criteria: string[];
  created_at: string;
}

export interface HexaMilestone {
  id: string;
  summary: string;
  work_item_id: string | null;
  alignment: HexaAlignment;
  evidence: HexaEvidenceRef[];
  created_at: string;
}

export interface HexaMilestoneInput {
  summary: string;
  work_item_id: string | null;
  alignment: HexaAlignment;
  evidence: HexaEvidenceInput[];
}

export interface HexaIntervention {
  id: string;
  kind: string;
  summary: string;
  evidence: HexaEvidenceRef[];
  created_at: string;
}

export type HexaReviewRating = "satisfied" | "average" | "unsatisfied";

export interface HexaReview {
  rating: HexaReviewRating;
  summary: string;
  evidence: HexaEvidenceRef[];
  created_at: string;
}

export interface HexaReviewInput {
  rating: HexaReviewRating;
  summary: string;
  evidence: HexaEvidenceInput[];
}

export interface HexaSessionAudit {
  goal_revisions: HexaGoalRevision[];
  success_criteria: string[];
  work_items: HexaWorkItem[];
  milestones: HexaMilestone[];
  important_outputs: HexaEvidenceRef[];
  interventions: HexaIntervention[];
  hexa_review: HexaReview | null;
  user_review: HexaReview | null;
}

export type HexaAuditMutationRequest =
  | { session_id: string; action: "revise_goal"; goal: string; success_criteria: string[] }
  | { session_id: string; action: "upsert_work_item"; work_item: HexaWorkItemInput }
  | { session_id: string; action: "remove_work_item"; work_item_id: string }
  | { session_id: string; action: "append_milestone"; milestone: HexaMilestoneInput }
  | { session_id: string; action: "append_output"; output: HexaEvidenceInput }
  | { session_id: string; action: "record_intervention"; intervention: Omit<HexaIntervention, "id" | "created_at" | "evidence"> & { evidence: HexaEvidenceInput[] } }
  | { session_id: string; action: "set_hexa_review"; review: HexaReviewInput }
  | { session_id: string; action: "set_user_review"; review: HexaReviewInput };

export interface HexaWatchedSession {
  session_id: string;
  agent: string;
  name: string;
  provider: string;
  workspace: string | null;
  goal: string | null;
  status: "starting" | "working" | "waiting" | "idle" | "completed" | "blocked";
  current_step: string | null;
  blocked_reason: string | null;
  need_user: boolean;
  confidence: string | null;
  started_at: string;
  updated_at: string;
  audit: HexaSessionAudit;
  planning_capability?: HexaPlanningCapability;
  plan_revision?: string | null;
  previous_session_ids?: string[];
}

export interface HexaWatchedAgent {
  key: string;
  provider: string;
  name: string;
  workspace: string | null;
  created_at: string;
  updated_at: string;
  runs: HexaWatchedSession[];
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
  source: "watched" | "hook" | "codex_bridge";
  bridge: HexaBridgeSession | null;
  watched: HexaWatchedSession | null;
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
      message: "等待用户确认",
    });
  }

  if (session.status === "active") {
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
  const toolEvents = lastEvents.filter((e) => TOOL_EVENT_NAMES.has(e));
  const completionEvents = lastEvents.filter((e) => COMPLETION_EVENT_NAMES.has(e));
  if (lastEvents.length >= 10 && toolEvents.length <= 1 && completionEvents.length === 0 && session.status === "active") {
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

  const label = score >= 78 ? "高匹配" : score >= 58 ? "推进中" : score >= 34 ? "需关注" : "偏离/卡住";
  const basis = `近 10 事件: 完成 ${completed} · 工具 ${toolEvents} · 告警 ${alerts.length}`;

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
  if (score >= 78) return "高匹配";
  if (score >= 58) return "推进中";
  if (score >= 34) return "需关注";
  return "偏离/卡住";
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
      ?? (bridgeStatus === "disconnected" ? "Codex 连接暂时中断，hook 记录仍然保留。" : liveProgress.detail),
    loop_status: loopStatus(alerts),
    pending_confirmations: pendingConfirmations,
    memory_locations: fallbackMemoryLocations(effectiveSession),
    strong_outputs: watched
      ? [{ tone: "good", text: "Agent 已主动加入 Hexa 托管，状态可信度高于被动扫描。" }, ...buildStrongOutputs(effectiveSession, stats)]
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
    project_intent: watched?.goal ?? readout?.project_intent ?? (effectiveSession.project_name ? `${effectiveSession.project_name} 项目会话` : "项目意图待识别"),
    recent_user_intent: readout?.recent_user_intent ?? "暂未读到最近用户消息，当前仅基于 hook 事件判断。",
    performance_read: readout?.performance_read ?? progress.detail,
    suggested_nudge: watched?.need_user
      ? "Agent 已声明需要用户介入，优先查看当前步骤或阻塞原因。"
      : readout?.suggested_nudge ?? "让 agent 对照用户目标说明当前进展。",
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

export function useHexaData() {
  const [sessions, setSessions] = useState<HexaSession[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [watchedAgents, setWatchedAgents] = useState<HexaWatchedAgent[]>([]);
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
    lan_url: null,
    tailnet_url: null,
    certificate_fingerprint: null,
    pairing_active: false,
    paired_devices: 0,
    devices: [],
    relay_status: "disabled",
    relay_url: null,
  });
  const [mobileRelayConfig, setMobileRelayConfig] = useState<MobileRelayConfig>({
    enabled: false,
    base_url: null,
    invite_code: null,
  });
  const [mobilePairing, setMobilePairing] = useState<MobilePairingInfo | null>(null);
  const [queuedInterventions, setQueuedInterventions] = useState<QueuedIntervention[]>([]);
  const [developmentGoals, setDevelopmentGoals] = useState<HexaDevelopmentGoal[]>([]);
  const watchedAgentsRef = useRef<HexaWatchedAgent[]>([]);
  const watchedExpiryRenderedRef = useRef(false);
  const sessionDataRef = useRef<HexaSession[]>([]);
  const statsDataRef = useRef<AgentStats[]>([]);
  const readoutDataRef = useRef<HexaReadout[]>([]);
  const bridgeDataRef = useRef<HexaBridgeSession[]>([]);
  const queueDataRef = useRef<QueuedIntervention[]>([]);
  const refreshGenerationRef = useRef(0);
  const watchRefreshRef = useRef<WatchRefresh<HexaWatchedAgent[]>>({
    data: null,
    state: "loading",
    error: null,
  });
  const goalRefreshRef = useRef<WatchRefresh<HexaDevelopmentGoal[]>>({
    data: null,
    state: "loading",
    error: null,
  });
  const [watchDataState, setWatchDataState] = useState<WatchDataState>("loading");
  const [goalDataState, setGoalDataState] = useState<WatchDataState>("loading");
  const goalRefreshGenerationRef = useRef(0);

  const fetchSnapshot = useCallback(async () => {
    const requestGeneration = ++refreshGenerationRef.current;

    try {
      const [sessionResult, statsResult, readoutResult, bridgeResult, watchedResult, healthResult, queueResult] = await Promise.allSettled([
        invoke<HexaSession[]>("get_all_sessions_history"),
        invoke<AgentStats[]>("get_agent_stats"),
        invoke<HexaReadout[]>("get_hexa_readouts"),
        invoke<HexaBridgeSession[]>("get_hexa_bridge_sessions"),
        invoke<HexaWatchedAgent[]>("refresh_hexa_watched_agents"),
        invoke<CodexBridgeHealth>("get_codex_bridge_health"),
        invoke<QueuedIntervention[]>("get_intervention_queue"),
      ]);
      const orderedWatchRefresh = resolveOrderedWatchRefresh(
        watchRefreshRef.current,
        watchedResult,
        requestGeneration,
        refreshGenerationRef.current,
      );
      if (!orderedWatchRefresh.applied || !orderedWatchRefresh.refresh) return;

      if (sessionResult.status === "fulfilled") sessionDataRef.current = sessionResult.value;
      if (statsResult.status === "fulfilled") statsDataRef.current = statsResult.value;
      if (readoutResult.status === "fulfilled") readoutDataRef.current = readoutResult.value;
      if (bridgeResult.status === "fulfilled") bridgeDataRef.current = bridgeResult.value;
      if (queueResult.status === "fulfilled") queueDataRef.current = queueResult.value;

      const watchRefresh = orderedWatchRefresh.refresh;
      watchRefreshRef.current = watchRefresh;
      setWatchDataState(watchRefresh.state);

      const sessionData = sessionDataRef.current;
      const statsData = statsDataRef.current;
      const readoutData = readoutDataRef.current;
      const bridgeData = bridgeDataRef.current;
      const watchedAgentData = watchRefresh.data ?? [];
      watchedAgentsRef.current = watchedAgentData;
      watchedExpiryRenderedRef.current = false;
      const watchedData = watchedAgentData.flatMap((agent) => agent.runs);
      const healthData = healthResult.status === "fulfilled" ? healthResult.value : null;
      const queueData = queueDataRef.current;
      const remoteData = await invoke<CodexRemoteControlState>("get_codex_remote_control").catch(() => null);
      const mobileData = await invoke<MobileBridgeStatus>("get_mobile_bridge_status").catch(() => null);
      const configData = await invoke<AppConfig>("get_config").catch(() => null);
      if (requestGeneration !== refreshGenerationRef.current) return;
      const statsByClient = new Map(statsData.map((stat) => [stat.client_type, stat]));
      const readoutBySession = new Map(readoutData.map((readout) => [readout.session_id, readout]));
      const watchedBySession = new Map(watchedData.map((watched) => [watched.session_id, watched]));
      const merged = mergeHexaSessions(excludePassiveHistorySessions(sessionData), bridgeData);
      const mergedIds = new Set(merged.map((item) => item.session.session_id));
      const watchedOnly = watchedData
        .filter((watched) => !mergedIds.has(watched.session_id))
        .map((watched) => ({
          session: watchedOnlySession(watched),
          source: "watched" as const,
          bridge: null,
        }));
      const mergedWithWatched = [...watchedOnly, ...merged].sort(
        (left, right) =>
          new Date(right.session.last_event_at).getTime() - new Date(left.session.last_event_at).getTime(),
      );
      const snapshots = mergedWithWatched.map((item) =>
        buildSupervisorSession(
          item.session,
          statsByClient,
          readoutBySession,
          watchedBySession.has(item.session.session_id) ? "watched" : item.source,
          item.bridge,
          watchedBySession.get(item.session.session_id) ?? null,
        ),
      );
      const allAlerts = snapshots
        .flatMap((snapshot) => snapshot.alerts.filter(
          (alert) => snapshot.session.status !== "completed" || alert.type === "permission",
        ));

      setSessions(snapshots.map((snapshot) => snapshot.session));
      setAgentStats(statsData);
      setWatchedAgents(watchedAgentData);
      setSupervisorSessions(sortHexaSessions(snapshots));
      setAlerts(allAlerts);
      if (healthData) setBridgeHealth(healthData);
      setQueuedInterventions(queueData);
      if (remoteData) setRemoteControl(remoteData);
      if (mobileData) {
        setMobileBridge(mobileData);
        if (!mobileData.pairing_active) setMobilePairing(null);
      }
      if (configData) setMobileRelayConfig(configData.mobile_relay);
    } catch {
      // Hub may open before the backend is ready.
    }
  }, []);

  const fetchSessions = useMemo(
    () => createCoalescedRefresh(fetchSnapshot),
    [fetchSnapshot],
  );

  const fetchGoalData = useMemo(
    () => createCoalescedRefresh(async () => {
      const requestGeneration = ++goalRefreshGenerationRef.current;
      const [goalResult] = await Promise.allSettled([
        invoke<HexaDevelopmentGoal[]>("get_hexa_development_goals"),
      ]);
      const goalRefresh = resolveWatchRefresh(goalRefreshRef.current, goalResult);
      if (requestGeneration !== goalRefreshGenerationRef.current) return;

      goalRefreshRef.current = goalRefresh;
      setGoalDataState(goalRefresh.state);
      if (goalRefresh.data) setDevelopmentGoals(goalRefresh.data);
    }),
    [],
  );

  const fetchLiveState = useMemo(
    () => createCoalescedRefresh(async () => {
      const [activeResult, watchedResult, healthResult, queueResult] = await Promise.allSettled([
        invoke<HexaSession[]>("get_active_sessions"),
        invoke<HexaWatchedAgent[]>("get_hexa_watched_agents"),
        invoke<CodexBridgeHealth>("get_codex_bridge_health"),
        invoke<QueuedIntervention[]>("get_intervention_queue"),
      ]);

      if (activeResult.status === "fulfilled") {
        setSessions((current) => [
          ...activeResult.value,
          ...current.filter((session) => session.status === "completed"),
        ]);
      }
      if (watchedResult.status === "fulfilled") {
        watchedAgentsRef.current = watchedResult.value;
        watchedExpiryRenderedRef.current = false;
        setWatchedAgents(watchedResult.value);
      }
      if (healthResult.status === "fulfilled") setBridgeHealth(healthResult.value);
      if (queueResult.status === "fulfilled") setQueuedInterventions(queueResult.value);
    }),
    [],
  );

  const fetchWatchedState = useMemo(
    () => createCoalescedRefresh(async () => {
      const action = watchedRefreshAction(
        watchedAgentsRef.current,
        watchedExpiryRenderedRef.current,
      );
      if (action === "idle") return;
      if (action === "render_expired") {
        watchedExpiryRenderedRef.current = true;
        setWatchedAgents((current) => [...current]);
        return;
      }
      const watched = await invoke<HexaWatchedAgent[]>("refresh_hexa_watched_agents");
      watchedAgentsRef.current = watched;
      watchedExpiryRenderedRef.current = false;
      setWatchedAgents(watched);
    }),
    [],
  );

  useEffect(() => {
    fetchSessions();
    fetchGoalData();
    const watchedTimer = window.setInterval(fetchWatchedState, WATCHED_REFRESH_INTERVAL_MS);

    const unlistenHook = listen("humhum://hook-event", () => {
      fetchLiveState();
    });
    const unlistenTimeout = listen("humhum://permission-timeout", () => {
      fetchLiveState();
    });
    const unlistenBridgeSession = listen("humhum://hexa-session-changed", fetchLiveState);
    const unlistenBridgeHealth = listen("humhum://codex-bridge-health", fetchLiveState);
    const unlistenGoalChanged = listen("humhum://hexa-goal-changed", fetchGoalData);
    const unlistenRemoteControl = listen<CodexRemoteControlState>(
      "humhum://codex-remote-control-changed",
      (event) => setRemoteControl(event.payload),
    );

    return () => {
      window.clearInterval(watchedTimer);
      unlistenHook.then((fn) => fn());
      unlistenTimeout.then((fn) => fn());
      unlistenBridgeSession.then((fn) => fn());
      unlistenBridgeHealth.then((fn) => fn());
      unlistenGoalChanged.then((fn) => fn());
      unlistenRemoteControl.then((fn) => fn());
    };
  }, [fetchGoalData, fetchLiveState, fetchSessions, fetchWatchedState]);

  useEffect(() => {
    if (!mobilePairing) return;
    let disposed = false;
    const syncPairingStatus = async () => {
      const state = await invoke<MobileBridgeStatus>("get_mobile_bridge_status").catch(() => null);
      if (disposed || !state) return;
      setMobileBridge(state);
      if (!state.pairing_active) setMobilePairing(null);
    };
    const timer = window.setInterval(syncPairingStatus, 750);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [mobilePairing]);

  const activeSessions = sessions.filter((s) => s.status !== "completed");
  const completedSessions = sessions.filter((s) => s.status === "completed");
  const supervisorBuckets = partitionSupervisorSessions(supervisorSessions);
  const activeSupervisorSessions = supervisorBuckets.active;
  const completedSupervisorSessions = supervisorBuckets.completed;
  const primarySupervisorSessions = supervisorSessions.filter((s) => s.priority === "primary");
  const compatibleSupervisorSessions = supervisorSessions.filter((s) => s.priority === "compatible");
  const retryHexaData = useCallback(async () => {
    await fetchSessions();
  }, [fetchSessions]);

  const retryGoalData = useCallback(async () => {
    await fetchGoalData();
  }, [fetchGoalData]);

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

  const startMobilePairing = useCallback(async (
    scope: "read" | "control" = "read",
    network: "lan" | "tailnet" = "lan",
  ) => {
    const pairing = await invoke<MobilePairingInfo>("start_mobile_pairing", { scope, network });
    setMobilePairing(pairing);
    const state = await invoke<MobileBridgeStatus>("get_mobile_bridge_status");
    setMobileBridge(state);
    if (!state.pairing_active) setMobilePairing(null);
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

  const configureMobileRelay = useCallback(async (
    enabled: boolean,
    rawBaseUrl: string,
    rawInviteCode: string,
  ) => {
    if (mobileBridge.enabled) {
      throw new Error("请先关闭 HUMHUM 移动访问，再修改加密唤醒中继");
    }
    const mobileRelay = normalizeMobileRelayConfig(enabled, rawBaseUrl, rawInviteCode);
    const config = await invoke<AppConfig>("get_config");
    await invoke("save_config", {
      newConfig: { ...config, mobile_relay: mobileRelay },
    });
    setMobileRelayConfig(mobileRelay);
    return mobileRelay;
  }, [mobileBridge.enabled]);

  const deleteWatchedSession = useCallback(async (sessionId: string) => {
    await invoke<HexaWatchedSession[]>("delete_hexa_watched_session", { sessionId });
    await fetchSessions();
  }, [fetchSessions]);

  const acceptGoalAttempt = useCallback(async (goalId: string, sessionId: string) => {
    const updated = await invoke<HexaDevelopmentGoal>("accept_hexa_goal_attempt", {
      request: { goal_id: goalId, session_id: sessionId },
    });
    setDevelopmentGoals((current) => {
      const next = current.map((goal) => goal.id === updated.id ? updated : goal);
      goalRefreshRef.current = { data: next, state: "ready", error: null };
      return next;
    });
    setGoalDataState("ready");
    return updated;
  }, []);

  const deleteDevelopmentGoal = useCallback(async (goalId: string) => {
    const updated = await invoke<HexaDevelopmentGoal[]>("delete_hexa_development_goal", { goalId });
    goalRefreshRef.current = { data: updated, state: "ready", error: null };
    setDevelopmentGoals(updated);
    setGoalDataState("ready");
    return updated;
  }, []);

  const mutateHexaSessionAudit = useCallback(async (request: HexaAuditMutationRequest) => {
    try {
      return await invoke<HexaWatchedSession>("mutate_hexa_session_audit", { request });
    } finally {
      await fetchSessions();
    }
  }, [fetchSessions]);

  return {
    sessions,
    activeSessions,
    completedSessions,
    agentStats,
    watchedAgents,
    supervisorSessions,
    activeSupervisorSessions,
    completedSupervisorSessions,
    primarySupervisorSessions,
    compatibleSupervisorSessions,
    alerts,
    watchDataState,
    retryHexaData,
    developmentGoals,
    goalDataState,
    retryGoalData,
    bridgeHealth,
    remoteControl,
    remotePairing,
    mobileBridge,
    mobilePairing,
    mobileRelayConfig,
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
    configureMobileRelay,
    deleteWatchedSession,
    acceptGoalAttempt,
    deleteDevelopmentGoal,
    mutateHexaSessionAudit,
  };
}
