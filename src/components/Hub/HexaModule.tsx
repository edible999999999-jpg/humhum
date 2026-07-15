import { useEffect, useReducer, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { Activity, ChevronDown, ChevronRight, Clock3, Copy, Crosshair, FileDiff, Flame, Link, Power, RefreshCw, RotateCcw, Save, Send, ShieldCheck, Smartphone, Square, Trash2, WifiOff } from "lucide-react";
import {
  useHexaData,
  type CodexRemoteControlState,
  type CodexRemotePairing,
  type CodexSendReceipt,
  type FocusResult,
  type HexaSupervisorSession,
  type HexaWatchedSession,
  type MobileBridgeStatus,
  type MobilePairingInfo,
  type MobileRelayConfig,
  type QueuedIntervention,
} from "../../hooks/useHexaData";
import { initialWatchDeleteState, watchDeleteReducer } from "../../hooks/hexaWatchState";
import { initialInterventionState, interventionReducer } from "../../hooks/interventionState";
import { mobilePresenceLabel } from "../../hooks/mobilePresence";
import {
  mobilePairingSecondsRemaining,
  shouldShowMobilePairingQr,
} from "../../hooks/mobilePairingQr";
import {
  interventionMatches,
  interventionProviderForClient,
  type InterventionProvider,
} from "../../hooks/interventionProvider";
import type { HexaAgentOverview } from "../../hooks/hexaAgentOverview";
import {
  initialSessionChangesState,
  sessionChangesReducer,
  type GitChangeSummary,
} from "../../hooks/sessionChangesState";
import { HexaActiveMonitor } from "./hexa/HexaActiveMonitor";

const CLIENT_COLORS: Record<string, string> = {
  "claude-code": "#f59e0b",
  codex: "#22c55e",
  qoderwork: "#fb7185",
  qoder: "#fb7185",
  codebuddy: "#f97316",
  workbuddy: "#14b8a6",
  "qwen-code": "#8b5cf6",
  "gemini-cli": "#38bdf8",
  "kimi-k1": "#f97316",
  hermes: "#0f9f8f",
  openclaw: "#e85d4a",
  wukong: "#eab308",
};

const STATUS_COLORS: Record<HexaSupervisorSession["progress_status"], string> = {
  working: "#22c55e",
  waiting: "#facc15",
  looping: "#fb923c",
  stalled: "#f87171",
  idle: "#38bdf8",
  completed: "rgba(255,255,255,0.42)",
};

const HEXA_REGISTER_COMMAND = `npm run hexa:watch -- "请把这里改成这轮任务目标"`;
const HEXA_UPDATE_COMMAND = `npm run hexa:update -- "我正在推进当前步骤"`;
const HEXA_DELETE_COMMAND = `npm run hexa:unwatch`;

function getClientColor(client: string): string {
  return CLIENT_COLORS[client] || "#94eff4";
}

function formatTimeAgo(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

function scoreColor(score: number): string {
  if (score >= 78) return "#22c55e";
  if (score >= 58) return "#38bdf8";
  if (score >= 38) return "#f59e0b";
  return "#f87171";
}

function averageScore(items: HexaSupervisorSession[]): number {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((sum, item) => sum + item.recent_need_score, 0) / items.length);
}

function MetricCard({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string | number;
  tone: string;
  detail: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: 12,
        borderRadius: 8,
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${tone}30`,
      }}
    >
      <div style={{ color: tone, fontSize: 22, lineHeight: 1, fontWeight: 850 }}>{value}</div>
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 11, fontWeight: 750, marginTop: 6 }}>
        {label}
      </div>
      <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginTop: 3, lineHeight: 1.35 }}>
        {detail}
      </div>
    </div>
  );
}

function formatHeartbeat(updatedAt: string | null): string {
  if (!updatedAt) return "No heartbeat";
  const elapsed = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(elapsed) ? `${formatTimeAgo(elapsed)} ago` : "Unknown heartbeat";
}

function WatchedAgentOverview({
  agents,
  selectedAgentId,
  onSelect,
}: {
  agents: HexaAgentOverview[];
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 0, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      {agents.map((agent) => {
        const selected = agent.id === selectedAgentId;
        const statusColor = agent.online ? "#22c55e" : agent.currentStatus === "blocked" ? "#f87171" : "rgba(255,255,255,0.42)";
        const goal = agent.currentRun?.goal ?? "No current goal reported";
        const step = agent.currentRun?.current_step ?? agent.currentRun?.blocked_reason ?? "No current step reported";

        return (
          <button
            key={agent.id}
            type="button"
            aria-expanded={selected}
            onClick={() => onSelect(agent.id)}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 14,
              width: "100%",
              padding: "13px 2px",
              border: 0,
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
                <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 900, overflowWrap: "anywhere" }}>
                  {agent.name}
                </span>
                <span style={{ color: "rgba(255,255,255,0.36)", fontSize: 10, fontWeight: 750 }}>
                  {agent.provider}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: statusColor, fontSize: 10, fontWeight: 850 }}>
                  {agent.online ? <Activity size={12} /> : <WifiOff size={12} />}
                  {agent.online ? "Online" : "Offline"} · {agent.currentStatus}
                </span>
              </div>
              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, overflowWrap: "anywhere" }}>
                {agent.workspace ?? "No workspace declared"}
              </div>
              <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                {goal}
              </div>
              <div style={{ color: "rgba(255,255,255,0.36)", fontSize: 10, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                {step}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.3)", fontSize: 10 }}>
                <Clock3 size={12} /> Last heartbeat {formatHeartbeat(agent.lastHeartbeat)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(42px, 1fr))", gap: 6, alignSelf: "start", minWidth: 112 }}>
              <MiniStat label="total" value={agent.metrics.total} />
              <MiniStat label="done" value={agent.metrics.completed} />
              <MiniStat label="blocked" value={agent.metrics.blocked} />
              <MiniStat label="success" value={`${agent.metrics.successRate}%`} />
              <span style={{ gridColumn: "1 / -1", justifySelf: "end", display: "inline-flex", alignItems: "center", gap: 3, color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 800 }}>
                {selected ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Details
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function WatchedAgentDataState({
  state,
  hasAgents,
  onRetry,
}: {
  state: "loading" | "ready" | "error";
  hasAgents: boolean;
  onRetry: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);

  if (state === "loading") {
    return <div role="status" style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, padding: "14px 0" }}>Loading watched Agents...</div>;
  }

  if (state === "ready" && !hasAgents) {
    return <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 11, padding: "14px 0" }}>No watched Agents yet. Register a run below to start durable supervision.</div>;
  }

  if (state !== "error") return null;

  return (
    <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "9px 10px", borderRadius: 8, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#fca5a5", fontSize: 10 }}>
      <span>{hasAgents ? "Watch store is unavailable. Showing cached Agent data." : "Watch store is unavailable. No cached Agent data is available."}</span>
      <button
        type="button"
        title="Retry watched Agent data"
        aria-label="Retry watched Agent data"
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void onRetry().finally(() => setRetrying(false));
        }}
        className="kawaii-toggle-btn"
        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
      >
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  );
}

function StatusBadge({ item }: { item: HexaSupervisorSession }) {
  const color = STATUS_COLORS[item.progress_status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        background: `${color}16`,
        border: `1px solid ${color}38`,
        color,
        fontSize: 10,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          boxShadow: item.progress_status === "working" ? `0 0 8px ${color}` : "none",
        }}
      />
      {item.progress_label}
    </span>
  );
}

function NeedFitBar({ item }: { item: HexaSupervisorSession }) {
  const color = scoreColor(item.recent_need_score);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
        <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, fontWeight: 750 }}>
          最近需求满足推断
        </span>
        <span style={{ color, fontSize: 11, fontWeight: 850 }}>
          {item.recent_need_score}% · {item.recent_need_label}
        </span>
      </div>
      <div
        style={{
          height: 7,
          borderRadius: 999,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${item.recent_need_score}%`,
            height: "100%",
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 12px ${color}55`,
          }}
        />
      </div>
      <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, marginTop: 5 }}>
        {item.recent_need_basis}
      </div>
    </div>
  );
}

function SessionCard({
  item,
  reviewOpen,
  onToggleReview,
  onSend,
  onInterrupt,
  onResume,
  onResolveApproval,
  onFocus,
  onLoadChanges,
  onDeleteWatched,
  queuedInterventions,
  onRetryIntervention,
  onDiscardIntervention,
  autoConfirmEnabled,
  onToggleAutoConfirm,
}: {
  item: HexaSupervisorSession;
  reviewOpen: boolean;
  onToggleReview: () => void;
  onSend: (threadId: string, message: string) => Promise<CodexSendReceipt>;
  onInterrupt: (threadId: string, turnId: string) => Promise<void>;
  onResume: (threadId: string) => Promise<void>;
  onResolveApproval: (approvalId: string, decision: "allow_once" | "deny") => Promise<void>;
  onFocus: (sessionId: string) => Promise<FocusResult>;
  onLoadChanges: (sessionId: string) => Promise<GitChangeSummary>;
  onDeleteWatched: (sessionId: string) => Promise<void>;
  queuedInterventions: QueuedIntervention[];
  onRetryIntervention: (interventionId: string) => Promise<CodexSendReceipt>;
  onDiscardIntervention: (interventionId: string) => Promise<void>;
  autoConfirmEnabled: boolean;
  onToggleAutoConfirm: (sessionId: string, enabled: boolean) => Promise<void>;
}) {
  const color = getClientColor(item.session.client_type);
  const eventNames = item.session.event_names.slice(-6);
  const isCompleted = item.session.status === "completed";
  const showReadout = !isCompleted || reviewOpen;
  const [focusState, setFocusState] = useState<"idle" | "busy" | "exact" | "fallback" | "failed">("idle");
  const [autoConfirmBusy, setAutoConfirmBusy] = useState(false);
  const [deleteState, dispatchDelete] = useReducer(watchDeleteReducer, initialWatchDeleteState);
  const [changes, dispatchChanges] = useReducer(sessionChangesReducer, initialSessionChangesState);
  const interventionProvider = interventionProviderForClient(item.session.client_type);

  const focusSession = async () => {
    setFocusState("busy");
    try {
      const result = await onFocus(item.session.session_id);
      setFocusState(result.exact ? "exact" : "fallback");
    } catch {
      setFocusState("failed");
    }
  };

  const toggleChanges = async () => {
    if (changes.open) {
      dispatchChanges({ type: "close" });
      return;
    }
    dispatchChanges({ type: "open" });
    if (changes.summary) return;
    dispatchChanges({ type: "load" });
    try {
      dispatchChanges({
        type: "success",
        summary: await onLoadChanges(item.session.session_id),
      });
    } catch (cause) {
      dispatchChanges({ type: "failure", error: String(cause) });
    }
  };

  const reloadChanges = async () => {
    dispatchChanges({ type: "load" });
    try {
      dispatchChanges({
        type: "success",
        summary: await onLoadChanges(item.session.session_id),
      });
    } catch (cause) {
      dispatchChanges({ type: "failure", error: String(cause) });
    }
  };

  return (
    <article
      style={{
        borderRadius: 8,
        background: "rgba(255,255,255,0.026)",
        border: "1px solid rgba(255,255,255,0.065)",
        borderLeft: `3px solid ${color}`,
        padding: 14,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
            <span style={{ color, fontSize: 11, fontWeight: 850 }}>{item.agent_label}</span>
            {item.source === "watched" && (
              <span
                style={{
                  color: "#34d399",
                  background: "rgba(52,211,153,0.1)",
                  border: "1px solid rgba(52,211,153,0.24)",
                  borderRadius: 999,
                  padding: "4px 8px",
                  fontSize: 10,
                  fontWeight: 850,
                }}
              >
                Hexa 托管
              </span>
            )}
            <StatusBadge item={item} />
            {item.session.route?.remote_host && (
              <span style={{ color: "#38bdf8", fontSize: 10, fontWeight: 750, overflowWrap: "anywhere" }}>
                SSH · {item.session.route.remote_host}
              </span>
            )}
            {item.pending_confirmations > 0 && (
              <span
                style={{
                  color: "#facc15",
                  background: "rgba(250,204,21,0.1)",
                  border: "1px solid rgba(250,204,21,0.24)",
                  borderRadius: 999,
                  padding: "4px 8px",
                  fontSize: 10,
                  fontWeight: 850,
                }}
              >
                等待确认
              </span>
            )}
          </div>
          <h3
            style={{
              margin: 0,
              color: "rgba(255,255,255,0.9)",
              fontSize: 15,
              lineHeight: 1.25,
              overflowWrap: "anywhere",
            }}
          >
            {item.display_name}
          </h3>
          <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.52)", fontSize: 12, lineHeight: 1.45 }}>
            {item.project_intent}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ textAlign: "right", minWidth: 42 }}>
            <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 18, fontWeight: 850 }}>
              {item.session.event_count}
            </div>
            <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>events</div>
          </div>
          {item.source === "watched" && (
            <button
              type="button"
              title={deleteState.error ? "删除失败，点击重试" : "从 Hexa 托管中删除"}
              aria-label="从 Hexa 托管中删除"
              disabled={deleteState.pending}
              onClick={() => {
                dispatchDelete({ type: "start" });
                void onDeleteWatched(item.session.session_id)
                  .then(() => dispatchDelete({ type: "success" }))
                  .catch((cause) => dispatchDelete({
                    type: "failure",
                    error: cause instanceof Error ? cause.message : String(cause),
                  }));
              }}
              className="kawaii-toggle-btn"
              style={{ width: 34, height: 34, padding: 0, display: "grid", placeItems: "center" }}
            >
              <Trash2 size={14} />
            </button>
          )}
          {!isCompleted && item.session.client_type === "claude-code" && (
            <button
              type="button"
              title={autoConfirmEnabled ? "关闭这个会话的自动批准" : "只为这个会话自动批准权限"}
              aria-label={autoConfirmEnabled ? "关闭单会话自动批准" : "开启单会话自动批准"}
              disabled={autoConfirmBusy}
              onClick={() => {
                setAutoConfirmBusy(true);
                void onToggleAutoConfirm(item.session.session_id, !autoConfirmEnabled)
                  .catch((cause) => console.error("Could not change session auto-approve", cause))
                  .finally(() => setAutoConfirmBusy(false));
              }}
              className={`kawaii-toggle-btn ${autoConfirmEnabled ? "connected" : ""}`}
              style={{ width: 34, height: 34, padding: 0, display: "grid", placeItems: "center" }}
            >
              <Flame size={15} />
            </button>
          )}
          <button
            type="button"
            title={focusState === "failed" ? "定位失败，点击重试" : "返回这个 Agent 会话"}
            aria-label="返回这个 Agent 会话"
            disabled={focusState === "busy"}
            onClick={() => void focusSession()}
            className="kawaii-toggle-btn"
            style={{ width: 34, height: 34, padding: 0, display: "grid", placeItems: "center" }}
          >
            <Crosshair size={15} />
          </button>
        </div>
      </div>

      {deleteState.error && (
        <div role="alert" style={{ color: "#fca5a5", fontSize: 10, lineHeight: 1.45 }}>
          删除失败：{deleteState.error}。点击删除按钮重试。
        </div>
      )}

      {focusState !== "idle" && focusState !== "busy" && (
        <div
          role="status"
          style={{
            minHeight: 14,
            marginTop: -6,
            color: focusState === "failed" ? "#f87171" : focusState === "exact" ? "#22c55e" : "#38bdf8",
            fontSize: 10,
            textAlign: "right",
          }}
        >
          {focusState === "exact" ? "已准确返回原会话" : focusState === "fallback" ? "已打开对应终端" : "定位失败，点击按钮重试"}
        </div>
      )}

      <NeedFitBar item={item} />

      {isCompleted && (
        <button
          type="button"
          onClick={onToggleReview}
          style={{
            width: "fit-content",
            border: `1px solid ${color}42`,
            background: `${color}12`,
            color,
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 11,
            fontWeight: 850,
            cursor: "pointer",
          }}
        >
          {reviewOpen ? "收起复盘" : "打开复盘"}
        </button>
      )}

      {showReadout && (
        <>
          <ReadoutBlock title="用户最近想要" text={item.recent_user_intent} tone="#38bdf8" />
          <ReadoutBlock title="Agent 正在做" text={item.current_work} tone={color} />
          <ReadoutBlock title="感官反馈" text={item.performance_read} tone={scoreColor(item.recent_need_score)} />
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <MiniStat label="last seen" value={formatTimeAgo(item.last_seen_ms)} />
        <MiniStat label="evidence" value={item.evidence.length} />
        <MiniStat label="loop" value={item.loop_status} />
      </div>

      {item.session.cwd && (
        <div style={{ display: "grid", gap: 8, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            type="button"
            onClick={() => void toggleChanges()}
            className="kawaii-toggle-btn"
            style={{ width: "fit-content", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <FileDiff size={14} />
            {changes.open ? "收起本轮改动" : "查看本轮改动"}
          </button>
          {changes.open && changes.status === "loading" && (
            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10 }}>正在读取本地 Git 状态...</div>
          )}
          {changes.open && changes.status === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#f87171", fontSize: 10, overflowWrap: "anywhere" }}>{changes.error}</span>
              <button type="button" onClick={() => void reloadChanges()} className="kawaii-toggle-btn" title="重试读取" aria-label="重试读取">
                <RefreshCw size={13} />
              </button>
            </div>
          )}
          {changes.open && changes.status === "ready" && changes.summary && (
            <SessionChangeSummary summary={changes.summary} />
          )}
        </div>
      )}

      {showReadout && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
          <ChipGroup title="判断依据" values={item.evidence.length ? item.evidence.slice(0, 4) : ["暂无依据"]} />
          <ChipGroup title="事件轨迹" values={eventNames.length ? eventNames : ["等待事件"]} />
        </div>
      )}

      {showReadout && <ReviewAction item={item} />}

      {interventionProvider && (
        <CodexIntervention
          item={item}
          provider={interventionProvider}
          onSend={onSend}
          onInterrupt={onInterrupt}
          onResume={onResume}
          onResolveApproval={onResolveApproval}
          queuedInterventions={queuedInterventions}
          onRetryIntervention={onRetryIntervention}
          onDiscardIntervention={onDiscardIntervention}
        />
      )}

      {item.alerts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {item.alerts.map((alert) => (
            <span
              key={`${item.session.session_id}-${alert.type}-${alert.message}`}
              style={{
                color: "#f59e0b",
                background: "rgba(245,158,11,0.09)",
                border: "1px solid rgba(245,158,11,0.22)",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 750,
              }}
            >
              {alert.message}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function SessionChangeSummary({ summary }: { summary: GitChangeSummary }) {
  if (summary.total_files === 0) {
    return <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10 }}>工作区目前没有未提交改动</div>;
  }
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "rgba(255,255,255,0.48)", fontSize: 10 }}>
        <span>{summary.branch || "detached HEAD"}</span>
        <span>{summary.total_files} 个文件</span>
        {summary.truncated && <span>仅显示前 {summary.files.length} 个</span>}
      </div>
      {summary.files.map((file) => (
        <div
          key={`${file.status}-${file.path}`}
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr) auto",
            gap: 8,
            alignItems: "center",
            minWidth: 0,
            padding: "5px 0",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <span style={{ color: file.staged ? "#22c55e" : "#38bdf8", fontSize: 9, fontWeight: 850 }}>
            {file.staged ? "已暂存" : file.status === "untracked" ? "新文件" : file.status}
          </span>
          <span style={{ minWidth: 0, color: "rgba(255,255,255,0.68)", fontSize: 10, overflowWrap: "anywhere" }}>
            {file.path}
          </span>
          <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 9, whiteSpace: "nowrap" }}>
            {file.binary ? "binary" : <><span style={{ color: "#22c55e" }}>+{file.insertions}</span> <span style={{ color: "#f87171" }}>-{file.deletions}</span></>}
          </span>
        </div>
      ))}
    </div>
  );
}

function CodexIntervention({
  item,
  provider,
  onSend,
  onInterrupt,
  onResume,
  onResolveApproval,
  queuedInterventions,
  onRetryIntervention,
  onDiscardIntervention,
}: {
  item: HexaSupervisorSession;
  provider: InterventionProvider;
  onSend: (threadId: string, message: string) => Promise<CodexSendReceipt>;
  onInterrupt: (threadId: string, turnId: string) => Promise<void>;
  onResume: (threadId: string) => Promise<void>;
  onResolveApproval: (approvalId: string, decision: "allow_once" | "deny") => Promise<void>;
  queuedInterventions: QueuedIntervention[];
  onRetryIntervention: (interventionId: string) => Promise<CodexSendReceipt>;
  onDiscardIntervention: (interventionId: string) => Promise<void>;
}) {
  const [delivery, dispatchDelivery] = useReducer(interventionReducer, initialInterventionState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCodex = provider === "codex";
  const agentLabel = provider === "claude"
    ? "Claude"
    : provider === "opencode"
      ? "OpenCode"
      : "Codex";
  const threadId = isCodex
    ? item.bridge?.provider_thread_id ?? item.session.session_id
    : item.session.session_id;
  const currentTurnId = item.bridge?.current_turn_id;
  const sending = delivery.status === "sending";

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    const message = delivery.draft.trim();
    if (!message || sending) return;
    dispatchDelivery({ type: "send" });
    try {
      const receipt = await onSend(threadId, message);
      dispatchDelivery({ type: receipt.status });
    } catch (cause) {
      dispatchDelivery({ type: "failed", error: String(cause) });
    }
  };

  return (
    <div style={{ display: "grid", gap: 8, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      {queuedInterventions.map((queued) => (
        <div
          key={queued.id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto",
            gap: 7,
            alignItems: "center",
            padding: 9,
            borderRadius: 8,
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.2)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#f87171", fontSize: 10, fontWeight: 850 }}>
              {queued.status === "sending" ? "正在重试" : `待重试 · 已尝试 ${queued.attempts} 次`}
            </div>
            <div style={{ color: "rgba(255,255,255,0.64)", fontSize: 11, lineHeight: 1.4, marginTop: 3, overflowWrap: "anywhere" }}>
              {queued.message}
            </div>
            {queued.last_error && (
              <div style={{ color: "rgba(248,113,113,0.72)", fontSize: 9, marginTop: 3, overflowWrap: "anywhere" }}>
                {queued.last_error}
              </div>
            )}
          </div>
          <button
            type="button"
            title="重试发送"
            aria-label="重试发送"
            disabled={busy || queued.status === "sending"}
            onClick={() => run(() => onRetryIntervention(queued.id))}
            className="kawaii-toggle-btn connected"
            style={{ width: 34, height: 34, padding: 0, display: "grid", placeItems: "center" }}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            title="放弃这条指令"
            aria-label="放弃这条指令"
            disabled={busy || queued.status === "sending"}
            onClick={() => run(() => onDiscardIntervention(queued.id))}
            className="kawaii-toggle-btn"
            style={{ width: 34, height: 34, padding: 0, display: "grid", placeItems: "center" }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {isCodex && item.pending_approvals.map((approval) => (
        <div key={approval.approval_id} style={{ display: "grid", gap: 7, padding: 9, borderRadius: 8, background: "rgba(250,204,21,0.07)", border: "1px solid rgba(250,204,21,0.2)" }}>
          <div style={{ color: "rgba(255,255,255,0.66)", fontSize: 11, lineHeight: 1.45 }}>{approval.summary}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" disabled={busy} onClick={() => run(() => onResolveApproval(approval.approval_id, "allow_once"))} className="kawaii-toggle-btn connected">允许一次</button>
            <button type="button" disabled={busy} onClick={() => run(() => onResolveApproval(approval.approval_id, "deny"))} className="kawaii-toggle-btn">拒绝</button>
          </div>
        </div>
      ))}

      {!isCodex || item.can_intervene ? (
        <div style={{ display: "grid", gridTemplateColumns: isCodex ? "minmax(0, 1fr) auto auto" : "minmax(0, 1fr) auto", gap: 7 }}>
          <input
            value={delivery.draft}
            onChange={(event) => dispatchDelivery({ type: "draft", value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && delivery.draft.trim() && !busy && !sending) {
                void sendMessage();
              }
            }}
            placeholder={`给 ${agentLabel} 发后续指令`}
            className="kawaii-input"
          />
          <button
            type="button"
            title="发送"
            disabled={busy || sending || !delivery.draft.trim()}
            onClick={() => void sendMessage()}
            className="kawaii-toggle-btn connected"
          ><Send size={15} /></button>
          {isCodex && (currentTurnId ? (
            <button type="button" title="中断当前回合" disabled={busy} onClick={() => run(() => onInterrupt(threadId, currentTurnId))} className="kawaii-toggle-btn"><Square size={14} /></button>
          ) : (
            <button type="button" title="恢复会话" disabled={busy} onClick={() => run(() => onResume(threadId))} className="kawaii-toggle-btn"><RotateCcw size={15} /></button>
          ))}
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => run(() => onResume(threadId))} className="kawaii-toggle-btn" style={{ width: "fit-content" }}>
          <RotateCcw size={14} /> 由 HUMHUM 恢复后介入
        </button>
      )}
      <div
        role="status"
        style={{
          minHeight: 14,
          color: delivery.status === "failed"
            ? "#f87171"
            : delivery.status === "delivered"
              ? "#22c55e"
              : delivery.status === "queued"
                ? "#38bdf8"
                : "rgba(255,255,255,0.28)",
          fontSize: 10,
          overflowWrap: "anywhere",
        }}
      >
        {delivery.status === "sending"
          ? "正在发送..."
          : delivery.status === "queued"
            ? "前一条指令尚未送达，当前指令已安全排队"
          : delivery.status === "delivered"
            ? `已送达 ${agentLabel} 会话`
            : delivery.status === "failed"
              ? `发送失败，指令已保留，可重试：${delivery.error}`
              : ""}
      </div>
      {error && <div style={{ color: "#f87171", fontSize: 10, overflowWrap: "anywhere" }}>{error}</div>}
    </div>
  );
}

function RemoteAccessPanel({
  state,
  pairing,
  onEnable,
  onDisable,
  onPair,
}: {
  state: CodexRemoteControlState;
  pairing: CodexRemotePairing | null;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onPair: () => Promise<CodexRemotePairing>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };
  const connected = state.status === "connected";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: 10, padding: 11, marginBottom: 14, borderRadius: 8, background: "rgba(56,189,248,0.045)", border: "1px solid rgba(56,189,248,0.16)" }}>
      <Smartphone size={18} color={connected ? "#22c55e" : "#38bdf8"} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: 850 }}>Codex Mobile Remote</div>
        <div style={{ color: "rgba(255,255,255,0.34)", fontSize: 10, marginTop: 3, overflowWrap: "anywhere" }}>{pairing?.manual_pairing_code ? `配对码: ${pairing.manual_pairing_code}` : state.message}</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {connected ? (
          <button type="button" title="关闭移动访问" disabled={busy} onClick={() => run(onDisable)} className="kawaii-toggle-btn"><Power size={15} /></button>
        ) : (
          <>
            <button type="button" title="开启移动访问" disabled={busy || state.status === "unavailable"} onClick={() => run(onEnable)} className="kawaii-toggle-btn connected"><Power size={15} /></button>
            <button type="button" title="生成配对码" disabled={busy || state.status === "unavailable"} onClick={() => run(onPair)} className="kawaii-toggle-btn"><Link size={15} /></button>
          </>
        )}
      </div>
    </div>
  );
}

function HumHumMobilePanel({
  state,
  pairing,
  relayConfig,
  onEnable,
  onDisable,
  onPair,
  onRevoke,
  onRevokeDevice,
  onConfigureRelay,
}: {
  state: MobileBridgeStatus;
  pairing: MobilePairingInfo | null;
  relayConfig: MobileRelayConfig;
  onEnable: () => Promise<MobileBridgeStatus>;
  onDisable: () => Promise<MobileBridgeStatus>;
  onPair: (scope?: "read" | "control", network?: "lan" | "tailnet") => Promise<MobilePairingInfo>;
  onRevoke: () => Promise<MobileBridgeStatus>;
  onRevokeDevice: (deviceId: string) => Promise<MobileBridgeStatus>;
  onConfigureRelay: (enabled: boolean, baseUrl: string) => Promise<MobileRelayConfig>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [network, setNetwork] = useState<"lan" | "tailnet">("lan");
  const [nowMs, setNowMs] = useState(Date.now());
  const [relayEnabled, setRelayEnabled] = useState(relayConfig.enabled);
  const [relayUrl, setRelayUrl] = useState(relayConfig.base_url ?? "");
  useEffect(() => {
    if (!state.tailnet_url) setNetwork("lan");
  }, [state.tailnet_url]);
  useEffect(() => {
    setRelayEnabled(relayConfig.enabled);
    setRelayUrl(relayConfig.base_url ?? "");
  }, [relayConfig]);
  useEffect(() => {
    if (!pairing) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  const pairingSeconds = pairing
    ? mobilePairingSecondsRemaining(pairing.expires_at, nowMs)
    : 0;
  const pairingQrVisible = pairing
    ? shouldShowMobilePairingQr(state.pairing_active, pairing.expires_at, nowMs)
    : false;
  const detail = pairing
    ? pairingQrVisible
      ? `${copied ? "Android 配对资料已复制 · " : ""}配对码 ${pairing.code} · ${pairing.network === "tailnet" ? "Tailnet" : "同网 LAN"} · ${pairing.scope === "control" ? "可控制" : "只读"} · 剩余 ${Math.ceil(pairingSeconds / 60)} 分钟`
      : "配对二维码已过期，请重新生成"
    : state.enabled
      ? `${state.lan_url ?? state.url} · ${state.paired_devices} 台设备`
      : "默认关闭；开启后仅同一局域网可见";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: 10, padding: 11, marginBottom: 10, borderRadius: 8, background: "rgba(34,197,94,0.045)", border: "1px solid rgba(34,197,94,0.16)" }}>
      <Smartphone size={18} color={state.enabled ? "#22c55e" : "#86a7d5"} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: 850 }}>HUMHUM Mobile Web</div>
        <div style={{ color: error ? "#f87171" : "rgba(255,255,255,0.34)", fontSize: 10, marginTop: 3, overflowWrap: "anywhere" }}>{error ?? detail}</div>
        {state.enabled && state.certificate_fingerprint && (
          <div title={state.certificate_fingerprint} style={{ color: "rgba(255,255,255,0.22)", fontSize: 9, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            TLS {state.certificate_fingerprint}
          </div>
        )}
        {state.enabled && state.tailnet_url && (
          <div
            role="group"
            aria-label="Android 配对网络"
            style={{ display: "inline-flex", gap: 2, padding: 2, marginTop: 6, borderRadius: 7, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {(["lan", "tailnet"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={network === option}
                onClick={() => setNetwork(option)}
                style={{ border: 0, borderRadius: 5, padding: "4px 8px", background: network === option ? "rgba(34,197,94,0.16)" : "transparent", color: network === option ? "#86efac" : "rgba(255,255,255,0.38)", fontSize: 9, fontWeight: 800, cursor: "pointer" }}
              >
                {option === "lan" ? "同网 LAN" : "外出 Tailnet"}
              </button>
            ))}
          </div>
        )}
        {!state.enabled && (
          <div style={{ display: "grid", gridTemplateColumns: "auto minmax(120px, 1fr) auto", alignItems: "center", gap: 6, marginTop: 7 }}>
            <label title="让手机跨网络收到加密的变化提醒" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.45)", fontSize: 9, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={relayEnabled}
                onChange={(event) => setRelayEnabled(event.target.checked)}
              />
              加密唤醒
            </label>
            <input
              aria-label="加密唤醒中继 URL"
              type="url"
              value={relayUrl}
              disabled={!relayEnabled || busy}
              placeholder="https://relay.example.com"
              onChange={(event) => setRelayUrl(event.target.value)}
              style={{ minWidth: 0, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.16)", color: "rgba(255,255,255,0.72)", padding: "0 8px", fontSize: 9 }}
            />
            <button
              type="button"
              title="保存加密唤醒设置"
              aria-label="保存加密唤醒设置"
              disabled={busy}
              onClick={() => run(() => onConfigureRelay(relayEnabled, relayUrl))}
              className="kawaii-icon-btn"
              style={{ width: 28, height: 28, minWidth: 28 }}
            ><Save size={13} /></button>
          </div>
        )}
        {state.enabled && (
          <div style={{ color: state.relay_status === "errored" ? "#f87171" : "rgba(255,255,255,0.3)", fontSize: 9, marginTop: 4, overflowWrap: "anywhere" }}>
            加密唤醒 · {state.relay_status === "disabled" ? "未启用" : state.relay_status === "connected" ? "已连接" : state.relay_status === "retrying" ? "正在重试" : "连接异常"}{state.relay_url ? ` · ${state.relay_url}` : ""}
          </div>
        )}
        {state.devices.map((device) => (
          <div key={device.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 7, marginTop: 5, color: "rgba(255,255,255,0.42)", fontSize: 9 }}>
            <span title={device.last_seen_at ?? "尚未收到在线状态"} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {device.name} · {device.scope === "control" ? "可控制" : "只读"} · {mobilePresenceLabel(device.presence_mode)}
            </span>
            <button type="button" title={`撤销 ${device.name}`} aria-label={`撤销 ${device.name}`} disabled={busy} onClick={() => run(() => onRevokeDevice(device.id))} className="kawaii-icon-btn" style={{ width: 24, height: 24, minWidth: 24 }}><Trash2 size={12} /></button>
          </div>
        ))}
        {pairing?.android_setup && pairingQrVisible && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div aria-label="Android 配对二维码" style={{ display: "grid", placeItems: "center", width: 176, height: 176, padding: 8, borderRadius: 6, background: "#ffffff", flex: "0 0 auto" }}>
              <QRCodeSVG
                value={pairing.android_setup}
                size={160}
                bgColor="#ffffff"
                fgColor="#111827"
                level="M"
                marginSize={4}
                title="HUMHUM Android 安全配对"
              />
            </div>
            <div style={{ minWidth: 150, flex: "1 1 160px" }}>
              <div style={{ color: "rgba(255,255,255,0.78)", fontSize: 11, fontWeight: 850 }}>手机扫码连接</div>
              <div style={{ marginTop: 5, color: "rgba(255,255,255,0.58)", fontSize: 11, lineHeight: 1.6 }}>
                Android 打开 HUMHUM，点击“扫描 Mac 配对二维码”。
              </div>
              <div style={{ marginTop: 5, color: "#86efac", fontSize: 10, fontWeight: 750 }}>
                {`${pairing.network === "tailnet" ? "Tailnet" : "同一网络"} · ${pairing.scope === "control" ? "可控制" : "只读"} · ${pairingSeconds} 秒`}
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6, maxWidth: 144 }}>
        {state.enabled ? (
          <>
            {pairing?.android_setup && (
              <button
                type="button"
                title="复制 Android 配对资料"
                aria-label="复制 Android 配对资料"
                disabled={busy}
                onClick={() => run(async () => {
                  await navigator.clipboard.writeText(pairing.android_setup);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 3000);
                })}
                className="kawaii-toggle-btn"
              ><Copy size={15} /></button>
            )}
            <button type="button" title="生成只读配对码" aria-label="生成只读配对码" disabled={busy} onClick={() => run(() => onPair("read", network))} className="kawaii-toggle-btn connected"><Link size={15} /></button>
            <button type="button" title="生成可控制配对码" aria-label="生成可控制配对码" disabled={busy} onClick={() => run(() => onPair("control", network))} className="kawaii-toggle-btn"><ShieldCheck size={15} /></button>
            {state.paired_devices > 0 && <button type="button" title="撤销全部移动设备" aria-label="撤销全部移动设备" disabled={busy} onClick={() => run(onRevoke)} className="kawaii-toggle-btn"><Trash2 size={15} /></button>}
            <button type="button" title="关闭 HUMHUM 移动访问" aria-label="关闭 HUMHUM 移动访问" disabled={busy} onClick={() => run(onDisable)} className="kawaii-toggle-btn"><Power size={15} /></button>
          </>
        ) : (
          <button type="button" title="开启 HUMHUM 移动访问" aria-label="开启 HUMHUM 移动访问" disabled={busy} onClick={() => run(onEnable)} className="kawaii-toggle-btn connected"><Power size={15} /></button>
        )}
      </div>
    </div>
  );
}

function ReviewAction({ item }: { item: HexaSupervisorSession }) {
  const isCompleted = item.session.status === "completed";
  return (
    <div
      style={{
        padding: "10px 11px",
        borderRadius: 8,
        background: isCompleted ? "rgba(34,197,94,0.055)" : "rgba(255,255,255,0.025)",
        border: isCompleted ? "1px solid rgba(34,197,94,0.18)" : "1px solid rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.56)",
        fontSize: 11,
        lineHeight: 1.5,
        display: "grid",
        gap: 7,
      }}
    >
      <div style={{ color: isCompleted ? "#22c55e" : "rgba(255,255,255,0.36)", fontWeight: 850 }}>
        {isCompleted ? "复盘结论" : "建议提醒"}
      </div>
      <div>{item.suggested_nudge}</div>
      {isCompleted && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
          <MiniStat label="fit score" value={`${item.recent_need_score}%`} />
          <MiniStat label="evidence" value={item.evidence.length} />
          <MiniStat label="events" value={item.session.event_count} />
        </div>
      )}
    </div>
  );
}

function ReadoutBlock({ title, text, tone }: { title: string; text: string; tone: string }) {
  return (
    <div
      style={{
        padding: "9px 10px",
        borderRadius: 8,
        background: `${tone}0d`,
        border: `1px solid ${tone}24`,
      }}
    >
      <div style={{ color: tone, fontSize: 10, fontWeight: 850, marginBottom: 4 }}>{title}</div>
      <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "8px 9px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.16)",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ color: "rgba(255,255,255,0.26)", fontSize: 9, marginBottom: 3 }}>{label}</div>
      <div
        style={{
          color: "rgba(255,255,255,0.7)",
          fontSize: 12,
          fontWeight: 800,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ChipGroup({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: 750, marginBottom: 5 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {values.map((value, index) => (
          <span
            key={`${title}-${value}-${index}`}
            style={{
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "3px 7px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.045)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 10,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: 32,
        borderRadius: 8,
        background: "rgba(255,255,255,0.018)",
        border: "1px dashed rgba(255,255,255,0.08)",
        textAlign: "center",
      }}
    >
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 13, fontWeight: 800 }}>
        暂无会话
      </div>
      <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 11, marginTop: 6 }}>
        agent hook 产生事件后，这里会显示当前工作状态和最近需求推进度。
      </div>
    </div>
  );
}

function SessionSection({
  title,
  count,
  detail,
  children,
}: {
  title: string;
  count: number;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 11, fontWeight: 900 }}>
          {title} <span style={{ color: "rgba(255,255,255,0.28)" }}>({count})</span>
        </div>
        <div style={{ color: "rgba(255,255,255,0.24)", fontSize: 10 }}>{detail}</div>
      </div>
      {children}
    </div>
  );
}

function WatchCommandPanel() {
  const [copied, setCopied] = useState<"register" | "update" | "delete" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const copy = async (kind: "register" | "update" | "delete", command: string) => {
    await navigator.clipboard.writeText(command);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div
      style={{
        display: "grid",
        gap: expanded ? 10 : 8,
        padding: 10,
        marginBottom: 14,
        borderRadius: 8,
        background: "rgba(52,211,153,0.055)",
        border: "1px solid rgba(52,211,153,0.18)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: 900 }}>主动加入 Hexa 托管</div>
          <div style={{ color: "rgba(255,255,255,0.34)", fontSize: 10, lineHeight: 1.45, marginTop: 4 }}>
            自动扫描会按 Agent 折叠。任何 agent 只要看到用户说“重点监控这个会话”，就应该执行下面短命令绑定到 Hexa。
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="kawaii-toggle-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起命令" : "展开命令"}
          </button>
          <button type="button" className="kawaii-toggle-btn connected" onClick={() => void copy("register", HEXA_REGISTER_COMMAND)}>
            <Copy size={14} /> {copied === "register" ? "已复制" : "复制注册命令"}
          </button>
        </div>
      </div>
      {expanded ? (
        <>
          <pre
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 8,
              background: "rgba(0,0,0,0.22)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.72)",
              fontSize: 10,
              lineHeight: 1.45,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {HEXA_REGISTER_COMMAND}
          </pre>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>
              后续进展用 update；结束托管用 unwatch。界面里托管卡片右上角也有删除按钮。
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="kawaii-toggle-btn" onClick={() => void copy("update", HEXA_UPDATE_COMMAND)}>
                <Send size={14} /> {copied === "update" ? "已复制" : "复制更新命令"}
              </button>
              <button type="button" className="kawaii-toggle-btn" onClick={() => void copy("delete", HEXA_DELETE_COMMAND)}>
                <Trash2 size={14} /> {copied === "delete" ? "已复制" : "复制删除命令"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.16)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(255,255,255,0.62)",
            fontSize: 10,
            fontFamily: "monospace",
            overflowWrap: "anywhere",
          }}
        >
          {HEXA_REGISTER_COMMAND}
        </div>
      )}
    </div>
  );
}

function AgentSessionGroup({
  agent,
  count,
  collapsed,
  onToggle,
  children,
}: {
  agent: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: collapsed ? 0 : 8,
        padding: 8,
        borderRadius: 8,
        background: "rgba(255,255,255,0.018)",
        border: "1px solid rgba(255,255,255,0.065)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          width: "100%",
          border: 0,
          background: "transparent",
          color: "rgba(255,255,255,0.64)",
          padding: "4px 2px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 900 }}>{collapsed ? "▸" : "▾"} {agent}</span>
        <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>{count} scanned sessions</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

export function HexaModule() {
  const {
    activeSupervisorSessions,
    completedSupervisorSessions,
    watchedAgents,
    supervisorSessions,
    alerts,
    watchDataState,
    retryHexaData,
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
    mutateHexaSessionAudit,
  } = useHexaData();
  const [openReviews, setOpenReviews] = useState<Set<string>>(new Set());
  const [autoConfirmSessions, setAutoConfirmSessions] = useState<Set<string>>(new Set());
  const [collapsedAgentGroups, setCollapsedAgentGroups] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<"watched" | "scanned">("watched");

  useEffect(() => {
    void invoke<string[]>("get_auto_confirm_sessions")
      .then((sessions) => setAutoConfirmSessions(new Set(sessions)))
      .catch(() => setAutoConfirmSessions(new Set()));
  }, []);

  const toggleAutoConfirm = async (sessionId: string, enabled: boolean) => {
    const sessions = await invoke<string[]>("set_session_auto_confirm", { sessionId, enabled });
    setAutoConfirmSessions(new Set(sessions));
  };

  const recentActivity = activeSupervisorSessions;
  const active = recentActivity.filter((item) => item.progress_status !== "idle");
  const recentCompleted = completedSupervisorSessions.slice(0, 6);
  const watchedSupervisorSessions = supervisorSessions.filter((item) => item.source === "watched" && item.watched);
  const watchedSessions = watchedAgents.flatMap((agent) => agent.runs);
  const watchedSupervisorBySessionId = new Map(
    watchedSupervisorSessions.map((item) => [item.session.session_id, item]),
  );
  const discoveredSessions = recentActivity.filter((item) => item.source !== "watched");
  const historicalSessions = recentCompleted.filter((item) => item.source !== "watched");
  const secondarySessions = [...discoveredSessions, ...historicalSessions];
  const pendingCount = active.reduce((sum, item) => sum + item.pending_confirmations, 0);
  const workingCount = active.filter((item) => item.progress_status === "working").length;
  const attentionCount = active.filter((item) =>
    ["waiting", "looping", "stalled"].includes(item.progress_status),
  ).length;
  const toggleReview = (sessionId: string) => {
    setOpenReviews((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };
  const renderSessionGrid = (items: HexaSupervisorSession[]) => (
    <div className="hexa-session-details" style={{ display: "grid", gap: 10 }}>
      {items.map((item) => {
        const provider = interventionProviderForClient(item.session.client_type);
        const threadId = provider === "codex"
          ? item.bridge?.provider_thread_id ?? item.session.session_id
          : item.session.session_id;
        const sendMessage = provider === "claude"
          ? sendClaudeMessage
          : provider === "opencode"
            ? sendOpenCodeMessage
            : sendCodexMessage;
        const retryMessage = provider === "claude"
          ? retryClaudeMessage
          : provider === "opencode"
            ? retryOpenCodeMessage
            : retryCodexMessage;
        return (
          <SessionCard
            key={item.session.session_id}
            item={item}
            reviewOpen={openReviews.has(item.session.session_id)}
            onToggleReview={() => toggleReview(item.session.session_id)}
            onSend={sendMessage}
            onInterrupt={interruptCodexTurn}
            onResume={resumeCodexThread}
            onResolveApproval={resolveCodexApproval}
            onFocus={focusAgentSession}
            onLoadChanges={getSessionChangeSummary}
            onDeleteWatched={deleteWatchedSession}
            queuedInterventions={provider
              ? queuedInterventions.filter((queued) => interventionMatches(queued, provider, threadId))
              : []}
            onRetryIntervention={retryMessage}
            onDiscardIntervention={discardQueuedIntervention}
            autoConfirmEnabled={autoConfirmSessions.has(item.session.session_id)}
            onToggleAutoConfirm={toggleAutoConfirm}
          />
        );
      })}
    </div>
  );
  const discoveredGroups = Array.from(
    discoveredSessions.reduce((groups, item) => {
      const key = item.agent_label;
      groups.set(key, [...(groups.get(key) ?? []), item]);
      return groups;
    }, new Map<string, HexaSupervisorSession[]>()),
  );
  const toggleAgentGroup = (agent: string) => {
    setCollapsedAgentGroups((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };
  const renderWatchedOperations = (session: HexaWatchedSession) => {
    const item = watchedSupervisorBySessionId.get(session.session_id);
    if (!item) return null;
    const provider = interventionProviderForClient(item.session.client_type);
    const threadId = provider === "codex"
      ? item.bridge?.provider_thread_id ?? item.session.session_id
      : item.session.session_id;
    const sendMessage = provider === "claude"
      ? sendClaudeMessage
      : provider === "opencode"
        ? sendOpenCodeMessage
        : sendCodexMessage;
    const retryMessage = provider === "claude"
      ? retryClaudeMessage
      : provider === "opencode"
        ? retryOpenCodeMessage
        : retryCodexMessage;

    return (
      <section className="hexa-report-section" aria-label="会话操作">
        <div className="hexa-report-section-title">
          <span><Activity size={15} /> 人工介入</span>
          {item.session.client_type === "claude-code" && (
            <button
              type="button"
              className={`kawaii-toggle-btn ${autoConfirmSessions.has(session.session_id) ? "connected" : ""}`}
              title={autoConfirmSessions.has(session.session_id) ? "关闭本会话自动批准" : "开启本会话自动批准"}
              onClick={() => void toggleAutoConfirm(session.session_id, !autoConfirmSessions.has(session.session_id))}
            >
              <Flame size={14} /> {autoConfirmSessions.has(session.session_id) ? "狂暴模式已开" : "狂暴模式"}
            </button>
          )}
        </div>
        {provider && (
          <CodexIntervention
            item={item}
            provider={provider}
            onSend={sendMessage}
            onInterrupt={interruptCodexTurn}
            onResume={resumeCodexThread}
            onResolveApproval={resolveCodexApproval}
            queuedInterventions={queuedInterventions.filter((queued) => interventionMatches(queued, provider, threadId))}
            onRetryIntervention={retryMessage}
            onDiscardIntervention={discardQueuedIntervention}
          />
        )}
      </section>
    );
  };

  return (
    <div className="hub-module">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <h2 className="hub-module-title" style={{ marginBottom: 4 }}>Hexa 会话监督</h2>
          <p className="hub-module-desc">
            主动监控每一轮目标、进度和结果；自动扫描只负责发现，不混入可信结论。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, color: "#7b8ba0", fontSize: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: bridgeHealth.status === "connected" ? "#22c55e" : bridgeHealth.status === "starting" ? "#facc15" : "#f87171" }} />
            {bridgeHealth.message}
          </div>
        </div>
      </div>

      <div className="hexa-top-tabs" role="tablist" aria-label="Hexa 会话区域">
        <button type="button" role="tab" aria-selected={activeSection === "watched"} className={`hexa-top-tab ${activeSection === "watched" ? "active" : ""}`} onClick={() => setActiveSection("watched")}>
          <strong>主动监控 · {watchedSessions.length}</strong>
          <span>可信报告与人工介入</span>
        </button>
        <button type="button" role="tab" aria-selected={activeSection === "scanned"} className={`hexa-top-tab ${activeSection === "scanned" ? "active" : ""}`} onClick={() => setActiveSection("scanned")}>
          <strong>自动扫描 · {secondarySessions.length}</strong>
          <span>发现会话与历史样本</span>
        </button>
      </div>

      {activeSection === "watched" ? (
        <HexaActiveMonitor
          sessions={watchedSessions}
          supervisorBySessionId={watchedSupervisorBySessionId}
          dataState={watchDataState}
          onRetry={retryHexaData}
          onFocus={focusAgentSession}
          onDelete={deleteWatchedSession}
          renderOperations={renderWatchedOperations}
          entryPanel={(
            <div style={{ display: "grid", gap: 10 }}>
              <WatchCommandPanel />
              <RemoteAccessPanel
                state={remoteControl}
                pairing={remotePairing}
                onEnable={enableCodexRemoteControl}
                onDisable={disableCodexRemoteControl}
                onPair={startCodexRemotePairing}
              />
              <HumHumMobilePanel
                state={mobileBridge}
                pairing={mobilePairing}
                relayConfig={mobileRelayConfig}
                onEnable={enableMobileBridge}
                onDisable={disableMobileBridge}
                onPair={startMobilePairing}
                onRevoke={revokeMobileDevices}
                onRevokeDevice={revokeMobileDevice}
                onConfigureRelay={configureMobileRelay}
              />
            </div>
          )}
        />
      ) : (
        <section style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <MetricCard label="活跃会话" value={active.length} tone="#22c55e" detail={`${workingCount} 个正在推进`} />
            <MetricCard label="需要关注" value={attentionCount} tone="#f59e0b" detail={`${pendingCount} 个等待确认`} />
            <MetricCard label="最近完成" value={recentCompleted.length} tone="#38bdf8" detail="保留最近 6 个复盘样本" />
            <MetricCard label="告警信号" value={alerts.length} tone="#f87171" detail="停滞、循环、低进展" />
          </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div
            style={{
              color: "rgba(255,255,255,0.42)",
              fontSize: 11,
              fontWeight: 850,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            自动扫描会话 ({secondarySessions.length})
          </div>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>
            这里只展示发现结果，不把启发式判断冒充主动监控结论
          </div>
        </div>

        {secondarySessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {discoveredSessions.length > 0 && (
              <SessionSection title="发现到" count={discoveredSessions.length} detail="来自 hook、Codex bridge 或本地会话扫描">
                <div style={{ display: "grid", gap: 8 }}>
                  {discoveredGroups.map(([agent, items]) => (
                    <AgentSessionGroup
                      key={agent}
                      agent={agent}
                      count={items.length}
                      collapsed={collapsedAgentGroups.has(agent)}
                      onToggle={() => toggleAgentGroup(agent)}
                    >
                      {renderSessionGrid(items)}
                    </AgentSessionGroup>
                  ))}
                </div>
              </SessionSection>
            )}
            {historicalSessions.length > 0 && (
              <SessionSection title="历史复盘" count={historicalSessions.length} detail="最近完成的会话样本，不参与活跃监控">
                {renderSessionGrid(historicalSessions)}
              </SessionSection>
            )}
          </div>
        )}
        </section>
      )}
    </div>
  );
}
