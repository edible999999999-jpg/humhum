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
  hermes: "Hermes Agent",
  openclaw: "OpenClaw",
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
      <img
        src="/mascots/expr/hexa/done.png"
        alt="Hexa"
        className="module-face"
        style={{ width: 40, height: 40 }}
        draggable={false}
      />
      <div className="completion-bubble-copy">
        <div className="completion-bubble-title">{statusLabel}</div>
        <div className="completion-bubble-detail">{detail}</div>
      </div>
      <button type="button" onClick={onDismiss} className="completion-bubble-close" aria-label="关闭会话结束提示">×</button>
      <span className="completion-bubble-tail" />
    </div>
  );
}
