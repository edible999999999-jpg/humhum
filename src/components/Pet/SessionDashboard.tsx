import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Session {
  session_id: string;
  client_type: string;
  cwd: string | null;
  project_name: string | null;
  started_at: string;
  last_event_at: string;
  event_count: number;
  status: "active" | "idle" | "completed";
  last_hook_message: string | null;
  last_tool_name: string | null;
}

const CLIENT_COLORS: Record<string, string> = {
  "claude-code": "bg-orange-500",
  codex: "bg-zinc-100 ring-1 ring-white/40",
  "qwen-code": "bg-blue-500",
  "gemini-cli": "bg-cyan-500",
  "kimi-k1": "bg-purple-500",
  qoderwork: "bg-green-400",
  "qoderwork-auto-allow": "bg-red-500",
};

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  "qwen-code": "Qwen",
  "gemini-cli": "Gemini",
  "kimi-k1": "Kimi",
  qoderwork: "Qoder",
  "qoderwork-auto-allow": "狂暴",
};

const STATUS_DOTS: Record<string, string> = {
  active: "bg-emerald-400 animate-pulse",
  idle: "bg-amber-400",
  completed: "bg-slate-500",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  return `${Math.floor(diffSec / 3600)}h`;
}

interface SessionDashboardProps {
  visible: boolean;
}

export function SessionDashboard({ visible }: SessionDashboardProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await invoke<Session[]>("get_active_sessions");
      setSessions(data);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchSessions();
    const timer = setInterval(fetchSessions, 3000);
    return () => clearInterval(timer);
  }, [visible, fetchSessions]);

  if (!visible) return null;

  return (
    <div className="w-full rounded-xl bg-slate-900 border border-white/10 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
          Sessions
        </span>
        <span className="text-[10px] text-white/30">
          {sessions.length > 0 ? `${sessions.length} active` : ""}
        </span>
      </div>

      {/* Session list */}
      <div className="max-h-[220px] overflow-y-auto scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-[11px] text-white/30">No active sessions</p>
            <p className="text-[10px] text-white/20 mt-1">
              Run Claude Code or other AI tools
            </p>
          </div>
        ) : (
          sessions.map((s) => (
            <SessionRow key={s.session_id} session={s} />
          ))
        )}
      </div>
    </div>
  );
}

function SessionRow({ session: s }: { session: Session }) {
  const clientColor = CLIENT_COLORS[s.client_type] ?? "bg-slate-500";
  const clientTextColor = s.client_type === "codex" ? "text-slate-950" : "text-white";
  const clientLabel = CLIENT_LABELS[s.client_type] ?? s.client_type;
  const statusDot = STATUS_DOTS[s.status] ?? "bg-slate-500";

  const displayMessage =
    s.last_hook_message ??
    (s.last_tool_name ? `Using ${s.last_tool_name}` : null);

  return (
    <div className="px-3 py-2.5 border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors">
      {/* Top row: client badge + project + time */}
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`${clientColor} ${clientTextColor} text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase`}
        >
          {clientLabel}
        </span>
        <span className="text-[11px] font-medium text-white/80 truncate flex-1">
          {s.project_name ?? "Unknown"}
        </span>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span className="text-[10px] text-white/30">
            {timeAgo(s.last_event_at)}
          </span>
        </div>
      </div>

      {/* Bottom row: last message */}
      {displayMessage && (
        <p className="text-[10px] text-white/40 truncate pl-0.5">
          {displayMessage}
        </p>
      )}
    </div>
  );
}
