import { useReducer, useState } from "react";
import { Crosshair, FileDiff, Link, Power, RefreshCw, RotateCcw, Send, ShieldCheck, Smartphone, Square, Trash2 } from "lucide-react";
import {
  useHexaData,
  type CodexRemoteControlState,
  type CodexRemotePairing,
  type CodexSendReceipt,
  type FocusResult,
  type HexaSupervisorSession,
  type MobileBridgeStatus,
  type MobilePairingInfo,
  type QueuedIntervention,
} from "../../hooks/useHexaData";
import { initialInterventionState, interventionReducer } from "../../hooks/interventionState";
import {
  interventionMatches,
  interventionProviderForClient,
  type InterventionProvider,
} from "../../hooks/interventionProvider";
import {
  initialSessionChangesState,
  sessionChangesReducer,
  type GitChangeSummary,
} from "../../hooks/sessionChangesState";

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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
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
  queuedInterventions,
  onRetryIntervention,
  onDiscardIntervention,
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
  queuedInterventions: QueuedIntervention[];
  onRetryIntervention: (interventionId: string) => Promise<CodexSendReceipt>;
  onDiscardIntervention: (interventionId: string) => Promise<void>;
}) {
  const color = getClientColor(item.session.client_type);
  const eventNames = item.session.event_names.slice(-6);
  const stats = item.stats;
  const isCompleted = item.session.status === "completed";
  const showReadout = !isCompleted || reviewOpen;
  const [focusState, setFocusState] = useState<"idle" | "busy" | "exact" | "fallback" | "failed">("idle");
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
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: 8, alignItems: "start" }}>
          <div style={{ textAlign: "right", minWidth: 42 }}>
            <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 18, fontWeight: 850 }}>
              {item.session.event_count}
            </div>
            <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>events</div>
          </div>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        <MiniStat label="last seen" value={formatTimeAgo(item.last_seen_ms)} />
        <MiniStat label="evidence" value={item.evidence.length} />
        <MiniStat label="tokens" value={stats ? formatTokens(stats.total_tokens) : "-"} />
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
  onEnable,
  onDisable,
  onPair,
  onRevoke,
  onRevokeDevice,
}: {
  state: MobileBridgeStatus;
  pairing: MobilePairingInfo | null;
  onEnable: () => Promise<MobileBridgeStatus>;
  onDisable: () => Promise<MobileBridgeStatus>;
  onPair: (scope?: "read" | "control") => Promise<MobilePairingInfo>;
  onRevoke: () => Promise<MobileBridgeStatus>;
  onRevokeDevice: (deviceId: string) => Promise<MobileBridgeStatus>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  const detail = pairing
    ? `配对码 ${pairing.code} · ${pairing.scope === "control" ? "可控制" : "只读"} · 5 分钟内有效`
    : state.enabled
      ? `${state.url} · ${state.paired_devices} 台设备`
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
        {state.devices.map((device) => (
          <div key={device.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 7, marginTop: 5, color: "rgba(255,255,255,0.42)", fontSize: 9 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {device.name} · {device.scope === "control" ? "可控制" : "只读"}
            </span>
            <button type="button" title={`撤销 ${device.name}`} aria-label={`撤销 ${device.name}`} disabled={busy} onClick={() => run(() => onRevokeDevice(device.id))} className="kawaii-icon-btn" style={{ width: 24, height: 24, minWidth: 24 }}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {state.enabled ? (
          <>
            <button type="button" title="生成只读配对码" aria-label="生成只读配对码" disabled={busy} onClick={() => run(() => onPair("read"))} className="kawaii-toggle-btn connected"><Link size={15} /></button>
            <button type="button" title="生成可控制配对码" aria-label="生成可控制配对码" disabled={busy} onClick={() => run(() => onPair("control"))} className="kawaii-toggle-btn"><ShieldCheck size={15} /></button>
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

export function HexaModule() {
  const {
    activeSupervisorSessions,
    completedSupervisorSessions,
    supervisorSessions,
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
  } = useHexaData();
  const [openReviews, setOpenReviews] = useState<Set<string>>(new Set());

  const active = activeSupervisorSessions;
  const recentCompleted = completedSupervisorSessions.slice(0, 6);
  const visibleSessions = [...active, ...recentCompleted];
  const pendingCount = active.reduce((sum, item) => sum + item.pending_confirmations, 0);
  const workingCount = active.filter((item) => item.progress_status === "working").length;
  const attentionCount = active.filter((item) =>
    ["waiting", "looping", "stalled"].includes(item.progress_status),
  ).length;
  const score = averageScore(visibleSessions);
  const toggleReview = (sessionId: string) => {
    setOpenReviews((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  return (
    <div className="hub-module">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 className="hub-module-title" style={{ marginBottom: 4 }}>Hexa Agent 看板</h2>
          <p className="hub-module-desc">
            每个活跃会话一张感官反馈卡：项目是什么、用户最近想要什么、agent 干得如何。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, color: "rgba(255,255,255,0.34)", fontSize: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: bridgeHealth.status === "connected" ? "#22c55e" : bridgeHealth.status === "starting" ? "#facc15" : "#f87171" }} />
            {bridgeHealth.message}
          </div>
        </div>
        <div
          style={{
            color: scoreColor(score),
            background: `${scoreColor(score)}14`,
            border: `1px solid ${scoreColor(score)}34`,
            borderRadius: 8,
            padding: "9px 11px",
            textAlign: "right",
            minWidth: 96,
          }}
        >
          <div style={{ fontSize: 22, lineHeight: 1, fontWeight: 900 }}>{score || "-"}</div>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginTop: 4 }}>avg need fit</div>
        </div>
      </div>

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
        onEnable={enableMobileBridge}
        onDisable={disableMobileBridge}
        onPair={startMobilePairing}
        onRevoke={revokeMobileDevices}
        onRevokeDevice={revokeMobileDevice}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
        <MetricCard label="活跃会话" value={active.length} tone="#22c55e" detail={`${workingCount} 个正在推进`} />
        <MetricCard label="需要关注" value={attentionCount} tone="#f59e0b" detail={`${pendingCount} 个等待确认`} />
        <MetricCard label="最近完成" value={recentCompleted.length} tone="#38bdf8" detail="保留最近 6 个复盘样本" />
        <MetricCard label="告警信号" value={alerts.length} tone="#f87171" detail="停滞、循环、低进展" />
      </div>

      <section style={{ display: "grid", gap: 10 }}>
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
            Sessions ({supervisorSessions.length})
          </div>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>
            score 优先基于 transcript 最近用户消息 + hook 事件推断
          </div>
        </div>

        {visibleSessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {visibleSessions.map((item) => {
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
                  queuedInterventions={provider
                    ? queuedInterventions.filter((queued) => interventionMatches(queued, provider, threadId))
                    : []}
                  onRetryIntervention={retryMessage}
                  onDiscardIntervention={discardQueuedIntervention}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
