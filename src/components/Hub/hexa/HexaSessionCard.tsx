import { useReducer, useState } from "react";
import { Crosshair, FileDiff, Flame, RefreshCw, Trash2 } from "lucide-react";
import {
  type AgentSendReceipt,
  type FocusResult,
  type HexaSupervisorSession,
  type QueuedIntervention,
} from "../../../hooks/useHexaData";
import { initialWatchDeleteState, watchDeleteReducer } from "../../../hooks/hexaWatchState";
import { interventionProviderForClient } from "../../../hooks/interventionProvider";
import {
  initialSessionChangesState,
  sessionChangesReducer,
  type GitChangeSummary,
} from "../../../hooks/sessionChangesState";
import {
  ChipGroup,
  getClientColor,
  MiniStat,
  ReadoutBlock,
  scoreColor,
  STATUS_COLORS,
  formatTimeAgo,
} from "./HexaShared";
import { AgentIntervention } from "./HexaIntervention";
import { t } from "@/lib/i18n";

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
          {t("hexa.recentNeedInfer")}
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

export function SessionCard({
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
  onSend: (threadId: string, message: string) => Promise<AgentSendReceipt>;
  onInterrupt: (threadId: string, turnId: string) => Promise<void>;
  onResume: (threadId: string) => Promise<void>;
  onResolveApproval: (approvalId: string, decision: "allow_once" | "deny") => Promise<void>;
  onFocus: (sessionId: string) => Promise<FocusResult>;
  onLoadChanges: (sessionId: string) => Promise<GitChangeSummary>;
  onDeleteWatched: (sessionId: string) => Promise<void>;
  queuedInterventions: QueuedIntervention[];
  onRetryIntervention: (interventionId: string) => Promise<AgentSendReceipt>;
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
                {t("hexa.managed")}
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
                {t("hexa.awaitConfirm")}
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
              title={deleteState.error ? t("hexa.deleteFromManagedRetry") : t("hexa.deleteFromManaged")}
              aria-label={t("hexa.deleteFromManaged")}
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
              title={autoConfirmEnabled ? t("hexa.autoApproveThisOff") : t("hexa.autoApproveThisOn")}
              aria-label={autoConfirmEnabled ? t("hexa.singleAutoOff") : t("hexa.singleAutoOn")}
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
            title={focusState === "failed" ? t("hexa.focusFailedRetry") : t("hexa.returnToSession")}
            aria-label={t("hexa.returnToSession")}
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
          {t("hexa.deleteFailedInline", { error: deleteState.error })}
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
          {focusState === "exact" ? t("hexa.focusExact") : focusState === "fallback" ? t("hexa.focusFallback") : t("hexa.focusFailedClick")}
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
          {reviewOpen ? t("hexa.collapseReview") : t("hexa.openReview")}
        </button>
      )}

      {showReadout && (
        <>
          <ReadoutBlock title={t("hexa.recentUserWant")} text={item.recent_user_intent} tone="#38bdf8" />
          <ReadoutBlock title={t("hexa.agentDoing")} text={item.current_work} tone={color} />
          <ReadoutBlock title={t("hexa.sensoryFeedback")} text={item.performance_read} tone={scoreColor(item.recent_need_score)} />
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
            {changes.open ? t("hexa.collapseChanges") : t("hexa.viewChanges")}
          </button>
          {changes.open && changes.status === "loading" && (
            <div style={{ color: "#7b8ba0", fontSize: 10 }}>{t("hexa.loadingGit")}</div>
          )}
          {changes.open && changes.status === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#f87171", fontSize: 10, overflowWrap: "anywhere" }}>{changes.error}</span>
              <button type="button" onClick={() => void reloadChanges()} className="kawaii-toggle-btn" title={t("hexa.retryRead")} aria-label={t("hexa.retryRead")}>
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
          <ChipGroup title={t("hexa.evidenceBasis")} values={item.evidence.length ? item.evidence.slice(0, 4) : [t("hexa.noBasis")]} />
          <ChipGroup title={t("hexa.eventTrail")} values={eventNames.length ? eventNames : [t("hexa.awaitEvent")]} />
        </div>
      )}

      {showReadout && <ReviewAction item={item} />}

      {interventionProvider && (
        <AgentIntervention
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
    return <div style={{ color: "#7b8ba0", fontSize: 10 }}>{t("hexa.noUncommitted")}</div>;
  }
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "#7b8ba0", fontSize: 10 }}>
        <span>{summary.branch || "detached HEAD"}</span>
        <span>{t("hexa.fileCount", { count: summary.total_files })}</span>
        {summary.truncated && <span>{t("hexa.showingFirst", { count: summary.files.length })}</span>}
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
            {file.staged ? t("hexa.fileStaged") : file.status === "untracked" ? t("hexa.fileUntracked") : file.status}
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
        {isCompleted ? t("hexa.reviewConclusion") : t("hexa.suggestReminder")}
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
