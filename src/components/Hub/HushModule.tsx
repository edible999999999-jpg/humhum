import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "../../lib/i18n/react";

const PLATFORM_ICONS: Record<string, string> = {
  wechat: "💬",
  dingtalk: "🔷",
  feishu: "🪶",
  telegram: "✈️",
  x: "𝕏",
  facetime: "📱",
};

const TIER_ORDER: string[] = ["family", "friends", "work"];

interface HushConnectorStatus {
  id: string;
  name: string;
  installed: boolean;
  bridge_ready: boolean;
  app_path?: string | null;
  status: string;
  next_step: string;
  bridge_mode: string;
}

interface HushInboxMessage {
  id: string;
  platform: string;
  sender: string;
  chat?: string | null;
  text: string;
  tier: string;
  importance: number;
  suggested_reply?: string | null;
  received_at: string;
  source_id?: string | null;
  preview_limited?: boolean;
  raw?: Record<string, unknown>;
}

interface NotificationBridgeStatus {
  state: "starting" | "running" | "permission_required" | "source_missing" | "error";
  message: string;
  last_scan_at: string | null;
  supported_apps: string[];
}

interface HushInboxSummary {
  total: number;
  unread_priority: number;
  by_tier: Record<string, number>;
  by_platform: Record<string, number>;
  messages: HushInboxMessage[];
}

export interface HushHealthSignal {
  device_id: string;
  source_id: string;
  kind: "health.steps.daily" | "health.resting_heart_rate.daily" | "health.sleep.daily" | string;
  started_at: string;
  ended_at: string;
  value: number;
  unit: "count" | "bpm" | "minutes" | string;
  source: "health_connect" | "phone_step_counter" | string;
  captured_at: string;
  quality: "trusted" | "device_estimate" | string;
}

type HushHealthMetric = Pick<HushHealthSignal, "value" | "unit" | "captured_at" | "ended_at" | "quality">;

export interface HushHealthSourceSummary {
  state: "empty" | "partial" | "stale" | "ready";
  deviceCount: number;
  localDate: string | null;
  lastSync: string | null;
  metrics: {
    steps: HushHealthMetric | null;
    restingHeartRate: HushHealthMetric | null;
    sleep: HushHealthMetric | null;
  };
}

const HEALTH_METRIC_KEYS = {
  "health.steps.daily": "steps",
  "health.resting_heart_rate.daily": "restingHeartRate",
  "health.sleep.daily": "sleep",
} as const;

export type HushHealthAvailability = "loading" | "ready" | "unavailable";

interface HushHealthDayGroup {
  deviceId: string;
  localDate: string;
  latestEndedAt: number;
  lastSyncAt: number;
  metrics: HushHealthSourceSummary["metrics"];
}

function parseHealthDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function newerHealthMetric(current: HushHealthMetric | null, candidate: HushHealthSignal): HushHealthMetric {
  if (!current) return candidate;
  const currentTime = parseHealthDate(current.ended_at) ?? Number.NEGATIVE_INFINITY;
  const candidateTime = parseHealthDate(candidate.ended_at) ?? Number.NEGATIVE_INFINITY;
  if (candidateTime > currentTime) return candidate;
  if (candidateTime < currentTime) return current;
  return (parseHealthDate(candidate.captured_at) ?? Number.NEGATIVE_INFINITY) >
    (parseHealthDate(current.captured_at) ?? Number.NEGATIVE_INFINITY)
    ? candidate
    : current;
}

function canonicalHealthDay(startedAt: string): string | null {
  const day = startedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && parseHealthDate(startedAt) !== null ? day : null;
}

export function deriveHushHealthSource(
  signals: HushHealthSignal[],
  now: Date = new Date(),
): HushHealthSourceSummary {
  const groups = new Map<string, HushHealthDayGroup>();
  const deviceIds = new Set<string>();

  for (const signal of signals) {
    const metricKey = HEALTH_METRIC_KEYS[signal.kind as keyof typeof HEALTH_METRIC_KEYS];
    const localDate = canonicalHealthDay(signal.started_at);
    const endedAt = parseHealthDate(signal.ended_at);
    const capturedAt = parseHealthDate(signal.captured_at);
    if (!metricKey || !localDate || endedAt === null || capturedAt === null || !Number.isFinite(signal.value)) continue;
    deviceIds.add(signal.device_id);
    const groupKey = `${signal.device_id}\u0000${localDate}`;
    const group = groups.get(groupKey) ?? {
      deviceId: signal.device_id,
      localDate,
      latestEndedAt: endedAt,
      lastSyncAt: capturedAt,
      metrics: { steps: null, restingHeartRate: null, sleep: null },
    };
    group.latestEndedAt = Math.max(group.latestEndedAt, endedAt);
    group.lastSyncAt = Math.max(group.lastSyncAt, capturedAt);
    group.metrics[metricKey] = newerHealthMetric(group.metrics[metricKey], signal);
    groups.set(groupKey, group);
  }

  const selected = Array.from(groups.values()).sort((a, b) =>
    b.latestEndedAt - a.latestEndedAt ||
    b.lastSyncAt - a.lastSyncAt ||
    a.deviceId.localeCompare(b.deviceId) ||
    a.localDate.localeCompare(b.localDate),
  )[0];

  const metrics = selected?.metrics ?? { steps: null, restingHeartRate: null, sleep: null };
  const isStale = selected !== undefined && now.getTime() - selected.latestEndedAt > 48 * 60 * 60 * 1000;
  const isPartial = Object.values(metrics).some((metric) => metric === null);
  const state: HushHealthSourceSummary["state"] = !selected
    ? "empty"
    : isStale
      ? "stale"
      : isPartial
        ? "partial"
        : "ready";

  return {
    state,
    deviceCount: deviceIds.size,
    localDate: selected?.localDate ?? null,
    lastSync: selected ? new Date(selected.lastSyncAt).toISOString() : null,
    metrics,
  };
}

