import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ExternalLink,
  LogIn,
  MessageCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "../../lib/i18n/react";
import {
  compareHushContacts,
  filterHushContacts,
  getHushConversationIdentity,
  getHushPlatformIdentity,
  getHushUnreadCount,
  groupHushMessages,
  migrateHushConversationState,
  parseHushConversationState,
  resolveHushSelectedContact,
  serializeHushConversationState,
  type DerivedContact,
  type HushConversationState,
  type HushFilter,
  type HushInboxMessage,
} from "./hushPresentation";

export {
  compareHushContacts,
  getHushConversationIdentity,
} from "./hushPresentation";

const TIER_ORDER: string[] = ["family", "friends", "work"];
export const HUSH_CONVERSATION_STATE_KEY = "humhum:hush:conversation-state:v1";

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

interface NotificationBridgeStatus {
  state:
    "starting" | "running" | "permission_required" | "source_missing" | "error";
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
  kind:
    | "health.steps.daily"
    | "health.resting_heart_rate.daily"
    | "health.sleep.daily"
    | string;
  started_at: string;
  ended_at: string;
  value: number;
  unit: "count" | "bpm" | "minutes" | string;
  source: "health_connect" | "phone_step_counter" | string;
  captured_at: string;
  quality: "trusted" | "device_estimate" | string;
}

type HushHealthMetric = Pick<
  HushHealthSignal,
  "value" | "unit" | "captured_at" | "ended_at" | "quality"
>;

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

function newerHealthMetric(
  current: HushHealthMetric | null,
  candidate: HushHealthSignal,
): HushHealthMetric {
  if (!current) return candidate;
  const currentTime =
    parseHealthDate(current.ended_at) ?? Number.NEGATIVE_INFINITY;
  const candidateTime =
    parseHealthDate(candidate.ended_at) ?? Number.NEGATIVE_INFINITY;
  if (candidateTime > currentTime) return candidate;
  if (candidateTime < currentTime) return current;
  return (parseHealthDate(candidate.captured_at) ?? Number.NEGATIVE_INFINITY) >
    (parseHealthDate(current.captured_at) ?? Number.NEGATIVE_INFINITY)
    ? candidate
    : current;
}

function canonicalHealthDay(startedAt: string): string | null {
  const day = startedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && parseHealthDate(startedAt) !== null
    ? day
    : null;
}

