import type { TranscriptEntry } from "@/types";

interface NotificationToastProps {
  entry: TranscriptEntry;
  onDismiss: () => void;
}

export function NotificationToast({ entry, onDismiss }: NotificationToastProps) {
  return (
    <div
      className="confirm-card toast-enter pointer-events-auto"
      style={{ borderColor: "rgba(148, 239, 244, 0.12)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(148, 239, 244, 0.08)", color: "rgba(148, 239, 244, 0.8)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <span className="text-white/80 font-semibold text-[13px]">{entry.timestamp.toLocaleTimeString()}</span>
        </div>
        <button onClick={onDismiss} className="text-white/20 hover:text-white/50 text-xs transition-colors leading-none">✕</button>
      </div>

      {/* Content */}
      <div className="px-3 pb-2.5">
        <p className="text-[12px] text-white/55 leading-snug truncate">{entry.text}</p>
      </div>
    </div>
  );
}
