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
  "claude-code": "bg-orange-500/80",
  codex: "bg-emerald-500/80",
  "qwen-code": "bg-blue-500/80",
  "gemini-cli": "bg-cyan-400/80",
  "kimi-k1": "bg-purple-500/80",
  qoderwork: "bg-rose-400/80",
};

const CLIENT_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  "qwen-code": "Qwen",
  "gemini-cli": "Gemini",
  "kimi-k1": "Kimi",
  qoderwork: "Qoder",
};

const STATUS_DOTS: Record<string, string> = {
  active: "bg-emerald-400 animate-pulse",
  idle: "bg-amber-400",
  completed: "bg-slate-300",
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
    <div
      className="w-full rounded-[22px] overflow-hidden"
      style={{
        background: "rgba(255,250,247,0.96)",
        border: "1px solid rgba(116,143,165,0.16)",
        boxShadow: "0 18px 44px rgba(90,115,150,0.2)",
        color: "#263241",
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(116,143,165,0.12)" }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>
          Sessions
        </span>
        {sessions.length > 0 && (
          <span className="kawaii-badge text-[9px]">
            {sessions.length}
          </span>
        )}
      </div>

      {/* Session list */}
      <div className="max-h-[220px] overflow-y-auto scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-[11px]" style={{ color: "#64748b" }}>No active sessions</p>
            <p className="text-[10px] mt-1" style={{ color: "#94a3b8" }}>
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
  const clientColor = CLIENT_COLORS[s.client_type] ?? "bg-slate-500/80";
  const clientLabel = CLIENT_LABELS[s.client_type] ?? s.client_type;
  const statusDot = STATUS_DOTS[s.status] ?? "bg-slate-500";

  const displayMessage =
    s.last_hook_message ??
    (s.last_tool_name ? `Using ${s.last_tool_name}` : null);

  return (
    <div
      className="px-3 py-2.5 transition-colors"
      style={{ borderBottom: "1px solid rgba(116,143,165,0.1)" }}
    >
      {/* Top row: client dot + project + time */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${clientColor}`} />
        <span className="text-[11px] flex-shrink-0" style={{ color: "#64748b" }}>
          {clientLabel}
        </span>
        <span className="text-[11px] font-medium truncate flex-1" style={{ color: "#334155" }}>
          {s.project_name ?? "Unknown"}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className={`w-1 h-1 rounded-full ${statusDot}`} />
          <span className="text-[10px]" style={{ color: "#94a3b8" }}>
            {timeAgo(s.last_event_at)}
          </span>
        </div>
      </div>

      {/* Bottom row: last message */}
      {displayMessage && (
        <p className="text-[10px] truncate pl-3.5" style={{ color: "#64748b" }}>
          {displayMessage}
        </p>
      )}
    </div>
  );
}
