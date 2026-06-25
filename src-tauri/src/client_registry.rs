use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ClientProfile {
    pub id: &'static str,
    pub name: &'static str,
    pub config_format: ConfigFormat,
    pub config_path: &'static str,
    pub hook_events: &'static [&'static str],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFormat {
    Json,
    Toml,
}

pub const CLIENTS: &[ClientProfile] = &[
    ClientProfile {
        id: "claude-code",
        name: "Claude Code",
        config_format: ConfigFormat::Json,
        config_path: ".claude/settings.json",
        hook_events: &["PermissionRequest", "Stop", "TaskCompleted", "Notification"],
    },
    ClientProfile {
        id: "codex",
        name: "Codex CLI",
        config_format: ConfigFormat::Json,
        config_path: ".codex/settings.json",
        hook_events: &["PermissionRequest", "Stop", "TaskCompleted"],
    },
    ClientProfile {
        id: "qwen-code",
        name: "Qwen Code",
        config_format: ConfigFormat::Json,
        config_path: ".qwen/settings.json",
        hook_events: &["PermissionRequest", "Stop", "TaskCompleted", "Notification"],
    },
    ClientProfile {
        id: "gemini-cli",
        name: "Gemini CLI",
        config_format: ConfigFormat::Json,
        config_path: ".gemini/settings.json",
        hook_events: &["PermissionRequest", "Stop", "TaskCompleted"],
    },
    ClientProfile {
        id: "kimi-k1",
        name: "Kimi K1",
        config_format: ConfigFormat::Toml,
        config_path: ".kimi/config.toml",
        hook_events: &["PermissionRequest", "Stop", "TaskCompleted"],
    },
];

pub fn get_client(id: &str) -> Option<&'static ClientProfile> {
    CLIENTS.iter().find(|c| c.id == id)
}

pub fn get_all_clients() -> &'static [ClientProfile] {
    CLIENTS
}
