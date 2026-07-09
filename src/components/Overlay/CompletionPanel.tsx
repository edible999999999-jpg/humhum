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
  const statusLabel = isCompleted
    ? t("completion.completed")
    : eventName === "Stop"
      ? t("completion.stopped")
      : t("completion.notification");

  const accent = isCompleted
    ? { border: "rgba(52, 211, 153, 0.12)", glow: "rgba(52, 211, 153, 0.03)", icon: "rgba(52, 211, 153, 0.8)", bg: "rgba(52, 211, 153, 0.08)" }
    : { border: "rgba(148, 239, 244, 0.12)", glow: "rgba(148, 239, 244, 0.03)", icon: "rgba(148, 239, 244, 0.8)", bg: "rgba(148, 239, 244, 0.08)" };

  return (
    <div
      className="confirm-card toast-enter pointer-events-auto"
      style={{ borderColor: accent.border, boxShadow: "0 18px 44px rgba(90,115,150,0.18)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: accent.bg, color: accent.icon }}
          >
            {isCompleted ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <rect x="9" y="9" width="6" height="6" rx="1" />
              </svg>
            )}
          </div>
          <span className="font-semibold text-[13px]" style={{ color: "#334155" }}>{statusLabel}</span>
          <span className="confirm-tag confirm-tag-client">{clientLabel}</span>
        </div>
        <button onClick={onDismiss} className="text-xs transition-colors leading-none" style={{ color: "#94a3b8" }}>✕</button>
      </div>

      {/* Content */}
      <div className="px-3 pb-2.5">
        <p className="text-[12px] leading-snug line-clamp-3" style={{ color: "#64748b" }}>
          {message || t("completion.fallback", { client: clientLabel, status: statusLabel })}
        </p>
      </div>
    </div>
  );
}
