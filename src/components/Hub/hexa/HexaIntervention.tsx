import { useReducer, useState } from "react";
import { RefreshCw, RotateCcw, Send, Square, Trash2 } from "lucide-react";
import {
  type AgentSendReceipt,
  type HexaSupervisorSession,
  type QueuedIntervention,
} from "../../../hooks/useHexaData";
import {
  initialInterventionState,
  interventionReducer,
  type InterventionState,
} from "../../../hooks/interventionState";
import { type InterventionProvider } from "../../../hooks/interventionProvider";
import { t } from "@/lib/i18n";

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
    ? t("hexa.ivSending")
    : status === "queued"
      ? t("hexa.ivQueued")
      : status === "delivered"
        ? t("hexa.ivDelivered", { agent: agentLabel })
        : status === "failed"
          ? t("hexa.ivSendFailed", { error: error ?? "" })
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

export function AgentIntervention({
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
  onSend: (threadId: string, message: string) => Promise<AgentSendReceipt>;
  onInterrupt: (threadId: string, turnId: string) => Promise<void>;
  onResume: (threadId: string) => Promise<void>;
  onResolveApproval: (approvalId: string, decision: "allow_once" | "deny") => Promise<void>;
  queuedInterventions: QueuedIntervention[];
  onRetryIntervention: (interventionId: string) => Promise<AgentSendReceipt>;
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
    <div
      className="hexa-intervention-composer"
      style={{
        display: "grid",
        gap: 8,
        paddingTop: 10,
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
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
              {queued.status === "sending" ? t("hexa.ivRetrying") : t("hexa.ivRetryPending", { count: queued.attempts })}
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
            title={t("hexa.ivRetrySend")}
            aria-label={t("hexa.ivRetrySend")}
            disabled={busy || queued.status === "sending"}
            onClick={() => run(() => onRetryIntervention(queued.id))}
            className="kawaii-toggle-btn connected"
            style={{ width: 34, height: 34, padding: 0, display: "grid", placeItems: "center" }}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            title={t("hexa.ivDiscard")}
            aria-label={t("hexa.ivDiscard")}
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
            <button type="button" disabled={busy} onClick={() => run(() => onResolveApproval(approval.approval_id, "allow_once"))} className="kawaii-toggle-btn connected">{t("hexa.ivAllowOnce")}</button>
            <button type="button" disabled={busy} onClick={() => run(() => onResolveApproval(approval.approval_id, "deny"))} className="kawaii-toggle-btn">{t("hexa.ivDeny")}</button>
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
            placeholder={t("hexa.ivFollowUpPlaceholder", { agent: agentLabel })}
            className="kawaii-input"
          />
          <button
            type="button"
            title={t("hexa.ivSend")}
            disabled={busy || sending || !delivery.draft.trim()}
            onClick={() => void sendMessage()}
            className="kawaii-toggle-btn connected"
          ><Send size={15} /></button>
          {isCodex && (currentTurnId ? (
            <button type="button" title={t("hexa.ivInterrupt")} disabled={busy} onClick={() => run(() => onInterrupt(threadId, currentTurnId))} className="kawaii-toggle-btn"><Square size={14} /></button>
          ) : (
            <button type="button" title={t("hexa.ivResume")} disabled={busy} onClick={() => run(() => onResume(threadId))} className="kawaii-toggle-btn"><RotateCcw size={15} /></button>
          ))}
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => run(() => onResume(threadId))} className="kawaii-toggle-btn" style={{ width: "fit-content" }}>
          <RotateCcw size={14} /> {t("hexa.ivResumeNudge")}
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
