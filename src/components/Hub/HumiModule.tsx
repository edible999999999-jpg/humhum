import { useState, useEffect, useCallback, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUp } from "lucide-react";
import { useTranslation } from "../../lib/i18n/react";
import type { AppConfig } from "../../types";
import { createHumiPiRuntime } from "../../lib/pi/runtime";
import type { HumiPiRuntime } from "../../lib/pi/types";

interface ActiveSession {
  session_id: string;
  client_type: string;
  project_name: string | null;
  status: string;
  event_count: number;
  last_event_at: string;
  last_tool_name: string | null;
}

interface HooksStatus {
  [clientId: string]: boolean;
}

interface PiInstallStatus {
  installed: boolean;
  version?: string | null;
  error?: string | null;
}

interface PiSessionStatus {
  session_id: string;
  state: "starting" | "idle" | "running" | "aborted" | "stopped" | "error";
  cwd?: string | null;
  session_file?: string | null;
  message_count: number;
  last_event_type?: string | null;
  last_error?: string | null;
  started_at: string;
  updated_at: string;
}

interface QoderAcpStatus {
  installed: boolean;
  version?: string | null;
  acp_supported: boolean;
  hint: string;
  error?: string | null;
}

interface LocalAgentKernelResult {
  session_id: string;
  asset_count: number;
  type_counts: Record<string, number>;
  agent_counts: Record<string, number>;
  top_tools: LocalUsageInsight[];
  top_skills: LocalUsageInsight[];
  agent_knowledge: LocalUsageInsight[];
  operational_tools: LocalUsageInsight[];
  suggested_actions: string[];
  memory_path: string;
  summary: string;
  answer: string;
  agent_reply?: HumiAgentReply;
  context_packet: HumiContextPacket;
}

interface LocalUsageInsight {
  name: string;
  count: number;
  source: string;
  detail: string;
}

interface HumiContextPacket {
  question: string;
  observed_workflows: string[];
  user_preference_candidates: string[];
  memory_candidates: string[];
  risk_notes: string[];
  context_sources: string[];
  evidence_notes: string[];
}

interface HumiAgentReply {
  message: string;
  confidence: string;
  cards: HumiAgentCard[];
  steps: HumiAgentStep[];
}

interface HumiAgentCard {
  title: string;
  body: string;
  tone: "blue" | "purple" | "green" | string;
}

interface HumiAgentStep {
  phase: string;
  title: string;
  content: string;
}

interface HumiChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface AgentKernelStatus {
  version: string;
  loop_model: AgentKernelStage[];
  roles: AgentKernelRole[];
  memory_layers: string[];
  active_bridges: string[];
  next_kernel_step: string;
}

interface AgentKernelStage {
  phase: string;
  contract: string;
}

interface AgentKernelRole {
  name: string;
  job: string;
  reads: string[];
  writes: string[];
}

interface HumiModuleProps {
  onActivityChange?: (active: boolean) => void;
}

const DEFAULT_KERNEL_ROOTS = [
  "~/.codex/skills",
  "~/.codex/plugins/cache",
  "~/.codex/vendor_imports/skills",
  "~/.claude",
  "~/.agents/skills",
  "~/.qoder",
  "~/.qoderwork",
  "~/.gemini",
  "~/.qwen",
  "~/.kimi",
  "~/.pi",
].join("\n");

const HUMI_CHAT_STORAGE_KEY = "humhum:humi:chatMessages";
const HUMI_ASK_TIMEOUT_MS = 45_000;
const DEFAULT_HUMI_CHAT_MESSAGES: HumiChatMessage[] = [
  {
    id: "humi-welcome",
    role: "assistant",
    text: "你好，我是 Humi。想了解最近的工作、技能或偏好吗？",
  },
];

