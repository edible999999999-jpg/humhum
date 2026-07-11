import { Fragment, useState, type CSSProperties } from "react";
import { Link as LinkIcon, Power, RotateCcw, Send, Smartphone, Square } from "lucide-react";
import {
  useHexaData,
  type CodexRemoteControlState,
  type CodexRemotePairing,
  type HexaSupervisorSession,
  type HexaMemoryLocation,
  type HexaSupervisorNote,
} from "../../hooks/useHexaData";

const CLIENT_COLORS: Record<string, string> = {
  "claude-code": "#f59e0b",
  codex: "#22c55e",
  qoderwork: "#fb7185",
  "qwen-code": "#8b5cf6",
  "gemini-cli": "#38bdf8",
  "kimi-k1": "#f97316",
  wukong: "#eab308",
};

const STATUS_COLORS: Record<HexaSupervisorSession["progress_status"], string> = {
  working: "#22c55e",
  waiting: "#facc15",
  looping: "#fb923c",
  stalled: "#f87171",
  idle: "#38bdf8",
  completed: "rgba(255,255,255,0.35)",
};

function getClientColor(client: string): string {
  return CLIENT_COLORS[client] || "#94eff4";
}

function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const diff = Math.max(0, Date.now() - start);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function formatTimeAgo(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function StatusPill({ item }: { item: HexaSupervisorSession }) {
  const color = STATUS_COLORS[item.progress_status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 999,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          boxShadow: item.progress_status === "working" ? `0 0 8px ${color}` : "none",
        }}
      />
      {item.progress_label}
    </span>
  );
}

