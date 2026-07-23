use crate::codex_bridge::{CodexBridgeHealth, CodexBridgeStatus};
use crate::config::BrainProvider;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrainProviderStatus {
    pub provider: BrainProvider,
    pub display_name: String,
    pub ready: bool,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HumiBrainStatus {
    pub initialized: bool,
    pub primary_provider: Option<BrainProvider>,
    pub fallback_enabled: bool,
    pub providers: Vec<BrainProviderStatus>,
}

pub fn provider_statuses(
    codex: &CodexBridgeHealth,
    qoder_transport_ready: bool,
    claude_transport_ready: bool,
) -> Vec<BrainProviderStatus> {
    let codex_ready = codex.status == CodexBridgeStatus::Connected;
    vec![
        BrainProviderStatus {
            provider: BrainProvider::Codex,
            display_name: "Codex".into(),
            ready: codex_ready,
            status: if codex_ready {
                "ready".into()
            } else {
                "unavailable".into()
            },
            detail: if codex_ready {
                codex
                    .version
                    .clone()
                    .unwrap_or_else(|| "使用 Codex 现有登录".into())
            } else {
                codex.message.clone()
            },
        },
        BrainProviderStatus {
            provider: BrainProvider::Qoder,
            display_name: "Qoder CLI".into(),
            ready: qoder_transport_ready,
            status: if qoder_transport_ready {
                "ready".into()
            } else {
                "transport_unavailable".into()
            },
            detail: if qoder_transport_ready {
                "使用 Qoder CLI 现有登录".into()
            } else {
                "尚未检测到可调用的 Qoder CLI ACP".into()
            },
        },
        BrainProviderStatus {
            provider: BrainProvider::Claude,
            display_name: "Claude Code".into(),
            ready: claude_transport_ready,
            status: if claude_transport_ready {
                "ready".into()
            } else {
                "transport_unavailable".into()
            },
            detail: if claude_transport_ready {
                "使用 Claude Code 现有登录".into()
            } else {
                "尚未检测到可调用的 Claude Code".into()
            },
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct HumiBrainSessions {
    schema_version: u32,
    sessions: BTreeMap<BrainProvider, String>,
}

impl Default for HumiBrainSessions {
    fn default() -> Self {
        Self {
            schema_version: 1,
            sessions: BTreeMap::new(),
        }
    }
}

#[derive(Debug)]
pub struct HumiBrainSessionStore {
    path: PathBuf,
    data: HumiBrainSessions,
}

impl HumiBrainSessionStore {
    pub fn load_default() -> Result<Self, String> {
        let home = dirs::home_dir().ok_or_else(|| "Home directory is unavailable".to_string())?;
        Self::load_from(home.join(".humhum").join("brain").join("sessions.json"))
    }

    pub fn load_from(path: PathBuf) -> Result<Self, String> {
        if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err("Humi brain sessions cannot be a symbolic link".into());
        }
        let data = if path.exists() {
            crate::local_api_auth::protect_owner_only(&path)?;
            let contents = std::fs::read_to_string(&path)
                .map_err(|error| format!("Could not read Humi brain sessions: {error}"))?;
            serde_json::from_str(&contents)
                .map_err(|error| format!("Could not parse Humi brain sessions: {error}"))?
        } else {
            HumiBrainSessions::default()
        };
        Ok(Self { path, data })
    }

    pub fn session(&self, provider: BrainProvider) -> Option<&str> {
        self.data.sessions.get(&provider).map(String::as_str)
    }

    pub fn set_session(&mut self, provider: BrainProvider, session_id: &str) -> Result<(), String> {
        let session_id = session_id.trim();
        if session_id.is_empty() || session_id.len() > 512 {
            return Err("Humi brain session identifier is invalid".into());
        }
        self.data.sessions.insert(provider, session_id.to_string());
        self.save()
    }

    #[cfg(test)]
    fn snapshot(&self) -> &HumiBrainSessions {
        &self.data
    }

    fn save(&self) -> Result<(), String> {
        let contents = serde_json::to_vec_pretty(&self.data)
            .map_err(|error| format!("Could not serialize Humi brain sessions: {error}"))?;
        crate::local_api_auth::write_private_file_atomically(&self.path, &contents)
            .map_err(|error| format!("Could not save Humi brain sessions: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_only_provider_session_identifiers() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("brain").join("sessions.json");
        let mut store = HumiBrainSessionStore::load_from(path.clone()).unwrap();

        store
            .set_session(BrainProvider::Codex, "thread-private")
            .unwrap();

        let reloaded = HumiBrainSessionStore::load_from(path).unwrap();
        assert_eq!(
            reloaded.session(BrainProvider::Codex),
            Some("thread-private")
        );
        let serialized = serde_json::to_value(reloaded.snapshot()).unwrap();
        assert!(serialized.to_string().contains("thread-private"));
        assert!(!serialized.to_string().contains("token"));
        assert!(!serialized.to_string().contains("prompt"));
    }

    #[test]
    fn exposes_only_transport_ready_agents_as_selectable_brains() {
        let providers = provider_statuses(
            &CodexBridgeHealth {
                status: CodexBridgeStatus::Connected,
                version: Some("codex-cli 0.105.0".into()),
                last_connected_at: None,
                message: "connected".into(),
            },
            false,
            false,
        );

        assert!(
            providers
                .iter()
                .find(|provider| provider.provider == BrainProvider::Codex)
                .unwrap()
                .ready
        );
        assert!(
            !providers
                .iter()
                .find(|provider| provider.provider == BrainProvider::Qoder)
                .unwrap()
                .ready
        );
        assert!(
            !providers
                .iter()
                .find(|provider| provider.provider == BrainProvider::Claude)
                .unwrap()
                .ready
        );
    }
}
