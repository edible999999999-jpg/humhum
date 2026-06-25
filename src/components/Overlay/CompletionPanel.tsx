import type { HookEvent } from "@/types";

interface CompletionPanelProps {
  event: HookEvent;
  onDismiss: () => void;
}

const CLIENT_TINTS: Record<string, string> = {
  "claude-code": "border-l-orange-400",
  codex: "border-l-green-400",
  "qwen-code": "border-l-blue-400",
  "gemini-cli": "border-l-cyan-400",
  "kimi-k1": "border-l-purple-400",
  qoderwork: "border-l-rose-400",
};

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  "qwen-code": "Qwen",
  "gemini-cli": "Gemini",
  "kimi-k1": "Kimi",
  qoderwork: "Qoder",
};

export function CompletionPanel({ event, onDismiss }: CompletionPanelProps) {
  const payload = event.payload as Record<string, unknown>;
  const clientType = event.client_type ?? "claude-code";
  const clientLabel = CLIENT_LABELS[clientType] ?? clientType;
  const tintClass = CLIENT_TINTS[clientType] ?? "border-l-slate-400";

  const message = (payload.message as string) ?? null;
  const eventName = event.hook_event_name;

  const statusLabel =
    eventName === "TaskCompleted" ? "完成" :
    eventName === "Stop" ? "结束" : "通知";

  const statusColor =
    eventName === "TaskCompleted" ? "text-emerald-400" :
    eventName === "Stop" ? "text-slate-400" : "text-blue-400";

  return (
    <div
      className={`
        toast-enter
        bg-slate-900/95 backdrop-blur-xl rounded-xl
        border border-white/10 border-l-2 ${tintClass}
        shadow-2xl overflow-hidden
      `}
    >
      {/* Header: client + status */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-white/70">
            {clientLabel}
          </span>
          <span className={`text-[10px] font-bold ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-white/30 hover:text-white text-xs transition-colors"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="px-3 py-2.5">
        {message ? (
          <p className="text-[11px] text-white/80 leading-relaxed line-clamp-4">
            {message}
          </p>
        ) : (
          <p className="text-[11px] text-white/50 italic">
            {clientLabel} 会话{statusLabel}
          </p>
        )}
      </div>
    </div>
  );
}
