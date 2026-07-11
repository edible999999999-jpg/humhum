import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Play, RotateCcw, X } from "lucide-react";
import type { AppConfig } from "@/types";
import { useTranslation } from "@/lib/i18n/react";
import { setLanguage } from "@/lib/i18n";
import { PetCanvas } from "../Pet/PetCanvas";
import { VOICE_PRESETS, DEFAULT_VOICE } from "./voicePresets";
import { StatsPanel } from "./StatsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { playSound, type SoundEvent } from "@/lib/audio/sound-effects";
import { MASCOT_THEMES, resolveMascotTheme } from "@/lib/mascot-theme";

interface SettingsPanelProps {
  onClose: () => void;
}

interface WakeGuardStatus {
  available: boolean;
  enabled: boolean;
  process_id: number | null;
  started_at: string | null;
  message: string;
}

interface RemoteBridgeStatus {
  status: "disconnected" | "connected" | "error";
  target: string | null;
  remote_port: number;
  message: string;
}

interface SoundPackInfo {
  path: string;
  name: string;
  display_name: string;
  available_events: SoundEvent[];
}

const LANG_TO_STT: Record<string, string> = { zh: "zh-CN", en: "en-US" };

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hookStatus, setHookStatus] = useState<Record<string, boolean>>({});
  const [hookLoading, setHookLoading] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [activeTab, setActiveTab] = useState<"settings" | "stats" | "memory">("settings");
  const [wakeStatus, setWakeStatus] = useState<WakeGuardStatus | null>(null);
  const [wakeLoading, setWakeLoading] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchAtLoginLoading, setLaunchAtLoginLoading] = useState(false);
  const [remoteBridge, setRemoteBridge] = useState<RemoteBridgeStatus | null>(null);
  const [remoteTarget, setRemoteTarget] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [soundPacks, setSoundPacks] = useState<SoundPackInfo[]>([]);
  const [soundPackLoading, setSoundPackLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, status, clientList, awake, autostart, remote, packs] = await Promise.all([
          invoke<AppConfig>("get_config"),
          invoke<Record<string, boolean>>("check_hooks_status"),
          invoke<Array<{ id: string; name: string }>>("get_supported_clients"),
          invoke<WakeGuardStatus>("get_wake_guard_status"),
          invoke<boolean>("get_launch_at_login"),
          invoke<RemoteBridgeStatus>("get_remote_bridge_status"),
          invoke<SoundPackInfo[]>("get_sound_packs"),
        ]);
        setConfig(cfg as AppConfig);
        setLanguage((cfg as AppConfig).ui.language as "zh" | "en");
        setHookStatus(status as Record<string, boolean>);
        setClients(clientList as Array<{ id: string; name: string }>);
        setWakeStatus(awake);
        setLaunchAtLogin(autostart);
        setRemoteBridge(remote);
        setSoundPacks(packs);
        setRemoteTarget(remote.target ?? "");
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      invoke<RemoteBridgeStatus>("get_remote_bridge_status")
        .then(setRemoteBridge)
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSave = useCallback(async () => {
    if (!config) return;
    const piUrl = config.pi.url.trim().replace(/\/$/, "");
    if (!piUrl || !config.pi.model_name.trim()) {
      setMessage({ type: "error", text: "请填写 Pi 的 URL 和 model_name" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await invoke("save_config", {
        newConfig: {
          ...config,
          pi: {
            ...config.pi,
            url: piUrl,
            model_name: config.pi.model_name.trim(),
            token: config.pi.token?.trim() || undefined,
          },
        },
      });
      setMessage({ type: "success", text: t("settings.saved") });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setMessage({ type: "error", text: t("settings.saveFailed", { e: String(e) }) });
    } finally {
      setSaving(false);
    }
  }, [config]);

  const updateConfig = useCallback(
    (updater: (prev: AppConfig) => AppConfig) => {
      setConfig((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  const handleHookToggle = useCallback(
    async (clientId: string, installed: boolean) => {
      setHookLoading((p) => ({ ...p, [clientId]: true }));
      try {
        if (installed) {
          await invoke("uninstall_hooks_for_client", { clientId });
          setHookStatus((p) => ({ ...p, [clientId]: false }));
        } else {
          await invoke("install_hooks_for_client", { clientId });
          setHookStatus((p) => ({ ...p, [clientId]: true }));
        }
      } catch (e) {
        setMessage({ type: "error", text: t("settings.hookFailed", { e: String(e) }) });
      } finally {
        setHookLoading((p) => ({ ...p, [clientId]: false }));
      }
    },
    []
  );

  const handleAwakeToggle = useCallback(async () => {
    const enabled = !(wakeStatus?.enabled ?? false);
    setWakeLoading(true);
    setMessage(null);
    try {
      const status = await invoke<WakeGuardStatus>("set_wake_guard_enabled", { enabled });
      setWakeStatus(status);
      updateConfig((current) => ({
        ...current,
        ui: { ...current.ui, awake_mode: status.enabled },
      }));
    } catch (error) {
      setMessage({ type: "error", text: t("settings.awakeFailed", { e: String(error) }) });
    } finally {
      setWakeLoading(false);
    }
  }, [wakeStatus, updateConfig, t]);

  const handleLaunchAtLoginToggle = useCallback(async () => {
    setLaunchAtLoginLoading(true);
    setMessage(null);
    try {
      const enabled = await invoke<boolean>("set_launch_at_login", {
        enabled: !launchAtLogin,
      });
      setLaunchAtLogin(enabled);
    } catch (error) {
      setMessage({ type: "error", text: t("settings.launchAtLoginFailed", { e: String(error) }) });
    } finally {
      setLaunchAtLoginLoading(false);
    }
  }, [launchAtLogin, t]);

  const handleRemoteBridgeToggle = useCallback(async () => {
    setRemoteLoading(true);
    setMessage(null);
    try {
      const status = remoteBridge?.status === "connected"
        ? await invoke<RemoteBridgeStatus>("disconnect_remote_bridge")
        : await invoke<RemoteBridgeStatus>("connect_remote_bridge", { target: remoteTarget });
      setRemoteBridge(status);
      if (status.target) setRemoteTarget(status.target);
    } catch (error) {
      setMessage({ type: "error", text: t("settings.remoteFailed", { e: String(error) }) });
    } finally {
      setRemoteLoading(false);
    }
  }, [remoteBridge?.status, remoteTarget, t]);

  const chooseSoundPack = useCallback(async () => {
    setSoundPackLoading(true);
    setMessage(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: t("settings.soundImport") });
      if (!selected) return;
      const info = await invoke<SoundPackInfo>("select_sound_pack", { path: selected });
      setSoundPacks(await invoke<SoundPackInfo[]>("get_sound_packs"));
      updateConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          sounds: {
            enabled: true,
            processing_started: true,
            attention_required: true,
            task_completed: true,
            error: true,
            resource_limit: true,
            ...current.ui.sounds,
            pack_path: info.path,
          },
        },
      }));
      setMessage({ type: "success", text: t("settings.soundImported", { name: info.display_name }) });
    } catch (error) {
      setMessage({ type: "error", text: t("settings.soundImportFailed", { e: String(error) }) });
    } finally {
      setSoundPackLoading(false);
    }
  }, [t, updateConfig]);

  const selectDiscoveredSoundPack = useCallback(async (path: string) => {
    setSoundPackLoading(true);
    try {
      const info = await invoke<SoundPackInfo>("select_sound_pack", { path });
      updateConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          sounds: {
            enabled: true,
            processing_started: true,
            attention_required: true,
            task_completed: true,
            error: true,
            resource_limit: true,
            ...current.ui.sounds,
            pack_path: info.path,
          },
        },
      }));
    } catch (error) {
      setMessage({ type: "error", text: t("settings.soundImportFailed", { e: String(error) }) });
    } finally {
      setSoundPackLoading(false);
    }
  }, [t, updateConfig]);

  const clearSoundPack = useCallback(async () => {
    await invoke("clear_sound_pack");
    updateConfig((current) => ({
      ...current,
      ui: {
        ...current.ui,
        sounds: {
          enabled: current.ui.sounds?.enabled !== false,
          processing_started: current.ui.sounds?.processing_started !== false,
          attention_required: current.ui.sounds?.attention_required !== false,
          task_completed: current.ui.sounds?.task_completed !== false,
          error: current.ui.sounds?.error !== false,
          resource_limit: current.ui.sounds?.resource_limit !== false,
          pack_path: undefined,
        },
      },
    }));
  }, [updateConfig]);

  if (loading || !config) {
    return (
      <div className="w-full h-full flex items-center justify-center settings-panel">
        <div className="flex flex-col items-center gap-3">
          <PetCanvas state="processing" size={48} />
          <p className="text-white/40 text-xs animate-pulse">{t("settings.loading")}</p>
        </div>
      </div>
    );
  }

  const voiceOptions = VOICE_PRESETS[config.tts.provider] ?? [];
  const connectedCount = Object.values(hookStatus).filter(Boolean).length;
  const soundPreferences = {
    enabled: config.ui.sounds?.enabled !== false,
    processing_started: config.ui.sounds?.processing_started !== false,
    attention_required: config.ui.sounds?.attention_required !== false,
    task_completed: config.ui.sounds?.task_completed !== false,
    error: config.ui.sounds?.error !== false,
    resource_limit: config.ui.sounds?.resource_limit !== false,
    pack_path: config.ui.sounds?.pack_path,
  };
  const mascotOverrides = config.ui.mascot_overrides ?? {};
  const mascotClients = [
    ...clients,
    { id: "pi", name: "Pi Agent" },
    { id: "wukong", name: "Wukong" },
  ].filter((client, index, all) => all.findIndex((candidate) => candidate.id === client.id) === index);

  return (
    <div className="w-full h-full flex flex-col settings-panel">
      {/* Header */}
      <header data-tauri-drag-region className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
        <div className="kawaii-avatar-ring">
          <PetCanvas state="idle" size={32} />
        </div>
        <div>
          <h1 className="text-[15px] font-bold text-white/85 tracking-wide">{t("settings.title")}</h1>
          <p className="text-[10px] text-white/25 -mt-0.5">{t("settings.subtitle")}</p>
        </div>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="kawaii-close-btn"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M1.5 0.5L5 4L8.5 0.5L9.5 1.5L6 5L9.5 8.5L8.5 9.5L5 6L1.5 9.5L0.5 8.5L4 5L0.5 1.5L1.5 0.5Z" />
          </svg>
        </button>
      </header>

      {/* Tab Navigation */}
      <div className="flex px-5 pt-3 pb-0 gap-1.5">
        <button
          onClick={() => setActiveTab("settings")}
          className={`kawaii-tab ${activeTab === "settings" ? "active" : ""}`}
        >
          {t("settings.tabSettings")}
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          className={`kawaii-tab ${activeTab === "stats" ? "active" : ""}`}
        >
          {t("settings.tabStats")}
        </button>
        <button
          onClick={() => setActiveTab("memory")}
          className={`kawaii-tab ${activeTab === "memory" ? "active" : ""}`}
        >
          {t("settings.tabMemory")}
        </button>
      </div>

      {/* Stats tab */}
      {activeTab === "stats" && (
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          <StatsPanel />
        </div>
      )}

      {/* Memory / Insights tab */}
      {activeTab === "memory" && (
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          <MemoryPanel />
        </div>
      )}

      {/* Settings tab — Scrollable content */}
      {activeTab === "settings" && <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">

        {/* Voice — the star section */}
        <KawaiiCard icon="~" title={t("settings.voiceTitle")} subtitle={t("settings.voiceSubtitle")}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["edge", "openai", "elevenlabs"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    const defaultVoice = DEFAULT_VOICE[p] ?? "";
                    updateConfig((c) => ({
                      ...c,
                      tts: { ...c.tts, provider: p, voice: defaultVoice },
                    }));
                  }}
                  className={`kawaii-chip ${config.tts.provider === p ? "active" : ""}`}
                >
                  {p === "edge" && t("settings.edgeFree")}
                  {p === "openai" && "OpenAI"}
                  {p === "elevenlabs" && "ElevenLabs"}
                </button>
              ))}
            </div>

            <div>
              <label className="kawaii-label">{t("settings.voiceLabel")}</label>
              {voiceOptions.length > 0 ? (
                <select
                  value={config.tts.voice}
                  onChange={(e) =>
                    updateConfig((c) => ({ ...c, tts: { ...c.tts, voice: e.target.value } }))
                  }
                  className="kawaii-input kawaii-select"
                >
                  {voiceOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={config.tts.voice}
                  onChange={(e) =>
                    updateConfig((c) => ({ ...c, tts: { ...c.tts, voice: e.target.value } }))
                  }
                  placeholder="Voice ID"
                  className="kawaii-input"
                />
              )}
            </div>

            <div>
              <label className="kawaii-label">
                {t("settings.speed")}
                <span className="kawaii-badge ml-2">{config.tts.speed.toFixed(1)}x</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config.tts.speed}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    tts: { ...c.tts, speed: parseFloat(e.target.value) },
                  }))
                }
                className="kawaii-slider w-full"
              />
            </div>
          </div>
        </KawaiiCard>

        {/* Connections */}
        <KawaiiCard
          icon="~"
          title={t("settings.connectionsTitle")}
          subtitle={t("settings.connectedCount", { n: connectedCount })}
        >
          <div className="space-y-0">
            {clients.map((client) => {
              const installed = hookStatus[client.id] ?? false;
              const isLoading = hookLoading[client.id] ?? false;
              return (
                <div
                  key={client.id}
                  className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 border-b border-white/[0.03] last:border-b-0"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                        installed
                          ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]"
                          : "bg-white/10"
                      }`}
                    />
                    <span className="text-[13px] text-white/65">{client.name}</span>
                  </div>
                  <button
                    onClick={() => handleHookToggle(client.id, installed)}
                    disabled={isLoading}
                    className={`kawaii-toggle-btn ${installed ? "connected" : ""}`}
                  >
                    {isLoading ? (
                      <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                    ) : installed ? (
                      t("settings.connected")
                    ) : (
                      t("settings.connect")
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </KawaiiCard>

        {/* Rage mode — auto confirm */}
        <KawaiiCard icon="~" title={t("settings.rageTitle")} subtitle={t("settings.rageSubtitle")}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/60">{t("settings.rageDesc")}</span>
            <button
              onClick={() =>
                updateConfig((c) => ({
                  ...c,
                  ui: { ...c.ui, auto_confirm: !c.ui.auto_confirm },
                }))
              }
              className={`kawaii-toggle-btn ${config.ui.auto_confirm ? "connected" : ""}`}
            >
              {config.ui.auto_confirm ? t("settings.rageOn") : t("settings.rageOff")}
            </button>
          </div>
        </KawaiiCard>

        <KawaiiCard icon="☾" title={t("settings.awakeTitle")} subtitle={t("settings.awakeSubtitle")}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-white/60">
              {wakeStatus?.enabled ? t("settings.awakeActive") : t("settings.awakeDesc")}
            </span>
            <button
              type="button"
              onClick={handleAwakeToggle}
              disabled={wakeLoading || wakeStatus?.available === false}
              className={`kawaii-toggle-btn ${wakeStatus?.enabled ? "connected" : ""}`}
            >
              {wakeLoading
                ? t("settings.awakeChanging")
                : wakeStatus?.enabled
                  ? t("settings.awakeOn")
                  : t("settings.awakeOff")}
            </button>
          </div>
        </KawaiiCard>

        <KawaiiCard icon="↻" title={t("settings.launchAtLoginTitle")} subtitle={t("settings.launchAtLoginSubtitle")}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-white/60">
              {launchAtLogin ? t("settings.launchAtLoginActive") : t("settings.launchAtLoginDesc")}
            </span>
            <button
              type="button"
              onClick={handleLaunchAtLoginToggle}
              disabled={launchAtLoginLoading}
              className={`kawaii-toggle-btn ${launchAtLogin ? "connected" : ""}`}
            >
              {launchAtLoginLoading
                ? t("settings.launchAtLoginChanging")
                : launchAtLogin
                  ? t("settings.launchAtLoginOn")
                  : t("settings.launchAtLoginOff")}
            </button>
          </div>
        </KawaiiCard>

        <KawaiiCard icon="!" title={t("settings.notificationsTitle")} subtitle={t("settings.notificationsSubtitle")}>
          <div className="grid grid-cols-2 gap-2">
            {([
              ["approval", "settings.notificationApproval"],
              ["question", "settings.notificationQuestion"],
              ["completed", "settings.notificationCompleted"],
              ["message", "settings.notificationMessage"],
            ] as const).map(([kind, label]) => {
              const enabled = config.ui.notifications?.[kind] !== false;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => updateConfig((current) => ({
                    ...current,
                    ui: {
                      ...current.ui,
                      notifications: {
                        approval: current.ui.notifications?.approval !== false,
                        question: current.ui.notifications?.question !== false,
                        completed: current.ui.notifications?.completed !== false,
                        message: current.ui.notifications?.message !== false,
                        [kind]: !enabled,
                      },
                    },
                  }))}
                  className={`kawaii-chip ${enabled ? "active" : ""}`}
                  aria-pressed={enabled}
                >
                  {t(label)}
                </button>
              );
            })}
          </div>
        </KawaiiCard>

        <KawaiiCard icon="♪" title={t("settings.soundTitle")} subtitle={t("settings.soundSubtitle")}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-white/60">{t("settings.soundEnabled")}</span>
              <button
                type="button"
                onClick={() => updateConfig((current) => ({
                  ...current,
                  ui: {
                    ...current.ui,
                    sounds: { ...soundPreferences, enabled: !soundPreferences.enabled },
                  },
                }))}
                className={`kawaii-toggle-btn ${soundPreferences.enabled ? "connected" : ""}`}
                aria-pressed={soundPreferences.enabled}
              >
                {soundPreferences.enabled ? t("settings.soundOn") : t("settings.soundOff")}
              </button>
            </div>

            <div className="flex gap-2">
              <select
                value={soundPreferences.pack_path ?? ""}
                onChange={(event) => event.target.value
                  ? void selectDiscoveredSoundPack(event.target.value)
                  : void clearSoundPack()}
                disabled={soundPackLoading}
                className="kawaii-input min-w-0 flex-1"
                aria-label={t("settings.soundPack")}
              >
                <option value="">{t("settings.soundBuiltIn")}</option>
                {soundPacks.map((pack) => (
                  <option key={pack.path} value={pack.path}>{pack.display_name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={chooseSoundPack}
                disabled={soundPackLoading}
                className="kawaii-icon-btn"
                title={t("settings.soundImport")}
                aria-label={t("settings.soundImport")}
              >
                <FolderOpen size={15} />
              </button>
              {soundPreferences.pack_path && (
                <button
                  type="button"
                  onClick={() => void clearSoundPack()}
                  className="kawaii-icon-btn"
                  title={t("settings.soundClear")}
                  aria-label={t("settings.soundClear")}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {([
                ["processingStarted", "processing_started", "settings.soundProcessing"],
                ["attentionRequired", "attention_required", "settings.soundAttention"],
                ["taskCompleted", "task_completed", "settings.soundCompleted"],
                ["error", "error", "settings.soundError"],
                ["resourceLimit", "resource_limit", "settings.soundResourceLimit"],
              ] as const).map(([soundEvent, key, label]) => {
                const enabled = soundPreferences[key];
                return (
                  <div key={soundEvent} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateConfig((current) => ({
                        ...current,
                        ui: {
                          ...current.ui,
                          sounds: { ...soundPreferences, [key]: !enabled },
                        },
                      }))}
                      className={`kawaii-chip flex-1 ${enabled ? "active" : ""}`}
                      aria-pressed={enabled}
                    >
                      {t(label)}
                    </button>
                    <button
                      type="button"
                      onClick={() => playSound(soundEvent, soundPreferences, true)}
                      className="kawaii-icon-btn"
                      title={t("settings.soundPreview")}
                      aria-label={`${t("settings.soundPreview")} ${t(label)}`}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </KawaiiCard>

        <KawaiiCard icon="H" title={t("settings.mascotTitle")} subtitle={t("settings.mascotSubtitle")}>
          <div className="space-y-2">
            {Object.keys(mascotOverrides).length > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => updateConfig((current) => ({
                    ...current,
                    ui: { ...current.ui, mascot_overrides: {} },
                  }))}
                  className="kawaii-icon-btn"
                  title={t("settings.mascotResetAll")}
                  aria-label={t("settings.mascotResetAll")}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            )}
            {mascotClients.map((client) => {
              const theme = resolveMascotTheme(client.id, mascotOverrides);
              return (
                <div key={client.id} className="flex items-center gap-2 min-w-0">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-white/80 text-[9px] font-bold"
                    style={{ borderColor: theme.accent, color: theme.accent }}
                    title={theme.label}
                  >
                    {theme.icon ? (
                      <img src={theme.icon} alt="" className="h-5 w-5 object-contain" />
                    ) : (
                      theme.monogram
                    )}
                  </span>
                  <span className="w-24 shrink-0 truncate text-xs text-white/65" title={client.name}>
                    {client.name}
                  </span>
                  <select
                    value={mascotOverrides[client.id] ?? ""}
                    onChange={(event) => updateConfig((current) => {
                      const nextOverrides = { ...(current.ui.mascot_overrides ?? {}) };
                      if (event.target.value) nextOverrides[client.id] = event.target.value;
                      else delete nextOverrides[client.id];
                      return {
                        ...current,
                        ui: { ...current.ui, mascot_overrides: nextOverrides },
                      };
                    })}
                    className="kawaii-input min-w-0 flex-1 py-2"
                    aria-label={`${client.name} ${t("settings.mascotAppearance")}`}
                  >
                    <option value="">{t("settings.mascotAutomatic", { name: resolveMascotTheme(client.id).label })}</option>
                    {MASCOT_THEMES.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </KawaiiCard>

        <KawaiiCard icon="⇄" title={t("settings.remoteTitle")} subtitle={t("settings.remoteSubtitle")}>
          <div className="space-y-2.5">
            <input
              type="text"
              value={remoteTarget}
              onChange={(event) => setRemoteTarget(event.target.value)}
              disabled={remoteLoading || remoteBridge?.status === "connected"}
              placeholder="user@trusted-host"
              className="kawaii-input"
              autoCapitalize="none"
              autoCorrect="off"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-white/60">
                {remoteBridge?.status === "connected"
                  ? t("settings.remoteActive", { target: remoteBridge.target ?? remoteTarget })
                  : t("settings.remoteDesc")}
              </span>
              <button
                type="button"
                onClick={handleRemoteBridgeToggle}
                disabled={remoteLoading || (remoteBridge?.status !== "connected" && !remoteTarget.trim())}
                className={`kawaii-toggle-btn ${remoteBridge?.status === "connected" ? "connected" : ""}`}
              >
                {remoteLoading
                  ? t("settings.remoteChanging")
                  : remoteBridge?.status === "connected"
                    ? t("settings.remoteDisconnect")
                    : t("settings.remoteConnect")}
              </button>
            </div>
          </div>
        </KawaiiCard>

        {/* Pi Agent — the only model configuration Humi needs */}
        <KawaiiCard icon="~" title="Pi Agent" subtitle="Humi 的聊天和理解都由 Pi 负责">
          <div className="space-y-3">
            <div>
              <label className="kawaii-label">URL</label>
              <input
                type="url"
                value={config.pi.url}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    pi: { ...c.pi, url: e.target.value },
                  }))
                }
                placeholder="https://api.openai.com/v1"
                className="kawaii-input"
              />
            </div>
            <div>
              <label className="kawaii-label">Token</label>
              <input
                type="password"
                value={config.pi.token ?? ""}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    pi: { ...c.pi, token: e.target.value || undefined },
                  }))
                }
                placeholder="输入 Token"
                className="kawaii-input"
              />
            </div>
            <div>
              <label className="kawaii-label">model_name</label>
              <input
                type="text"
                value={config.pi.model_name}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    pi: { ...c.pi, model_name: e.target.value },
                  }))
                }
                placeholder="gpt-4o-mini"
                className="kawaii-input"
              />
            </div>
          </div>
        </KawaiiCard>

        {/* Advanced — collapsed by default */}
        <div className="kawaii-advanced-toggle">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="kawaii-expand-btn"
          >
            <span className="text-white/40 text-xs">
              {showAdvanced ? t("settings.collapseAdvanced") : t("settings.expandAdvanced")}
            </span>
            <span
              className={`text-white/30 text-[10px] transition-transform duration-300 ${
                showAdvanced ? "rotate-180" : ""
              }`}
            >
              ▼
            </span>
          </button>

          <div className={`collapsible ${showAdvanced ? "open" : ""}`}>
            <div className="kawaii-card mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="kawaii-label">{t("settings.language")}</label>
                  <select
                    value={config.ui.language}
                    onChange={(e) => {
                      const lang = e.target.value as "zh" | "en";
                      setLanguage(lang);
                      updateConfig((c) => ({
                        ...c,
                        ui: { ...c.ui, language: lang },
                        stt: { ...c.stt, language: LANG_TO_STT[lang] ?? "zh-CN" },
                      }));
                    }}
                    className="kawaii-input kawaii-select"
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div>
                  <label className="kawaii-label">{t("settings.sttEngine")}</label>
                  <select
                    value={config.stt.provider}
                    onChange={(e) =>
                      updateConfig((c) => ({
                        ...c,
                        stt: {
                          ...c.stt,
                          provider: e.target.value as AppConfig["stt"]["provider"],
                        },
                      }))
                    }
                    className="kawaii-input kawaii-select"
                  >
                    <option value="web-speech">{t("settings.webSpeechFree")}</option>
                    <option value="whisper">Whisper</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="kawaii-label">Edge TTS Bridge URL</label>
                <input
                  type="text"
                  value={config.tts.edge_bridge_url ?? ""}
                  onChange={(e) =>
                    updateConfig((c) => ({
                      ...c,
                      tts: { ...c.tts, edge_bridge_url: e.target.value || undefined },
                    }))
                  }
                  placeholder="http://localhost:5050"
                  className="kawaii-input"
                />
              </div>
              <div>
                <label className="kawaii-label">{t("settings.hookPort")}</label>
                <input
                  type="number"
                  value={config.hook_port}
                  onChange={(e) =>
                    updateConfig((c) => ({
                      ...c,
                      hook_port: parseInt(e.target.value) || 31275,
                    }))
                  }
                  className="kawaii-input"
                />
              </div>
            </div>
          </div>
        </div>
      </div>}

      {/* Message toast */}
      {activeTab === "settings" && message && (
        <div
          className={`mx-5 mb-2 px-4 py-2 rounded-full text-xs text-center transition-all animate-bounce-in ${
            message.type === "success"
              ? "bg-emerald-500/8 text-emerald-400/90 border border-emerald-500/15"
              : "bg-red-500/8 text-red-400/90 border border-red-500/15"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Save button */}
      {activeTab === "settings" && (
        <div className="px-5 py-4 border-t border-white/[0.03]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="kawaii-save-btn"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-3.5 h-3.5 border-2 border-current/60 border-t-transparent rounded-full animate-spin" />
                {t("settings.saving")}
              </span>
            ) : (
              t("settings.save")
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ===== Kawaii Card Component =====

function KawaiiCard({
  icon: _icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="kawaii-card">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[13px] font-semibold text-white/75">{title}</h2>
        {subtitle && (
          <span className="text-[10px] text-white/25 ml-auto">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}
