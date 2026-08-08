use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

/// Application configuration stored on disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// HumHum local server port for receiving hook events.
    ///
    /// Every field carries `#[serde(default)]` on purpose: a config written by
    /// an older/newer build (or hand-edited) that is missing a single field
    /// must NOT fail the whole parse — that path resets the entire config to
    /// defaults and, on the next save(), silently overwrites the user's saved
    /// API keys and settings. Missing fields degrade to their own defaults.
    #[serde(default = "default_hook_port")]
    pub hook_port: u16,

    /// API keys for various services (BYOK)
    #[serde(default)]
    pub api_keys: ApiKeys,

    /// TTS configuration
    #[serde(default)]
    pub tts: TtsConfig,

    /// STT configuration
    #[serde(default)]
    pub stt: SttConfig,

    /// LLM summarizer configuration
    #[serde(default)]
    pub summarizer: SummarizerConfig,

    /// Humi's selected host Agent. Provider credentials stay with the provider.
    #[serde(default)]
    pub brain: BrainConfig,

    /// Optional Pi fallback configuration.
    #[serde(default)]
    pub pi: PiConfig,

    #[serde(default)]
    pub mobile_relay: MobileRelayConfig,

    /// Restore the phone bridge after HUMHUM restarts.
    #[serde(default)]
    pub mobile_access_enabled: bool,

    /// UI preferences
    #[serde(default)]
    pub ui: UiConfig,
}