export function deriveHushHealthSource(
  signals: HushHealthSignal[],
  now: Date = new Date(),
): HushHealthSourceSummary {
  const groups = new Map<string, HushHealthDayGroup>();
  const deviceIds = new Set<string>();

  for (const signal of signals) {
    const metricKey =
      HEALTH_METRIC_KEYS[signal.kind as keyof typeof HEALTH_METRIC_KEYS];
    const localDate = canonicalHealthDay(signal.started_at);
    const endedAt = parseHealthDate(signal.ended_at);
    const capturedAt = parseHealthDate(signal.captured_at);
    if (
      !metricKey ||
      !localDate ||
      endedAt === null ||
      capturedAt === null ||
      !Number.isFinite(signal.value)
    )
      continue;
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
    group.metrics[metricKey] = newerHealthMetric(
      group.metrics[metricKey],
      signal,
    );
    groups.set(groupKey, group);
  }

  const selected = Array.from(groups.values()).sort(
    (a, b) =>
      b.latestEndedAt - a.latestEndedAt ||
      b.lastSyncAt - a.lastSyncAt ||
      a.deviceId.localeCompare(b.deviceId) ||
      a.localDate.localeCompare(b.localDate),
  )[0];

  const metrics = selected?.metrics ?? {
    steps: null,
    restingHeartRate: null,
    sleep: null,
  };
  const isStale =
    selected !== undefined &&
    now.getTime() - selected.latestEndedAt > 48 * 60 * 60 * 1000;
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
interface DwsHushStatus {
  state:
    "not_installed" | "authentication_required" | "ready" | "syncing" | "error";
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
  const [filter, setFilter] = useState<HushFilter>("all");
  const [conversationState, setConversationState] =
    useState<HushConversationState>(readStoredConversationState);
  const [connectors, setConnectors] = useState<HushConnectorStatus[]>([]);
  const [inbox, setInbox] = useState<HushInboxSummary | null>(null);
  const [healthSignals, setHealthSignals] = useState<HushHealthSignal[]>([]);
  const [healthAvailability, setHealthAvailability] =
    useState<HushHealthAvailability>("loading");
  const [notificationBridge, setNotificationBridge] =
    useState<NotificationBridgeStatus | null>(null);
  const [dwsStatus, setDwsStatus] = useState<DwsHushStatus | null>(null);
  const [dwsReport, setDwsReport] = useState<DwsSyncReport | null>(null);
  const [dwsSyncing, setDwsSyncing] = useState(false);
  const [dwsLoggingIn, setDwsLoggingIn] = useState(false);
  const [dwsAutoUpdating, setDwsAutoUpdating] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [healthClearFailed, setHealthClearFailed] = useState(false);
  const [openingConnector, setOpeningConnector] = useState<string | null>(null);
  const [confirmingHealthClear, setConfirmingHealthClear] = useState(false);
  const [clearingHealth, setClearingHealth] = useState(false);
  const [pendingHealthClearCount, setPendingHealthClearCount] = useState(0);
  const [lastHealthClearCount, setLastHealthClearCount] = useState<
    number | null
  >(null);

  useEffect(() => {
    writeStoredConversationState(conversationState);
  }, [conversationState]);

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
      const status = await invoke<NotificationBridgeStatus>(
        "get_hush_notification_bridge_status",
      );
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

  const openConnector = useCallback(
    async (connectorId: string) => {
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
    },
    [fetchConnectors],
  );

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

  const syncDws = useCallback(async () => {
    setDwsSyncing(true);
    setConnectorError(null);
    try {
      const report = await invoke<DwsSyncReport>("sync_hush_dws");
      setDwsReport(report);
      await Promise.all([fetchDwsStatus(), fetchInbox()]);
    } catch (error) {
      setConnectorError(String(error));
      await fetchDwsStatus();
    } finally {
      setDwsSyncing(false);
    }
  }, [fetchDwsStatus, fetchInbox]);

  const loginDws = useCallback(async () => {
    setDwsLoggingIn(true);
    setConnectorError(null);
    try {
      await invoke("open_hush_dws_login");
      await fetchDwsStatus();
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setDwsLoggingIn(false);
    }
  }, [fetchDwsStatus]);

  const setDwsAutoSync = useCallback(async (enabled: boolean) => {
    setDwsAutoUpdating(true);
    setConnectorError(null);
    try {
      const status = await invoke<DwsHushStatus>("set_hush_dws_auto_sync", {
        enabled,
      });
      setDwsStatus(status);
    } catch (error) {
      setConnectorError(String(error));
    } finally {
      setDwsAutoUpdating(false);
    }
  }, []);

  const contacts = useMemo<DerivedContact[]>(() => {
    const map = new Map<string, DerivedContact>();
    for (const message of inbox?.messages ?? []) {
      const identity = getHushConversationIdentity(message);
      const existing = map.get(identity.id);
      if (existing) {
        existing.messages.push(message);
        for (const legacyId of identity.legacyIds) {
          if (!existing.legacyIds.includes(legacyId)) {
            existing.legacyIds.push(legacyId);
          }
        }
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
          legacyIds: identity.legacyIds,
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

  useEffect(() => {
    setConversationState((current) =>
      migrateHushConversationState(current, contacts),
    );
  }, [contacts]);

  const filteredContacts = useMemo(
    () => filterHushContacts(contacts, filter, conversationState),
    [contacts, conversationState, filter],
  );
  const selectedContact = resolveHushSelectedContact(contacts, selectedId);
  const healthSource = useMemo(
    () => deriveHushHealthSource(healthSignals),
    [healthSignals],
  );

  const selectContact = useCallback((contact: DerivedContact) => {
    setSelectedId(contact.id);
    setConversationState((current) => ({
      ...current,
      readThrough: {
        ...current.readThrough,
        [contact.id]: contact.lastMessageTime,
      },
    }));
  }, []);

  const toggleAttention = useCallback((contactId: string) => {
    setConversationState((current) => {
      const isAttention = current.attentionIds.includes(contactId);
      return {
        ...current,
        attentionIds: isAttention
          ? current.attentionIds.filter((id) => id !== contactId)
          : [...current.attentionIds, contactId],
      };
    });
  }, []);

  return (
    <div className="hub-module hush-room-module">
      <header className="hub-module-heading hush-heading">
        <span className="hub-module-kicker">{t("hub.role.hush")}</span>
        <h2 className="hub-module-title">{t("hub.hush.title")}</h2>
        <p className="hub-module-desc">{t("hub.hush.desc")}</p>
      </header>

      <HushStatusArea
        connectors={connectors}
        connectorError={connectorError}
        notificationBridge={notificationBridge}
        dwsStatus={dwsStatus}
        dwsReport={dwsReport}
        inbox={inbox}
        openingConnector={openingConnector}
        dwsSyncing={dwsSyncing}
        dwsLoggingIn={dwsLoggingIn}
        dwsAutoUpdating={dwsAutoUpdating}
        healthSource={healthSource}
        healthSignalsCount={healthSignals.length}
        healthAvailability={healthAvailability}
        confirmingHealthClear={confirmingHealthClear}
        pendingHealthClearCount={pendingHealthClearCount}
        lastHealthClearCount={lastHealthClearCount}
        clearingHealth={clearingHealth}
        healthClearFailed={healthClearFailed}
        onOpenConnector={openConnector}
        onOpenSettings={openFullDiskAccess}
        onSyncDws={syncDws}
        onLoginDws={loginDws}
        onAutoSyncChange={setDwsAutoSync}
        onRefreshInbox={fetchInbox}
        onClearInbox={clearInbox}
        onRequestHealthClear={() => {
          setPendingHealthClearCount(healthSignals.length);
          setHealthClearFailed(false);
          setConfirmingHealthClear(true);
        }}
        onCancelHealthClear={() => {
          setConfirmingHealthClear(false);
          setHealthClearFailed(false);
        }}
        onConfirmHealthClear={clearHealthSignals}
      />

      <div className="hush-inbox-toolbar">
        <div className="hush-filter-control" aria-label="消息筛选">
          {(
            [
              ["all", "全部"],
              ["attention", "特别关注"],
              ["unread", "未读"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "is-active" : ""}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="hush-conversation-count">
          {filteredContacts.length} 个会话
        </span>
      </div>

      {contacts.length === 0 ? (
        <div className="hush-empty-state">
          <div className="hub-empty-title">{t("hub.hush.emptyTitle")}</div>
          <div className="hub-empty-desc">{t("hub.hush.emptyDesc")}</div>
        </div>
      ) : (
        <div className="hush-inbox-workspace">
          <aside className="hush-conversation-pane" aria-label="会话列表">
            {filteredContacts.length > 0 ? (
              <ul className="hush-contact-list">
                {filteredContacts.map((contact) => (
                  <HushContactRow
                    key={contact.id}
                    contact={contact}
                    selected={selectedId === contact.id}
                    attention={conversationState.attentionIds.includes(
                      contact.id,
                    )}
                    unreadCount={getHushUnreadCount(contact, conversationState)}
                    onSelect={() => selectContact(contact)}
                    onToggleAttention={() => toggleAttention(contact.id)}
                  />
                ))}
              </ul>
            ) : (
              <div className="hush-filter-empty">当前筛选下没有会话</div>
            )}
          </aside>

          <section className="hush-message-pane" aria-label="消息记录">
            {selectedContact ? (
              <ConversationDetail contact={selectedContact} />
            ) : (
              <div className="hush-select-empty">
                <div className="hub-empty-title">
                  {t("hub.hush.selectContactTitle")}
                </div>
                <div className="hub-empty-desc">
                  {t("hub.hush.selectContactDesc")}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function HushStatusArea({
  connectors,
  connectorError,
  notificationBridge,
  dwsStatus,
  dwsReport,
  inbox,
  openingConnector,
  dwsSyncing,
  dwsLoggingIn,
  dwsAutoUpdating,
  healthSource,
  healthSignalsCount,
  healthAvailability,
  confirmingHealthClear,
  pendingHealthClearCount,
  lastHealthClearCount,
  clearingHealth,
  healthClearFailed,
  onOpenConnector,
  onOpenSettings,
  onSyncDws,
  onLoginDws,
  onAutoSyncChange,
  onRefreshInbox,
  onClearInbox,
  onRequestHealthClear,
  onCancelHealthClear,
  onConfirmHealthClear,
}: {
  connectors: HushConnectorStatus[];
  connectorError: string | null;
  notificationBridge: NotificationBridgeStatus | null;
  dwsStatus: DwsHushStatus | null;
  dwsReport: DwsSyncReport | null;
  inbox: HushInboxSummary | null;
  openingConnector: string | null;
  dwsSyncing: boolean;
  dwsLoggingIn: boolean;
  dwsAutoUpdating: boolean;
  healthSource: HushHealthSourceSummary;
  healthSignalsCount: number;
  healthAvailability: HushHealthAvailability;
  confirmingHealthClear: boolean;
  pendingHealthClearCount: number;
  lastHealthClearCount: number | null;
  clearingHealth: boolean;
  healthClearFailed: boolean;
  onOpenConnector: (connectorId: string) => void;
  onOpenSettings: () => void;
  onSyncDws: () => void;
  onLoginDws: () => void;
  onAutoSyncChange: (enabled: boolean) => void;
  onRefreshInbox: () => void;
  onClearInbox: () => void;
  onRequestHealthClear: () => void;
  onCancelHealthClear: () => void;
  onConfirmHealthClear: () => void;
}) {
  const notificationReady = notificationBridge?.state === "running";
  const dingTalkReady = Boolean(dwsStatus?.authenticated);

  return (
    <details className="hush-status-area">
      <summary>
        <span className="hush-status-summary-title">
          <ShieldCheck size={15} aria-hidden="true" />
          连接与状态
        </span>
        <span className="hush-status-summary-meta">
          钉钉{dingTalkReady ? "已连接" : "未连接"} · WeChat
          {notificationReady ? "已监听" : "未监听"} · {inbox?.total ?? 0} 条消息
        </span>
        <ChevronDown
          className="hush-status-chevron"
          size={16}
          aria-hidden="true"
        />
      </summary>

      <div className="hush-status-content">
        {connectorError && (
          <div className="hush-status-error">{connectorError}</div>
        )}
        <HushTruthPanel
          inbox={inbox}
          bridge={notificationBridge}
          dwsStatus={dwsStatus}
        />
        <HushHealthSourcePanel
          summary={healthSource}
          availability={healthAvailability}
          confirmingClear={confirmingHealthClear}
          clearCount={pendingHealthClearCount || healthSignalsCount}
          lastClearCount={lastHealthClearCount}
          clearing={clearingHealth}
          clearFailed={healthClearFailed}
          onRequestClear={onRequestHealthClear}
          onCancelClear={onCancelHealthClear}
          onConfirmClear={onConfirmHealthClear}
        />
        <div className="hush-status-section">
          <div className="hush-status-section-title">消息来源</div>
          <div className="hush-connector-list">
            {connectors.map((connector) => (
              <HushConnectorRow
                key={connector.id}
                connector={connector}
                notificationActive={notificationReady}
                dwsActive={connector.id === "dingtalk" && dingTalkReady}
                busy={openingConnector === connector.id}
                onOpen={() => onOpenConnector(connector.id)}
              />
            ))}
          </div>
        </div>
        <NotificationBridgePanel
          status={notificationBridge}
          onOpenSettings={onOpenSettings}
        />
        <DwsPanel
          status={dwsStatus}
          report={dwsReport}
          syncing={dwsSyncing}
          loggingIn={dwsLoggingIn}
          autoUpdating={dwsAutoUpdating}
          onSync={onSyncDws}
          onLogin={onLoginDws}
          onAutoSyncChange={onAutoSyncChange}
        />
        <LiveInboxPanel
          inbox={inbox}
          onRefresh={onRefreshInbox}
          onClear={onClearInbox}
        />
      </div>
    </details>
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
  const dwsActive =
    dwsStatus?.authenticated &&
    ["ready", "syncing", "error"].includes(dwsStatus.state);
  const notificationActive = bridge?.state === "running";
  const state = dwsActive
    ? "钉钉消息已连接"
    : notificationActive
      ? "本地通知已连接"
      : "消息源尚未连接";
  const detail = dwsActive
    ? "Hush 通过本机 DWS 只读同步钉钉群聊和私聊，不发送或回复消息。"
    : notificationActive
      ? "Hush 正在读取 macOS 投递的 WeChat 和钉钉通知预览，不访问私有聊天数据库。"
      : "登录钉钉 DWS 后即可同步最近 24 小时的群聊和私聊。";

  return (
    <div className="hush-truth-row">
      <div>
        <strong>{state}</strong>
        <span>{detail}</span>
      </div>
      <span className="hush-truth-count">{inbox?.total ?? 0} 条已接入</span>
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
  const lastScan = status?.last_scan_at
    ? new Date(status.last_scan_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div className="hush-status-row">
      <span className={`hush-state-dot is-${state}`} aria-hidden="true" />
      <div className="hush-status-row-copy">
        <strong>
          {t("hub.hush.bridge.title")} · {t(`hub.hush.bridge.${state}`)}
        </strong>
        <span>
          {t(`hub.hush.bridge.${state}Desc`)}
          {lastScan
            ? ` · ${t("hub.hush.bridge.lastScan", { time: lastScan })}`
            : ""}
        </span>
        <div className="hush-source-labels">
          {(status?.supported_apps ?? ["WeChat", "钉钉"]).map((app) => (
            <HushPlatformLabel key={app} platform={app} />
          ))}
        </div>
      </div>
      {state === "permission_required" && (
        <button
          type="button"
          className="hush-status-action"
          onClick={onOpenSettings}
        >
          <Settings size={14} aria-hidden="true" />
          {t("hub.hush.bridge.openSettings")}
        </button>
      )}
    </div>
  );
}

function formatHealthDate(value: string | null, includeTime = false): string {
  if (!value) return "";
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value,
  );
  if (Number.isNaN(date.getTime())) return "";
  return includeTime
    ? date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatHealthMetric(metric: HushHealthMetric | null): string | null {
  if (!metric) return null;
  const value = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(metric.value);
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
  const statusColor =
    displayState === "ready"
      ? "#15803d"
      : displayState === "empty" || displayState === "loading"
        ? "#64748b"
        : displayState === "stale"
          ? "#b45309"
          : displayState === "unavailable"
            ? "#b91c1c"
            : "#0f766e";
  const stateLabel = t(`hub.hush.health.state.${displayState}`);
  const hasReadableHealth =
    availability === "ready" && summary.state !== "empty";
  const metrics = [
    {
      key: "steps",
      label: t("hub.hush.health.steps"),
      metric: summary.metrics.steps,
    },
    {
      key: "heart",
      label: t("hub.hush.health.restingHeartRate"),
      metric: summary.metrics.restingHeartRate,
    },
    {
      key: "sleep",
      label: t("hub.hush.health.sleep"),
      metric: summary.metrics.sleep,
    },
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 850,
                color: "#1f3d3a",
              }}
            >
              {t("hub.hush.health.title")}
            </h3>
            <span style={{ fontSize: 10, fontWeight: 800, color: statusColor }}>
              {stateLabel}
            </span>
          </div>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 11,
              color: "#52716c",
              lineHeight: 1.5,
            }}
          >
            {t(`hub.hush.health.desc.${displayState}`)}
          </p>
        </div>
      </div>

      {availability === "unavailable" ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "#9a3412",
            lineHeight: 1.5,
          }}
        >
          {t("hub.hush.health.unavailableHint")}
        </div>
      ) : availability === "loading" ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "#52716c",
            lineHeight: 1.5,
          }}
        >
          {t("hub.hush.health.loadingHint")}
        </div>
      ) : summary.state === "empty" ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "#52716c",
            lineHeight: 1.5,
          }}
        >
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
                  <div
                    style={{ fontSize: 10, color: "#5d7c76", fontWeight: 750 }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 15,
                      color: value ? "#1f3d3a" : "#7b928e",
                      fontWeight: 850,
                    }}
                  >
                    {value ?? t("hub.hush.health.unavailable")}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 10,
              fontSize: 10,
              color: "#52716c",
            }}
          >
            <span>
              {t("hub.hush.health.latestDate", {
                date: formatHealthDate(summary.localDate),
              })}
            </span>
            <span>{t("hub.hush.health.sourceDevice")}</span>
            <span>
              {t("hub.hush.health.recordedDevices", {
                count: summary.deviceCount,
              })}
            </span>
            <span>
              {t("hub.hush.health.lastSync", {
                time: formatHealthDate(summary.lastSync, true),
              })}
            </span>
          </div>
        </>
      )}

      {clearFailed && (
        <div
          role="status"
          style={{ marginTop: 10, fontSize: 10, color: "#b45309" }}
        >
          {t("hub.hush.health.clearError")}
        </div>
      )}

      {lastClearCount !== null && (
        <div
          role="status"
          style={{
            marginTop: 10,
            fontSize: 10,
            color: "#15803d",
            fontWeight: 750,
          }}
        >
          {t("hub.hush.health.clearSuccess", { count: lastClearCount })}
        </div>
      )}

      {hasReadableHealth && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
          {confirmingClear ? (
            <>
              <span style={{ fontSize: 11, color: "#7c2d12", fontWeight: 750 }}>
                {t("hub.hush.health.clearConfirm", { count: clearCount })}
              </span>
              <div style={{ display: "flex", gap: 7 }}>
                <button
                  className="kawaii-tab"
                  type="button"
                  disabled={clearing}
                  onClick={onCancelClear}
                  style={{ fontSize: 10, padding: "5px 9px" }}
                >
                  {t("hub.common.cancel")}
                </button>
                <button
                  className="kawaii-tab"
                  type="button"
                  disabled={clearing}
                  onClick={onConfirmClear}
                  style={{ fontSize: 10, padding: "5px 9px", color: "#b91c1c" }}
                >
                  {clearing
                    ? t("hub.hush.health.clearing")
                    : t("hub.hush.health.clearConfirmAction", {
                        count: clearCount,
                      })}
                </button>
              </div>
            </>
          ) : (
            <>
              <span style={{ fontSize: 10, color: "#52716c" }}>
                {t("hub.hush.health.localOnly")}
              </span>
              <button
                className="kawaii-tab"
                type="button"
                onClick={onRequestClear}
                style={{ fontSize: 10, padding: "5px 9px", color: "#b45309" }}
              >
                {t("hub.hush.health.clear")}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DwsPanel({
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
  const sourceLabel =
    status?.executable_source === "standalone"
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
    <div className="hush-status-row hush-dingtalk-row">
      <span className={`hush-state-dot is-${state}`} aria-hidden="true" />
      <div className="hush-status-row-copy">
        <strong>钉钉消息同步 · {stateLabel[state]}</strong>
        <span>{status?.message ?? "正在检查本机钉钉 DWS"}</span>
        <span className="hush-status-secondary">
          {sourceLabel} · 上次成功：{lastSuccess}
        </span>
        {status?.executable_path && (
          <code title={status.executable_path}>{status.executable_path}</code>
        )}
        <label className="hush-auto-sync">
          <input
            type="checkbox"
            checked={status?.auto_sync_enabled ?? false}
            disabled={!status?.authenticated || autoUpdating}
            onChange={(event) => onAutoSyncChange(event.target.checked)}
          />
          每 {status?.sync_interval_minutes ?? 5} 分钟自动同步
        </label>
        {report && (
          <div className="hush-sync-report">
            <span>会话 {report.conversations}</span>
            <span>已检查 {report.examined_messages}</span>
            <span>新增 {report.imported_messages}</span>
            <span>重复 {report.duplicate_messages}</span>
            {report.partial && <strong>本轮已到安全上限，可继续同步。</strong>}
          </div>
        )}
      </div>
      <div className="hush-status-actions">
        {state === "authentication_required" && (
          <button
            type="button"
            className="hush-status-action"
            onClick={onLogin}
            disabled={loggingIn}
          >
            <LogIn size={14} aria-hidden="true" />
            {loggingIn ? "等待登录..." : "登录钉钉"}
          </button>
        )}
        <button
          type="button"
          className="hush-status-action"
          onClick={onSync}
          disabled={!canSync}
        >
          <RefreshCw
            className={isSyncing ? "is-spinning" : ""}
            size={14}
            aria-hidden="true"
          />
          {isSyncing ? "同步中..." : syncLabel}
        </button>
      </div>
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
    <details className="hush-live-debug">
      <summary>
        <span>本地收件箱调试</span>
        <span>
          {inbox?.total ?? 0} 条 · 优先 {inbox?.unread_priority ?? 0}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="hush-live-debug-content">
        <div className="hush-live-debug-toolbar">
          <code>http://127.0.0.1:31275/hush/inbox</code>
          <button
            type="button"
            className="hush-icon-button"
            onClick={onRefresh}
            aria-label="刷新本地收件箱"
            title="刷新本地收件箱"
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="hush-icon-button is-danger"
            onClick={onClear}
            aria-label="清空本地收件箱"
            title="清空本地收件箱"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
        {messages.length === 0 ? (
          <div className="hush-live-empty">暂无本地消息。</div>
        ) : (
          <div className="hush-live-list">
            {messages.slice(0, 8).map((message) => (
              <div className="hush-live-row" key={message.id}>
                <HushPlatformLabel platform={message.platform} />
                <strong>{message.sender}</strong>
                <span>{message.text}</span>
                {message.preview_limited && (
                  <small>{t("hub.hush.bridge.limitedPreview")}</small>
                )}
                {message.suggested_reply && !message.preview_limited && (
                  <small>建议回复：{message.suggested_reply}</small>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function HushConnectorRow({
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
  const sourceActive = dwsActive || notificationActive;
  const connectorIdentity = getHushPlatformIdentity(connector.name);
  const statusLabel = dwsActive
    ? "DWS 已连接"
    : notificationActive
      ? "通知桥已启用"
      : connector.bridge_ready
        ? "消息桥已就绪"
        : connector.installed
          ? "应用可打开"
          : "未安装";

  return (
    <div className="hush-connector-row">
      <HushPlatformLabel platform={connector.id} />
      <div>
        <strong>{connectorIdentity.label}</strong>
        <span>
          {statusLabel} · {connector.status}
        </span>
        <small>
          {connector.bridge_mode} · {connector.next_step}
        </small>
        {connector.app_path && (
          <code title={connector.app_path}>{connector.app_path}</code>
        )}
      </div>
      <button
        type="button"
        className="hush-icon-button"
        onClick={onOpen}
        disabled={busy || !connector.installed}
        aria-label={`打开${connectorIdentity.label}`}
        title={`打开${connectorIdentity.label}`}
      >
        <ExternalLink size={15} aria-hidden="true" />
      </button>
      <span
        className={`hush-connector-state ${sourceActive ? "is-active" : ""}`}
      >
        {sourceActive ? "已连接" : "未连接"}
      </span>
    </div>
  );
}

export function HushContactRow({
  contact,
  selected,
  attention,
  unreadCount,
  onSelect,
  onToggleAttention,
}: {
  contact: DerivedContact;
  selected: boolean;
  attention: boolean;
  unreadCount: number;
  onSelect: () => void;
  onToggleAttention: () => void;
}) {
  const isPriority = contact.importance >= 4;
  const unread = unreadCount > 0;

  return (
    <li
      className={[
        "hush-contact-row",
        selected ? "is-selected" : "",
        unread ? "is-unread" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
    >
      <button
        type="button"
        className="hush-contact-select"
        aria-current={selected ? "true" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <span className="hush-contact-heading">
          <strong>{contact.name}</strong>
          <time dateTime={contact.lastMessageTime}>
            {formatTime(contact.lastMessageTime)}
          </time>
        </span>
        <span className="hush-contact-sources">
          {contact.platforms.map((platform) => (
            <HushPlatformLabel key={platform} platform={platform} />
          ))}
          {unread && (
            <span
              className="hush-unread-label"
              aria-label={`${unreadCount} 条未读`}
            >
              {unreadCount} 条未读
            </span>
          )}
          {isPriority && <span className="hush-priority-label">重点</span>}
        </span>
        <span className="hush-contact-preview">{contact.lastMessage}</span>
      </button>
      <button
        type="button"
        className={`hush-star-button ${attention ? "is-active" : ""}`}
        aria-label={
          attention ? `取消特别关注${contact.name}` : `特别关注${contact.name}`
        }
        aria-pressed={attention}
        title={attention ? "取消特别关注" : "特别关注"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleAttention();
        }}
      >
        <Star
          size={16}
          fill={attention ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

function ConversationDetail({ contact }: { contact: DerivedContact }) {
  const { t } = useTranslation();
  const groups = groupHushMessages(contact.messages);

  return (
    <div className="hush-conversation-detail">
      <header className="hush-conversation-header">
        <div>
          <h3>{contact.name}</h3>
          <div className="hush-contact-sources">
            {contact.platforms.map((platform) => (
              <HushPlatformLabel key={platform} platform={platform} />
            ))}
            <span>
              {contact.tier} · P{contact.importance}
            </span>
          </div>
        </div>
        <span>
          {groups.length} 组 · {contact.messages.length} 条
        </span>
      </header>

      <div className="hush-message-groups">
        {groups.map((group) => (
          <section className="hush-message-group" key={group.id}>
            <header>
              <strong>{group.sender}</strong>
              <HushPlatformLabel platform={group.platform} />
              {group.chat && <span>{group.chat}</span>}
              <time dateTime={group.startedAt}>
                {formatGroupTime(group.startedAt, group.endedAt)}
              </time>
            </header>
            <div className="hush-message-lines">
              {group.messages.map((message) => (
                <div className="hush-message-line" key={message.id}>
                  <p>{message.text}</p>
                  {message.preview_limited && (
                    <div className="hush-message-warning">
                      {t("hub.hush.bridge.limitedPreview")}
                    </div>
                  )}
                  {message.suggested_reply && !message.preview_limited && (
                    <div className="hush-message-suggestion">
                      <MessageCircle size={13} aria-hidden="true" />
                      <span>
                        {t("hub.hush.suggestedReplies")}：
                        {message.suggested_reply}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function HushPlatformLabel({ platform }: { platform: string }) {
  const identity = getHushPlatformIdentity(platform);
  return (
    <span className={`hush-platform-label is-${identity.key}`}>
      <span aria-hidden="true" />
      {identity.label}
    </span>
  );
}

function readStoredConversationState(): HushConversationState {
  if (typeof window === "undefined") return parseHushConversationState(null);
  try {
    return parseHushConversationState(
      window.localStorage.getItem(HUSH_CONVERSATION_STATE_KEY),
    );
  } catch {
    return parseHushConversationState(null);
  }
}

function writeStoredConversationState(state: HushConversationState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      HUSH_CONVERSATION_STATE_KEY,
      serializeHushConversationState(state),
    );
  } catch {
    // The inbox remains usable when local storage is unavailable.
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatGroupTime(startedAt: string, endedAt: string): string {
  const started = formatTime(startedAt);
  const ended = formatTime(endedAt);
  return started === ended ? started : `${started} - ${ended}`;
}
