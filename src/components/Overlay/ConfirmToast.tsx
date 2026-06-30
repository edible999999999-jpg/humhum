import type { HookEvent } from "@/types";

interface ConfirmToastProps {
  event: HookEvent;
  onConfirm: (behavior: "allow" | "deny" | "allowAlways") => void;
  onDismiss: () => void;
}

/**
 * Compact confirmation toast for PermissionRequest events.
 * Shows tool name + key details with Allow/Deny buttons.
 * Much smaller than the old full-panel approach.
 */
export function ConfirmToast({ event, onConfirm, onDismiss }: ConfirmToastProps) {
  const payload = event.payload as Record<string, unknown>;
  const toolName = (payload.tool_name as string) ?? "Unknown";
  const toolInput = (payload.tool_input as Record<string, unknown>) ?? {};

  // Extract a concise description from tool input
  const summary = getToolSummary(toolName, toolInput);

  return (
    <div
      className="
        toast-enter pointer-events-auto
        bg-slate-800/95 backdrop-blur-md rounded-lg
        border border-amber-500/30 border-l-2 border-l-amber-400
        px-3 py-2.5 shadow-xl
      "
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-medium text-amber-300">需要确认</span>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-500 hover:text-white text-xs"
        >
          ×
        </button>
      </div>

      {/* Tool info — single line */}
      <div className="mb-2">
        <p className="text-xs text-slate-300 leading-snug">
          <span className="text-indigo-300 font-mono">{toolName}</span>
          {summary && (
            <span className="text-slate-400"> — {summary}</span>
          )}
        </p>
      </div>

      {/* Action buttons — 3 options like Ping Island */}
      <div className="flex gap-1.5">
        <button
          onClick={() => onConfirm("deny")}
          className="px-2 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-xs font-medium transition-colors border border-red-500/20"
        >
          拒绝
        </button>
        <button
          onClick={() => onConfirm("allowAlways")}
          className="flex-1 px-2 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded text-xs font-medium transition-colors border border-indigo-500/20"
        >
          始终允许
        </button>
        <button
          onClick={() => onConfirm("allow")}
          className="flex-1 px-2 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded text-xs font-medium transition-colors border border-emerald-500/20"
        >
          允许
        </button>
      </div>
    </div>
  );
}

/** Generate a one-line summary of a tool invocation */
function getToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return (input.command as string)?.slice(0, 60) ?? "";
    case "Write":
    case "Edit":
      return (input.file_path as string)?.split("/").pop() ?? "";
    case "Read":
      return (input.file_path as string)?.split("/").pop() ?? "";
    default:
      return JSON.stringify(input).slice(0, 60);
  }
}