fn default_hook_port() -> u16 {
    31275
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct MobileRelayConfig {
    pub enabled: bool,
    pub base_url: Option<String>,
    pub invite_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ApiKeys {
    pub openai: Option<String>,
    pub elevenlabs: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TtsConfig {
    /// Which TTS provider to use: "edge" | "openai" | "elevenlabs"
    pub provider: String,
    /// Voice ID / name
    pub voice: String,
    /// Speech speed (0.5 - 2.0)
    pub speed: f32,
    /// Model name (for OpenAI: "tts-1" | "tts-1-hd")
    pub model: Option<String>,
}

impl Default for TtsConfig {
    fn default() -> Self {
        Self {
            provider: "edge".to_string(),
            voice: "zh-CN-XiaoxiaoNeural".to_string(),
            speed: 1.0,
            model: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SttConfig {
    /// Which STT provider: "web-speech" | "whisper"
    pub provider: String,
    /// Language hint for recognition
    pub language: String,
}

impl Default for SttConfig {
    fn default() -> Self {
        Self {
            provider: "web-speech".to_string(),
            language: "zh-CN".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SummarizerConfig {
    /// OpenAI-compatible API base URL
    pub api_base: String,
    /// Model name (e.g., "gpt-4o-mini")
    pub model: String,
    /// Max tokens for summary
    pub max_tokens: u32,
}

impl Default for SummarizerConfig {
    fn default() -> Self {
        Self {
            api_base: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            max_tokens: 500,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum BrainProvider {
    Codex,
    Qoder,
    Claude,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct BrainConfig {
    pub schema_version: u32,
    pub initialized: bool,
    // A present-but-unknown provider string (e.g. a removed/renamed variant from
    // another build, "gemini") would otherwise fail the whole AppConfig parse and
    // reset every setting to defaults. Deserialize an unrecognized value to None
    // so the rest of the config survives; the user just re-picks a host agent.
    #[serde(default, deserialize_with = "deserialize_optional_brain_provider")]
    pub primary_provider: Option<BrainProvider>,
    pub fallback_enabled: bool,
}

fn deserialize_optional_brain_provider<'de, D>(
    deserializer: D,
) -> Result<Option<BrainProvider>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Accept null, a known snake_case variant, or any other string/value —
    // anything unrecognized collapses to None instead of erroring.
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| serde_json::from_value::<BrainProvider>(value).ok()))
}

impl Default for BrainConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            initialized: false,
            primary_provider: None,
            fallback_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PiConfig {
    /// OpenAI-compatible API base URL
    pub url: String,
    /// Provider token, kept local and omitted from user-facing status
    pub token: Option<String>,
    /// Provider model identifier
    pub model_name: String,
}

impl Default for PiConfig {
    fn default() -> Self {
        Self {
            url: "https://api.openai.com/v1".to_string(),
            token: None,
            model_name: "gpt-4o-mini".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    /// Pet position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
    pub position: String,
    /// Language: "zh" | "en"
    pub language: String,
    pub auto_confirm: bool,
    pub auto_confirm_sessions: BTreeSet<String>,
    pub analytics_enabled: bool,
    pub awake_mode: bool,
    pub notifications: NotificationPreferences,
    pub sounds: SoundPreferences,
    pub mascot_overrides: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct NotificationPreferences {
    pub approval: bool,
    pub question: bool,
    pub completed: bool,
    pub message: bool,
}

impl Default for NotificationPreferences {
    fn default() -> Self {
        Self {
            approval: true,
            question: true,
            completed: true,
            message: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SoundPreferences {
    pub enabled: bool,
    pub pack_path: Option<String>,
    pub processing_started: bool,
    pub attention_required: bool,
    pub task_completed: bool,
    pub error: bool,
    pub resource_limit: bool,
}

impl Default for SoundPreferences {
    fn default() -> Self {
        Self {
            enabled: true,
            pack_path: None,
            processing_started: true,
            attention_required: true,
            task_completed: true,
            error: true,
            resource_limit: true,
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            position: "bottom-right".to_string(),
            language: "zh".to_string(),
            auto_confirm: false,
            auto_confirm_sessions: BTreeSet::new(),
            analytics_enabled: true,
            awake_mode: false,
            notifications: NotificationPreferences::default(),
            sounds: SoundPreferences::default(),
            mascot_overrides: BTreeMap::new(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hook_port: 31275,
            api_keys: ApiKeys::default(),
            tts: TtsConfig {
                provider: "edge".to_string(),
                voice: "zh-CN-XiaoxiaoNeural".to_string(),
                speed: 1.0,
                model: None,
            },
            stt: SttConfig {
                provider: "web-speech".to_string(),
                language: "zh-CN".to_string(),
            },
            summarizer: SummarizerConfig {
                api_base: "https://api.openai.com/v1".to_string(),
                model: "gpt-4o-mini".to_string(),
                max_tokens: 500,
            },
            brain: BrainConfig::default(),
            pi: PiConfig::default(),
            mobile_relay: MobileRelayConfig::default(),
            mobile_access_enabled: false,
            ui: UiConfig::default(),
        }
    }
}

impl AppConfig {
    /// Get the config file path
    fn config_path() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".humhum").join("config.json")
    }

    /// Load config from disk, or return default
    pub fn load(_app_handle: &tauri::AppHandle) -> Self {
        let path = Self::config_path();

        // Migrate ~/.devpod → ~/.humhum if needed
        if !path.parent().map(|p| p.exists()).unwrap_or(false) {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            let old_dir = home.join(".devpod");
            if old_dir.exists() {
                let new_dir = home.join(".humhum");
                if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
                    log::warn!("Failed to migrate ~/.devpod → ~/.humhum: {}", e);
                } else {
                    log::info!("Migrated ~/.devpod → ~/.humhum");
                }
            }
        }

        if path.exists() {
            if std::fs::symlink_metadata(&path)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                log::warn!("Refusing to read a symbolic-link HUMHUM config");
                return Self::default();
            }
            if let Err(error) = crate::local_api_auth::protect_owner_only(&path) {
                log::warn!("Failed to protect config before reading it: {error}");
            }
            match std::fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
                    Ok(mut config) => {
                        config.migrate_legacy_pi_config();
                        let mobile_access_is_explicit =
                            serde_json::from_str::<serde_json::Value>(&content)
                                .ok()
                                .and_then(|value| {
                                    value
                                        .as_object()
                                        .map(|object| object.contains_key("mobile_access_enabled"))
                                })
                                .unwrap_or(false);
                        if config.migrate_legacy_mobile_access(mobile_access_is_explicit) {
                            if let Err(error) = config.save() {
                                log::warn!(
                                    "Could not persist the migrated mobile access preference: {error}"
                                );
                            }
                        }
                        return config;
                    }
                    Err(e) => {
                        log::warn!("Failed to parse config: {}, using defaults", e);
                    }
                },
                Err(e) => {
                    log::warn!("Failed to read config: {}, using defaults", e);
                }
            }
        }
        Self::default()
    }

    pub fn migrate_legacy_pi_config(&mut self) {
        let defaults = PiConfig::default();
        if self.pi.url == defaults.url && self.summarizer.api_base != defaults.url {
            self.pi.url = self.summarizer.api_base.clone();
        }
        if self.pi.model_name == defaults.model_name && self.summarizer.model != defaults.model_name
        {
            self.pi.model_name = self.summarizer.model.clone();
        }
        if self.pi.token.is_none() {
            self.pi.token = self.api_keys.openai.clone();
        }
    }

    pub fn migrate_legacy_mobile_access(&mut self, mobile_access_is_explicit: bool) -> bool {
        if !mobile_access_is_explicit && self.mobile_relay.enabled && !self.mobile_access_enabled {
            self.mobile_access_enabled = true;
            true
        } else {
            false
        }
    }

    /// Save config to disk
    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
        }
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        crate::local_api_auth::write_private_file_atomically(&path, content.as_bytes())
            .map_err(|e| format!("Failed to atomically write private config: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::{AppConfig, BrainProvider};

    #[test]
    fn defaults_require_an_explicit_host_agent_brain_selection() {
        let config = AppConfig::default();

        assert_eq!(config.brain.schema_version, 1);
        assert!(!config.brain.initialized);
        assert_eq!(config.brain.primary_provider, None);
        assert!(!config.brain.fallback_enabled);
        assert_eq!(config.pi.url, "https://api.openai.com/v1");
        assert_eq!(config.pi.model_name, "gpt-4o-mini");
        assert_eq!(config.pi.token, None);
        assert!(config.ui.notifications.approval);
        assert!(config.ui.notifications.question);
        assert!(config.ui.notifications.completed);
        assert!(config.ui.notifications.message);
        assert!(config.ui.sounds.enabled);
        assert!(config.ui.sounds.pack_path.is_none());
        assert!(config.ui.mascot_overrides.is_empty());
        assert!(config.ui.auto_confirm_sessions.is_empty());
        assert!(config.ui.analytics_enabled);
        assert!(!config.mobile_relay.enabled);
        assert_eq!(config.mobile_relay.base_url, None);
        assert!(!config.mobile_access_enabled);
    }

    #[test]
    fn persists_a_selected_host_agent_without_copying_credentials() {
        let mut config = AppConfig::default();
        config.brain.initialized = true;
        config.brain.primary_provider = Some(BrainProvider::Codex);

        let saved = serde_json::to_value(&config).unwrap();

        assert_eq!(saved["brain"]["primary_provider"], "codex");
        assert!(saved["brain"].get("token").is_none());
        assert!(saved["brain"].get("url").is_none());
    }

    #[test]
    fn legacy_provider_fields_are_migrated_into_pi_configuration() {
        let mut config: AppConfig = serde_json::from_value(serde_json::json!({
            "hook_port": 31275,
            "api_keys": { "openai": "legacy-token" },
            "tts": {
                "provider": "edge",
                "voice": "zh-CN-XiaoxiaoNeural",
                "speed": 1.0,
                "model": null
            },
            "stt": { "provider": "web-speech", "language": "zh-CN" },
            "summarizer": {
                "api_base": "https://gateway.example/v1",
                "model": "gateway-model",
                "max_tokens": 500
            },
            "ui": { "position": "bottom-right", "language": "zh", "auto_confirm": false }
        }))
        .expect("legacy config should deserialize");

        config.migrate_legacy_pi_config();

        assert_eq!(config.pi.url, "https://gateway.example/v1");
        assert_eq!(config.pi.model_name, "gateway-model");
        assert_eq!(config.pi.token.as_deref(), Some("legacy-token"));
        assert!(config.ui.notifications.approval);
        assert!(config.ui.auto_confirm_sessions.is_empty());
        assert!(config.ui.analytics_enabled);
        assert!(!config.mobile_relay.enabled);
        assert_eq!(config.mobile_relay.base_url, None);
        assert!(!config.mobile_access_enabled);
    }

    #[test]
    fn legacy_anywhere_users_restore_mobile_access_after_restart() {
        let mut config = AppConfig::default();
        config.mobile_relay.enabled = true;

        let migrated = config.migrate_legacy_mobile_access(false);

        assert!(migrated);
        assert!(config.mobile_access_enabled);
    }

    #[test]
    fn explicit_mobile_access_choice_is_never_overridden_by_migration() {
        let mut config = AppConfig::default();
        config.mobile_relay.enabled = true;
        config.mobile_access_enabled = false;

        let migrated = config.migrate_legacy_mobile_access(true);

        assert!(!migrated);
        assert!(!config.mobile_access_enabled);
    }

    // Regression: a config missing whole sections (older/newer build, hand edit)
    // must deserialize by filling defaults, NOT fail the parse and reset every
    // setting — which would clobber saved API keys on the next save().
    #[test]
    fn partial_config_preserves_present_fields_and_defaults_the_rest() {
        let config: AppConfig = serde_json::from_value(serde_json::json!({
            "api_keys": { "openai": "keep-me", "elevenlabs": "keep-me-too" }
        }))
        .expect("a config missing most fields must still deserialize");

        // Present fields survive.
        assert_eq!(config.api_keys.openai.as_deref(), Some("keep-me"));
        assert_eq!(config.api_keys.elevenlabs.as_deref(), Some("keep-me-too"));
        // Missing fields fall back to their own defaults.
        assert_eq!(config.hook_port, 31275);
        assert_eq!(config.tts.provider, "edge");
        assert_eq!(config.stt.provider, "web-speech");
        assert_eq!(config.summarizer.api_base, "https://api.openai.com/v1");
        assert_eq!(config.ui.position, "bottom-right");
    }

    // Regression: a present-but-unknown host-agent string (e.g. a variant from a
    // different build) must degrade to None, not fail the whole AppConfig parse.
    #[test]
    fn unknown_brain_provider_degrades_to_none_without_losing_config() {
        let config: AppConfig = serde_json::from_value(serde_json::json!({
            "api_keys": { "openai": "keep-me" },
            "brain": {
                "schema_version": 1,
                "initialized": true,
                "primary_provider": "gemini",
                "fallback_enabled": false
            }
        }))
        .expect("an unknown provider must not fail the whole config parse");

        assert_eq!(config.brain.primary_provider, None);
        assert_eq!(config.api_keys.openai.as_deref(), Some("keep-me"));

        // A known value still round-trips.
        let ok: AppConfig = serde_json::from_value(serde_json::json!({
            "brain": { "primary_provider": "claude" }
        }))
        .unwrap();
        assert_eq!(ok.brain.primary_provider, Some(BrainProvider::Claude));
    }
}
