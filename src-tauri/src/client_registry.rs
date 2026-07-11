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
    FlatJson,
    CopilotJson,
    OpenCodePlugin,
    HermesPlugin,
    OpenClawHook,
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
    ClientProfile {
        id: "cursor",
        name: "Cursor",
        config_format: ConfigFormat::FlatJson,
        config_path: ".cursor/hooks.json",
        hook_events: &[
            "sessionStart",
            "sessionEnd",
            "beforeSubmitPrompt",
            "preToolUse",
            "postToolUse",
            "stop",
            "subagentStart",
            "subagentStop",
            "preCompact",
        ],
    },
    ClientProfile {
        id: "github-copilot",
        name: "GitHub Copilot CLI",
        config_format: ConfigFormat::CopilotJson,
        config_path: ".copilot/hooks/humhum.json",
        hook_events: &[
            "sessionStart",
            "sessionEnd",
            "userPromptSubmitted",
            "preToolUse",
            "postToolUse",
            "agentStop",
            "subagentStop",
            "errorOccurred",
        ],
    },
    ClientProfile {
        id: "opencode",
        name: "OpenCode",
        config_format: ConfigFormat::OpenCodePlugin,
        config_path: ".config/opencode/plugins/humhum.ts",
        hook_events: &[
            "session.created",
            "session.idle",
            "session.error",
            "permission.asked",
            "tool.execute.before",
            "tool.execute.after",
        ],
    },
    ClientProfile {
        id: "hermes",
        name: "Hermes Agent",
        config_format: ConfigFormat::HermesPlugin,
        config_path: ".hermes/plugins/humhum",
        hook_events: &[
            "on_session_start",
            "pre_llm_call",
            "pre_tool_call",
            "post_tool_call",
            "post_llm_call",
            "on_session_end",
            "on_session_finalize",
            "on_session_reset",
        ],
    },
    ClientProfile {
        id: "openclaw",
        name: "OpenClaw",
        config_format: ConfigFormat::OpenClawHook,
        config_path: ".openclaw/hooks/humhum-openclaw",
        hook_events: &["command", "message", "session"],
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
        for id in [
            "claude-code",
            "qoder",
            "codebuddy",
            "workbuddy",
            "cursor",
            "github-copilot",
            "opencode",
        ] {
            assert!(get_client(id).is_some(), "missing client profile: {id}");
        }
    }

    #[test]
    fn includes_hermes_plugin_profile() {
        let profile = get_client("hermes").expect("missing Hermes client profile");

        assert!(matches!(profile.config_format, ConfigFormat::HermesPlugin));
        assert_eq!(profile.config_path, ".hermes/plugins/humhum");
        assert!(profile.hook_events.contains(&"pre_tool_call"));
        assert!(profile.hook_events.contains(&"on_session_finalize"));
    }

    #[test]
    fn includes_openclaw_internal_hook_profile() {
        let profile = get_client("openclaw").expect("missing OpenClaw client profile");

        assert!(matches!(profile.config_format, ConfigFormat::OpenClawHook));
        assert_eq!(profile.config_path, ".openclaw/hooks/humhum-openclaw");
        assert_eq!(profile.hook_events, ["command", "message", "session"]);
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
