import type { TranscriptEntry } from "@/types";

interface NotificationToastProps {
  entry: TranscriptEntry;
  onDismiss: () => void;
}

/**
 * Compact notification toast for non-critical events (Stop, TaskCompleted, Notification).
 * Shows briefly above the pet, auto-dismisses.
 */
export function NotificationToast({ entry, onDismiss }: NotificationToastProps) {
  const typeColors: Record<string, string> = {
    summary: "border-l-indigo-400",
    system: "border-l-slate-400",
    command: "border-l-emerald-400",
  };

  return (
    <div
      className={`
        toast-enter pointer-events-auto
        bg-slate-800/90 backdrop-blur-md rounded-lg
        border border-white/10 border-l-2 ${typeColors[entry.type] ?? "border-l-slate-400"}
        px-3 py-2 shadow-xl
        flex items-start gap-2
      `}
    >
      <span className="flex-shrink-0 mt-0.5 text-slate-400">
        <TypeIcon type={entry.type} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-200 leading-snug truncate">
          {entry.text}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {entry.timestamp.toLocaleTimeString()}
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-slate-500 hover:text-white text-xs flex-shrink-0 ml-1"
      >
        ×
      </button>
    </div>
  );
}

function TypeIcon({ type }: { type: string }) {
  const size = 14;
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (type) {
    case "summary":
      return <svg {...props}><polyline points="20 6 9 17 4 12" /></svg>;
    case "system":
      return <svg {...props}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>;
    case "command":
      return <svg {...props}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>;
  }
}