function loadHumiChatMessages(): HumiChatMessage[] {
  try {
    const raw = sessionStorage.getItem(HUMI_CHAT_STORAGE_KEY);
    if (!raw) return DEFAULT_HUMI_CHAT_MESSAGES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_HUMI_CHAT_MESSAGES;
    return parsed.filter(
      (message): message is HumiChatMessage =>
        typeof message?.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.text === "string",
    );
  } catch {
    return DEFAULT_HUMI_CHAT_MESSAGES;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function HumiModule({ onActivityChange }: HumiModuleProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [hooksStatus, setHooksStatus] = useState<HooksStatus>({});
  const [piStatus, setPiStatus] = useState<PiInstallStatus | null>(null);
  const [qoderStatus, setQoderStatus] = useState<QoderAcpStatus | null>(null);
  const [kernelSession, setKernelSession] = useState<PiSessionStatus | null>(null);
  const [kernelLoading, setKernelLoading] = useState(false);
  const [kernelMessage, setKernelMessage] = useState<string | null>(null);
  const [kernelCwd, setKernelCwd] = useState("");
  const [kernelRoots, setKernelRoots] = useState(DEFAULT_KERNEL_ROOTS);
  const [localKernelResult, setLocalKernelResult] = useState<LocalAgentKernelResult | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [humiProgress, setHumiProgress] = useState("Humi 正在等你说话");
  const [chatMessages, setChatMessages] = useState<HumiChatMessage[]>(loadHumiChatMessages);
  const [agentKernelStatus, setAgentKernelStatus] = useState<AgentKernelStatus | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const piRuntimeRef = useRef<HumiPiRuntime | null>(null);
  const [kernelPrompt, setKernelPrompt] = useState(
    "现在技能用得最多的是啥？"
  );

  const fetchSessions = useCallback(async () => {
    try {
      const data = await invoke<ActiveSession[]>("get_active_sessions");
      setSessions(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchHooksStatus = useCallback(async () => {
    try {
      const status = await invoke<HooksStatus>("check_hooks_status");
      setHooksStatus(status);
    } catch {
      // ignore
    }
  }, []);

  const fetchKernelStatus = useCallback(async () => {
    try {
      const [config, pi, qoder, kernel] = await Promise.all([
        invoke<AppConfig>("get_config"),
        invoke<PiInstallStatus>("check_pi_installed"),
        invoke<QoderAcpStatus>("check_qoder_acp_support"),
        invoke<AgentKernelStatus>("get_agent_kernel_status"),
      ]);
      setAppConfig(config);
      setPiStatus(pi);
      setQoderStatus(qoder);
      setAgentKernelStatus(kernel);
    } catch (e) {
      setKernelMessage(`Kernel check failed: ${String(e)}`);
    }
  }, []);

  const refreshPiSession = useCallback(async (sessionId: string) => {
    try {
      const status = await invoke<PiSessionStatus>("get_pi_session_status", { sessionId });
      setKernelSession(status);
    } catch (e) {
      setKernelMessage(`Pi session status failed: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchHooksStatus();
    fetchKernelStatus();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions, fetchHooksStatus, fetchKernelStatus]);

  useEffect(() => {
    if (!kernelSession || ["stopped", "error"].includes(kernelSession.state)) return;
    const interval = setInterval(() => refreshPiSession(kernelSession.session_id), 2000);
    return () => clearInterval(interval);
  }, [kernelSession, refreshPiSession]);

  useEffect(() => {
    piRuntimeRef.current = null;
  }, [appConfig?.pi.url, appConfig?.pi.token, appConfig?.pi.model_name]);

  useEffect(() => {
    sessionStorage.setItem(HUMI_CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
  }, [chatMessages]);

  useEffect(() => {
    onActivityChange?.(kernelLoading);
  }, [kernelLoading, onActivityChange]);

  useEffect(() => () => onActivityChange?.(false), [onActivityChange]);

  const startPiKernel = useCallback(async () => {
    setKernelLoading(true);
    setKernelMessage(null);
    try {
      const status = await invoke<PiSessionStatus>("start_pi_session", {
        options: {
          cwd: kernelCwd.trim() || undefined,
          name: "humhum-kernel-lab",
          provider: undefined,
          model: undefined,
        },
      });
      setKernelSession(status);
      await fetchSessions();
    } catch (e) {
      setKernelMessage(`Start Pi failed: ${String(e)}`);
    } finally {
      setKernelLoading(false);
    }
  }, [fetchSessions, kernelCwd]);

  const askHumi = useCallback(async () => {
    if (!appConfig) {
      setKernelMessage("还没有读取到 Pi 配置");
      return;
    }
    const prompt = kernelPrompt.trim();
    if (!prompt || kernelLoading) return;
    setKernelLoading(true);
    setKernelMessage(null);
    setHumiProgress("Humi 正在认真听你说");
    setChatMessages((messages) => [
      ...messages,
      { id: `user-${Date.now()}`, role: "user", text: prompt },
    ]);
    setKernelPrompt("");
    try {
      const runtime = piRuntimeRef.current ?? createHumiPiRuntime(appConfig, {
        onProgress: ({ label }) => setHumiProgress(label),
      });
      piRuntimeRef.current = runtime;
      const answer = await withTimeout(
        runtime.ask(prompt),
        HUMI_ASK_TIMEOUT_MS,
        "Humi 等了太久还没有收到 AI 助手回复，请检查 URL、Token 或模型服务是否可用。",
      );
      setChatMessages((messages) => [
        ...messages,
        { id: `assistant-${Date.now()}`, role: "assistant", text: answer },
      ]);
      setHumiProgress("我整理好啦");
    } catch (e) {
      const errorMessage = String(e instanceof Error ? e.message : e);
      setKernelMessage(errorMessage);
      setHumiProgress("这次没有连上 Pi");
      setChatMessages((messages) => [
        ...messages,
        { id: `error-${Date.now()}`, role: "assistant", text: errorMessage || "我暂时没有连上 Pi，请检查 URL、Token 和 model_name。" },
      ]);
    } finally {
      setKernelLoading(false);
    }
  }, [appConfig, kernelLoading, kernelPrompt]);

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void askHumi();
      }
    },
    [askHumi],
  );

  const sendPiTask = useCallback(async () => {
    if (!kernelSession) return;
    setKernelLoading(true);
    setKernelMessage(null);
    try {
      await invoke("send_pi_prompt", {
        sessionId: kernelSession.session_id,
        message: kernelPrompt,
      });
      await refreshPiSession(kernelSession.session_id);
      await fetchSessions();
    } catch (e) {
      setKernelMessage(`Send prompt failed: ${String(e)}`);
    } finally {
      setKernelLoading(false);
    }
  }, [fetchSessions, kernelPrompt, kernelSession, refreshPiSession]);

  const stopPiKernel = useCallback(async () => {
    if (!kernelSession) return;
    setKernelLoading(true);
    setKernelMessage(null);
    try {
      await invoke("stop_pi_session", { sessionId: kernelSession.session_id });
      setKernelSession((prev) => (prev ? { ...prev, state: "stopped" } : prev));
      await fetchSessions();
    } catch (e) {
      setKernelMessage(`Stop Pi failed: ${String(e)}`);
    } finally {
      setKernelLoading(false);
    }
  }, [fetchSessions, kernelSession]);

  return (
    <div className="hub-module humi-room-module">
      <div className="humi-conversation">
        <header style={{ display: "flex", alignItems: "center", gap: 10, width: "min(820px, 100%)", margin: "0 auto", minHeight: 52, padding: "4px 0" }}>
          <img
            src="/mascots/humi-sprite-v1.png"
            alt="Humi"
            width={38}
            height={38}
            style={{ objectFit: "contain", borderRadius: 8, flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 850, color: "#263241" }}>Humi</div>
            <div style={{ fontSize: 10, color: "#8290a3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{humiProgress}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowDetails((value) => !value)} aria-label="Toggle details" style={{ ...warmButtonStyle(false), padding: "6px 10px", fontSize: 11 }}>
            {showDetails ? "收起" : "详情"}
          </button>
        </header>

        <div className="humi-transcript">
          {chatMessages.map((message) => (
            <div key={message.id} className={`humi-message-row humi-message-row-${message.role}`}>
              <div className="humi-message">
                {message.text}
              </div>
            </div>
          ))}
          {kernelLoading && <div className="humi-loading-message">{humiProgress}…</div>}
        </div>

        <div className="humi-composer-shell">
          <div className="humi-composer">
            <textarea className="humi-composer-input" value={kernelPrompt} onChange={(e) => setKernelPrompt(e.target.value)} onKeyDown={handleComposerKeyDown} placeholder="和 Humi 聊聊" rows={1} style={{ ...warmInputStyle, flex: 1, minHeight: 30, maxHeight: 120, resize: "vertical", border: 0, padding: "5px 0", background: "transparent", boxShadow: "none" }} />
            <button className="humi-composer-send" onClick={() => void askHumi()} disabled={kernelLoading || !kernelPrompt.trim()} aria-label="Send message"><ArrowUp size={17} strokeWidth={2.3} aria-hidden="true" /></button>
          </div>
        </div>

        {showDetails && (
          <div className="humi-details-panel">
            <div className="humi-details-status-grid">
              <KernelStatusCard
                name="Pi Agent"
                ok={!!appConfig?.pi.token}
                detail={appConfig?.pi.token ? appConfig.pi.model_name : "请先配置 Token"}
                note="Bundled ReAct runtime"
              />
              <KernelStatusCard
                name="Qoder ACP"
                ok={!!qoderStatus?.acp_supported}
                detail={
                  qoderStatus?.installed
                    ? qoderStatus.acp_supported
                      ? "ACP exposed"
                      : "CLI detected, ACP not exposed"
                    : qoderStatus?.error || "not installed"
                }
                note={qoderStatus?.version || "Watcher fallback"}
              />
            </div>
            <input
              value={kernelCwd}
              onChange={(e) => setKernelCwd(e.target.value)}
              placeholder="Working directory"
              style={detailsInputStyle}
            />
            <textarea
              value={kernelRoots}
              onChange={(e) => setKernelRoots(e.target.value)}
              placeholder="Agent asset roots, one per line"
              rows={4}
              style={{ ...detailsInputStyle, resize: "vertical", minHeight: 76, fontFamily: "monospace", marginTop: 8 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button
                onClick={fetchKernelStatus}
                disabled={kernelLoading}
                style={warmButtonStyle(false)}
              >
                Check kernel
              </button>
              <button
                onClick={startPiKernel}
                disabled={kernelLoading || !piStatus?.installed || (!!kernelSession && kernelSession.state !== "stopped")}
                style={warmButtonStyle(false)}
              >
                Legacy CLI
              </button>
              <button
                onClick={sendPiTask}
                disabled={kernelLoading || !kernelSession || ["stopped", "error"].includes(kernelSession.state)}
                style={warmButtonStyle(false)}
              >
                Send Task
              </button>
              <button
                onClick={stopPiKernel}
                disabled={kernelLoading || !kernelSession || kernelSession.state === "stopped"}
                style={warmButtonStyle(false)}
              >
                Stop
              </button>
            </div>
            {qoderStatus?.hint && (
              <div style={{ fontSize: 10, color: "#7b8798", lineHeight: 1.5, marginTop: 8 }}>
                {qoderStatus.hint}
              </div>
            )}
            {agentKernelStatus && <AgentKernelStatusView status={agentKernelStatus} />}
            {localKernelResult && (
              <div style={{ marginTop: 10 }}>
                {(localKernelResult.top_tools.length > 0 ||
                  localKernelResult.top_skills.length > 0 ||
                  localKernelResult.agent_knowledge.length > 0 ||
                  localKernelResult.operational_tools.length > 0) && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                    <InsightList title="Skill knowledge" items={localKernelResult.top_skills} />
                    <InsightList title="Agent knowledge" items={localKernelResult.agent_knowledge} />
                    <InsightList title="Non-builtin tools" items={localKernelResult.top_tools} />
                    <InsightList title="Operation tools" items={localKernelResult.operational_tools} />
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 10, color: "#64748b", lineHeight: 1.55 }}>
                  {localKernelResult.summary}
                </div>
                {localKernelResult.agent_reply?.steps?.length ? (
                  <AgentTrace steps={localKernelResult.agent_reply.steps} />
                ) : null}
                <ContextPacketView context={localKernelResult.context_packet} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {Object.entries(localKernelResult.type_counts).map(([kind, count]) => (
                    <span key={kind} style={kernelPillStyle}>
                      {kind} {count}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {localKernelResult.suggested_actions.map((action) => (
                    <div key={action} style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
                      - {action}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>
                  memory: {localKernelResult.memory_path}
                </div>
              </div>
            )}
          </div>
        )}

        {kernelMessage && (
          <div style={{ marginTop: 10, fontSize: 10, color: "#fca5a5", lineHeight: 1.5 }}>
            {kernelMessage}
          </div>
        )}
      </div>

      {showDetails && (
        <RuntimeDetails
          sessions={sessions}
          hooksStatus={hooksStatus}
          kernelSession={kernelSession}
          hookTitle={t("hub.humi.hookStatus")}
          liveTitle={t("hub.humi.liveSessions")}
          emptyTitle={t("hub.humi.emptyTitle")}
          emptyDesc={t("hub.humi.emptyDesc")}
          noHooks={t("hub.humi.noHooks")}
        />
      )}
    </div>
  );
}

function QuietSignalsStrip({
  assets,
  skillCount,
  agentCount,
  connectedClients,
}: {
  assets: number;
  skillCount: number;
  agentCount: number;
  connectedClients: string[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 10,
        marginBottom: 14,
      }}
    >
      <QuietSignal label="quiet assets" value={assets ? `${assets}` : "indexing"} />
      <QuietSignal label="skill signals" value={skillCount ? `${skillCount}` : "warming up"} />
      <QuietSignal label="agent sources" value={agentCount ? `${agentCount}` : "listening"} />
      <QuietSignal label="live hooks" value={connectedClients.length ? connectedClients.join(", ") : "none yet"} />
    </div>
  );
}

function QuietSignal({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 11,
        borderRadius: 8,
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(116,143,165,0.12)",
        boxShadow: "0 10px 28px rgba(90,115,150,0.08)",
      }}
    >
      <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 850, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, color: "#334155", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

function RuntimeDetails({
  sessions,
  hooksStatus,
  kernelSession,
  hookTitle,
  liveTitle,
  emptyTitle,
  emptyDesc,
  noHooks,
}: {
  sessions: ActiveSession[];
  hooksStatus: HooksStatus;
  kernelSession: PiSessionStatus | null;
  hookTitle: string;
  liveTitle: string;
  emptyTitle: string;
  emptyDesc: string;
  noHooks: string;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      {kernelSession && (
        <div style={{ marginBottom: 12, fontSize: 10, color: "#64748b", lineHeight: 1.7 }}>
          <span style={{ color: "#6d6ade", fontWeight: 850 }}>{kernelSession.state}</span>
          {" · "}
          {kernelSession.session_id.slice(0, 18)}
          {" · messages "}
          {kernelSession.message_count}
          {kernelSession.last_event_type ? ` · ${kernelSession.last_event_type}` : ""}
          {kernelSession.last_error ? ` · ${kernelSession.last_error}` : ""}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#7b8798", textTransform: "uppercase", marginBottom: 8 }}>
          {hookTitle}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(hooksStatus).length === 0 ? (
            <div className="hub-empty-inline">{noHooks}</div>
          ) : (
            Object.entries(hooksStatus).map(([clientId, connected]) => (
              <span
                key={clientId}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: `1px solid ${connected ? "rgba(52,211,153,0.2)" : "rgba(116,143,165,0.12)"}`,
                  background: connected ? "rgba(223,248,239,0.78)" : "rgba(255,255,255,0.62)",
                  color: connected ? "#15803d" : "#94a3b8",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: connected ? "#34d399" : "#cbd5e1",
                  }}
                />
                {clientId}
              </span>
            ))
          )}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#7b8798", textTransform: "uppercase", marginBottom: 8 }}>
          {liveTitle}
        </div>
        {sessions.length === 0 ? (
          <div className="hub-empty-state">
            <div className="hub-empty-title">{emptyTitle}</div>
            <div className="hub-empty-desc">{emptyDesc}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sessions.map((s) => (
              <div
                key={s.session_id}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.72)",
                  border: "1px solid rgba(116,143,165,0.12)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: s.status === "active" ? "#34d399" : "#fbbf24",
                  }}
                />
                <span style={{ color: "#334155", fontWeight: 700 }}>
                  {s.project_name || s.session_id.slice(0, 8)}
                </span>
                <span style={{ color: "#94a3b8", fontSize: 10 }}>{s.client_type}</span>
                <div style={{ flex: 1 }} />
                {s.last_tool_name && (
                  <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>
                    {s.last_tool_name}
                  </span>
                )}
                <span style={{ fontSize: 10, color: "#94a3b8" }}>{s.event_count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InsightList({ title, items }: { title: string; items: LocalUsageInsight[] }) {
  return (
    <div style={{ padding: 9, borderRadius: 8, background: "rgba(255,255,255,0.62)", border: "1px solid rgba(116,143,165,0.12)" }}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 850, marginBottom: 6 }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.45 }}>
          Not enough local evidence yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 5 }}>
          {items.slice(0, 4).map((item) => (
            <div key={`${title}-${item.name}`} style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#334155", fontWeight: 760, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.name}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#6d6ade", fontWeight: 850 }}>
                  {item.count}
                </span>
              </div>
              <div style={{ fontSize: 9, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.source || item.detail}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WarmInsightCard({ title, body, tint }: { title: string; body: string; tint: string }) {
  return (
    <div
      style={{
        minHeight: 112,
        padding: 12,
        borderRadius: 8,
        background: tint,
        border: "1px solid rgba(116,143,165,0.12)",
      }}
    >
      <div style={{ fontSize: 11, color: "#6d6ade", fontWeight: 900, marginBottom: 7 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "#465468", lineHeight: 1.55, fontWeight: 620 }}>
        {body}
      </div>
    </div>
  );
}

function AgentTrace({ steps }: { steps: HumiAgentStep[] }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        borderRadius: 8,
        background: "rgba(255,255,255,0.58)",
        border: "1px solid rgba(116,143,165,0.12)",
      }}
    >
      <div style={{ fontSize: 10, color: "#6d6ade", fontWeight: 900, marginBottom: 7 }}>
        Humi agent trace
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {steps.map((step) => (
          <div key={`${step.phase}-${step.title}`} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8 }}>
            <div style={{ fontSize: 9, color: "#8d7ddf", fontWeight: 900, textTransform: "uppercase" }}>
              {step.phase}
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#334155", fontWeight: 850, marginBottom: 2 }}>
                {step.title}
              </div>
              <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
                {step.content}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentKernelStatusView({ status }: { status: AgentKernelStatus }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        borderRadius: 8,
        background: "rgba(255,255,255,0.58)",
        border: "1px solid rgba(116,143,165,0.12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#6d6ade", fontWeight: 900 }}>
          Local agent kernel
        </div>
        <div style={{ marginLeft: "auto", fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>
          {status.version}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ContextList
          title="Loop contract"
          items={status.loop_model.map((stage) => `${stage.phase}: ${stage.contract}`)}
        />
        <ContextList title="Active bridges" items={status.active_bridges} />
        <ContextList
          title="Roles"
          items={status.roles.map((role) => `${role.name}: ${role.job}`)}
        />
        <ContextList title="Memory layers" items={status.memory_layers} />
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
        {status.next_kernel_step}
      </div>
    </div>
  );
}

function cardTint(tone: string): string {
  if (tone === "purple") return "#f0ecff";
  if (tone === "green") return "#e7f8ef";
  return "#eaf7ff";
}

function ContextPacketView({ context }: { context: HumiContextPacket }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        borderRadius: 8,
        background: "rgba(255,255,255,0.58)",
        border: "1px solid rgba(116,143,165,0.12)",
      }}
    >
      <div style={{ fontSize: 10, color: "#6d6ade", fontWeight: 900, marginBottom: 6 }}>
        Context fed to Humi
      </div>
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5, marginBottom: 8 }}>
        Question: {context.question || "empty"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ContextList title="Observed workflows" items={context.observed_workflows} />
        <ContextList title="Preference candidates" items={context.user_preference_candidates} />
        <ContextList title="Memory candidates" items={context.memory_candidates} />
        <ContextList title="Risk notes" items={context.risk_notes} />
        <ContextList title="Sources" items={context.context_sources} />
        <ContextList title="Evidence" items={context.evidence_notes} />
      </div>
    </div>
  );
}

function ContextList({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 850, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: "grid", gap: 3 }}>
        {(items.length ? items : ["No signal yet."]).slice(0, 4).map((item) => (
          <div
            key={`${title}-${item}`}
            style={{
              fontSize: 9,
              color: "#475569",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function describeWorkDirection(result: LocalAgentKernelResult): string {
  if (result.context_packet.observed_workflows[0]) {
    return result.context_packet.observed_workflows[0];
  }
  const tools = result.top_tools.map((item) => item.name.toLowerCase());
  if (tools.some((name) => ["bash", "read", "edit", "write"].includes(name))) {
    return "你最近明显在做工程实现和本地验证，偏向边读、边改、边跑通。";
  }
  if (result.type_counts.skill || result.type_counts.agent) {
    return "你正在整理 Agent 能力底座，适合把重复配置沉淀成长期知识。";
  }
  return "你最近的上下文还在形成中，Humi 会继续观察你的工作节奏。";
}

function describePreferenceMemory(result: LocalAgentKernelResult): string {
  if (result.context_packet.user_preference_candidates[0]) {
    return result.context_packet.user_preference_candidates[0];
  }
  if (result.top_tools.length > 0) {
    return "少展示原始配置，多给结论、偏好、下一步。这条偏好我会优先记住。";
  }
  if ((result.type_counts.memory ?? 0) > 0) {
    return "你已经有一些记忆素材，下一步是把它们整理成可复用的个人规则。";
  }
  return "我会先记录你的表达偏好和工作习惯，再慢慢补足长期记忆。";
}

function describeNextStep(result: LocalAgentKernelResult): string {
  if (result.context_packet.memory_candidates[0]) {
    return result.context_packet.memory_candidates[0];
  }
  const action = result.suggested_actions[0];
  if (action?.toLowerCase().includes("soul")) {
    return "补一层 soul/personality，让不同 Agent 更稳定地理解你的表达风格。";
  }
  if (action?.toLowerCase().includes("memory")) {
    return "先把今天重复出现的偏好写进 memory，后面不用反复说明。";
  }
  return "先继续完成钉钉本地桥和 Hype 归档，把演示链路变顺。";
}

function KernelStatusCard({
  name,
  ok,
  detail,
  note,
}: {
  name: string;
  ok: boolean;
  detail?: string | null;
  note: string;
}) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        background: ok ? "rgba(223,248,239,0.8)" : "rgba(255,255,255,0.58)",
        border: `1px solid ${ok ? "rgba(52,211,153,0.18)" : "rgba(116,143,165,0.12)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: ok ? "#34d399" : "rgba(255,255,255,0.22)",
            boxShadow: ok ? "0 0 8px rgba(52,211,153,0.45)" : "none",
          }}
        />
        <span style={{ fontSize: 11, color: "#334155", fontWeight: 800 }}>{name}</span>
      </div>
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.35 }}>{detail || "unknown"}</div>
      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 4 }}>{note}</div>
    </div>
  );
}

const warmInputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid rgba(116,143,165,0.16)",
  background: "rgba(255,255,255,0.76)",
  color: "#263241",
  fontSize: 14,
  lineHeight: 1.55,
  padding: "12px 14px",
  outline: "none",
};

const detailsInputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid rgba(116,143,165,0.14)",
  background: "rgba(255,255,255,0.58)",
  color: "#334155",
  fontSize: 11,
  padding: "8px 10px",
  outline: "none",
};

const kernelPillStyle: CSSProperties = {
  padding: "3px 7px",
  borderRadius: 8,
  border: "1px solid rgba(116,143,165,0.14)",
  background: "rgba(255,255,255,0.62)",
  color: "#64748b",
  fontSize: 9,
  fontWeight: 800,
};

function warmButtonStyle(primary: boolean): CSSProperties {
  return {
    border: `1px solid ${primary ? "rgba(109,106,222,0.26)" : "rgba(116,143,165,0.16)"}`,
    background: primary ? "linear-gradient(135deg, #8d7ddf, #63bdd1)" : "rgba(255,255,255,0.68)",
    color: primary ? "#ffffff" : "#57667a",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 800,
    padding: primary ? "9px 16px" : "8px 12px",
    cursor: "pointer",
    boxShadow: primary ? "0 10px 24px rgba(109,106,222,0.2)" : "none",
  };
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.04)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "monospace" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
