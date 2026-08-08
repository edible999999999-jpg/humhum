import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Flame } from "lucide-react";
import {
  useHexaData,
  type HexaSupervisorSession,
  type HexaWatchedSession,
} from "../../hooks/useHexaData";
import {
  interventionMatches,
  interventionProviderForClient,
} from "../../hooks/interventionProvider";
import { HexaActiveMonitor } from "./hexa/HexaActiveMonitor";
import {
  AgentSessionGroup,
  EmptyState,
  HexaMetricSummary,
  SessionSection,
} from "./hexa/HexaShared";
import { AgentIntervention } from "./hexa/HexaIntervention";
import { SessionCard } from "./hexa/HexaSessionCard";
import { t } from "@/lib/i18n";
import {
  HermesObserverCard,
  HexaMobileAccessPanel,
  HexaMobilePairingCard,
  HexaRemoteAccessPanel,
  HexaWatchCommandPanel,
  type HermesObserverStatus,
} from "./hexa/HexaAccessPanels";

export { HexaMetricSummary } from "./hexa/HexaShared";
export { HexaInterventionDeliveryStatus } from "./hexa/HexaIntervention";
export {
  HexaMobileAccessPanel,
  HexaMobilePairingCard,
  HexaRemoteAccessPanel,
  HexaWatchCommandPanel,
  startOrRefreshMobilePairing,
} from "./hexa/HexaAccessPanels";

