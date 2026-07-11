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
        hook_events: &[
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "PermissionRequest",
            "Notification",
            "Stop",
            "TaskCompleted",
            "SubagentStart",
            "SubagentStop",
            "SessionStart",
            "SessionEnd",
            "PreCompact",
        ],
    },
    ClientProfile {
        id: "codex",
        name: "Codex CLI",
        config_format: ConfigFormat::Json,
        config_path: ".codex/hooks.json",
        hook_events: &["PermissionRequest", "Stop", "TaskCompleted"],
    },
    ClientProfile {
        id: "qwen-code",
        name: "Qwen Code",
        config_format: ConfigFormat::Json,
        config_path: ".qwen/settings.json",
        hook_events: &[
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "PermissionRequest",
            "Notification",
            "Stop",
            "TaskCompleted",
            "SubagentStart",
            "SubagentStop",
            "SessionStart",
            "SessionEnd",
            "PreCompact",
        ],
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
    ClientProfile {
        id: "qoderwork",
        name: "QoderWork",
        config_format: ConfigFormat::Json,
        config_path: ".qoderwork/settings.json",
        hook_events: &[
            "PermissionRequest",
            "Stop",
            "Notification",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "SessionStart",
            "SessionEnd",
        ],
    },
    ClientProfile {
        id: "qoder",
        name: "Qoder",
        config_format: ConfigFormat::Json,
        config_path: ".qoder/settings.json",
        hook_events: &[
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "PermissionRequest",
            "Notification",
            "Stop",
            "SessionStart",
            "SessionEnd",
        ],
    },
    ClientProfile {
        id: "codebuddy",
        name: "CodeBuddy",
        config_format: ConfigFormat::Json,
        config_path: ".codebuddy/settings.json",
        hook_events: &[
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "PermissionRequest",
            "Notification",
            "Stop",
            "SubagentStop",
            "SessionStart",
            "SessionEnd",
            "PreCompact",
        ],
    },
    ClientProfile {
        id: "workbuddy",
        name: "WorkBuddy",
        config_format: ConfigFormat::Json,
        config_path: ".workbuddy/settings.json",
        hook_events: &[
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "PermissionRequest",
            "Notification",
            "Stop",
            "SubagentStop",
            "SessionStart",
            "SessionEnd",
            "PreCompact",
        ],
    },
];

pub fn get_client(id: &str) -> Option<&'static ClientProfile> {
    CLIENTS.iter().find(|c| c.id == id)
}

pub fn get_all_clients() -> &'static [ClientProfile] {
    CLIENTS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_verified_claude_compatible_clients() {
        for id in ["claude-code", "qoder", "codebuddy", "workbuddy"] {
            assert!(get_client(id).is_some(), "missing client profile: {id}");
        }
    }

    #[test]
    fn supervision_profiles_capture_progress_and_lifecycle_events() {
        for id in [
            "claude-code",
            "qwen-code",
            "qoder",
            "codebuddy",
            "workbuddy",
        ] {
            let profile = get_client(id).unwrap();
            assert!(
                profile.hook_events.contains(&"PreToolUse"),
                "{id} lacks PreToolUse"
            );
            assert!(
                profile.hook_events.contains(&"PostToolUse"),
                "{id} lacks PostToolUse"
            );
            assert!(
                profile.hook_events.contains(&"SessionStart"),
                "{id} lacks SessionStart"
            );
            assert!(
                profile.hook_events.contains(&"SessionEnd"),
                "{id} lacks SessionEnd"
            );
        }
    }
}