interface DerivedContact {
  id: string;
  name: string;
  tier: string;
  platforms: string[];
  lastMessage: string;
  lastMessageTime: string;
  importance: number;
  messages: HushInboxMessage[];
}

export function compareHushContacts(
  a: Pick<DerivedContact, "importance" | "lastMessageTime">,
  b: Pick<DerivedContact, "importance" | "lastMessageTime">,
): number {
  const aTime = Date.parse(a.lastMessageTime);
  const bTime = Date.parse(b.lastMessageTime);
  const timeDifference =
    (Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY) -
    (Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY);
  return timeDifference || b.importance - a.importance;
}

export function getHushConversationIdentity(
  message: Pick<HushInboxMessage, "platform" | "sender" | "chat" | "source_id" | "raw">,
): { id: string; name: string } {
  const isDwsMessage =
    message.source_id?.startsWith("dws:") || message.raw?.source === "dws";
  if (isDwsMessage) {
    const conversationId =
      typeof message.raw?.conversation_id === "string"
        ? message.raw.conversation_id.trim()
        : "";
    const chatName = message.chat?.trim() ?? "";
    const conversationKey = conversationId || chatName;
    if (conversationKey) {
      return {
        id: `${message.platform}:conversation:${conversationKey}`,
        name: chatName || message.sender,
      };
    }
  }

  return {
    id: `${message.platform}:${message.sender}`,
    name: message.sender,
  };
}

interface DwsHushStatus {
  state: "not_installed" | "authentication_required" | "ready" | "syncing" | "error";
  message: string;
  executable_source: "standalone" | "wukong" | null;
  executable_path: string | null;
  authenticated: boolean;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  last_success_at: string | null;
  last_attempt_at: string | null;
  syncing: boolean;
  pending_sync: boolean;
}

interface DwsSyncReport {
  conversations: number;
  examined_messages: number;
  imported_messages: number;
  duplicate_messages: number;
  pages: number;
  partial: boolean;
  next_cursor: string | null;
}