export function HexaModule({
  focusGoalId = null,
}: {
  focusGoalId?: string | null;
} = {}) {
  const {
    activeSupervisorSessions,
    completedSupervisorSessions,
    watchedAgents,
    supervisorSessions,
    alerts,
    watchDataState,
    retryHexaData,
    developmentGoals,
    goalDataState,
    retryGoalData,
    bridgeHealth,
    remoteControl,
    remotePairing,
    mobileBridge,
    mobilePairing,
    mobileRelayConfig,
    queuedInterventions,
    sendCodexMessage,
    retryCodexMessage,
    sendClaudeMessage,
    retryClaudeMessage,
    sendOpenCodeMessage,
    retryOpenCodeMessage,
    discardQueuedIntervention,
    interruptCodexTurn,
    resumeCodexThread,
    resolveCodexApproval,
    focusAgentSession,
    getSessionChangeSummary,
    enableCodexRemoteControl,
    disableCodexRemoteControl,
    startCodexRemotePairing,
    enableMobileBridge,
    disableMobileBridge,
    startMobilePairing,
    revokeMobileDevices,
    revokeMobileDevice,
    configureMobileRelay,
    deleteWatchedSession,
    acceptGoalAttempt,
    deleteDevelopmentGoal,
    mutateHexaSessionAudit,
  } = useHexaData();
  const [openReviews, setOpenReviews] = useState<Set<string>>(new Set());
  const [autoConfirmSessions, setAutoConfirmSessions] = useState<Set<string>>(new Set());
  const [collapsedAgentGroups, setCollapsedAgentGroups] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<"watched" | "scanned">("watched");
  const [hermesObserver, setHermesObserver] = useState<HermesObserverStatus | null>(null);
  const [hermesConnecting, setHermesConnecting] = useState(false);
  const [hermesError, setHermesError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<string[]>("get_auto_confirm_sessions")
      .then((sessions) => setAutoConfirmSessions(new Set(sessions)))
      .catch(() => setAutoConfirmSessions(new Set()));
    void invoke<HermesObserverStatus>("get_hermes_observer_status")
      .then(setHermesObserver)
      .catch(() => setHermesObserver(null));
  }, []);

  const connectHermesObserver = async () => {
    setHermesConnecting(true);
    setHermesError(null);
    try {
      await invoke("install_hooks_for_client", { clientId: "hermes" });
      setHermesObserver(await invoke<HermesObserverStatus>("get_hermes_observer_status"));
    } catch (cause) {
      setHermesError(String(cause));
    } finally {
      setHermesConnecting(false);
    }
  };

  const toggleAutoConfirm = async (sessionId: string, enabled: boolean) => {
    const sessions = await invoke<string[]>("set_session_auto_confirm", { sessionId, enabled });
    setAutoConfirmSessions(new Set(sessions));
  };

  const recentActivity = activeSupervisorSessions;
  const active = recentActivity.filter((item) => item.progress_status !== "idle");
  const recentCompleted = completedSupervisorSessions.slice(0, 6);
  const watchedSupervisorSessions = supervisorSessions.filter((item) => item.source === "watched" && item.watched);
  const watchedSessions = watchedAgents.flatMap((agent) => agent.runs);
  const watchedSupervisorBySessionId = new Map(
    watchedSupervisorSessions.map((item) => [item.session.session_id, item]),
  );
  const discoveredSessions = recentActivity.filter((item) => item.source !== "watched");
  const historicalSessions = recentCompleted.filter((item) => item.source !== "watched");
  const secondarySessions = [...discoveredSessions, ...historicalSessions];
  const pendingCount = active.reduce((sum, item) => sum + item.pending_confirmations, 0);
  const workingCount = active.filter((item) => item.progress_status === "working").length;
  const attentionCount = active.filter((item) =>
    ["waiting", "looping", "stalled"].includes(item.progress_status),
  ).length;
  const toggleReview = (sessionId: string) => {
    setOpenReviews((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };
  const renderSessionGrid = (items: HexaSupervisorSession[]) => (
    <div className="hexa-session-details" style={{ display: "grid", gap: 10 }}>
      {items.map((item) => {
        const provider = interventionProviderForClient(item.session.client_type);
        const threadId = provider === "codex"
          ? item.bridge?.provider_thread_id ?? item.session.session_id
          : item.session.session_id;
        const sendMessage = provider === "claude"
          ? sendClaudeMessage
          : provider === "opencode"
            ? sendOpenCodeMessage
            : sendCodexMessage;
        const retryMessage = provider === "claude"
          ? retryClaudeMessage
          : provider === "opencode"
            ? retryOpenCodeMessage
            : retryCodexMessage;
        return (
          <SessionCard
            key={item.session.session_id}
            item={item}
            reviewOpen={openReviews.has(item.session.session_id)}
            onToggleReview={() => toggleReview(item.session.session_id)}
            onSend={sendMessage}
            onInterrupt={interruptCodexTurn}
            onResume={resumeCodexThread}
            onResolveApproval={resolveCodexApproval}
            onFocus={focusAgentSession}
            onLoadChanges={getSessionChangeSummary}
            onDeleteWatched={deleteWatchedSession}
            queuedInterventions={provider
              ? queuedInterventions.filter((queued) => interventionMatches(queued, provider, threadId))
              : []}
            onRetryIntervention={retryMessage}
            onDiscardIntervention={discardQueuedIntervention}
            autoConfirmEnabled={autoConfirmSessions.has(item.session.session_id)}
            onToggleAutoConfirm={toggleAutoConfirm}
          />
        );
      })}
    </div>
  );
  const discoveredGroups = Array.from(
    discoveredSessions.reduce((groups, item) => {
      const key = item.agent_label;
      groups.set(key, [...(groups.get(key) ?? []), item]);
      return groups;
    }, new Map<string, HexaSupervisorSession[]>()),
  );
  const toggleAgentGroup = (agent: string) => {
    setCollapsedAgentGroups((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };
  const renderWatchedOperations = (session: HexaWatchedSession) => {
    const item = watchedSupervisorBySessionId.get(session.session_id);
    if (!item) return null;
    const provider = interventionProviderForClient(item.session.client_type);
    const threadId = provider === "codex"
      ? item.bridge?.provider_thread_id ?? item.session.session_id
      : item.session.session_id;
    const sendMessage = provider === "claude"
      ? sendClaudeMessage
      : provider === "opencode"
        ? sendOpenCodeMessage
        : sendCodexMessage;
    const retryMessage = provider === "claude"
      ? retryClaudeMessage
      : provider === "opencode"
        ? retryOpenCodeMessage
        : retryCodexMessage;

    return (
      <section
        className="hexa-report-section hexa-report-operations"
        aria-label={t("hexa.sessionActions")}
      >
        <div className="hexa-report-section-title">
          <span><Activity size={15} /> {t("hexa.intervene")}</span>
          {item.session.client_type === "claude-code" && (
            <button
              type="button"
              className={`kawaii-toggle-btn ${autoConfirmSessions.has(session.session_id) ? "connected" : ""}`}
              title={autoConfirmSessions.has(session.session_id) ? t("hexa.autoApproveOff") : t("hexa.autoApproveOn")}
              onClick={() => void toggleAutoConfirm(session.session_id, !autoConfirmSessions.has(session.session_id))}
            >
              <Flame size={14} /> {autoConfirmSessions.has(session.session_id) ? t("hexa.autoModeOn") : t("hexa.autoMode")}
            </button>
          )}
        </div>
        {provider && (
          <AgentIntervention
            item={item}
            provider={provider}
            onSend={sendMessage}
            onInterrupt={interruptCodexTurn}
            onResume={resumeCodexThread}
            onResolveApproval={resolveCodexApproval}
            queuedInterventions={queuedInterventions.filter((queued) => interventionMatches(queued, provider, threadId))}
            onRetryIntervention={retryMessage}
            onDiscardIntervention={discardQueuedIntervention}
          />
        )}
      </section>
    );
  };

  return (
    <div className="hub-module hexa-room-module">
      <header className="hexa-heading-row hexa-room-header">
        <div className="hexa-room-identity">
          <img
            src="/mascots/avatars/hexa-avatar.png"
            alt=""
            aria-hidden="true"
          />
          <div className="hexa-heading-copy">
            <div className="hexa-title-line">
              <h2 className="hub-module-title">{t("hexa.supervisorTitle")}</h2>
              <div className="hexa-bridge-health" role="status">
                <span
                  className={`hexa-bridge-health-dot is-${bridgeHealth.status}`}
                  aria-hidden="true"
                />
                <span>{bridgeHealth.message}</span>
              </div>
            </div>
            <p className="hub-module-desc">
              {t("hexa.supervisorSubtitle")}
            </p>
          </div>
        </div>
        <div className="hexa-header-actions">
          <div className="hexa-top-tabs" role="tablist" aria-label={t("hexa.tabRegions")}>
            <button type="button" role="tab" aria-selected={activeSection === "watched"} className={`hexa-top-tab ${activeSection === "watched" ? "active" : ""}`} onClick={() => setActiveSection("watched")}>
              <strong>{t("hexa.tabWatched", { count: watchedSessions.length })}</strong>
              <span>{t("hexa.tabWatchedHint")}</span>
            </button>
            <button type="button" role="tab" aria-selected={activeSection === "scanned"} className={`hexa-top-tab ${activeSection === "scanned" ? "active" : ""}`} onClick={() => setActiveSection("scanned")}>
              <strong>{t("hexa.tabScanned", { count: secondarySessions.length })}</strong>
              <span>{t("hexa.tabScannedHint")}</span>
            </button>
          </div>
          <HexaMobilePairingCard
            state={mobileBridge}
            pairing={mobilePairing}
            onEnable={enableMobileBridge}
            onPair={startMobilePairing}
          />
        </div>
      </header>

      {activeSection === "watched" ? (
        <HexaActiveMonitor
          sessions={watchedSessions}
          developmentGoals={developmentGoals}
          supervisorBySessionId={watchedSupervisorBySessionId}
          dataState={watchDataState}
          goalDataState={goalDataState}
          onRetry={retryHexaData}
          onRetryGoals={retryGoalData}
          onFocus={focusAgentSession}
          onDelete={deleteWatchedSession}
          onMutate={mutateHexaSessionAudit}
          onAcceptGoalAttempt={acceptGoalAttempt}
          onDeleteGoal={deleteDevelopmentGoal}
          renderOperations={renderWatchedOperations}
          focusGoalId={focusGoalId}
          entryPanel={(
            <div className="hexa-binding-stack">
              <HermesObserverCard
                status={hermesObserver}
                busy={hermesConnecting}
                error={hermesError}
                onConnect={connectHermesObserver}
              />
              <HexaWatchCommandPanel />
              <HexaRemoteAccessPanel
                state={remoteControl}
                pairing={remotePairing}
                onEnable={enableCodexRemoteControl}
                onDisable={disableCodexRemoteControl}
                onPair={startCodexRemotePairing}
              />
              <HexaMobileAccessPanel
                state={mobileBridge}
                pairing={mobilePairing}
                relayConfig={mobileRelayConfig}
                onEnable={enableMobileBridge}
                onDisable={disableMobileBridge}
                onPair={startMobilePairing}
                onRevoke={revokeMobileDevices}
                onRevokeDevice={revokeMobileDevice}
                onConfigureRelay={configureMobileRelay}
              />
            </div>
          )}
        />
      ) : (
        <section className="hexa-scanned-section">
          <HexaMetricSummary
            items={[
              { label: t("hexa.metricActive"), value: active.length, tone: "progress", detail: t("hexa.metricActiveDetail", { count: workingCount }) },
              { label: t("hexa.metricAttention"), value: attentionCount, tone: "attention", detail: t("hexa.metricAttentionDetail", { count: pendingCount }) },
              { label: t("hexa.metricRecent"), value: recentCompleted.length, tone: "complete", detail: t("hexa.metricRecentDetail") },
              { label: t("hexa.metricAlerts"), value: alerts.length, tone: "alert", detail: t("hexa.metricAlertsDetail") },
            ]}
          />
        <div className="hexa-scanned-heading">
          <strong>{t("hexa.scanSessions", { count: secondarySessions.length })}</strong>
          <span>
            {t("hexa.scanNote")}
          </span>
        </div>

        {secondarySessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {discoveredSessions.length > 0 && (
              <SessionSection title={t("hexa.discovered")} count={discoveredSessions.length} detail={t("hexa.discoveredDetail")}>
                <div style={{ display: "grid", gap: 8 }}>
                  {discoveredGroups.map(([agent, items]) => (
                    <AgentSessionGroup
                      key={agent}
                      agent={agent}
                      count={items.length}
                      collapsed={collapsedAgentGroups.has(agent)}
                      onToggle={() => toggleAgentGroup(agent)}
                    >
                      {renderSessionGrid(items)}
                    </AgentSessionGroup>
                  ))}
                </div>
              </SessionSection>
            )}
            {historicalSessions.length > 0 && (
              <SessionSection title={t("hexa.historical")} count={historicalSessions.length} detail={t("hexa.historicalDetail")}>
                {renderSessionGrid(historicalSessions)}
              </SessionSection>
            )}
          </div>
        )}
        </section>
      )}
    </div>
  );
}
