import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "@/types";
import { useTranslation } from "@/lib/i18n/react";
import { setLanguage } from "@/lib/i18n";
import { PetCanvas } from "../Pet/PetCanvas";
import { VOICE_PRESETS, DEFAULT_VOICE } from "./voicePresets";
import { StatsPanel } from "./StatsPanel";
import { MemoryPanel } from "./MemoryPanel";

interface SettingsPanelProps {
  onClose: () => void;
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

  useEffect(() => {
    (async () => {
      try {
        const [cfg, status, clientList] = await Promise.all([
          invoke<AppConfig>("get_config"),
          invoke<Record<string, boolean>>("check_hooks_status"),
          invoke<Array<{ id: string; name: string }>>("get_supported_clients"),
        ]);
        setConfig(cfg as AppConfig);
        setLanguage((cfg as AppConfig).ui.language as "zh" | "en");
        setHookStatus(status as Record<string, boolean>);
        setClients(clientList as Array<{ id: string; name: string }>);
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      await invoke("save_config", { newConfig: config });
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

        {/* API Key — compact */}
        <KawaiiCard icon="~" title={t("settings.keysTitle")} subtitle={t("settings.keysSubtitle")}>
          <div className="space-y-3">
            <div>
              <label className="kawaii-label">OpenAI API Key</label>
              <input
                type="password"
                value={config.api_keys.openai ?? ""}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    api_keys: { ...c.api_keys, openai: e.target.value || undefined },
                  }))
                }
                placeholder={t("settings.openaiPlaceholder")}
                className="kawaii-input"
              />
            </div>
            <div>
              <label className="kawaii-label">{t("settings.elevenOptional")}</label>
              <input
                type="password"
                value={config.api_keys.elevenlabs ?? ""}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    api_keys: { ...c.api_keys, elevenlabs: e.target.value || undefined },
                  }))
                }
                placeholder={t("settings.elevenPlaceholder")}
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
                <label className="kawaii-label">{t("settings.summaryModel")}</label>
                <input
                  type="text"
                  value={config.summarizer.model}
                  onChange={(e) =>
                    updateConfig((c) => ({
                      ...c,
                      summarizer: { ...c.summarizer, model: e.target.value },
                    }))
                  }
                  placeholder="gpt-4o-mini"
                  className="kawaii-input"
                />
              </div>
              <div>
                <label className="kawaii-label">Summarizer API Base</label>
                <input
                  type="text"
                  value={config.summarizer.api_base}
                  onChange={(e) =>
                    updateConfig((c) => ({
                      ...c,
                      summarizer: { ...c.summarizer, api_base: e.target.value },
                    }))
                  }
                  placeholder="https://api.openai.com/v1"
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
