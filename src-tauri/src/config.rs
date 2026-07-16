use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

/// Application configuration stored on disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// HumHum local server port for receiving hook events
    pub hook_port: u16,

    /// API keys for various services (BYOK)
    pub api_keys: ApiKeys,

    /// TTS configuration
    pub tts: TtsConfig,

    /// STT configuration
    pub stt: SttConfig,

    /// LLM summarizer configuration
    pub summarizer: SummarizerConfig,

    /// Pi Agent provider configuration (the single source for Humi's Agent runtime)
    #[serde(default)]
    pub pi: PiConfig,

    #[serde(default)]
    pub mobile_relay: MobileRelayConfig,

    /// UI preferences
    pub ui: UiConfig,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttConfig {
    /// Which STT provider: "web-speech" | "whisper"
    pub provider: String,
    /// Language hint for recognition
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizerConfig {
    /// OpenAI-compatible API base URL
    pub api_base: String,
    /// Model name (e.g., "gpt-4o-mini")
    pub model: String,
    /// Max tokens for summary
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
            pi: PiConfig::default(),
            mobile_relay: MobileRelayConfig::default(),
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
    use super::AppConfig;

    #[test]
    fn defaults_include_a_single_pi_provider_configuration() {
        let config = AppConfig::default();

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
    }
}
