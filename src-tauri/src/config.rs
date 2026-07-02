use serde::{Deserialize, Serialize};
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

    /// UI preferences
    pub ui: UiConfig,
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
#[serde(default)]
pub struct UiConfig {
    /// Pet position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
    pub position: String,
    /// Language: "zh" | "en"
    pub language: String,
    pub auto_confirm: bool,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            position: "bottom-right".to_string(),
            language: "zh".to_string(),
            auto_confirm: false,
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
            match std::fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(config) => return config,
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

    /// Save config to disk
    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
        }
        let content =
            serde_json::to_string_pretty(self).map_err(|e| format!("Failed to serialize: {}", e))?;
        std::fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))?;
        Ok(())
    }
}
