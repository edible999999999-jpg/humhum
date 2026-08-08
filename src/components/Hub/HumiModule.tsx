import { useState, useEffect, useCallback, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUp,
  ExternalLink,
  PanelRight,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Volume2,
  Wrench,
} from "lucide-react";
import type { AppConfig } from "../../types";
import { createHumiPiRuntime } from "../../lib/pi/runtime";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import type { HumiPiRuntime } from "../../lib/pi/types";
import type { HexaDevelopmentGoal, HexaGoalAttempt } from "../../hooks/hexaGoalMonitoring";
import type { HexaWatchedSession } from "../../hooks/useHexaData";
import { useTranslation } from "@/lib/i18n/react";
import { t as translate } from "@/lib/i18n";

interface ActiveSession {
  session_id: string;
  client_type: string;
  project_name: string | null;
  status: string;
  event_count: number;
  last_event_at: string;
  last_tool_name: string | null;
}

interface AggregatedStats {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  active_agents: number;
  total_tool_calls: number;
  total_sessions: number;
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

type HumiBrainProvider = "codex" | "qoder" | "claude";

interface HumiBrainProviderStatus {
  provider: HumiBrainProvider;
  display_name: string;
  ready: boolean;
  /** Whether the provider has a real transport. Unsupported ones are hidden. */
  supported?: boolean;
  status: string;
  detail: string;
}

interface HumiBrainStatus {
  initialized: boolean;
  primary_provider?: HumiBrainProvider | null;
  fallback_enabled: boolean;
  providers: HumiBrainProviderStatus[];
}

interface HumiBrainAnswer {
  answer: string;
  provider: HumiBrainProvider | "pi";
  fallback: boolean;
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
  onOpenHexa: (goalId: string | null) => void;
}

interface HumiHexaAttention {
  attentionCount: number;
  failedCount: number;
  mostUrgentGoal: HexaDevelopmentGoal | null;
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
const HUMI_ASK_TIMEOUT_MS = 100_000;

// Persist the visible transcript across restarts. Prefer localStorage; fall
// back to sessionStorage, then an in-memory shim, so a missing or throwing
// Storage implementation (private mode, restricted webview) never breaks the
// component at import time.
const HUMI_CHAT_STORAGE: Pick<Storage, "getItem" | "setItem"> = (() => {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // fall through
  }
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    // fall through
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  };
})();
function defaultHumiChatMessages(): HumiChatMessage[] {
  return [
    {
      id: "humi-welcome",
      role: "assistant",
      text: translate("humi.chat.welcome"),
    },
  ];
}

