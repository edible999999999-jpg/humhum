import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PetCanvas } from "../Pet/PetCanvas";
import { useTranslation } from "../../lib/i18n/react";

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

const DEFAULT_KERNEL_ROOTS = [
  "~/.codex/skills",
  "~/.codex/plugins/cache",
  "~/.codex/vendor_imports/skills",
  "~/.claude",
  "~/.agents/skills",
  "~/.qoder",
  "~/Desktop/my_station/devpod-ai-companion",
].join("\n");

export function HumiModule() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [hooksStatus, setHooksStatus] = useState<HooksStatus>({});
  const [petState, setPetState] = useState<"idle" | "processing" | "speaking">("idle");
  const [piStatus, setPiStatus] = useState<PiInstallStatus | null>(null);
  const [qoderStatus, setQoderStatus] = useState<QoderAcpStatus | null>(null);
  const [kernelSession, setKernelSession] = useState<PiSessionStatus | null>(null);
  const [kernelLoading, setKernelLoading] = useState(false);
  const [kernelMessage, setKernelMessage] = useState<string | null>(null);
  const [kernelCwd, setKernelCwd] = useState("/Users/yuxi/Desktop/my_station/devpod-ai-companion");
  const [kernelRoots, setKernelRoots] = useState(DEFAULT_KERNEL_ROOTS);
  const [localKernelResult, setLocalKernelResult] = useState<LocalAgentKernelResult | null>(null);
  const [agentKernelStatus, setAgentKernelStatus] = useState<AgentKernelStatus | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [kernelPrompt, setKernelPrompt] = useState(
    "现在技能用得最多的是啥？"
  );

  const fetchSessions = useCallback(async () => {
    try {
      const data = await invoke<ActiveSession[]>("get_active_sessions");
      setSessions(data);
      if (data.some((s) => s.status === "active")) {
        setPetState("processing");
      } else {
        setPetState("idle");
      }
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
      const [pi, qoder, kernel] = await Promise.all([
        invoke<PiInstallStatus>("check_pi_installed"),
        invoke<QoderAcpStatus>("check_qoder_acp_support"),
        invoke<AgentKernelStatus>("get_agent_kernel_status"),
      ]);
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

  const runLocalKernel = useCallback(async () => {
    setKernelLoading(true);
    setKernelMessage(null);
    try {
      const roots = kernelRoots
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      const result = await invoke<LocalAgentKernelResult>("run_local_agent_kernel", {
        options: {
          cwd: kernelCwd.trim() || undefined,
          prompt: kernelPrompt,
          roots,
        },
      });
      setLocalKernelResult(result);
      await fetchSessions();
    } catch (e) {
      setKernelMessage(`Local kernel failed: ${String(e)}`);
    } finally {
      setKernelLoading(false);
    }
  }, [fetchSessions, kernelCwd, kernelPrompt, kernelRoots]);

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

  const connectedClients = Object.entries(hooksStatus)
    .filter(([, connected]) => connected)
    .map(([id]) => id);

  const activeClientTypes = [...new Set(sessions.map((s) => s.client_type))];
  const currentReply = localKernelResult?.agent_reply;
  const visibleCards = currentReply?.cards?.length
    ? currentReply.cards
    : localKernelResult
      ? [
          { title: "Work direction", body: describeWorkDirection(localKernelResult), tone: "blue" },
          { title: "Remember this", body: describePreferenceMemory(localKernelResult), tone: "purple" },
          { title: "Gentle next step", body: describeNextStep(localKernelResult), tone: "green" },
        ]
      : [];

  return (
    <div className="hub-module">
      <div className="hub-module-heading">
        <span className="hub-module-kicker">{t("hub.role.humi")}</span>
        <h2 className="hub-module-title">{t("hub.humi.title")}</h2>
        <p className="hub-module-desc">{t("hub.humi.desc")}</p>
      </div>

      {/* Ask Humi */}
      <div
        style={{
          marginBottom: 16,
          padding: 18,
          borderRadius: 24,
          background: "linear-gradient(145deg, rgba(255,250,247,0.98), rgba(239,249,255,0.94) 55%, rgba(244,236,255,0.9))",
          border: "1px solid rgba(116,143,165,0.18)",
          boxShadow: "0 18px 54px rgba(90, 115, 150, 0.16)",
          color: "#263241",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "128px 1fr", gap: 18, alignItems: "center", marginBottom: 16 }}>
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 128,
              borderRadius: 22,
              background: "radial-gradient(circle at 35% 25%, rgba(255,255,255,0.95), rgba(224,246,255,0.72) 48%, rgba(236,226,255,0.6))",
              border: "1px solid rgba(138, 171, 196, 0.14)",
            }}
          >
            <PetCanvas state={petState} size={104} activeClients={activeClientTypes} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 850, color: "#6d6ade", marginBottom: 5 }}>
              Ask Humi
            </div>
            <div style={{ fontSize: 24, lineHeight: 1.18, fontWeight: 900, color: "#263241", letterSpacing: 0 }}>
              Tell me what you noticed about me.
            </div>
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.55, marginTop: 8 }}>
              Humi quietly reads local Agent context, then turns it into personal preferences, work direction, and gentle next steps.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                value={kernelPrompt}
                onChange={(e) => setKernelPrompt(e.target.value)}
                placeholder="Ask Humi something like: 最近我最常用的技能是什么？"
                rows={3}
                style={{ ...warmInputStyle, resize: "vertical", minHeight: 82 }}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  "最近我最常用的技能是什么？",
                  "你觉得我现在的工作方向是什么？",
                  "哪些偏好应该帮我记住？",
                  "今天我最该先推进什么？",
                ].map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => setKernelPrompt(question)}
                    style={{
                      border: "1px solid rgba(116,143,165,0.14)",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.68)",
                      color: "#57667a",
                      fontSize: 11,
                      fontWeight: 750,
                      padding: "7px 10px",
                      cursor: "pointer",
                    }}
                  >
                    {question}
                  </button>
                ))}
              </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={runLocalKernel}
              disabled={kernelLoading}
              style={warmButtonStyle(true)}
            >
              {kernelLoading ? "Humi is thinking..." : "Ask Humi"}
            </button>
            <button onClick={() => setShowDetails((value) => !value)} style={warmButtonStyle(false)}>
              {showDetails ? "Hide details" : "Details"}
            </button>
            <span style={{ fontSize: 11, color: "#7b8798" }}>
              Scanning stays quiet. Humi only shows what is useful to you.
            </span>
          </div>
        </div>

        {localKernelResult && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              borderRadius: 20,
              background: "rgba(255,255,255,0.72)",
              border: "1px solid rgba(116,143,165,0.14)",
              boxShadow: "0 10px 30px rgba(90,115,150,0.1)",
            }}
          >
            <div style={{ fontSize: 12, color: "#8d7ddf", fontWeight: 900, marginBottom: 6 }}>
              What Humi noticed
            </div>
            <div style={{ fontSize: 15, color: "#2d3748", lineHeight: 1.78, fontWeight: 650 }}>
              {currentReply?.message || localKernelResult.answer}
            </div>
            {currentReply?.confidence && (
              <div style={{ marginTop: 9, fontSize: 10, color: "#8290a3", fontWeight: 750 }}>
                Confidence: {currentReply.confidence} · Humi separates real skills from built-in operation tools.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
              {visibleCards.map((card) => (
                <WarmInsightCard
                  key={`${card.title}-${card.tone}`}
                  title={card.title}
                  body={card.body}
                  tint={cardTint(card.tone)}
                />
              ))}
            </div>
          </div>
        )}

        {showDetails && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 16,
              background: "rgba(255,255,255,0.48)",
              border: "1px dashed rgba(116,143,165,0.22)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <KernelStatusCard
                name="Pi RPC"
                ok={!!piStatus?.installed}
                detail={piStatus?.installed ? piStatus.version || "installed" : piStatus?.error || "not installed"}
                note="Active sidecar kernel"
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
                Start Pi
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

        {kernelSession && (
          <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.42)", lineHeight: 1.7 }}>
            <span style={{ color: "#94eff4", fontWeight: 800 }}>{kernelSession.state}</span>
            {" · "}
            {kernelSession.session_id.slice(0, 18)}
            {" · messages "}
            {kernelSession.message_count}
            {kernelSession.last_event_type ? ` · ${kernelSession.last_event_type}` : ""}
            {kernelSession.last_error ? ` · ${kernelSession.last_error}` : ""}
          </div>
        )}

        {kernelMessage && (
          <div style={{ marginTop: 10, fontSize: 10, color: "#fca5a5", lineHeight: 1.5 }}>
            {kernelMessage}
          </div>
        )}
      </div>

      {/* Connected agents */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          {t("hub.humi.hookStatus")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(hooksStatus).length === 0 ? (
            <div className="hub-empty-inline">{t("hub.humi.noHooks")}</div>
          ) : (
            Object.entries(hooksStatus).map(([clientId, connected]) => (
              <span
                key={clientId}
                style={{
                  padding: "4px 10px",
                  borderRadius: 9999,
                  border: `1px solid ${connected ? "rgba(52,211,153,0.2)" : "rgba(255,255,255,0.06)"}`,
                  background: connected ? "rgba(52,211,153,0.06)" : "rgba(255,255,255,0.02)",
                  color: connected ? "rgba(110,231,183,0.9)" : "rgba(255,255,255,0.3)",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: connected ? "#34d399" : "rgba(255,255,255,0.15)",
                }} />
                {clientId}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Active sessions */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          {t("hub.humi.liveSessions")}
        </div>
        {sessions.length === 0 ? (
          <div className="hub-empty-state">
            <div className="hub-empty-title">{t("hub.humi.emptyTitle")}</div>
            <div className="hub-empty-desc">{t("hub.humi.emptyDesc")}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sessions.map((s) => (
              <div
                key={s.session_id}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: s.status === "active" ? "#34d399" : "#fbbf24",
                  boxShadow: s.status === "active" ? "0 0 6px #34d399" : "none",
                }} />
                <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
                  {s.project_name || s.session_id.slice(0, 8)}
                </span>
                <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>
                  {s.client_type}
                </span>
                <div style={{ flex: 1 }} />
                {s.last_tool_name && (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                    {s.last_tool_name}
                  </span>
                )}
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                  {s.event_count}
                </span>
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
    <div style={{ padding: 9, borderRadius: 12, background: "rgba(255,255,255,0.62)", border: "1px solid rgba(116,143,165,0.12)" }}>
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
        borderRadius: 16,
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
        borderRadius: 14,
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
        borderRadius: 14,
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
        borderRadius: 14,
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
  return "先继续完成阿里钉本地桥和 Hype 归档，把演示链路变顺。";
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
        borderRadius: 12,
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
  borderRadius: 18,
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
  borderRadius: 12,
  border: "1px solid rgba(116,143,165,0.14)",
  background: "rgba(255,255,255,0.58)",
  color: "#334155",
  fontSize: 11,
  padding: "8px 10px",
  outline: "none",
};

const kernelPillStyle: CSSProperties = {
  padding: "3px 7px",
  borderRadius: 999,
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
    borderRadius: 999,
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
        borderRadius: 14,
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