function NoteList({ title, notes }: { title: string; notes: HexaSupervisorNote[] }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", marginBottom: 6, fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {notes.slice(0, 3).map((note, index) => {
          const color =
            note.tone === "good" ? "#22c55e" : note.tone === "watch" ? "#f59e0b" : "rgba(255,255,255,0.36)";
          return (
            <div
              key={`${title}-${index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "6px 1fr",
                gap: 8,
                alignItems: "start",
                color: "rgba(255,255,255,0.58)",
                fontSize: 11,
                lineHeight: 1.45,
              }}
            >
              <span style={{ width: 6, height: 6, marginTop: 5, borderRadius: "50%", background: color }} />
              <span>{note.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MemoryList({ locations }: { locations: HexaMemoryLocation[] }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", marginBottom: 6, fontWeight: 700 }}>
        Memory locations
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {locations.slice(0, 3).map((location) => (
          <div
            key={`${location.label}-${location.path}`}
            style={{
              padding: "7px 8px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.055)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.68)", fontWeight: 650 }}>
                {location.label}
              </span>
              <span style={{ fontSize: 9, color: location.exists ? "#22c55e" : "rgba(255,255,255,0.28)" }}>
                {location.exists ? "visible" : "unknown"}
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={location.path}
            >
              {location.path}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 3, lineHeight: 1.35 }}>
              {location.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatStrip({ item }: { item: HexaSupervisorSession }) {
  const stats = item.stats;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 8,
      }}
    >
      {[
        ["events", item.session.event_count.toString()],
        ["last seen", formatTimeAgo(item.last_seen_ms)],
        ["tokens", stats ? formatTokens(stats.total_tokens) : "pending"],
        ["cost", stats ? formatCost(stats.total_cost_usd) : "pending"],
      ].map(([label, value]) => (
        <div
          key={label}
          style={{
            minWidth: 0,
            padding: "7px 8px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.18)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.26)", marginBottom: 2 }}>{label}</div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.72)",
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionPanel({
  item,
  expanded,
  onToggle,
}: {
  item: HexaSupervisorSession;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = getClientColor(item.session.client_type);
  const recentEvents = item.session.event_names.slice(-6);

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%",
        textAlign: "left",
        padding: 0,
        border: "none",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
      }}
    >
      <article
        style={{
          borderRadius: 8,
          background: "rgba(255,255,255,0.026)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderLeft: `3px solid ${color}`,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
              <span style={{ fontSize: 10, color, fontWeight: 800 }}>{item.agent_label}</span>
              <StatusPill item={item} />
              {item.pending_confirmations > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#facc15",
                    background: "rgba(250,204,21,0.1)",
                    border: "1px solid rgba(250,204,21,0.22)",
                    borderRadius: 999,
                    padding: "3px 8px",
                    fontWeight: 700,
                  }}
                >
                  pending confirmation
                </span>
              )}
            </div>
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.25,
                color: "rgba(255,255,255,0.88)",
                overflowWrap: "anywhere",
              }}
            >
              {item.display_name}
            </h3>
            <p style={{ margin: "7px 0 0", fontSize: 12, color: "rgba(255,255,255,0.48)", lineHeight: 1.45 }}>
              {item.progress_detail}
            </p>
          </div>
          <div style={{ textAlign: "right", flex: "0 0 auto", color: "rgba(255,255,255,0.32)", fontSize: 10 }}>
            <div>{formatDuration(item.session.started_at)}</div>
            <div style={{ marginTop: 4 }}>loop: {item.loop_status}</div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <StatStrip item={item} />
        </div>

        {expanded && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 14,
            }}
          >
            <div style={{ display: "grid", gap: 14 }}>
              <MemoryList locations={item.memory_locations} />
              {item.session.cwd && (
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", marginBottom: 5, fontWeight: 700 }}>
                    Workspace
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.4)",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      overflowWrap: "anywhere",
                      lineHeight: 1.4,
                    }}
                  >
                    {item.session.cwd}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <NoteList title="Strong outputs" notes={item.strong_outputs} />
              <NoteList title="Watchouts" notes={item.watchouts} />
              {recentEvents.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", marginBottom: 6, fontWeight: 700 }}>
                    Event trail
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {recentEvents.map((eventName, index) => (
                      <span
                        key={`${eventName}-${index}`}
                        style={{
                          padding: "2px 6px",
                          borderRadius: 6,
                          background: "rgba(255,255,255,0.04)",
                          color: "rgba(255,255,255,0.42)",
                          fontSize: 9,
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      >
                        {eventName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </article>
    </button>
  );
}

function CodexControls({
  item,
  onSend,
  onInterrupt,
  onResume,
  onResolveApproval,
}: {
  item: HexaSupervisorSession;
  onSend: (threadId: string, message: string) => Promise<unknown>;
  onInterrupt: (threadId: string, turnId: string) => Promise<unknown>;
  onResume: (threadId: string) => Promise<unknown>;
  onResolveApproval: (approvalId: string, decision: "allow_once" | "deny") => Promise<unknown>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bridge = item.bridge;
  if (!bridge || !item.can_intervene) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    await run(async () => {
      await onSend(bridge.provider_thread_id ?? bridge.session_id, text);
      setMessage("");
    });
  };

  return (
    <div
      style={{
        margin: "-5px 8px 3px",
        padding: "10px 12px",
        borderLeft: "1px solid rgba(34,197,94,0.2)",
        borderRight: "1px solid rgba(34,197,94,0.2)",
        borderBottom: "1px solid rgba(34,197,94,0.2)",
        background: "rgba(34,197,94,0.035)",
        borderRadius: "0 0 8px 8px",
      }}
    >
      {item.pending_approvals.length > 0 && (
        <div style={{ display: "grid", gap: 7, marginBottom: 9 }}>
          {item.pending_approvals.map((approval) => (
            <div
              key={approval.approval_id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                paddingBottom: 7,
                borderBottom: "1px solid rgba(255,255,255,0.055)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.76)", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                  {approval.summary}
                </div>
                {approval.reason && (
                  <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginTop: 2 }}>
                    {approval.reason}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onResolveApproval(approval.approval_id, "deny"))}
                  style={{
                    border: "1px solid rgba(248,113,113,0.3)",
                    background: "rgba(248,113,113,0.08)",
                    color: "#fca5a5",
                    borderRadius: 6,
                    padding: "5px 8px",
                    fontSize: 10,
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  Deny
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onResolveApproval(approval.approval_id, "allow_once"))}
                  style={{
                    border: "1px solid rgba(34,197,94,0.32)",
                    background: "rgba(34,197,94,0.1)",
                    color: "#86efac",
                    borderRadius: 6,
                    padding: "5px 8px",
                    fontSize: 10,
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  Allow once
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 7 }}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !bridge.current_turn_id) {
              event.preventDefault();
              void send();
            }
          }}
          disabled={busy || Boolean(bridge.current_turn_id)}
          placeholder={bridge.current_turn_id ? "Codex is working" : "Send a follow-up to Codex"}
          aria-label="Message Codex"
          style={{
            minWidth: 0,
            height: 32,
            boxSizing: "border-box",
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(0,0,0,0.18)",
            color: "rgba(255,255,255,0.78)",
            borderRadius: 6,
            padding: "0 9px",
            fontSize: 11,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          {bridge.current_turn_id ? (
            <button
              type="button"
              title="Interrupt current Codex turn"
              aria-label="Interrupt current Codex turn"
              disabled={busy}
              onClick={() => run(() => onInterrupt(bridge.provider_thread_id ?? bridge.session_id, bridge.current_turn_id!))}
              style={iconButtonStyle("#fca5a5", busy)}
            >
              <Square size={14} strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              title="Resume Codex thread"
              aria-label="Resume Codex thread"
              disabled={busy}
              onClick={() => run(() => onResume(bridge.provider_thread_id ?? bridge.session_id))}
              style={iconButtonStyle("#93c5fd", busy)}
            >
              <RotateCcw size={14} strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            title="Send to Codex"
            aria-label="Send to Codex"
            disabled={busy || Boolean(bridge.current_turn_id) || message.trim().length === 0}
            onClick={() => void send()}
            style={iconButtonStyle("#86efac", busy || Boolean(bridge.current_turn_id) || message.trim().length === 0)}
          >
            <Send size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      {error && <div style={{ color: "#fca5a5", fontSize: 10, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function iconButtonStyle(color: string, disabled: boolean): CSSProperties {
  return {
    width: 32,
    height: 32,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${color}44`,
    background: `${color}10`,
    color,
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    padding: 0,
  };
}

function RemoteControlPanel({
  state,
  pairing,
  onEnable,
  onDisable,
  onPair,
}: {
  state: CodexRemoteControlState;
  pairing: CodexRemotePairing | null;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onPair: () => Promise<CodexRemotePairing>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = state.status === "connected" || state.status === "connecting";
  const pairingActive = pairing && pairing.expires_at * 1000 > Date.now();

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        borderRadius: 8,
        background: "rgba(255,255,255,0.022)",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Smartphone size={15} color="#93c5fd" aria-hidden="true" />
          <div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.74)", fontWeight: 800 }}>
              Codex mobile
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.36)", marginTop: 2 }}>
              {state.message}
            </div>
          </div>
        </div>
        <span
          title={state.status}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flex: "0 0 auto",
            background: state.status === "connected" ? "#22c55e" : state.status === "connecting" ? "#facc15" : "rgba(255,255,255,0.26)",
          }}
        />
      </div>

      {pairingActive && (
        <div style={{ marginTop: 10, padding: "9px 10px", borderRadius: 6, background: "rgba(147,197,253,0.08)", border: "1px solid rgba(147,197,253,0.18)" }}>
          <div style={{ color: "#bfdbfe", fontSize: 18, fontWeight: 800, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {pairing.manual_pairing_code ?? pairing.pairing_code}
          </div>
          <div style={{ color: "rgba(255,255,255,0.34)", fontSize: 9, marginTop: 4 }}>
            Expires {new Date(pairing.expires_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
        {!enabled ? (
          <button type="button" disabled={busy || state.status === "unavailable"} onClick={() => void run(onEnable)} style={remoteButtonStyle("#93c5fd", busy || state.status === "unavailable") }>
            <Power size={13} aria-hidden="true" /> Enable mobile access
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void run(onPair)} style={remoteButtonStyle("#86efac", busy)}>
              <LinkIcon size={13} aria-hidden="true" /> Create pairing code
            </button>
            <button type="button" disabled={busy} onClick={() => void run(onDisable)} style={remoteButtonStyle("#fca5a5", busy)}>
              <Power size={13} aria-hidden="true" /> Disable
            </button>
          </>
        )}
      </div>
      {state.server_name && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.24)", marginTop: 8 }}>{state.server_name}</div>}
      {error && <div style={{ color: "#fca5a5", fontSize: 10, marginTop: 8, lineHeight: 1.4 }}>{error}</div>}
    </div>
  );
}

function remoteButtonStyle(color: string, disabled: boolean): CSSProperties {
  return {
    minHeight: 30,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${color}3d`,
    background: `${color}0d`,
    color,
    borderRadius: 6,
    padding: "0 9px",
    fontSize: 10,
    fontWeight: 750,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
}

function EmptyState() {
  return (
    <div
      style={{
        padding: 28,
        borderRadius: 8,
        background: "rgba(255,255,255,0.018)",
        border: "1px dashed rgba(255,255,255,0.07)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.48)", fontWeight: 700 }}>
        暂无 Claude/Codex 会话
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginTop: 6 }}>
        启动本地 hook 后，Hexa 会把进度、确认点和 transcript 复盘集中到这里。
      </div>
    </div>
  );
}

export function HexaModule() {
  const {
    activeSupervisorSessions,
    completedSupervisorSessions,
    primarySupervisorSessions,
    compatibleSupervisorSessions,
    alerts,
    bridgeHealth,
    remoteControl,
    remotePairing,
    sendCodexMessage,
    interruptCodexTurn,
    resumeCodexThread,
    resolveCodexApproval,
    enableCodexRemoteControl,
    disableCodexRemoteControl,
    startCodexRemotePairing,
  } = useHexaData();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activePrimary = activeSupervisorSessions.filter((s) => s.priority === "primary");
  const completedPrimary = completedSupervisorSessions.filter((s) => s.priority === "primary").slice(0, 6);
  const pendingCount = activeSupervisorSessions.reduce((sum, item) => sum + item.pending_confirmations, 0);
  const loopCount = activeSupervisorSessions.filter((item) => item.loop_status !== "clear").length;

  return (
    <div className="hub-module">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 className="hub-module-title" style={{ marginBottom: 4 }}>Hexa Supervisor</h2>
          <p className="hub-module-desc">
            Claude / Codex 监工台，观察每轮进度、确认点、memory 和复盘信号。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, fontSize: 10, color: "rgba(255,255,255,0.38)" }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: bridgeHealth.status === "connected" ? "#22c55e" : bridgeHealth.status === "starting" ? "#facc15" : "#f87171",
              }}
            />
            <span>{bridgeHealth.message}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <SummaryPill label="active" value={activeSupervisorSessions.length} color="#22c55e" />
          <SummaryPill label="pending" value={pendingCount} color="#facc15" />
          <SummaryPill label="watch" value={alerts.length + loopCount} color="#fb923c" />
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(260px, 0.8fr)", gap: 14 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <SectionHeader title="Claude Session / Codex Session" count={primarySupervisorSessions.length} />
          {activePrimary.length === 0 && completedPrimary.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {activePrimary.map((item) => (
                <Fragment key={`active-${item.session.session_id}`}>
                  <SessionPanel
                    item={item}
                    expanded={expandedId === item.session.session_id}
                    onToggle={() =>
                      setExpandedId(expandedId === item.session.session_id ? null : item.session.session_id)
                    }
                  />
                  <CodexControls
                    item={item}
                    onSend={sendCodexMessage}
                    onInterrupt={interruptCodexTurn}
                    onResume={resumeCodexThread}
                    onResolveApproval={resolveCodexApproval}
                  />
                </Fragment>
              ))}
              {completedPrimary.map((item) => (
                <SessionPanel
                  key={`completed-${item.session.session_id}`}
                  item={item}
                  expanded={expandedId === item.session.session_id}
                  onToggle={() =>
                    setExpandedId(expandedId === item.session.session_id ? null : item.session.session_id)
                  }
                />
              ))}
            </>
          )}
        </div>

        <aside style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <RemoteControlPanel
            state={remoteControl}
            pairing={remotePairing}
            onEnable={enableCodexRemoteControl}
            onDisable={disableCodexRemoteControl}
            onPair={startCodexRemotePairing}
          />
          <ReviewPanel
            title="Needs attention"
            rows={[
              [`${pendingCount}`, "pending confirmations"],
              [`${loopCount}`, "loop or stalled sessions"],
              [`${alerts.length}`, "active alerts"],
            ]}
          />
          <ReviewPanel
            title="Supervisor model"
            rows={[
              ["progress", "working / waiting / stalled / completed"],
              ["memory", "~/.claude/projects + ~/.codex/sessions"],
              ["review", "strong outputs + watchouts"],
            ]}
          />
          {compatibleSupervisorSessions.length > 0 && (
            <div
              style={{
                borderRadius: 8,
                background: "rgba(255,255,255,0.022)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: 12,
              }}
            >
              <SectionHeader title="Compatible agents" count={compatibleSupervisorSessions.length} />
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {compatibleSupervisorSessions.slice(0, 6).map((item) => (
                  <div key={`compatible-${item.session.session_id}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.66)", fontWeight: 700 }}>
                        {item.agent_label}
                      </span>
                      <span style={{ fontSize: 10, color: STATUS_COLORS[item.progress_status] }}>
                        {item.progress_label}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", lineHeight: 1.35 }}>
                      {item.display_name} · {formatTimeAgo(item.last_seen_ms)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "rgba(255,255,255,0.42)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {title}
      </div>
      <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 11 }}>{count}</span>
    </div>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        minWidth: 72,
        padding: "7px 9px",
        borderRadius: 8,
        background: `${color}12`,
        border: `1px solid ${color}2f`,
      }}
    >
      <div style={{ color, fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      <div style={{ color: "rgba(255,255,255,0.34)", fontSize: 9, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function ReviewPanel({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div
      style={{
        borderRadius: 8,
        background: "rgba(255,255,255,0.022)",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: 12,
      }}
    >
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", fontWeight: 800, marginBottom: 9 }}>
        {title}
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {rows.map(([value, label]) => (
          <div key={`${title}-${label}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{label}</span>
            <span style={{ color: "rgba(255,255,255,0.76)", fontSize: 11, fontWeight: 750, textAlign: "right" }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
