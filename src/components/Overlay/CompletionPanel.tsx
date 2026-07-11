import { t } from "@/lib/i18n";
import type { HookEvent } from "@/types";

interface CompletionPanelProps {
  event: HookEvent;
  onDismiss: () => void;
}

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  "qwen-code": "Qwen",
  "gemini-cli": "Gemini",
  "kimi-k1": "Kimi",
  qoderwork: "Qoder",
  wukong: "Wukong",
};

export function CompletionPanel({ event, onDismiss }: CompletionPanelProps) {
  const payload = event.payload as Record<string, unknown>;
  const clientType = event.client_type ?? "claude-code";
  const clientLabel = CLIENT_LABELS[clientType] ?? clientType;

  const message = (payload.message as string) ?? null;
  const eventName = event.hook_event_name;

  const isCompleted = eventName === "TaskCompleted";
  const statusLabel = isCompleted ? t("completion.bubbleDone") : t("completion.bubbleStopped");
  const detail = message || `${clientLabel} ${isCompleted ? t("completion.completed") : t("completion.stopped")}`;

  const accent = isCompleted
    ? { border: "rgba(52, 211, 153, 0.16)", icon: "#10b981", bg: "rgba(52, 211, 153, 0.1)" }
    : { border: "rgba(148, 163, 184, 0.18)", icon: "#64748b", bg: "rgba(148, 163, 184, 0.11)" };

  return (
    <div
      className="completion-bubble toast-enter pointer-events-auto"
      style={{ borderColor: accent.border }}
    >
      <div
        className="completion-bubble-icon"
        style={{ background: accent.bg, color: accent.icon }}
      >
        {isCompleted ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12h8" />
          </svg>
        )}
      </div>
      <div className="completion-bubble-copy">
        <div className="completion-bubble-title">{statusLabel}</div>
        <div className="completion-bubble-detail">{detail}</div>
      </div>
      <button onClick={onDismiss} className="completion-bubble-close" aria-label="Dismiss">×</button>
      <span className="completion-bubble-tail" />
    </div>
  );
}
