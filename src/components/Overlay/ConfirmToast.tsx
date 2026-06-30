import { useState, useEffect } from "react";
import type { HookEvent } from "@/types";

interface ConfirmToastProps {
  event: HookEvent;
  onConfirm: (behavior: "allow" | "deny" | "allowAlways") => void;
  onDismiss: () => void;
}

export function ConfirmToast({ event, onConfirm, onDismiss }: ConfirmToastProps) {
  const payload = event.payload as Record<string, unknown>;
  const toolName = (payload.tool_name as string) ?? "Unknown";
  const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const detail = getToolDetail(toolName, toolInput);
  const timeLabel = elapsed < 60 ? `<${elapsed + 1}s` : `${Math.floor(elapsed / 60)}m`;

  return (
    <div className="confirm-card toast-enter pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded flex items-center justify-center bg-amber-400/15 text-amber-400">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <span className="text-white/90 font-semibold text-[13px]">请求批准</span>
          <span className="confirm-tag confirm-tag-time">{timeLabel}</span>
          <span className="confirm-tag confirm-tag-client">{event.client_type || "CC"}</span>
        </div>
        <button onClick={onDismiss} className="text-white/30 hover:text-white/60 text-xs transition-colors leading-none">✕</button>
      </div>

      {/* Tool info */}
      <div className="px-3 pb-2">
        <div className="text-amber-400 font-bold text-[13px] mb-1">{toolName}</div>
        {detail && (
          <div className="confirm-detail-box" style={{ maxHeight: 72 }}>
            <code className="text-[11px] text-white/70 leading-snug break-all whitespace-pre-wrap">
              {detail}
            </code>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 px-3 pb-2">
        <button onClick={() => onConfirm("deny")} className="confirm-btn confirm-btn-deny text-xs py-1.5">
          拒绝 <kbd className="confirm-kbd ml-1">N</kbd>
        </button>
        <button onClick={() => onConfirm("allowAlways")} className="confirm-btn confirm-btn-always text-xs py-1.5">
          始终 <kbd className="confirm-kbd ml-1">A</kbd>
        </button>
        <button onClick={() => onConfirm("allow")} className="confirm-btn confirm-btn-allow text-xs py-1.5">
          允许 <kbd className="confirm-kbd ml-1">Y</kbd>
        </button>
      </div>
    </div>
  );
}

function getToolDetail(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash": {
      const cmd = input.command as string;
      if (!cmd) return "";
      return `command: ${cmd.slice(0, 200)}${cmd.length > 200 ? "..." : ""}`;
    }
    case "Write":
    case "Edit":
    case "Read": {
      const fp = input.file_path as string;
      if (!fp) return "";
      const parts = fp.split("/");
      const short = parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : fp;
      return `file: ${short}`;
    }
    default:
      return JSON.stringify(input, null, 2).slice(0, 200);
  }
}
