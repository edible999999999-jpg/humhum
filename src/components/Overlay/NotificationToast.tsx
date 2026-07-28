import type { TranscriptEntry } from "@/types";

interface NotificationToastProps {
  entry: TranscriptEntry;
  onDismiss: () => void;
}

export function NotificationToast({ entry, onDismiss }: NotificationToastProps) {
  return (
    <div
      className="confirm-card toast-enter pointer-events-auto"
      style={{ borderColor: "rgba(116,143,165,0.16)", boxShadow: "0 18px 44px rgba(90,115,150,0.18)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <img
            src="/mascots/expr/hush/peek-wave.png"
            alt="Hush"
            className="module-face"
            style={{ width: 28, height: 28 }}
            draggable={false}
          />
          <span className="font-semibold text-[13px]" style={{ color: "#334155" }}>{entry.timestamp.toLocaleTimeString()}</span>
        </div>
        <button type="button" onClick={onDismiss} aria-label="关闭通知" className="text-xs transition-colors leading-none" style={{ color: "#94a3b8" }}>✕</button>
      </div>

      {/* Content */}
      <div className="px-3 pb-2.5">
        <p className="text-[12px] leading-snug truncate" style={{ color: "#64748b" }}>{entry.text}</p>
      </div>
    </div>
  );
}
