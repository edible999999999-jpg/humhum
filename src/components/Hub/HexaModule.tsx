import { useEffect, useReducer, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { Activity, ChevronDown, ChevronRight, Clock3, Copy, Crosshair, FileDiff, Flame, Link, Power, QrCode, RefreshCw, RotateCcw, Save, Send, ShieldCheck, Smartphone, Square, Trash2, WifiOff } from "lucide-react";
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
import {
  initialInterventionState,
  interventionReducer,
  type InterventionState,
} from "../../hooks/interventionState";
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
  completed: "#64748b",
};

const HEXA_REGISTER_COMMAND = `~/.humhum/bin/humhum-hexa watch "请把这里改成这轮任务目标"`;
const HEXA_UPDATE_COMMAND = `~/.humhum/bin/humhum-hexa update "我正在推进当前步骤"`;
const HEXA_DELETE_COMMAND = `~/.humhum/bin/humhum-hexa unwatch`;

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

function MetricSummaryItem({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string | number;
  tone: "progress" | "attention" | "complete" | "alert";
  detail: string;
}) {
  return (
    <div className="hexa-metric-summary-item" data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

export function HexaMetricSummary({
  items,
}: {
  items: Array<{
    label: string;
    value: string | number;
    tone: "progress" | "attention" | "complete" | "alert";
    detail: string;
  }>;
}) {
  return (
    <div className="hexa-metric-summary" aria-label="自动扫描摘要">
      {items.map((item) => (
        <MetricSummaryItem key={item.label} {...item} />
      ))}
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
        const statusColor = agent.online ? "#22c55e" : agent.currentStatus === "blocked" ? "#f87171" : "#64748b";
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
                <span style={{ color: "#475569", fontSize: 13, fontWeight: 900, overflowWrap: "anywhere" }}>
                  {agent.name}
                </span>
                <span style={{ color: "#7b8ba0", fontSize: 10, fontWeight: 750 }}>
                  {agent.provider}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: statusColor, fontSize: 10, fontWeight: 850 }}>
                  {agent.online ? <Activity size={12} /> : <WifiOff size={12} />}
                  {agent.online ? "Online" : "Offline"} · {agent.currentStatus}
                </span>
              </div>
              <div style={{ color: "#7b8ba0", fontSize: 10, overflowWrap: "anywhere" }}>
                {agent.workspace ?? "No workspace declared"}
              </div>
              <div style={{ color: "#475569", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                {goal}
              </div>
              <div style={{ color: "#7b8ba0", fontSize: 10, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                {step}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#7b8ba0", fontSize: 10 }}>
                <Clock3 size={12} /> Last heartbeat {formatHeartbeat(agent.lastHeartbeat)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(42px, 1fr))", gap: 6, alignSelf: "start", minWidth: 112 }}>
              <MiniStat label="total" value={agent.metrics.total} />
              <MiniStat label="done" value={agent.metrics.completed} />
              <MiniStat label="blocked" value={agent.metrics.blocked} />
              <MiniStat label="success" value={`${agent.metrics.successRate}%`} />
              <span style={{ gridColumn: "1 / -1", justifySelf: "end", display: "inline-flex", alignItems: "center", gap: 3, color: "#7b8ba0", fontSize: 10, fontWeight: 800 }}>
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
    return <div role="status" style={{ color: "#7b8ba0", fontSize: 11, padding: "14px 0" }}>Loading watched Agents...</div>;
  }

  if (state === "ready" && !hasAgents) {
    return <div style={{ color: "#7b8ba0", fontSize: 11, padding: "14px 0" }}>No watched Agents yet. Register a run below to start durable supervision.</div>;
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

export async function startOrRefreshMobilePairing(
  state: MobileBridgeStatus,
  pairing: MobilePairingInfo | null,
  onEnable: () => Promise<MobileBridgeStatus>,
  onPair: (scope?: "read" | "control", network?: "lan" | "tailnet") => Promise<MobilePairingInfo>,
): Promise<MobilePairingInfo> {
  if (!state.enabled) await onEnable();
  return onPair(pairing?.scope ?? "read", pairing?.network ?? "lan");
}

export function HexaMobilePairingCard({
  state,
  pairing,
  onEnable,
  onPair,
}: {
  state: MobileBridgeStatus;
  pairing: MobilePairingInfo | null;
  onEnable: () => Promise<MobileBridgeStatus>;
  onPair: (scope?: "read" | "control", network?: "lan" | "tailnet") => Promise<MobilePairingInfo>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!pairing) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const secondsRemaining = pairing
    ? mobilePairingSecondsRemaining(pairing.expires_at, nowMs)
    : 0;
  const qrVisible = pairing
    ? shouldShowMobilePairingQr(state.pairing_active, pairing.expires_at, nowMs)
    : false;
  const pairingExpanded = qrVisible && Boolean(pairing?.android_setup);
  const actionLabel = pairingExpanded ? "刷新配对二维码" : "生成配对二维码";

  const refreshPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      await startOrRefreshMobilePairing(state, pairing, onEnable, onPair);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="hexa-mobile-pairing"
      aria-label="Hexa 手机连接"
      data-expanded={pairingExpanded ? "true" : "false"}
    >
      {pairingExpanded && pairing?.android_setup ? (
        <div className="hexa-mobile-pairing-panel">
          <div className="hexa-mobile-pairing-qr" aria-label="Hexa 手机配对二维码">
            <QRCodeSVG
              value={pairing.android_setup}
              size={120}
              bgColor="#ffffff"
              fgColor="#111827"
              level="M"
              marginSize={4}
              title="HUMHUM Android 安全配对"
            />
          </div>
          <div className="hexa-mobile-pairing-copy">
            <div className="hexa-mobile-pairing-title">
              <Smartphone size={16} />
              <span>在手机查看 Hexa</span>
            </div>
            <div className="hexa-mobile-pairing-detail">Android HUMHUM 扫码连接</div>
            <div className="hexa-mobile-pairing-status">
              {pairing.network === "tailnet" ? "Tailnet" : "同一 Wi-Fi"} · {pairing.scope === "control" ? "可控制" : "只读"} · 剩余 {Math.max(1, Math.ceil(secondsRemaining / 60))} 分钟
            </div>
            <button
              type="button"
              className="hexa-mobile-pairing-action"
              aria-label={actionLabel}
              title={actionLabel}
              disabled={busy}
              onClick={() => void refreshPairing()}
            >
              <RefreshCw size={14} className={busy ? "hexa-mobile-refreshing" : undefined} />
              {busy ? "正在刷新" : "刷新二维码"}
            </button>
          </div>
        </div>
      ) : (
        <div className="hexa-mobile-affordance">
          <Smartphone size={17} aria-hidden="true" />
          <div className="hexa-mobile-affordance-copy">
            <strong>在手机查看 Hexa</strong>
            <span>
              {error ?? (state.paired_devices > 0
                ? `已连接 ${state.paired_devices} 台设备，也可以重新配对`
                : "生成二维码后，用 Android HUMHUM 扫描")}
            </span>
            <small>默认只读 · 同一 Wi-Fi · 5 分钟有效</small>
          </div>
          <button
            type="button"
            className="hexa-mobile-pairing-action"
            aria-label={actionLabel}
            title={actionLabel}
            disabled={busy}
            onClick={() => void refreshPairing()}
          >
            <QrCode size={15} />
            {busy ? "正在生成" : "生成二维码"}
          </button>
        </div>
      )}
      {error && pairingExpanded && <div className="hexa-mobile-pairing-error">{error}</div>}
    </aside>
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
        borderRadius: 6,
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
        <span style={{ color: "#7b8ba0", fontSize: 10, fontWeight: 750 }}>
          最近需求满足推断
        </span>
        <span style={{ color, fontSize: 11, fontWeight: 850 }}>
          {item.recent_need_score}% · {item.recent_need_label}
        </span>
      </div>
      <div
        style={{
          height: 7,
          borderRadius: 4,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${item.recent_need_score}%`,
            height: "100%",
            borderRadius: 4,
            background: color,
            boxShadow: `0 0 12px ${color}55`,
          }}
        />
      </div>
      <div style={{ color: "#7b8ba0", fontSize: 10, marginTop: 5 }}>
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
                  borderRadius: 6,
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
                  borderRadius: 6,
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
              color: "#475569",
              fontSize: 15,
              lineHeight: 1.25,
              overflowWrap: "anywhere",
            }}
          >
            {item.display_name}
          </h3>
          <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 12, lineHeight: 1.45 }}>
            {item.project_intent}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ textAlign: "right", minWidth: 42 }}>
            <div style={{ color: "#475569", fontSize: 18, fontWeight: 850 }}>
              {item.session.event_count}
            </div>
            <div style={{ color: "#7b8ba0", fontSize: 10 }}>events</div>
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
            <div style={{ color: "#7b8ba0", fontSize: 10 }}>正在读取本地 Git 状态...</div>
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
                borderRadius: 6,
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
    return <div style={{ color: "#7b8ba0", fontSize: 10 }}>工作区目前没有未提交改动</div>;
  }
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "#7b8ba0", fontSize: 10 }}>
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
          <span style={{ minWidth: 0, color: "#475569", fontSize: 10, overflowWrap: "anywhere" }}>
            {file.path}
          </span>
          <span style={{ color: "#7b8ba0", fontSize: 9, whiteSpace: "nowrap" }}>
            {file.binary ? "binary" : <><span style={{ color: "#22c55e" }}>+{file.insertions}</span> <span style={{ color: "#f87171" }}>-{file.deletions}</span></>}
          </span>
        </div>
      ))}
    </div>
  );
}

const DELIVERY_STATUS_COLORS: Record<InterventionState["status"], string> = {
  idle: "#7b8ba0",
  sending: "#526579",
  queued: "#1f70a8",
  delivered: "#25775c",
  failed: "#b23a53",
};

export function HexaInterventionDeliveryStatus({
  status,
  agentLabel,
  error,
}: {
  status: InterventionState["status"];
  agentLabel: string;
  error: string | null;
}) {
  const message = status === "sending"
    ? "正在发送..."
    : status === "queued"
      ? "前一条指令尚未送达，当前指令已安全排队"
      : status === "delivered"
        ? `已送达 ${agentLabel} 会话`
        : status === "failed"
          ? `发送失败，指令已保留，可重试：${error}`
          : "";

  return (
    <div
      role="status"
      className={`hexa-intervention-delivery is-${status}`}
      data-status={status}
      style={{
        minHeight: 14,
        color: DELIVERY_STATUS_COLORS[status],
        fontSize: 10,
        overflowWrap: "anywhere",
      }}
    >
      {message}
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
            <div style={{ color: "#475569", fontSize: 11, lineHeight: 1.4, marginTop: 3, overflowWrap: "anywhere" }}>
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
          <div style={{ color: "#475569", fontSize: 11, lineHeight: 1.45 }}>{approval.summary}</div>
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
      <HexaInterventionDeliveryStatus
        status={delivery.status}
        agentLabel={agentLabel}
        error={delivery.error}
      />
      {error && <div style={{ color: "#f87171", fontSize: 10, overflowWrap: "anywhere" }}>{error}</div>}
    </div>
  );
}

export function HexaRemoteAccessPanel({
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
    <section className="hexa-binding-section hexa-remote-access">
      <Smartphone size={18} color={connected ? "#22c55e" : "#38bdf8"} />
      <div className="hexa-binding-copy">
        <strong>Codex Mobile Remote</strong>
        <span>{pairing?.manual_pairing_code ? `配对码: ${pairing.manual_pairing_code}` : state.message}</span>
      </div>
      <div className="hexa-binding-actions">
        {connected ? (
          <button type="button" title="关闭移动访问" disabled={busy} onClick={() => run(onDisable)} className="kawaii-toggle-btn"><Power size={15} /></button>
        ) : (
          <>
            <button type="button" title="开启移动访问" disabled={busy || state.status === "unavailable"} onClick={() => run(onEnable)} className="kawaii-toggle-btn connected"><Power size={15} /></button>
            <button type="button" title="生成配对码" disabled={busy || state.status === "unavailable"} onClick={() => run(onPair)} className="kawaii-toggle-btn"><Link size={15} /></button>
          </>
        )}
      </div>
    </section>
  );
}

export function HexaMobileAccessPanel({
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
  onConfigureRelay: (
    enabled: boolean,
    baseUrl: string,
    inviteCode: string,
  ) => Promise<MobileRelayConfig>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [network, setNetwork] = useState<"lan" | "tailnet">("lan");
  const [nowMs, setNowMs] = useState(Date.now());
  const [relayEnabled, setRelayEnabled] = useState(relayConfig.enabled);
  const [relayUrl, setRelayUrl] = useState(relayConfig.base_url ?? "");
  const [relayInvite, setRelayInvite] = useState(relayConfig.invite_code ?? "");
  useEffect(() => {
    if (!state.tailnet_url) setNetwork("lan");
  }, [state.tailnet_url]);
  useEffect(() => {
    setRelayEnabled(relayConfig.enabled);
    setRelayUrl(relayConfig.base_url ?? "");
    setRelayInvite(relayConfig.invite_code ?? "");
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
    <section className="hexa-binding-section hexa-mobile-access">
      <Smartphone size={18} color={state.enabled ? "#22c55e" : "#86a7d5"} />
      <div className="hexa-binding-copy hexa-mobile-access-copy">
        <strong>HUMHUM Mobile Web</strong>
        <span className={error ? "is-error" : undefined}>{error ?? detail}</span>
        {state.enabled && state.certificate_fingerprint && (
          <small className="hexa-mobile-fingerprint" title={state.certificate_fingerprint}>
            TLS {state.certificate_fingerprint}
          </small>
        )}
        {state.enabled && state.tailnet_url && (
          <div
            role="group"
            aria-label="Android 配对网络"
            className="hexa-mobile-network-control"
          >
            {(["lan", "tailnet"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={network === option}
                onClick={() => setNetwork(option)}
                className={network === option ? "is-active" : undefined}
              >
                {option === "lan" ? "同网 LAN" : "外出 Tailnet"}
              </button>
            ))}
          </div>
        )}
        {!state.enabled && (
          <div className="hexa-mobile-relay-form">
            <label title="让手机在 5G 或其他 Wi-Fi 安全连接这台 Mac">
              <input
                type="checkbox"
                checked={relayEnabled}
                onChange={(event) => setRelayEnabled(event.target.checked)}
              />
              Anywhere 内测
            </label>
            <div className="hexa-mobile-relay-fields">
              <input
                aria-label="Anywhere 中继 URL"
                type="url"
                value={relayUrl}
                disabled={!relayEnabled || busy}
                placeholder="https://relay.example.com"
                onChange={(event) => setRelayUrl(event.target.value)}
                className="hexa-binding-input"
              />
              <input
                aria-label="Anywhere 内测邀请码"
                type="password"
                value={relayInvite}
                disabled={!relayEnabled || busy}
                placeholder="内测邀请码"
                autoComplete="off"
                onChange={(event) => setRelayInvite(event.target.value)}
                className="hexa-binding-input"
              />
            </div>
            <button
              type="button"
              title="保存 Anywhere 设置"
              aria-label="保存 Anywhere 设置"
              disabled={busy}
              onClick={() => run(() => onConfigureRelay(
                relayEnabled,
                relayUrl,
                relayInvite,
              ))}
              className="kawaii-icon-btn"
              style={{ width: 28, height: 28, minWidth: 28 }}
            ><Save size={13} /></button>
          </div>
        )}
        {state.enabled && (
          <div className={`hexa-mobile-relay-status ${state.relay_status === "errored" ? "is-error" : ""}`}>
            加密唤醒 · {state.relay_status === "disabled" ? "未启用" : state.relay_status === "connected" ? "已连接" : state.relay_status === "retrying" ? "正在重试" : "连接异常"}{state.relay_url ? ` · ${state.relay_url}` : ""}
          </div>
        )}
        {state.devices.map((device) => (
          <div key={device.id} className="hexa-mobile-device">
            <span title={device.last_seen_at ?? "尚未收到在线状态"}>
              {device.name} · {device.scope === "control" ? "可控制" : "只读"} · {mobilePresenceLabel(device.presence_mode)}
            </span>
            <button type="button" title={`撤销 ${device.name}`} aria-label={`撤销 ${device.name}`} disabled={busy} onClick={() => run(() => onRevokeDevice(device.id))} className="kawaii-icon-btn" style={{ width: 24, height: 24, minWidth: 24 }}><Trash2 size={12} /></button>
          </div>
        ))}
        {pairing?.android_setup && pairingQrVisible && (
          <div className="hexa-mobile-setup">
            <div aria-label="Android 配对二维码" className="hexa-mobile-setup-qr">
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
            <div className="hexa-mobile-setup-copy">
              <strong>手机扫码连接</strong>
              <span>
                Android 打开 HUMHUM，点击“扫描电脑配对二维码”。
              </span>
              <small>
                {`${pairing.network === "tailnet" ? "Tailnet" : "同一网络"} · ${pairing.scope === "control" ? "可控制" : "只读"} · ${pairingSeconds} 秒`}
              </small>
            </div>
          </div>
        )}
      </div>
      <div className="hexa-binding-actions hexa-mobile-access-actions">
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
    </section>
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
        color: "#475569",
        fontSize: 11,
        lineHeight: 1.5,
        display: "grid",
        gap: 7,
      }}
    >
      <div style={{ color: isCompleted ? "#22c55e" : "#526579", fontWeight: 850 }}>
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
      <div style={{ color: "#475569", fontSize: 12, lineHeight: 1.5 }}>
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
      <div style={{ color: "#7b8ba0", fontSize: 9, marginBottom: 3 }}>{label}</div>
      <div
        style={{
          color: "#475569",
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
      <div style={{ color: "#7b8ba0", fontSize: 10, fontWeight: 750, marginBottom: 5 }}>
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
              color: "#7b8ba0",
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
      <div style={{ color: "#475569", fontSize: 13, fontWeight: 800 }}>
        暂无会话
      </div>
      <div style={{ color: "#7b8ba0", fontSize: 11, marginTop: 6 }}>
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
    <div className="hexa-scanned-group">
      <div className="hexa-scanned-group-heading">
        <strong>
          {title} <span>({count})</span>
        </strong>
        <small>{detail}</small>
      </div>
      {children}
    </div>
  );
}

export function HexaWatchCommandPanel() {
  const [copied, setCopied] = useState<"register" | "update" | "delete" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const copy = async (kind: "register" | "update" | "delete", command: string) => {
    await navigator.clipboard.writeText(command);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <section className={`hexa-binding-section hexa-watch-command ${expanded ? "is-expanded" : ""}`}>
      <div className="hexa-watch-command-heading">
        <div className="hexa-binding-copy">
          <strong>主动加入 Hexa 托管</strong>
          <span>
            已接入的 Agent 在任何项目里看到“重点监控这个会话”后，都会用全局 Connector 绑定真实会话，不再依赖当前项目的 npm 脚本。
          </span>
        </div>
        <div className="hexa-binding-actions">
          <button type="button" className="kawaii-toggle-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起命令" : "展开命令"}
          </button>
          <button type="button" className="kawaii-toggle-btn connected" onClick={() => void copy("register", HEXA_REGISTER_COMMAND)}>
            <Copy size={14} /> {copied === "register" ? "已复制" : "复制注册命令"}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="hexa-watch-command-details">
          <pre>{HEXA_REGISTER_COMMAND}</pre>
          <div className="hexa-watch-command-footer">
            <span>
              后续进展用 update；结束托管用 unwatch。Agent 没有结构化计划能力时，Hexa 会明确说明，不会伪造工作项。
            </span>
            <div className="hexa-binding-actions">
              <button type="button" className="kawaii-toggle-btn" onClick={() => void copy("update", HEXA_UPDATE_COMMAND)}>
                <Send size={14} /> {copied === "update" ? "已复制" : "复制更新命令"}
              </button>
              <button type="button" className="kawaii-toggle-btn" onClick={() => void copy("delete", HEXA_DELETE_COMMAND)}>
                <Trash2 size={14} /> {copied === "delete" ? "已复制" : "复制删除命令"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <code className="hexa-watch-command-preview">{HEXA_REGISTER_COMMAND}</code>
      )}
    </section>
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
    <div className={`hexa-scanned-agent ${collapsed ? "is-collapsed" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        className="hexa-scanned-agent-toggle"
      >
        <strong>{collapsed ? "▸" : "▾"} {agent}</strong>
        <small>{count} scanned sessions</small>
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
    <div className="hub-module hexa-room-module">
      <div className="hexa-heading-row">
        <div className="hexa-heading-copy">
          <h2 className="hub-module-title" style={{ marginBottom: 4 }}>Hexa 会话监督</h2>
          <p className="hub-module-desc">
            主动监控每一轮目标、进度和结果；自动扫描只负责发现，不混入可信结论。
          </p>
          <div className="hexa-bridge-health" role="status">
            <span
              className={`hexa-bridge-health-dot is-${bridgeHealth.status}`}
              aria-hidden="true"
            />
            <span>{bridgeHealth.message}</span>
          </div>
        </div>
        <HexaMobilePairingCard
          state={mobileBridge}
          pairing={mobilePairing}
          onEnable={enableMobileBridge}
          onPair={startMobilePairing}
        />
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
          onMutate={mutateHexaSessionAudit}
          renderOperations={renderWatchedOperations}
          entryPanel={(
            <div className="hexa-binding-stack">
              <HexaWatchCommandPanel />
              <HexaRemoteAccessPanel
                state={remoteControl}
                pairing={remotePairing}
                onEnable={enableCodexRemoteControl}
                onDisable={disableCodexRemoteControl}
                onPair={startCodexRemotePairing}
              />
              <HexaMobileAccessPanel
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
        <section className="hexa-scanned-section">
          <HexaMetricSummary
            items={[
              { label: "活跃会话", value: active.length, tone: "progress", detail: `${workingCount} 个正在推进` },
              { label: "需要关注", value: attentionCount, tone: "attention", detail: `${pendingCount} 个等待确认` },
              { label: "最近完成", value: recentCompleted.length, tone: "complete", detail: "保留最近 6 个复盘样本" },
              { label: "告警信号", value: alerts.length, tone: "alert", detail: "停滞、循环、低进展" },
            ]}
          />
        <div className="hexa-scanned-heading">
          <strong>自动扫描会话 ({secondarySessions.length})</strong>
          <span>
            这里只展示发现结果，不把启发式判断冒充主动监控结论
          </span>
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