function loadHumiChatMessages(): HumiChatMessage[] {
  try {
    const raw = HUMI_CHAT_STORAGE.getItem(HUMI_CHAT_STORAGE_KEY);
    if (!raw) return defaultHumiChatMessages();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultHumiChatMessages();
    return parsed.filter(
      (message): message is HumiChatMessage =>
        typeof message?.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.text === "string",
    );
  } catch {
    return defaultHumiChatMessages();
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

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function attemptIsComplete(
  attempt: HexaGoalAttempt,
  session: HexaWatchedSession | undefined,
): boolean {
  return attempt.completed_at !== null || session?.status === "completed";
}

function summarizeHexaAttention(
  goals: HexaDevelopmentGoal[],
  watchedSessions: HexaWatchedSession[],
): HumiHexaAttention {
  const sessionsById = new Map(
    watchedSessions.map((session) => [session.session_id, session]),
  );
  const linkedSessionIds = new Set(
    goals.flatMap((goal) => goal.attempts.map((attempt) => attempt.session_id)),
  );
  const candidates: Array<{
    goal: HexaDevelopmentGoal | null;
    failedCount: number;
    priority: number;
    updatedAt: string;
  }> = goals.flatMap((goal) => {
    if (goal.accepted_attempt_id) return [];

    const failedCount = goal.attempts.filter(
      (attempt) => attempt.result_status === "failed",
    ).length;
    const hasLiveBlocker = goal.attempts.some((attempt) => {
      const session = sessionsById.get(attempt.session_id);
      return session?.status === "blocked" || session?.status === "waiting";
    });
    const hasCompletedUnverified = goal.attempts.some((attempt) => {
      const session = sessionsById.get(attempt.session_id);
      return (
        attempt.result_status === "unverified" &&
        attemptIsComplete(attempt, session)
      );
    });
    const allAttemptsComplete =
      goal.attempts.length > 0 &&
      goal.attempts.every((attempt) =>
        attemptIsComplete(attempt, sessionsById.get(attempt.session_id)),
      );

    if (
      failedCount === 0 &&
      !hasLiveBlocker &&
      !hasCompletedUnverified &&
      !allAttemptsComplete
    ) {
      return [];
    }

    return [{
      goal,
      failedCount,
      priority:
        failedCount > 0
          ? 0
          : hasLiveBlocker
            ? 1
            : hasCompletedUnverified
              ? 2
              : 3,
      updatedAt: goal.updated_at,
    }];
  });
  for (const session of watchedSessions) {
    if (
      linkedSessionIds.has(session.session_id) ||
      (session.status !== "blocked" && session.status !== "waiting")
    ) {
      continue;
    }
    candidates.push({
      goal: null,
      failedCount: 0,
      priority: 1,
      updatedAt: session.updated_at,
    });
  }
  candidates.sort((left, right) =>
    left.priority - right.priority ||
    timestamp(right.updatedAt) - timestamp(left.updatedAt)
  );

  return {
    attentionCount: candidates.length,
    failedCount: candidates.reduce(
      (total, candidate) => total + candidate.failedCount,
      0,
    ),
    mostUrgentGoal: candidates[0]?.goal ?? null,
  };
}

export function HumiModule({ onActivityChange, onOpenHexa }: HumiModuleProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [developmentGoals, setDevelopmentGoals] = useState<HexaDevelopmentGoal[]>([]);
  const [hexaWatchedSessions, setHexaWatchedSessions] = useState<HexaWatchedSession[]>([]);
  const [hooksStatus, setHooksStatus] = useState<HooksStatus>({});
  const [piStatus, setPiStatus] = useState<PiInstallStatus | null>(null);
  const [qoderStatus, setQoderStatus] = useState<QoderAcpStatus | null>(null);
  const [brainStatus, setBrainStatus] = useState<HumiBrainStatus | null>(null);
  const [kernelSession, setKernelSession] = useState<PiSessionStatus | null>(null);
  const [kernelLoading, setKernelLoading] = useState(false);
  const [kernelMessage, setKernelMessage] = useState<string | null>(null);
  const [kernelCwd, setKernelCwd] = useState("");
  const [kernelRoots, setKernelRoots] = useState(DEFAULT_KERNEL_ROOTS);
  const [localKernelResult, setLocalKernelResult] = useState<LocalAgentKernelResult | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [humiProgress, setHumiProgress] = useState(() => translate("humi.progress.idle"));
  const [chatMessages, setChatMessages] = useState<HumiChatMessage[]>(loadHumiChatMessages);
  const [agentKernelStatus, setAgentKernelStatus] = useState<AgentKernelStatus | null>(null);
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsMessage, setOperationsMessage] = useState<string | null>(null);
  const [ttsPreviewing, setTtsPreviewing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  // Lets the user reopen the brain picker after a brain is already chosen, so
  // they can switch (e.g. from an unusable Codex to an installed Claude).
  const [showBrainPicker, setShowBrainPicker] = useState(false);
  const piRuntimeRef = useRef<HumiPiRuntime | null>(null);
  const [kernelPrompt, setKernelPrompt] = useState(
    () => translate("humi.prompt.default")
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

  const fetchStats = useCallback(async () => {
    try {
      const data = await invoke<AggregatedStats>("get_stats");
      setStats(data);
    } catch {
      // Stats stay optional when local analytics are disabled.
    }
  }, []);

  const fetchHexaAttention = useCallback(async () => {
    const [goalsResult, sessionsResult] = await Promise.allSettled([
      invoke<HexaDevelopmentGoal[]>("get_hexa_development_goals"),
      invoke<HexaWatchedSession[]>("get_hexa_watched_sessions"),
    ]);
    setDevelopmentGoals(
      goalsResult.status === "fulfilled" ? goalsResult.value : [],
    );
    setHexaWatchedSessions(
      sessionsResult.status === "fulfilled" ? sessionsResult.value : [],
    );
  }, []);

  const fetchKernelStatus = useCallback(async () => {
    try {
      const [config, pi, qoder, kernel, brain] = await Promise.all([
        invoke<AppConfig>("get_config"),
        invoke<PiInstallStatus>("check_pi_installed"),
        invoke<QoderAcpStatus>("check_qoder_acp_support"),
        invoke<AgentKernelStatus>("get_agent_kernel_status"),
        invoke<HumiBrainStatus>("get_humi_brain_status"),
      ]);
      setAppConfig(config);
      setPiStatus(pi);
      setQoderStatus(qoder);
      setAgentKernelStatus(kernel);
      setBrainStatus(brain);
    } catch (e) {
      setKernelMessage(isTauriRuntime() ? `Kernel check failed: ${String(e)}` : null);
    }
  }, []);

  const refreshBrainStatus = useCallback(async () => {
    try {
      setBrainStatus(await invoke<HumiBrainStatus>("get_humi_brain_status"));
    } catch {
      // The existing setup state remains visible while the bridge reconnects.
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
    fetchStats();
    fetchHexaAttention();
    const interval = setInterval(() => {
      void fetchSessions();
      void fetchHexaAttention();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchHexaAttention, fetchSessions, fetchHooksStatus, fetchKernelStatus, fetchStats]);

  useEffect(() => {
    const interval = setInterval(fetchStats, 15_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  useEffect(() => {
    if (brainStatus?.initialized) return;
    const interval = setInterval(refreshBrainStatus, 3000);
    return () => clearInterval(interval);
  }, [brainStatus?.initialized, refreshBrainStatus]);

  useEffect(() => {
    if (!kernelSession || ["stopped", "error"].includes(kernelSession.state)) return;
    const interval = setInterval(() => refreshPiSession(kernelSession.session_id), 2000);
    return () => clearInterval(interval);
  }, [kernelSession, refreshPiSession]);

  useEffect(() => {
    piRuntimeRef.current = null;
  }, [appConfig?.pi.url, appConfig?.pi.token, appConfig?.pi.model_name]);

  useEffect(() => {
    // Persist across restarts (localStorage, not sessionStorage) so the
    // conversation the user sees survives a relaunch and stays aligned with the
    // Codex thread the backend keeps under ~/.humhum/brain/sessions.json.
    try {
      HUMI_CHAT_STORAGE.setItem(HUMI_CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
    } catch {
      // Quota or private-mode failure — a lost transcript is not worth crashing.
    }
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
      setKernelMessage(t("humi.error.noConfig"));
      return;
    }
    if (!appConfig.brain.initialized || !appConfig.brain.primary_provider) {
      setKernelMessage(t("humi.error.noBrain"));
      return;
    }
    const prompt = kernelPrompt.trim();
    if (!prompt || kernelLoading) return;
    setKernelLoading(true);
    setKernelMessage(null);
    setHumiProgress(t("humi.progress.listening"));
    setChatMessages((messages) => [
      ...messages,
      { id: `user-${Date.now()}`, role: "user", text: prompt },
    ]);
    setKernelPrompt("");
    try {
      const result = await withTimeout(
        invoke<HumiBrainAnswer>("ask_humi_with_brain", {
          options: {
            prompt,
            roots: kernelRoots
              .split("\n")
              .map((root) => root.trim())
              .filter(Boolean),
          },
        }),
        HUMI_ASK_TIMEOUT_MS,
        t("humi.error.timeout"),
      );
      setChatMessages((messages) => [
        ...messages,
        { id: `assistant-${Date.now()}`, role: "assistant", text: result.answer },
      ]);
      setHumiProgress(t("humi.progress.organized", { provider: result.provider === "codex" ? "Codex" : result.provider }));
    } catch (e) {
      if (appConfig.brain.fallback_enabled && appConfig.pi.token) {
        try {
          setHumiProgress(t("humi.progress.usingFallback"));
          const runtime = piRuntimeRef.current ?? createHumiPiRuntime(appConfig, {
            onProgress: ({ label }) => setHumiProgress(label),
          });
          piRuntimeRef.current = runtime;
          const answer = await withTimeout(
            runtime.ask(prompt),
            HUMI_ASK_TIMEOUT_MS,
            t("humi.error.fallbackTimeout"),
          );
          setChatMessages((messages) => [
            ...messages,
            { id: `assistant-${Date.now()}`, role: "assistant", text: answer },
          ]);
          setHumiProgress(t("humi.progress.fallbackOrganized"));
        } catch (fallbackError) {
          const errorMessage = String(
            fallbackError instanceof Error ? fallbackError.message : fallbackError,
          );
          setKernelMessage(errorMessage);
          setHumiProgress(t("humi.progress.notConnected"));
          setChatMessages((messages) => [
            ...messages,
            { id: `error-${Date.now()}`, role: "assistant", text: errorMessage },
          ]);
        }
      } else {
        const errorMessage = String(e instanceof Error ? e.message : e);
        setKernelMessage(errorMessage);
        setHumiProgress(t("humi.progress.notConnected"));
        setChatMessages((messages) => [
          ...messages,
          { id: `error-${Date.now()}`, role: "assistant", text: errorMessage },
        ]);
      }
    } finally {
      setKernelLoading(false);
    }
  }, [appConfig, kernelLoading, kernelPrompt, kernelRoots, t]);

  const selectBrain = useCallback(async (provider: HumiBrainProvider) => {
    setKernelLoading(true);
    setKernelMessage(null);
    try {
      const status = await invoke<HumiBrainStatus>("set_humi_brain_provider", { provider });
      const config = await invoke<AppConfig>("get_config");
      setBrainStatus(status);
      setAppConfig(config);
      setShowBrainPicker(false);
      setHumiProgress(t("humi.progress.connected", { name: status.providers.find((item) => item.provider === provider)?.display_name ?? provider }));
    } catch (error) {
      setKernelMessage(String(error));
    } finally {
      setKernelLoading(false);
    }
  }, [t]);

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

  const refreshOperations = useCallback(async () => {
    setOperationsLoading(true);
    setOperationsMessage(null);
    await Promise.all([
      fetchSessions(),
      fetchHooksStatus(),
      fetchKernelStatus(),
      fetchStats(),
      fetchHexaAttention(),
    ]);
    setOperationsLoading(false);
  }, [fetchHexaAttention, fetchHooksStatus, fetchKernelStatus, fetchSessions, fetchStats]);

  const focusSession = useCallback(async (session: ActiveSession) => {
    setOperationsMessage(null);
    try {
      await invoke("focus_agent_session", { sessionId: session.session_id });
    } catch (error) {
      setOperationsMessage(t("humi.error.openSession", { error: String(error) }));
    }
  }, [t]);

  const toggleAutoConfirm = useCallback(async () => {
    if (!appConfig) return;
    const updated: AppConfig = {
      ...appConfig,
      ui: {
        ...appConfig.ui,
        auto_confirm: !appConfig.ui.auto_confirm,
      },
    };
    setAppConfig(updated);
    setOperationsMessage(null);
    try {
      await invoke("save_config", { newConfig: updated });
    } catch (error) {
      setAppConfig(appConfig);
      setOperationsMessage(t("humi.error.autoConfirm", { error: String(error) }));
    }
  }, [appConfig, t]);

  const previewTts = useCallback(async () => {
    if (!appConfig || ttsPreviewing) return;
    setTtsPreviewing(true);
    setOperationsMessage(null);
    try {
      const base64Data = await invoke<string>("synthesize_system_speech", {
        text: t("humi.tts.previewText"),
        voice: appConfig.tts.voice,
        speed: appConfig.tts.speed,
      });
      await invoke("play_audio", { base64Data });
    } catch (error) {
      setOperationsMessage(t("humi.error.ttsPreview", { error: String(error) }));
    } finally {
      setTtsPreviewing(false);
    }
  }, [appConfig, ttsPreviewing, t]);

  const hexaAttention = summarizeHexaAttention(
    developmentGoals,
    hexaWatchedSessions,
  );

  return (
    <div className="hub-module humi-room-module">
      <div className={`humi-workspace ${operationsOpen ? "is-operations-open" : ""}`}>
        <div className="humi-conversation humi-conversation-stage">
          <button
            type="button"
            className="humi-operations-toggle"
            onClick={() => setOperationsOpen((open) => !open)}
            aria-expanded={operationsOpen}
            aria-controls="humi-operations-panel"
            aria-label={operationsOpen ? t("humi.operations.collapse") : t("humi.operations.expand")}
            title={operationsOpen ? t("humi.operations.collapse") : t("humi.operations.expand")}
          >
            <PanelRight size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>

          <div className="humi-transcript">
            {brainStatus && (!brainStatus.initialized || showBrainPicker) && (
              <div className="humi-brain-setup" role="group" aria-label={t("humi.brain.selectAria")}>
                <div className="humi-brain-setup-copy">
                  <strong>{t("humi.brain.selectTitle")}</strong>
                  <span>{t("humi.brain.selectDesc")}</span>
                </div>
                <div className="humi-brain-provider-list">
                  {brainStatus.providers
                    .filter((provider) => provider.supported !== false)
                    .map((provider) => (
                    <button
                      key={provider.provider}
                      type="button"
                      className={`humi-brain-provider ${provider.ready ? "is-ready" : ""} ${provider.provider === brainStatus.primary_provider ? "is-current" : ""}`}
                      disabled={!provider.ready || kernelLoading}
                      onClick={() => void selectBrain(provider.provider)}
                      title={provider.detail}
                    >
                      <strong>{provider.display_name}</strong>
                      <span>{provider.ready ? t("humi.brain.connectable") : provider.detail}</span>
                    </button>
                  ))}
                </div>
                {brainStatus.initialized && (
                  <button
                    type="button"
                    className="humi-brain-picker-cancel"
                    onClick={() => setShowBrainPicker(false)}
                  >
                    {t("humi.brain.cancelSwitch")}
                  </button>
                )}
              </div>
            )}
            {chatMessages.map((message) => (
              <div key={message.id} className={`humi-message-row humi-message-row-${message.role}`}>
                {message.role === "assistant" && (
                  <img
                    className="humi-message-avatar"
                    src="/mascots/humi-sprite-v1.png"
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <div className="humi-message">
                  {message.text}
                </div>
              </div>
            ))}
            {kernelLoading && (
              <div className="humi-message-row humi-message-row-assistant">
                <img
                  className="humi-message-avatar is-listening"
                  src="/mascots/humi-sprite-v1.png"
                  alt=""
                  aria-hidden="true"
                />
                <div className="humi-loading-message">{humiProgress}…</div>
              </div>
            )}
          </div>

          <div className="humi-composer-shell">
            <div className="humi-composer">
              <button
                type="button"
                className={`humi-composer-tool ${showDetails ? "is-active" : ""}`}
                onClick={() => setShowDetails((value) => !value)}
                aria-label={showDetails ? t("humi.details.collapseAria") : t("humi.details.openAria")}
                title={showDetails ? t("humi.details.collapseTitle") : t("humi.details.title")}
              >
                <SlidersHorizontal size={17} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <textarea aria-label={t("humi.composer.inputAria")} className="humi-composer-input" value={kernelPrompt} onChange={(e) => setKernelPrompt(e.target.value)} onKeyDown={handleComposerKeyDown} placeholder={t("humi.composer.placeholder")} rows={1} style={{ ...warmInputStyle, flex: 1, minHeight: 30, maxHeight: 120, resize: "vertical", border: 0, padding: "5px 0", background: "transparent", boxShadow: "none" }} />
              <button type="button" className="humi-composer-send" onClick={() => void askHumi()} disabled={kernelLoading || !kernelPrompt.trim()} aria-label={t("humi.composer.sendAria")}><ArrowUp size={17} strokeWidth={2.3} aria-hidden="true" /></button>
            </div>
          </div>

          {showDetails && (
            <div className="humi-details-panel">
              <div className="humi-details-status-grid">
                <KernelStatusCard
                  name={t("humi.brain.cardName")}
                  ok={!!brainStatus?.initialized}
                  detail={
                    brainStatus?.providers.find(
                      (provider) => provider.provider === brainStatus.primary_provider,
                    )?.display_name ?? t("humi.brain.notSelected")
                  }
                  note={t("humi.brain.cardNote")}
                />
                <KernelStatusCard
                  name={t("humi.fallback.cardName")}
                  ok={!!appConfig?.brain.fallback_enabled && !!appConfig?.pi.token}
                  detail={
                    appConfig?.brain.fallback_enabled
                      ? appConfig.pi.token
                        ? appConfig.pi.model_name
                        : t("humi.fallback.enabledUnconfigured")
                      : t("humi.fallback.off")
                  }
                  note={t("humi.fallback.cardNote")}
                />
              </div>
              {brainStatus?.initialized && !showBrainPicker && (
                <button
                  type="button"
                  onClick={() => setShowBrainPicker(true)}
                  disabled={kernelLoading}
                  style={{ ...warmButtonStyle(false), marginTop: 8 }}
                >
                  {t("humi.brain.changeAction")}
                </button>
              )}
              <input
                aria-label={t("humi.details.cwdAria")}
                value={kernelCwd}
                onChange={(e) => setKernelCwd(e.target.value)}
                placeholder="Working directory"
                style={detailsInputStyle}
              />
              <textarea
                aria-label={t("humi.details.rootsAria")}
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
            <div className="humi-kernel-message">
              {kernelMessage}
            </div>
          )}
        </div>

        {operationsOpen && (
          <HumiOperationsRail
            sessions={sessions}
            stats={stats}
            config={appConfig}
            loading={operationsLoading}
            ttsPreviewing={ttsPreviewing}
            message={operationsMessage}
            hexaAttention={hexaAttention}
            onRefresh={() => void refreshOperations()}
            onOpenHexa={() => onOpenHexa(hexaAttention.mostUrgentGoal?.id ?? null)}
            onFocusSession={(session) => void focusSession(session)}
            onToggleAutoConfirm={() => void toggleAutoConfirm()}
            onPreviewTts={() => void previewTts()}
          />
        )}
      </div>
    </div>
  );
}

function HumiOperationsRail({
  sessions,
  stats,
  config,
  loading,
  ttsPreviewing,
  message,
  hexaAttention,
  onRefresh,
  onOpenHexa,
  onFocusSession,
  onToggleAutoConfirm,
  onPreviewTts,
}: {
  sessions: ActiveSession[];
  stats: AggregatedStats | null;
  config: AppConfig | null;
  loading: boolean;
  ttsPreviewing: boolean;
  message: string | null;
  hexaAttention: HumiHexaAttention;
  onRefresh: () => void;
  onOpenHexa: () => void;
  onFocusSession: (session: ActiveSession) => void;
  onToggleAutoConfirm: () => void;
  onPreviewTts: () => void;
}) {
  const { t } = useTranslation();
  const [openingDashboard, setOpeningDashboard] = useState(false);
  const openTokenDashboard = useCallback(async () => {
    setOpeningDashboard(true);
    try {
      await invoke("open_token_dashboard");
    } catch (error) {
      console.error("Failed to open token dashboard", error);
    } finally {
      setOpeningDashboard(false);
    }
  }, []);
  const autoConfirm = config?.ui.auto_confirm === true;
  const voiceName = config?.tts.voice
    ?.replace(/^zh-CN-/, "")
    .replace(/Neural$/, "");

  return (
    <aside
      id="humi-operations-panel"
      className="humi-operations"
      aria-label={t("humi.operations.aria")}
    >
      <div className="humi-operations-header">
        <div>
          <strong>{t("humi.operations.title")}</strong>
          <span>{sessions.length > 0 ? t("humi.operations.sessionsOnline", { count: sessions.length }) : t("humi.operations.waitingSessions")}</span>
        </div>
        <button
          type="button"
          className="humi-icon-button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t("humi.operations.refreshAria")}
          title={t("humi.operations.refreshTitle")}
        >
          <RefreshCw
            size={15}
            strokeWidth={1.9}
            className={loading ? "is-spinning" : undefined}
            aria-hidden="true"
          />
        </button>
      </div>

      <button
        type="button"
        className="humi-session-row humi-hexa-summary"
        onClick={onOpenHexa}
        aria-label={t("humi.hexa.summaryAria", { count: hexaAttention.attentionCount, failed: hexaAttention.failedCount })}
      >
        <Wrench size={15} strokeWidth={1.9} aria-hidden="true" />
        <span className="humi-session-copy">
          <strong>{t("humi.hexa.goalsNeedAttention", { count: hexaAttention.attentionCount })}</strong>
          <small>{t("humi.hexa.verificationFailed", { count: hexaAttention.failedCount })}</small>
        </span>
        <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
      </button>

      <section className="humi-operation-section humi-session-monitor">
        <div className="humi-operation-heading">
          <span>{t("humi.session.liveTitle")}</span>
          <span>{sessions.length}</span>
        </div>
        {sessions.length === 0 ? (
          <div className="humi-operation-empty">
            {t("humi.session.empty")}
          </div>
        ) : (
          <div className="humi-session-list">
            {sessions.slice(0, 5).map((session) => {
              const name = session.project_name || session.session_id.slice(0, 8);
              return (
                <button
                  key={session.session_id}
                  type="button"
                  className="humi-session-row"
                  onClick={() => onFocusSession(session)}
                  aria-label={t("humi.session.openAria", { name })}
                >
                  <span
                    className={`humi-session-dot ${session.status === "active" ? "is-active" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="humi-session-copy">
                    <strong>{name}</strong>
                    <small>
                      {session.client_type} · {formatHumiTimeAgo(session.last_event_at)}
                    </small>
                  </span>
                  <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="humi-operation-section">
        <div className="humi-operation-heading">
          <span>{t("humi.autoConfirm.title")}</span>
          <span className={autoConfirm ? "is-on" : undefined}>
            {autoConfirm ? t("humi.autoConfirm.on") : t("humi.autoConfirm.off")}
          </span>
        </div>
        <div className="humi-control-row">
          <div>
            <strong>{t("humi.autoConfirm.permission")}</strong>
            <small>{t("humi.autoConfirm.desc")}</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoConfirm}
            aria-label={t("humi.autoConfirm.switchAria")}
            className={`humi-switch ${autoConfirm ? "is-on" : ""}`}
            onClick={onToggleAutoConfirm}
            disabled={!config}
          >
            <span />
          </button>
        </div>
      </section>

      <section className="humi-operation-section">
        <div className="humi-operation-heading">
          <span>{t("humi.tts.title")}</span>
          <Volume2 size={14} strokeWidth={1.8} aria-hidden="true" />
        </div>
        <div className="humi-control-row">
          <div>
            <strong>{config?.tts.provider ? config.tts.provider.toUpperCase() : t("humi.tts.loading")}</strong>
            <small>
              {voiceName || t("humi.tts.defaultVoice")}
              {config ? ` · ${config.tts.speed.toFixed(1)}x` : ""}
            </small>
          </div>
          <button
            type="button"
            className="humi-preview-button"
            aria-label={t("humi.tts.previewAria")}
            title={t("humi.tts.previewTitle")}
            onClick={onPreviewTts}
            disabled={!config || ttsPreviewing}
          >
            <Play size={13} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section
        className="humi-operation-section humi-token-summary is-clickable"
        role="button"
        tabIndex={0}
        aria-label={t("humi.token.openAria")}
        aria-busy={openingDashboard}
        onClick={() => void openTokenDashboard()}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void openTokenDashboard();
          }
        }}
      >
        <div className="humi-operation-heading">
          <span>{t("humi.token.title")}</span>
          <span>{t("humi.token.agentCount", { count: stats?.active_agents ?? 0 })}</span>
        </div>
        <div className="humi-token-value">
          <strong>{formatHumiCount(stats?.total_tokens ?? 0)}</strong>
          <span>Token</span>
        </div>
        <div className="humi-token-meta">
          <span>{t("humi.token.sessionCount", { count: stats?.total_sessions ?? 0 })}</span>
          <span>{t("humi.token.toolCallCount", { count: formatHumiCount(stats?.total_tool_calls ?? 0) })}</span>
        </div>
        <span className="humi-token-cta">
          {openingDashboard ? t("humi.token.opening") : t("humi.token.openCta")}
        </span>
      </section>

      {message && <div className="humi-operation-message">{message}</div>}
    </aside>
  );
}

function formatHumiCount(value: number): string {
  if (value >= 1_000_000_000) return `${trimHumiDecimal(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trimHumiDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimHumiDecimal(value / 1_000)}K`;
  return String(value);
}

function trimHumiDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatHumiTimeAgo(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return translate("humi.time.justNow");
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return translate("humi.time.justNow");
  if (seconds < 3600) return translate("humi.time.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86_400) return translate("humi.time.hoursAgo", { count: Math.floor(seconds / 3600) });
  return translate("humi.time.daysAgo", { count: Math.floor(seconds / 86_400) });
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
    return translate("humi.direction.engineering");
  }
  if (result.type_counts.skill || result.type_counts.agent) {
    return translate("humi.direction.agentBase");
  }
  return translate("humi.direction.forming");
}

function describePreferenceMemory(result: LocalAgentKernelResult): string {
  if (result.context_packet.user_preference_candidates[0]) {
    return result.context_packet.user_preference_candidates[0];
  }
  if (result.top_tools.length > 0) {
    return translate("humi.preference.lessRaw");
  }
  if ((result.type_counts.memory ?? 0) > 0) {
    return translate("humi.preference.memoryReusable");
  }
  return translate("humi.preference.default");
}

function describeNextStep(result: LocalAgentKernelResult): string {
  if (result.context_packet.memory_candidates[0]) {
    return result.context_packet.memory_candidates[0];
  }
  const action = result.suggested_actions[0];
  if (action?.toLowerCase().includes("soul")) {
    return translate("humi.nextStep.soul");
  }
  if (action?.toLowerCase().includes("memory")) {
    return translate("humi.nextStep.memory");
  }
  return translate("humi.nextStep.default");
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