export function HushModule() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<HushConnectorStatus[]>([]);
  const [inbox, setInbox] = useState<HushInboxSummary | null>(null);
  const [healthSignals, setHealthSignals] = useState<HushHealthSignal[]>([]);
  const [healthAvailability, setHealthAvailability] = useState<HushHealthAvailability>("loading");
  const [notificationBridge, setNotificationBridge] = useState<NotificationBridgeStatus | null>(null);
  const [dwsStatus, setDwsStatus] = useState<DwsHushStatus | null>(null);
  const [dwsReport, setDwsReport] = useState<DwsSyncReport | null>(null);
  const [dingTalkSyncing, setDingTalkSyncing] = useState(false);
  const [dingTalkLoggingIn, setDingTalkLoggingIn] = useState(false);
  const [dingTalkAutoUpdating, setDingTalkAutoUpdating] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [healthClearFailed, setHealthClearFailed] = useState(false);
  const [openingConnector, setOpeningConnector] = useState<string | null>(null);
  const [confirmingHealthClear, setConfirmingHealthClear] = useState(false);
  const [clearingHealth, setClearingHealth] = useState(false);
  const [pendingHealthClearCount, setPendingHealthClearCount] = useState(0);
  const [lastHealthClearCount, setLastHealthClearCount] = useState<number | null>(null);

  const fetchConnectors = useCallback(async () => {
    try {
      const data = await invoke<HushConnectorStatus[]>("get_hush_connectors");
      setConnectors(data);
      setConnectorError(null);
    } catch (error) {
      setConnectorError(String(error));
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const fetchInbox = useCallback(async () => {
    try {
      const data = await invoke<HushInboxSummary>("get_hush_inbox");
      setInbox(data);
    } catch (error) {
      setConnectorError(String(error));
    }
  }, []);

  useEffect(() => {
    fetchInbox();
    const interval = setInterval(fetchInbox, 4000);
    return () => clearInterval(interval);
  }, [fetchInbox]);

  const fetchHealthSignals = useCallback(async () => {
    try {
      const data = await invoke<HushHealthSignal[]>("get_hush_health_signals");
      setHealthSignals(data);
      setHealthAvailability("ready");
      setLastHealthClearCount(null);
    } catch (error) {
      setHealthSignals([]);
      setHealthAvailability("unavailable");
      setConfirmingHealthClear(false);
      setLastHealthClearCount(null);
    }
  }, []);

  useEffect(() => {
    fetchHealthSignals();
    const interval = setInterval(fetchHealthSignals, 30_000);
    return () => clearInterval(interval);
  }, [fetchHealthSignals]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen("humhum://hush-message", () => fetchInbox()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [fetchInbox]);

  const fetchNotificationBridge = useCallback(async () => {
    try {
      const status = await invoke<NotificationBridgeStatus>("get_hush_notification_bridge_status");
      setNotificationBridge(status);
    } catch (error) {
      setNotificationBridge({
        state: "error",
        message: String(error),
        last_scan_at: null,
        supported_apps: ["WeChat", "钉钉"],
      });
    }
  }, []);

  useEffect(() => {
    fetchNotificationBridge();
    const interval = setInterval(fetchNotificationBridge, 5000);
    return () => clearInterval(interval);
  }, [fetchNotificationBridge]);

  const fetchDwsStatus = useCallback(async () => {
    try {
      const status = await invoke<DwsHushStatus>("get_hush_dws_status");
      setDwsStatus(status);
    } catch (error) {
      setDwsStatus((current) => ({
        state: "error",
        message: String(error),
        executable_source: current?.executable_source ?? null,
        executable_path: current?.executable_path ?? null,
        authenticated: current?.authenticated ?? false,
        auto_sync_enabled: current?.auto_sync_enabled ?? false,
        sync_interval_minutes: current?.sync_interval_minutes ?? 5,
        last_success_at: current?.last_success_at ?? null,
        last_attempt_at: current?.last_attempt_at ?? null,
        syncing: false,
        pending_sync: current?.pending_sync ?? false,
      }));
    }
  }, []);

  useEffect(() => {
    fetchDwsStatus();
    const interval = setInterval(fetchDwsStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchDwsStatus]);

  const openFullDiskAccess = useCallback(async () => {
    try {
      await invoke("open_full_disk_access_settings");
    } catch (error) {
      setConnectorError(String(error));
    }
  }, []);

  const openConnector = useCallback(async (connectorId: string) => {
    setOpeningConnector(connectorId);
    setConnectorError(null);
    try {
      await invoke("open_hush_connector", { connectorId });
      await fetchConnectors();
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setOpeningConnector(null);
    }
  }, [fetchConnectors]);

  const clearInbox = useCallback(async () => {
    await invoke("clear_hush_inbox");
    await fetchInbox();
  }, [fetchInbox]);

  const clearHealthSignals = useCallback(async () => {
    setClearingHealth(true);
    setHealthClearFailed(false);
    try {
      const clearedCount = await invoke<number>("clear_hush_health_signals");
      setHealthSignals([]);
      setHealthAvailability("ready");
      setLastHealthClearCount(clearedCount);
      setConfirmingHealthClear(false);
    } catch (error) {
      setHealthClearFailed(true);
    } finally {
      setClearingHealth(false);
    }
  }, []);

  const syncDingTalk = useCallback(async () => {
    setDingTalkSyncing(true);
    setConnectorError(null);
    try {
      const report = await invoke<DwsSyncReport>("sync_hush_dws");
      setDwsReport(report);
      await Promise.all([fetchDwsStatus(), fetchInbox()]);
    } catch (error) {
      setConnectorError(String(error));
      await fetchDwsStatus();
    } finally {
      setDingTalkSyncing(false);
    }
  }, [fetchDwsStatus, fetchInbox]);

  const loginDingTalk = useCallback(async () => {
    setDingTalkLoggingIn(true);
    setConnectorError(null);
    try {
      await invoke("open_hush_dws_login");
      await fetchDwsStatus();
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setDingTalkLoggingIn(false);
    }
  }, [fetchDwsStatus]);

  const setDingTalkAutoSync = useCallback(async (enabled: boolean) => {
    setDingTalkAutoUpdating(true);
    setConnectorError(null);
    try {
      const status = await invoke<DwsHushStatus>("set_hush_dws_auto_sync", { enabled });
      setDwsStatus(status);
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setDingTalkAutoUpdating(false);
    }
  }, []);

  const contacts = useMemo<DerivedContact[]>(() => {
    const messages = inbox?.messages ?? [];
    const map = new Map<string, DerivedContact>();
    for (const message of messages) {
      const identity = getHushConversationIdentity(message);
      const existing = map.get(identity.id);
      if (existing) {
        existing.messages.push(message);
        if (message.received_at > existing.lastMessageTime) {
          existing.lastMessage = message.text;
          existing.lastMessageTime = message.received_at;
        }
        existing.importance = Math.max(existing.importance, message.importance);
        if (!existing.platforms.includes(message.platform)) {
          existing.platforms.push(message.platform);
        }
      } else {
        map.set(identity.id, {
          id: identity.id,
          name: identity.name,
          tier: TIER_ORDER.includes(message.tier) ? message.tier : "work",
          platforms: [message.platform],
          lastMessage: message.text,
          lastMessageTime: message.received_at,
          importance: message.importance,
          messages: [message],
        });
      }
    }
    return Array.from(map.values()).sort(compareHushContacts);
  }, [inbox]);

  const selectedContact = selectedId
    ? contacts.find((c) => c.id === selectedId) ?? null
    : null;
  const healthSource = useMemo(() => deriveHushHealthSource(healthSignals), [healthSignals]);

  return (
    <div className="hub-module">
      <div className="hub-module-heading">
        <span className="hub-module-kicker">{t("hub.role.hush")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <h2 className="hub-module-title" style={{ margin: 0 }}>{t("hub.hush.title")}</h2>
          <span
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 9999,
              background: "rgba(148,239,244,0.08)",
              border: "1px solid rgba(148,239,244,0.18)",
              color: "#94eff4",
              fontWeight: 700,
            }}
          >
            Local-first bridge
          </span>
        </div>
        <p className="hub-module-desc">
          {t("hub.hush.desc")}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        {connectors.map((connector) => (
          <HushConnectorCard
            key={connector.id}
            connector={connector}
            notificationActive={notificationBridge?.state === "running"}
            dwsActive={connector.id === "dingtalk" && Boolean(dwsStatus?.authenticated)}
            busy={openingConnector === connector.id}
            onOpen={() => openConnector(connector.id)}
          />
        ))}
      </div>
      {connectorError && (
        <div style={{ marginBottom: 12, fontSize: 11, color: "#fb7185", lineHeight: 1.5 }}>
          {connectorError}
        </div>
      )}
      <NotificationBridgePanel status={notificationBridge} onOpenSettings={openFullDiskAccess} />
      <HushTruthPanel inbox={inbox} bridge={notificationBridge} dwsStatus={dwsStatus} />

      <HushHealthSourcePanel
        summary={healthSource}
        availability={healthAvailability}
        confirmingClear={confirmingHealthClear}
        clearCount={pendingHealthClearCount}
        lastClearCount={lastHealthClearCount}
        clearing={clearingHealth}
        clearFailed={healthClearFailed}
        onRequestClear={() => {
          setPendingHealthClearCount(healthSignals.length);
          setHealthClearFailed(false);
          setConfirmingHealthClear(true);
        }}
        onCancelClear={() => {
          setConfirmingHealthClear(false);
          setHealthClearFailed(false);
        }}
        onConfirmClear={clearHealthSignals}
      />

      <DingTalkDwsPanel
        status={dwsStatus}
        report={dwsReport}
        syncing={dingTalkSyncing}
        loggingIn={dingTalkLoggingIn}
        autoUpdating={dingTalkAutoUpdating}
        onSync={syncDingTalk}
        onLogin={loginDingTalk}
        onAutoSyncChange={setDingTalkAutoSync}
      />

      <LiveInboxPanel inbox={inbox} onRefresh={fetchInbox} onClear={clearInbox} />

      {contacts.length === 0 ? (
        <div
          style={{
            padding: 36,
            textAlign: "center",
            borderRadius: 16,
            background: "rgba(255,255,255,0.62)",
            border: "1px dashed rgba(116,143,165,0.18)",
          }}
        >
          <div className="hub-empty-title">{t("hub.hush.emptyTitle")}</div>
          <div className="hub-empty-desc" style={{ maxWidth: 380, margin: "6px auto 0" }}>
            {t("hub.hush.emptyDesc")}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, minHeight: 400 }}>
          {/* Contact list (real, aggregated from inbox) */}
          <div
            style={{
              borderRadius: 14,
              background: "rgba(255,255,255,0.55)",
              border: "1px solid rgba(116,143,165,0.14)",
              overflowY: "auto",
              maxHeight: 500,
            }}
            className="scrollbar-thin"
          >
            {contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                selected={selectedId === contact.id}
                onClick={() => setSelectedId(contact.id)}
              />
            ))}
          </div>

          {/* Detail panel */}
          <div
            style={{
              borderRadius: 14,
              background: "rgba(255,255,255,0.55)",
              border: "1px solid rgba(116,143,165,0.14)",
              padding: 16,
              overflowY: "auto",
              maxHeight: 500,
            }}
            className="scrollbar-thin"
          >
            {selectedContact ? (
              <div className="animate-bounce-in">
                {/* Contact header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#263241" }}>
                      {selectedContact.name}
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
                      {selectedContact.platforms.map((p) => (
                        <span key={p} style={{ fontSize: 12 }} title={p}>
                          {PLATFORM_ICONS[p] || p}
                        </span>
                      ))}
                      <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 4 }}>
                        {selectedContact.tier} · P{selectedContact.importance}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase" }}>
                    {t("hub.hush.messages")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selectedContact.messages.map((msg) => (
                      <div
                        key={msg.id}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.7)",
                          border: "1px solid rgba(116,143,165,0.12)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>
                            {msg.sender}
                          </span>
                          <span style={{ fontSize: 9, color: "#94a3b8" }}>
                            {PLATFORM_ICONS[msg.platform] || msg.platform}
                            {msg.chat ? ` · ${msg.chat}` : ""}
                          </span>
                          {msg.source_id?.startsWith("dws:") && (
                            <span style={{ fontSize: 8, fontWeight: 800, color: "#0f6d78", border: "1px solid rgba(15,109,120,0.2)", borderRadius: 4, padding: "1px 4px" }}>
                              DWS
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>
                          {msg.text}
                        </div>
                        {msg.preview_limited && (
                          <div style={{ marginTop: 5, fontSize: 10, color: "#b7791f", lineHeight: 1.4 }}>
                            {t("hub.hush.bridge.limitedPreview")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Suggested replies (from backend, latest message) */}
                {(() => {
                  const withReply = [...selectedContact.messages]
                    .reverse()
                    .find((m) => m.suggested_reply && !m.preview_limited);
                  if (!withReply?.suggested_reply) return null;
                  return (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase" }}>
                        {t("hub.hush.suggestedReplies")}
                      </div>
                      <button
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 10,
                          background: "rgba(148,239,244,0.12)",
                          border: "1px solid rgba(116,143,165,0.16)",
                          color: "#0f6d78",
                          fontSize: 12,
                          textAlign: "left",
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        {withReply.suggested_reply}
                      </button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: "center" }}>
                <div className="hub-empty-title">{t("hub.hush.selectContactTitle")}</div>
                <div className="hub-empty-desc">{t("hub.hush.selectContactDesc")}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationBridgePanel({
  status,
  onOpenSettings,
}: {
  status: NotificationBridgeStatus | null;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const state = status?.state ?? "starting";
  const stateColor = state === "running" ? "#15803d" : state === "starting" ? "#64748b" : "#b45309";
  const lastScan = status?.last_scan_at
    ? new Date(status.last_scan_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div
      style={{
        marginBottom: 14,
        padding: "11px 13px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderRadius: 8,
        background: "rgba(255,255,255,0.58)",
        border: "1px solid rgba(116,143,165,0.16)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          flex: "0 0 auto",
          borderRadius: "50%",
          background: stateColor,
          boxShadow: `0 0 0 3px ${stateColor}20`,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 850, color: "#334155" }}>
            {t("hub.hush.bridge.title")}
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, color: stateColor }}>
            {t(`hub.hush.bridge.${state}`)}
          </span>
          {(status?.supported_apps ?? ["WeChat", "钉钉"]).map((app) => (
            <span key={app} style={{ fontSize: 9, color: "#64748b" }}>
              {app === "DingTalk" ? "钉钉" : app}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 3, fontSize: 10, color: "#64748b", lineHeight: 1.4 }}>
          {t(`hub.hush.bridge.${state}Desc`)}
          {lastScan ? ` · ${t("hub.hush.bridge.lastScan", { time: lastScan })}` : ""}
        </div>
      </div>
      {state === "permission_required" && (
        <button className="kawaii-tab" onClick={onOpenSettings} style={{ fontSize: 10, padding: "5px 9px" }}>
          {t("hub.hush.bridge.openSettings")}
        </button>
      )}
    </div>
  );
}

function HushTruthPanel({
  inbox,
  bridge,
  dwsStatus,
}: {
  inbox: HushInboxSummary | null;
  bridge: NotificationBridgeStatus | null;
  dwsStatus: DwsHushStatus | null;
}) {
  const dwsActive = dwsStatus?.authenticated && ["ready", "syncing", "error"].includes(dwsStatus.state);
  const notificationActive = bridge?.state === "running";
  const state = dwsActive
    ? "钉钉消息已连接"
    : notificationActive
      ? "本地通知已连接"
      : "消息源尚未连接";
  const detail = dwsActive
    ? "Hush 通过本机 DWS 只读同步钉钉群聊和私聊，不发送或回复消息。"
    : notificationActive
      ? "Hush 正在读取 macOS 投递的微信和钉钉通知预览，不访问私有聊天数据库。"
      : "登录钉钉 DWS 后即可同步最近 24 小时的群聊和私聊。";

  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 18,
        background: "linear-gradient(135deg, rgba(255,255,255,0.9), rgba(232,248,247,0.82))",
        border: "1px solid rgba(116,143,165,0.14)",
        boxShadow: "0 12px 34px rgba(90,115,150,0.1)",
        color: "#334155",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#6d6ade", fontWeight: 900, marginBottom: 4 }}>
            Hush connection truth
          </div>
          <div style={{ fontSize: 18, color: "#263241", fontWeight: 900, lineHeight: 1.2 }}>
            {state}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.55 }}>
            {detail}
          </div>
        </div>
        <div
          style={{
            minWidth: 124,
            padding: 10,
            borderRadius: 15,
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(116,143,165,0.12)",
          }}
        >
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 850, textTransform: "uppercase" }}>
            approved inbox
          </div>
          <div style={{ marginTop: 4, fontSize: 22, color: "#334155", fontWeight: 900 }}>
            {inbox?.total ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatHealthDate(value: string | null, includeTime = false): string {
  if (!value) return "";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "";
  return includeTime
    ? date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatHealthMetric(metric: HushHealthMetric | null): string | null {
  if (!metric) return null;
  const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(metric.value);
  if (metric.unit === "count") return value;
  if (metric.unit === "bpm") return `${value} bpm`;
  if (metric.unit === "minutes") return `${value} min`;
  return value;
}

export function HushHealthSourcePanel({
  summary,
  availability,
  confirmingClear,
  clearCount,
  lastClearCount,
  clearing,
  clearFailed,
  onRequestClear,
  onCancelClear,
  onConfirmClear,
}: {
  summary: HushHealthSourceSummary;
  availability: HushHealthAvailability;
  confirmingClear: boolean;
  clearCount: number;
  lastClearCount: number | null;
  clearing: boolean;
  clearFailed?: boolean;
  onRequestClear: () => void;
  onCancelClear: () => void;
  onConfirmClear: () => void;
}) {
  const { t } = useTranslation();
  const displayState = availability === "ready" ? summary.state : availability;
  const statusColor = displayState === "ready"
    ? "#15803d"
    : displayState === "empty" || displayState === "loading"
      ? "#64748b"
      : displayState === "stale"
        ? "#b45309"
        : displayState === "unavailable"
          ? "#b91c1c"
          : "#0f766e";
  const stateLabel = t(`hub.hush.health.state.${displayState}`);
  const hasReadableHealth = availability === "ready" && summary.state !== "empty";
  const metrics = [
    { key: "steps", label: t("hub.hush.health.steps"), metric: summary.metrics.steps },
    { key: "heart", label: t("hub.hush.health.restingHeartRate"), metric: summary.metrics.restingHeartRate },
    { key: "sleep", label: t("hub.hush.health.sleep"), metric: summary.metrics.sleep },
  ];

  return (
    <section
      aria-label={t("hub.hush.health.title")}
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 8,
        background: "rgba(236,253,245,0.76)",
        border: "1px solid rgba(45, 212, 191, 0.28)",
        color: "#1f3d3a",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            marginTop: 5,
            flex: "0 0 auto",
            borderRadius: "50%",
            background: statusColor,
            boxShadow: `0 0 0 3px ${statusColor}1c`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 850, color: "#1f3d3a" }}>
              {t("hub.hush.health.title")}
            </h3>
            <span style={{ fontSize: 10, fontWeight: 800, color: statusColor }}>
              {stateLabel}
            </span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#52716c", lineHeight: 1.5 }}>
            {t(`hub.hush.health.desc.${displayState}`)}
          </p>
        </div>
      </div>

      {availability === "unavailable" ? (
        <div style={{ marginTop: 12, fontSize: 11, color: "#9a3412", lineHeight: 1.5 }}>
          {t("hub.hush.health.unavailableHint")}
        </div>
      ) : availability === "loading" ? (
        <div style={{ marginTop: 12, fontSize: 11, color: "#52716c", lineHeight: 1.5 }}>
          {t("hub.hush.health.loadingHint")}
        </div>
      ) : summary.state === "empty" ? (
        <div style={{ marginTop: 12, fontSize: 11, color: "#52716c", lineHeight: 1.5 }}>
          {t("hub.hush.health.emptyHint")}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 8,
              marginTop: 12,
            }}
          >
            {metrics.map(({ key, label, metric }) => {
              const value = formatHealthMetric(metric);
              return (
                <div
                  key={key}
                  style={{
                    minWidth: 0,
                    padding: "2px 0 2px 9px",
                    borderLeft: "2px solid rgba(45, 212, 191, 0.38)",
                  }}
                >
                  <div style={{ fontSize: 10, color: "#5d7c76", fontWeight: 750 }}>{label}</div>
                  <div style={{ marginTop: 3, fontSize: 15, color: value ? "#1f3d3a" : "#7b928e", fontWeight: 850 }}>
                    {value ?? t("hub.hush.health.unavailable")}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 10, color: "#52716c" }}>
            <span>{t("hub.hush.health.latestDate", { date: formatHealthDate(summary.localDate) })}</span>
            <span>{t("hub.hush.health.sourceDevice")}</span>
            <span>{t("hub.hush.health.recordedDevices", { count: summary.deviceCount })}</span>
            <span>{t("hub.hush.health.lastSync", { time: formatHealthDate(summary.lastSync, true) })}</span>
          </div>
        </>
      )}

      {clearFailed && (
        <div role="status" style={{ marginTop: 10, fontSize: 10, color: "#b45309" }}>
          {t("hub.hush.health.clearError")}
        </div>
      )}

      {lastClearCount !== null && (
        <div role="status" style={{ marginTop: 10, fontSize: 10, color: "#15803d", fontWeight: 750 }}>
          {t("hub.hush.health.clearSuccess", { count: lastClearCount })}
        </div>
      )}

      {hasReadableHealth && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          {confirmingClear ? (
            <>
              <span style={{ fontSize: 11, color: "#7c2d12", fontWeight: 750 }}>
                {t("hub.hush.health.clearConfirm", { count: clearCount })}
              </span>
              <div style={{ display: "flex", gap: 7 }}>
                <button className="kawaii-tab" type="button" disabled={clearing} onClick={onCancelClear} style={{ fontSize: 10, padding: "5px 9px" }}>
                  {t("hub.common.cancel")}
                </button>
                <button className="kawaii-tab" type="button" disabled={clearing} onClick={onConfirmClear} style={{ fontSize: 10, padding: "5px 9px", color: "#b91c1c" }}>
                  {clearing ? t("hub.hush.health.clearing") : t("hub.hush.health.clearConfirmAction", { count: clearCount })}
                </button>
              </div>
            </>
          ) : (
            <>
              <span style={{ fontSize: 10, color: "#52716c" }}>{t("hub.hush.health.localOnly")}</span>
              <button className="kawaii-tab" type="button" onClick={onRequestClear} style={{ fontSize: 10, padding: "5px 9px", color: "#b45309" }}>
                {t("hub.hush.health.clear")}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DingTalkDwsPanel({
  status,
  report,
  syncing,
  loggingIn,
  autoUpdating,
  onSync,
  onLogin,
  onAutoSyncChange,
}: {
  status: DwsHushStatus | null;
  report: DwsSyncReport | null;
  syncing: boolean;
  loggingIn: boolean;
  autoUpdating: boolean;
  onSync: () => void;
  onLogin: () => void;
  onAutoSyncChange: (enabled: boolean) => void;
}) {
  const state = status?.state ?? "syncing";
  const isSyncing = syncing || status?.syncing || state === "syncing";
  const stateLabel: Record<DwsHushStatus["state"], string> = {
    not_installed: "未安装",
    authentication_required: "待登录",
    ready: "已就绪",
    syncing: "同步中",
    error: "需要处理",
  };
  const stateColor = state === "ready"
    ? "#15803d"
    : state === "syncing"
      ? "#2563eb"
      : state === "not_installed" || state === "authentication_required"
        ? "#b45309"
        : "#be123c";
  const sourceLabel = status?.executable_source === "standalone"
    ? "独立 DWS"
    : status?.executable_source === "wukong"
      ? "悟空内置 DWS"
      : "尚未发现 DWS";
  const canSync = Boolean(status?.authenticated) && !isSyncing;
  const syncLabel = status?.pending_sync
    ? "继续同步"
    : status?.last_success_at
      ? "同步新消息"
      : "同步最近 24 小时";
  const lastSuccess = status?.last_success_at
    ? new Date(status.last_success_at).toLocaleString()
    : "尚未同步";

  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 8,
        background: "rgba(255,255,255,0.64)",
        border: "1px solid rgba(116,143,165,0.16)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            marginTop: 5,
            flex: "0 0 auto",
            borderRadius: "50%",
            background: stateColor,
            boxShadow: `0 0 0 3px ${stateColor}20`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 850, color: "#263241" }}>
              钉钉消息同步
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, color: stateColor }}>
              {stateLabel[state]}
            </span>
            <span style={{ fontSize: 9, color: "#64748b" }}>{sourceLabel}</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
            {status?.message ?? "正在检查本机钉钉 DWS"}
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#64748b" }}>上次成功：{lastSuccess}</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, color: "#475569", cursor: status?.authenticated ? "pointer" : "not-allowed" }}>
              <input
                type="checkbox"
                checked={status?.auto_sync_enabled ?? false}
                disabled={!status?.authenticated || autoUpdating}
                onChange={(event) => onAutoSyncChange(event.target.checked)}
              />
              每 {status?.sync_interval_minutes ?? 5} 分钟自动同步
            </label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {state === "authentication_required" && (
            <button
              className="kawaii-tab"
              onClick={onLogin}
              disabled={loggingIn}
              style={{ fontSize: 10, padding: "6px 10px" }}
            >
              {loggingIn ? "等待登录..." : "登录钉钉"}
            </button>
          )}
          <button
            className="kawaii-tab"
            onClick={onSync}
            disabled={!canSync}
            style={{ fontSize: 10, padding: "6px 10px", opacity: canSync ? 1 : 0.5 }}
          >
            {isSyncing ? "同步中..." : syncLabel}
          </button>
        </div>
      </div>

      {report && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(116,143,165,0.12)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            {[
              ["会话", report.conversations],
              ["已检查", report.examined_messages],
              ["新增", report.imported_messages],
              ["重复", report.duplicate_messages],
            ].map(([label, value]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 850, color: "#334155" }}>{value}</div>
                <div style={{ fontSize: 9, color: "#94a3b8" }}>{label}</div>
              </div>
            ))}
          </div>
          {report.partial && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#b45309", lineHeight: 1.45 }}>
              本轮已到安全上限，进度已保存；点击“继续同步”会从当前游标接着读取。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveInboxPanel({
  inbox,
  onRefresh,
  onClear,
}: {
  inbox: HushInboxSummary | null;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const messages = inbox?.messages ?? [];
  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        borderRadius: 16,
        background: "linear-gradient(135deg, rgba(148,239,244,0.06), rgba(255,255,255,0.018))",
        border: "1px solid rgba(148,239,244,0.14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 850, color: "rgba(255,255,255,0.86)" }}>
            Live message inbox
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: "rgba(255,255,255,0.38)" }}>
            {t("hub.hush.inbox.approvedOnly")}
          </div>
        </div>
        <button className="kawaii-tab" onClick={onRefresh} style={{ fontSize: 10, padding: "5px 9px" }}>
          Refresh
        </button>
        <button className="kawaii-tab" onClick={onClear} style={{ fontSize: 10, padding: "5px 9px" }}>
          Clear
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
        <MiniInboxStat label="messages" value={inbox?.total ?? 0} />
        <MiniInboxStat label="priority" value={inbox?.unread_priority ?? 0} />
        <MiniInboxStat label="family" value={inbox?.by_tier.family ?? 0} />
        <MiniInboxStat label="work" value={inbox?.by_tier.work ?? 0} />
      </div>

      {messages.length === 0 ? (
        <div style={{ padding: 14, borderRadius: 8, background: "rgba(255,255,255,0.018)", color: "rgba(255,255,255,0.34)", fontSize: 11, lineHeight: 1.55 }}>
          {t("hub.hush.inbox.emptyLive")}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }} className="scrollbar-thin">
          {messages.slice(0, 8).map((message) => (
            <div
              key={message.id}
              style={{
                padding: 10,
                borderRadius: 12,
                background: message.importance >= 4 ? "rgba(251,191,36,0.07)" : "rgba(255,255,255,0.022)",
                border: `1px solid ${message.importance >= 4 ? "rgba(251,191,36,0.16)" : "rgba(255,255,255,0.05)"}`,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#94eff4", fontWeight: 850 }}>{message.platform}</span>
                {message.source_id?.startsWith("dws:") && (
                  <span style={{ fontSize: 8, fontWeight: 800, color: "#94eff4", border: "1px solid rgba(148,239,244,0.24)", borderRadius: 4, padding: "1px 4px" }}>
                    DWS
                  </span>
                )}
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.78)", fontWeight: 780 }}>{message.sender}</span>
                {message.chat && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.34)" }}>{message.chat}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.32)" }}>
                  {message.tier} · P{message.importance}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.68)", lineHeight: 1.5 }}>{message.text}</div>
              {message.preview_limited && (
                <div style={{ marginTop: 5, fontSize: 10, color: "#fbbf24", lineHeight: 1.4 }}>
                  {t("hub.hush.bridge.limitedPreview")}
                </div>
              )}
              {message.suggested_reply && !message.preview_limited && (
                <div style={{ marginTop: 6, fontSize: 11, color: "rgba(148,239,244,0.72)", lineHeight: 1.45 }}>
                  Suggested: {message.suggested_reply}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniInboxStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 8, borderRadius: 10, background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 16, fontWeight: 850, color: "rgba(255,255,255,0.86)" }}>{value}</div>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.32)", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function HushConnectorCard({
  connector,
  notificationActive,
  dwsActive,
  busy,
  onOpen,
}: {
  connector: HushConnectorStatus;
  notificationActive: boolean;
  dwsActive: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  const icon = connector.id === "dingtalk" ? "🔷" : "💬";
  const sourceActive = dwsActive || notificationActive;
  const statusColor = sourceActive ? "#34d399" : connector.bridge_ready ? "#34d399" : connector.installed ? "#fbbf24" : "#fb7185";
  const statusLabel = dwsActive ? "DWS 已连接" : notificationActive ? "Notification bridge active" : connector.bridge_ready ? "Message bridge ready" : connector.installed ? "App launch ready" : "Not installed";

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        background: connector.installed ? "rgba(148,239,244,0.035)" : "rgba(255,255,255,0.018)",
        border: `1px solid ${connector.installed ? "rgba(148,239,244,0.12)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.8)" }}>
            {connector.name}
          </div>
          <div style={{ fontSize: 10, color: statusColor, marginTop: 2, fontWeight: 800 }}>
            {statusLabel}
          </div>
        </div>
        <button
          onClick={onOpen}
          disabled={busy || !connector.installed}
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 999,
            background: connector.installed ? "rgba(148,239,244,0.1)" : "rgba(255,255,255,0.03)",
            color: connector.installed ? "#94eff4" : "rgba(255,255,255,0.25)",
            fontSize: 10,
            fontWeight: 800,
            padding: "6px 10px",
            cursor: connector.installed ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Opening..." : "Open"}
        </button>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.45 }}>
        {connector.status}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: "rgba(148,239,244,0.58)", fontWeight: 800 }}>
        Mode: {connector.bridge_mode}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.24)", lineHeight: 1.4 }}>
        {connector.next_step}
      </div>
    </div>
  );
}

function ContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: DerivedContact;
  selected: boolean;
  onClick: () => void;
}) {
  const isPriority = contact.importance >= 4;
  const timeLabel = formatTime(contact.lastMessageTime);

  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: selected ? "rgba(148,239,244,0.14)" : "transparent",
        borderLeft: selected ? "2px solid rgba(52,178,190,0.6)" : "2px solid transparent",
        transition: "all 0.15s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
            {contact.name}
          </span>
          {isPriority && (
            <span style={{
              width: 5, height: 5, borderRadius: "50%", background: "#f59e0b",
              boxShadow: "0 0 4px rgba(245,158,11,0.6)",
            }} />
          )}
        </div>
        <div style={{
          fontSize: 10, color: "#94a3b8",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {contact.lastMessage}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>
          {timeLabel}
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          {contact.platforms.map((p) => (
            <span key={p} style={{ fontSize: 8 }}>{PLATFORM_ICONS[p] || p}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
