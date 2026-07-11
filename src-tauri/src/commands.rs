use crate::agent_kernel::{self, AgentKernelStatus};
use crate::client_registry::{self, ConfigFormat};
use crate::codex_bridge::{
    ApprovalDecision, CodexBridgeHealth, CodexBridgeState, CodexRemoteControlState,
    CodexRemotePairing,
};
use crate::config::AppConfig;
use crate::event_bus::{self, HookEvent, PermissionDecision};
use crate::git_changes::GitChangeSummary;
use crate::hexa_protocol::HexaSessionProjection;
use crate::hook_server::PendingMap;
use crate::hush_store::{HushInboxSummary, HushStore};
use crate::intervention_queue::{InterventionProvider, InterventionQueue, QueuedIntervention};
use crate::knowledge_store::{AgentAsset, AgentAssetRootDiagnostic, KnowledgeStore, Preference};
use crate::mobile_bridge::{
    MobileBridgeState, MobileBridgeStatus, MobileDeviceScope, MobilePairingInfo,
};
use crate::pi_sidecar::{self, PiSessionStatus, PiSidecarState, PiStartOptions};
use crate::remote_bridge::{RemoteBridgeState, RemoteBridgeStatus};
use crate::session_store::{Session, SessionStatus, SessionStore};
use crate::stats_store::StatsStore;
use crate::wake_guard::{WakeGuardState, WakeGuardStatus};
use crate::window_focus;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet, VecDeque};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command;

const HUMHUM_HOOK_SCRIPT: &str = include_str!("../../hooks/humhum-hook.sh");
const HUMHUM_OPENCODE_PLUGIN: &str = include_str!("../../hooks/humhum-opencode-plugin.ts");

#[tauri::command]
pub async fn get_remote_bridge_status(
    state: State<'_, Arc<RemoteBridgeState>>,
) -> Result<RemoteBridgeStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn connect_remote_bridge(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    state: State<'_, Arc<RemoteBridgeState>>,
    target: String,
) -> Result<RemoteBridgeStatus, String> {
    let local_port = config
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?
        .hook_port;
    state.connect(&target, local_port).await
}

#[tauri::command]
pub async fn disconnect_remote_bridge(
    state: State<'_, Arc<RemoteBridgeState>>,
) -> Result<RemoteBridgeStatus, String> {
    state.disconnect().await
}

#[tauri::command]
pub async fn get_launch_at_login(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod client_hook_install_tests {
    use super::*;

    #[test]
    fn cursor_hooks_are_flat_and_preserve_existing_entries() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("hooks.json");
        std::fs::write(
            &path,
            r#"{"hooks":{"preToolUse":[{"command":"user-hook"}]}}"#,
        )
        .unwrap();

        install_flat_json_hooks(
            &path,
            "'/tmp/humhum-hook.sh' --client 'cursor'",
            &["preToolUse", "sessionStart", "preCompact"],
            false,
        )
        .unwrap();

        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["version"], 1);
        assert_eq!(value["hooks"]["preToolUse"].as_array().unwrap().len(), 2);
        let managed = &value["hooks"]["preToolUse"][1];
        assert_eq!(managed["matcher"], "*");
        assert!(managed.get("type").is_none());
        assert!(managed["command"].as_str().unwrap().contains("PreToolUse"));
        assert!(value["hooks"]["preCompact"][0]["command"]
            .as_str()
            .unwrap()
            .contains("PreCompact"));

        uninstall_flat_json_hooks(&path, &["preToolUse", "sessionStart", "preCompact"], false)
            .unwrap();
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["hooks"]["preToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(value["hooks"]["preToolUse"][0]["command"], "user-hook");
    }

    #[test]
    fn copilot_hooks_use_versioned_bash_entries() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("humhum.json");

        install_flat_json_hooks(
            &path,
            "'/tmp/humhum-hook.sh' --client 'github-copilot'",
            &["userPromptSubmitted", "errorOccurred"],
            true,
        )
        .unwrap();

        let value: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(value["version"], 1);
        assert!(value["hooks"]["userPromptSubmitted"][0]["bash"]
            .as_str()
            .unwrap()
            .contains("UserPromptSubmit"));
        assert!(value["hooks"]["errorOccurred"][0]["bash"]
            .as_str()
            .unwrap()
            .contains("PostToolUseFailure"));
        assert_eq!(value["hooks"]["errorOccurred"][0]["timeoutSec"], 10);
    }

    #[test]
    fn opencode_plugin_uses_runtime_token_without_embedding_it() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("plugins/humhum.ts");

        install_opencode_plugin(&path, 31_275).unwrap();

        let source = std::fs::read_to_string(&path).unwrap();
        assert!(source.contains("HUMHUM_OPENCODE_PLUGIN"));
        assert!(source.contains("127.0.0.1:31275"));
        assert!(source.contains("local-api-token"));
        assert!(!source.contains("__HUMHUM_PORT__"));
        uninstall_opencode_plugin(&path).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn opencode_plugin_bridges_permission_decisions_through_the_official_api() {
        assert!(HUMHUM_OPENCODE_PLUGIN.contains(r#""permission.asked": "PermissionRequest""#));
        assert!(HUMHUM_OPENCODE_PLUGIN.contains(r#""session.deleted": "SessionEnd""#));
        assert!(HUMHUM_OPENCODE_PLUGIN.contains("postSessionIdPermissionsPermissionId"));
        assert!(HUMHUM_OPENCODE_PLUGIN.contains(r#"behavior === "deny" ? "reject" : "once""#));
        assert!(HUMHUM_OPENCODE_PLUGIN.contains("permission ? 125_000 : 3000"));
        assert!(HUMHUM_OPENCODE_PLUGIN.contains(r#"typeof properties.permission === "string""#));
    }
}

#[cfg(test)]
mod session_change_tests {
    use super::*;

    #[test]
    fn change_summary_workspace_requires_a_known_session() {
        let mut store = SessionStore::new();
        store.update_from_event(&HookEvent {
            id: "event-1".into(),
            hook_event_name: "SessionStart".into(),
            session_id: "known-session".into(),
            transcript_path: None,
            cwd: Some("/tmp".into()),
            client_type: "claude-code".into(),
            payload: serde_json::json!({}),
            timestamp: "2026-07-12T00:00:00Z".into(),
        });
        let store = std::sync::Mutex::new(store);

        assert_eq!(
            change_summary_workspace(&store, "known-session").unwrap(),
            std::path::PathBuf::from("/tmp")
        );
        assert!(change_summary_workspace(&store, "unknown-session").is_err());
    }
}

#[tauri::command]
pub async fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }
    manager.is_enabled().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_mobile_bridge_status(
    state: State<'_, Arc<MobileBridgeState>>,
) -> Result<MobileBridgeStatus, String> {
    Ok(state.status())
}

#[tauri::command]
pub async fn enable_mobile_bridge(
    app: AppHandle,
    state: State<'_, Arc<MobileBridgeState>>,
) -> Result<MobileBridgeStatus, String> {
    state.inner().enable(app).await
}

#[tauri::command]
pub async fn disable_mobile_bridge(
    state: State<'_, Arc<MobileBridgeState>>,
) -> Result<MobileBridgeStatus, String> {
    state.disable()
}

#[tauri::command]
pub async fn start_mobile_pairing(
    state: State<'_, Arc<MobileBridgeState>>,
    scope: MobileDeviceScope,
) -> Result<MobilePairingInfo, String> {
    state.create_pairing(scope)
}

#[tauri::command]
pub async fn revoke_mobile_devices(
    state: State<'_, Arc<MobileBridgeState>>,
) -> Result<MobileBridgeStatus, String> {
    state.revoke_devices()
}

#[tauri::command]
pub async fn revoke_mobile_device(
    state: State<'_, Arc<MobileBridgeState>>,
    device_id: String,
) -> Result<MobileBridgeStatus, String> {
    state.revoke_device(&device_id)
}

#[tauri::command]
pub async fn get_wake_guard_status(
    state: State<'_, Arc<WakeGuardState>>,
) -> Result<WakeGuardStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn set_wake_guard_enabled(
    state: State<'_, Arc<WakeGuardState>>,
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    enabled: bool,
) -> Result<WakeGuardStatus, String> {
    let status = state.set_enabled(enabled).await?;
    let mut stored = config.lock().map_err(|error| error.to_string())?;
    stored.ui.awake_mode = status.enabled;
    stored.save()?;
    Ok(status)
}

#[tauri::command]
pub async fn get_codex_bridge_health(
    state: State<'_, Arc<CodexBridgeState>>,
) -> Result<CodexBridgeHealth, String> {
    Ok(state.blocking_health())
}

#[tauri::command]
pub async fn get_hexa_bridge_sessions(
    state: State<'_, Arc<CodexBridgeState>>,
) -> Result<Vec<HexaSessionProjection>, String> {
    Ok(state.sessions())
}

#[tauri::command]
pub async fn get_codex_remote_control(
    state: State<'_, Arc<CodexBridgeState>>,
) -> Result<CodexRemoteControlState, String> {
    Ok(state.remote_control())
}

#[tauri::command]
pub async fn hexa_enable_codex_remote_control(
    state: State<'_, Arc<CodexBridgeState>>,
) -> Result<CodexRemoteControlState, String> {
    state
        .enable_remote_control()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn hexa_disable_codex_remote_control(
    state: State<'_, Arc<CodexBridgeState>>,
) -> Result<CodexRemoteControlState, String> {
    state
        .disable_remote_control()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn hexa_start_codex_remote_pairing(
    state: State<'_, Arc<CodexBridgeState>>,
) -> Result<CodexRemotePairing, String> {
    state
        .start_remote_pairing()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn hexa_start_codex_thread(
    state: State<'_, Arc<CodexBridgeState>>,
    workspace: String,
) -> Result<String, String> {
    state
        .start_thread(&workspace)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn hexa_resume_codex_thread(
    state: State<'_, Arc<CodexBridgeState>>,
    thread_id: String,
) -> Result<String, String> {
    state
        .resume_thread(&thread_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn hexa_send_codex_message(
    state: State<'_, Arc<CodexBridgeState>>,
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
    thread_id: String,
    message: String,
) -> Result<CodexSendReceipt, String> {
    enqueue_and_deliver_codex_message(&state, &queue, &thread_id, &message).await
}

#[tauri::command]
pub async fn hexa_send_claude_message(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
    session_id: String,
    message: String,
) -> Result<CodexSendReceipt, String> {
    enqueue_and_deliver_cli_message(
        &store,
        &queue,
        InterventionProvider::Claude,
        &session_id,
        &message,
    )
    .await
}

#[tauri::command]
pub async fn hexa_send_opencode_message(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
    session_id: String,
    message: String,
) -> Result<CodexSendReceipt, String> {
    enqueue_and_deliver_cli_message(
        &store,
        &queue,
        InterventionProvider::OpenCode,
        &session_id,
        &message,
    )
    .await
}

pub(crate) async fn enqueue_and_deliver_cli_message(
    store: &std::sync::Mutex<SessionStore>,
    queue: &std::sync::Mutex<InterventionQueue>,
    provider: InterventionProvider,
    session_id: &str,
    message: &str,
) -> Result<CodexSendReceipt, String> {
    let (client_type, label) = match provider {
        InterventionProvider::Claude => ("claude-code", "Claude"),
        InterventionProvider::OpenCode => ("opencode", "OpenCode"),
        InterventionProvider::Codex => return Err("Codex uses the app-server transport".into()),
    };
    let workspace = cli_followup_workspace(store, session_id, client_type, label)?;
    let entry = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .enqueue_for(provider, session_id, message)?;
    let is_next = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .is_next_for_thread(&entry.id)?;
    if !is_next {
        return Ok(CodexSendReceipt {
            status: "queued".into(),
            turn_id: None,
            intervention_id: entry.id,
        });
    }
    let delivered = match provider {
        InterventionProvider::Claude => {
            deliver_queued_claude_message(queue, &entry.id, &workspace).await
        }
        InterventionProvider::OpenCode => {
            deliver_queued_opencode_message(queue, &entry.id, &workspace).await
        }
        InterventionProvider::Codex => unreachable!(),
    };
    match delivered {
        Ok(()) => Ok(CodexSendReceipt {
            status: "delivered".into(),
            turn_id: None,
            intervention_id: entry.id,
        }),
        Err(_) => Ok(CodexSendReceipt {
            status: "queued".into(),
            turn_id: None,
            intervention_id: entry.id,
        }),
    }
}

pub(crate) async fn enqueue_and_deliver_codex_message(
    state: &CodexBridgeState,
    queue: &std::sync::Mutex<InterventionQueue>,
    thread_id: &str,
    message: &str,
) -> Result<CodexSendReceipt, String> {
    let entry = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .enqueue(thread_id, message)?;
    let is_next = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .is_next_for_thread(&entry.id)?;
    if !is_next {
        return Ok(CodexSendReceipt {
            status: "queued".into(),
            turn_id: None,
            intervention_id: entry.id,
        });
    }
    match deliver_queued_codex_message(state, queue, &entry.id).await {
        Ok(turn_id) => Ok(CodexSendReceipt {
            status: "delivered".into(),
            turn_id: Some(turn_id),
            intervention_id: entry.id,
        }),
        Err(_) => Ok(CodexSendReceipt {
            status: "queued".into(),
            turn_id: None,
            intervention_id: entry.id,
        }),
    }
}

#[derive(Debug, Serialize)]
pub struct CodexSendReceipt {
    pub status: String,
    pub turn_id: Option<String>,
    pub intervention_id: String,
}

#[tauri::command]
pub async fn get_intervention_queue(
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
) -> Result<Vec<QueuedIntervention>, String> {
    Ok(queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .entries())
}

#[tauri::command]
pub async fn hexa_retry_codex_message(
    state: State<'_, Arc<CodexBridgeState>>,
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
    intervention_id: String,
) -> Result<CodexSendReceipt, String> {
    let turn_id = deliver_queued_codex_message(&state, &queue, &intervention_id).await?;
    Ok(CodexSendReceipt {
        status: "delivered".into(),
        turn_id: Some(turn_id),
        intervention_id,
    })
}

#[tauri::command]
pub async fn hexa_retry_claude_message(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
    intervention_id: String,
) -> Result<CodexSendReceipt, String> {
    let entry = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .entries()
        .into_iter()
        .find(|entry| entry.id == intervention_id)
        .ok_or_else(|| format!("Queued intervention not found: {intervention_id}"))?;
    if entry.provider != InterventionProvider::Claude {
        return Err("Queued intervention is not a Claude message".into());
    }
    let workspace = claude_followup_workspace(&store, &entry.thread_id)?;
    deliver_queued_claude_message(&queue, &intervention_id, &workspace).await?;
    Ok(CodexSendReceipt {
        status: "delivered".into(),
        turn_id: None,
        intervention_id,
    })
}

#[tauri::command]
pub async fn hexa_retry_opencode_message(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
    intervention_id: String,
) -> Result<CodexSendReceipt, String> {
    let entry = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .entries()
        .into_iter()
        .find(|entry| entry.id == intervention_id)
        .ok_or_else(|| format!("Queued intervention not found: {intervention_id}"))?;
    if entry.provider != InterventionProvider::OpenCode {
        return Err("Queued intervention is not an OpenCode message".into());
    }
    let workspace = cli_followup_workspace(&store, &entry.thread_id, "opencode", "OpenCode")?;
    deliver_queued_opencode_message(&queue, &intervention_id, &workspace).await?;
    Ok(CodexSendReceipt {
        status: "delivered".into(),
        turn_id: None,
        intervention_id,
    })
}

#[tauri::command]
pub async fn discard_queued_intervention(
    queue: State<'_, Arc<std::sync::Mutex<InterventionQueue>>>,
    intervention_id: String,
) -> Result<(), String> {
    queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .mark_delivered(&intervention_id)
}

async fn deliver_queued_codex_message(
    state: &CodexBridgeState,
    queue: &std::sync::Mutex<InterventionQueue>,
    intervention_id: &str,
) -> Result<String, String> {
    let entry = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .mark_sending(intervention_id)?;

    match state.send_message(&entry.thread_id, &entry.message).await {
        Ok(turn_id) => {
            queue
                .lock()
                .map_err(|error| format!("Queue lock error after delivery: {error}"))?
                .mark_delivered(intervention_id)
                .map_err(|error| {
                    format!("Codex accepted the message, but queue cleanup failed: {error}")
                })?;
            Ok(turn_id)
        }
        Err(error) => {
            let message = error.to_string();
            queue
                .lock()
                .map_err(|lock_error| format!("{message}; queue lock error: {lock_error}"))?
                .mark_failed(intervention_id, &message)
                .map_err(|queue_error| format!("{message}; queue update failed: {queue_error}"))?;
            Err(message)
        }
    }
}

fn claude_followup_workspace(
    store: &std::sync::Mutex<SessionStore>,
    session_id: &str,
) -> Result<PathBuf, String> {
    cli_followup_workspace(store, session_id, "claude-code", "Claude")
}

fn cli_followup_workspace(
    store: &std::sync::Mutex<SessionStore>,
    session_id: &str,
    client_type: &str,
    label: &str,
) -> Result<PathBuf, String> {
    let store = store
        .lock()
        .map_err(|error| format!("Session lock error: {error}"))?;
    let session = store
        .get_all_sessions_with_history()
        .into_iter()
        .find(|session| session.session_id == session_id)
        .ok_or_else(|| format!("{label} session is no longer known to HUMHUM"))?;
    if session.client_type != client_type {
        return Err(format!("Only local {label} sessions can be resumed"));
    }
    session
        .cwd
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| format!("{label} session has no known workspace"))
}

async fn deliver_queued_claude_message(
    queue: &std::sync::Mutex<InterventionQueue>,
    intervention_id: &str,
    workspace: &Path,
) -> Result<(), String> {
    let entry = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .mark_sending(intervention_id)?;
    if entry.provider != InterventionProvider::Claude {
        let message = "Queued intervention is not a Claude message";
        queue
            .lock()
            .map_err(|error| format!("{message}; queue lock error: {error}"))?
            .mark_failed(intervention_id, message)?;
        return Err(message.into());
    }
    match crate::claude_followup::send_followup(&entry.thread_id, workspace, &entry.message).await {
        Ok(()) => queue
            .lock()
            .map_err(|error| format!("Queue lock error after delivery: {error}"))?
            .mark_delivered(intervention_id),
        Err(error) => {
            queue
                .lock()
                .map_err(|lock_error| format!("{error}; queue lock error: {lock_error}"))?
                .mark_failed(intervention_id, &error)
                .map_err(|queue_error| format!("{error}; queue update failed: {queue_error}"))?;
            Err(error)
        }
    }
}

async fn deliver_queued_opencode_message(
    queue: &std::sync::Mutex<InterventionQueue>,
    intervention_id: &str,
    workspace: &Path,
) -> Result<(), String> {
    let entry = queue
        .lock()
        .map_err(|error| format!("Queue lock error: {error}"))?
        .mark_sending(intervention_id)?;
    if entry.provider != InterventionProvider::OpenCode {
        let message = "Queued intervention is not an OpenCode message";
        queue
            .lock()
            .map_err(|error| format!("{message}; queue lock error: {error}"))?
            .mark_failed(intervention_id, message)?;
        return Err(message.into());
    }
    match crate::opencode_followup::send_followup(&entry.thread_id, workspace, &entry.message).await
    {
        Ok(()) => queue
            .lock()
            .map_err(|error| format!("Queue lock error after delivery: {error}"))?
            .mark_delivered(intervention_id),
        Err(error) => {
            queue
                .lock()
                .map_err(|lock_error| format!("{error}; queue lock error: {lock_error}"))?
                .mark_failed(intervention_id, &error)
                .map_err(|queue_error| format!("{error}; queue update failed: {queue_error}"))?;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn hexa_interrupt_codex_turn(
    state: State<'_, Arc<CodexBridgeState>>,
    thread_id: String,
    turn_id: String,
) -> Result<(), String> {
    state
        .interrupt(&thread_id, &turn_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn hexa_resolve_codex_approval(
    state: State<'_, Arc<CodexBridgeState>>,
    approval_id: String,
    decision: ApprovalDecision,
) -> Result<(), String> {
    state
        .resolve_approval(&approval_id, decision)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn hexa_answer_codex_question(
    state: State<'_, Arc<CodexBridgeState>>,
    question_id: String,
    answers: Value,
) -> Result<(), String> {
    state
        .answer_question(&question_id, answers)
        .await
        .map_err(|error| error.to_string())
}

/// Get the current configuration
#[tauri::command]
pub async fn get_config(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
) -> Result<Value, String> {
    let config = config.lock().map_err(|e| format!("Lock error: {}", e))?;
    serde_json::to_value(&*config).map_err(|e| format!("Serialize error: {}", e))
}

/// Save updated configuration
#[tauri::command]
pub async fn save_config(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    new_config: Value,
) -> Result<(), String> {
    let mut config = config.lock().map_err(|e| format!("Lock error: {}", e))?;
    let updated: AppConfig =
        serde_json::from_value(new_config).map_err(|e| format!("Parse error: {}", e))?;
    updated.save()?;
    *config = updated;
    Ok(())
}

/// Get the hook server port
#[tauri::command]
pub async fn get_hook_port(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
) -> Result<u16, String> {
    let config = config.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(config.hook_port)
}

/// Check whether the Pi coding agent CLI is available on PATH.
#[tauri::command]
pub async fn check_pi_installed() -> Result<Value, String> {
    serde_json::to_value(pi_sidecar::check_installed().await)
        .map_err(|e| format!("Serialize error: {}", e))
}

/// Start a Pi RPC sidecar session. Pi remains a monitored child process of HumHum.
#[tauri::command]
pub async fn start_pi_session(
    app: tauri::AppHandle,
    state: State<'_, Arc<PiSidecarState>>,
    options: PiStartOptions,
) -> Result<PiSessionStatus, String> {
    pi_sidecar::start_session(app, state.inner().clone(), options).await
}

/// Send a user prompt to a running Pi sidecar session.
#[tauri::command]
pub async fn send_pi_prompt(
    state: State<'_, Arc<PiSidecarState>>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    state.send_prompt(&session_id, message).await
}

/// Return HumHum's cached view of a Pi sidecar session.
#[tauri::command]
pub async fn get_pi_session_status(
    state: State<'_, Arc<PiSidecarState>>,
    session_id: String,
) -> Result<PiSessionStatus, String> {
    state
        .status(&session_id)
        .await
        .ok_or_else(|| format!("Pi session not found: {}", session_id))
}

/// Ask Pi to abort the current operation without tearing down the process.
#[tauri::command]
pub async fn abort_pi_session(
    state: State<'_, Arc<PiSidecarState>>,
    session_id: String,
) -> Result<(), String> {
    state.abort(&session_id).await
}

/// Stop a Pi sidecar session and emit a SessionEnd event for Hexa/HUMHUM.
#[tauri::command]
pub async fn stop_pi_session(
    app: tauri::AppHandle,
    state: State<'_, Arc<PiSidecarState>>,
    session_id: String,
) -> Result<(), String> {
    state.stop(&app, &session_id).await
}

#[derive(Debug, Serialize)]
pub struct QoderAcpStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub acp_supported: bool,
    pub hint: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HushConnectorStatus {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub bridge_ready: bool,
    pub app_path: Option<String>,
    pub status: String,
    pub next_step: String,
    pub bridge_mode: String,
}

#[derive(Debug, Serialize)]
pub struct LocalSourceCandidate {
    pub path: String,
    pub exists: bool,
    pub kind: String,
    pub readable: bool,
    pub file_count: usize,
    pub sample_files: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DingTalkLocalSourceReport {
    pub app_detected: bool,
    pub app_path: Option<String>,
    pub source_count: usize,
    pub readable_count: usize,
    pub candidates: Vec<LocalSourceCandidate>,
    pub summary: String,
    pub next_step: String,
}

#[derive(Debug, Serialize)]
pub struct DingTalkImportReport {
    pub source_path: String,
    pub scanned_files: usize,
    pub imported_messages: usize,
    pub skipped_binary_sources: usize,
    pub skipped_files: usize,
    pub errors: Vec<String>,
    pub summary: String,
}

/// Detect the local Qoder CLI and whether it exposes an ACP-style command.
#[tauri::command]
pub async fn check_qoder_acp_support() -> Result<QoderAcpStatus, String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        Command::new("qoder").arg("--help").output(),
    )
    .await;

    match output {
        Ok(Ok(output)) if output.status.success() => {
            let help = String::from_utf8_lossy(&output.stdout).to_string();
            let first_line = help.lines().next().unwrap_or("Qoder").trim().to_string();
            let help_lower = help.to_lowercase();
            let acp_supported =
                help_lower.contains("acp") || help_lower.contains("agent client protocol");
            Ok(QoderAcpStatus {
                installed: true,
                version: Some(first_line),
                acp_supported,
                hint: if acp_supported {
                    "Qoder CLI appears to expose ACP-related options. HUMHUM can add an active ACP bridge next.".to_string()
                } else {
                    "Qoder CLI is installed, but this command surface looks like the editor launcher. HUMHUM will keep using the Qoder session watcher until the ACP command is confirmed.".to_string()
                },
                error: None,
            })
        }
        Ok(Ok(output)) => Ok(QoderAcpStatus {
            installed: false,
            version: None,
            acp_supported: false,
            hint: "Qoder CLI did not respond successfully.".to_string(),
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        }),
        Ok(Err(e)) => Ok(QoderAcpStatus {
            installed: false,
            version: None,
            acp_supported: false,
            hint: "Install Qoder CLI or expose it on PATH before enabling ACP.".to_string(),
            error: Some(e.to_string()),
        }),
        Err(_) => Ok(QoderAcpStatus {
            installed: false,
            version: None,
            acp_supported: false,
            hint: "Qoder CLI check timed out.".to_string(),
            error: Some("Timed out while checking qoder --help".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn get_agent_kernel_status(
    knowledge_store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    hush_store: State<'_, Arc<std::sync::Mutex<HushStore>>>,
) -> Result<AgentKernelStatus, String> {
    let knowledge_assets = {
        let store = knowledge_store
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        store.get_all().preferences.len() + store.get_all().agent_rules.len()
    };
    let hush_messages = {
        let store = hush_store
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        store.summary().total
    };
    let pi_available = pi_sidecar::check_installed().await.installed;
    let qoder_available = check_qoder_acp_support()
        .await
        .map(|status| status.installed)
        .unwrap_or(false);

    Ok(agent_kernel::build_agent_kernel_status(
        knowledge_assets,
        hush_messages,
        pi_available,
        qoder_available,
    ))
}

/// Return local social/work message connectors that Hush can prepare.
#[tauri::command]
pub async fn get_hush_connectors() -> Result<Vec<HushConnectorStatus>, String> {
    Ok(vec![
        build_hush_connector(
            "dingtalk",
            "DingTalk",
            &[
                "/Applications/DingTalk.app",
                "/Applications/钉钉.app",
                "/System/Applications/DingTalk.app",
                "/Users/yuxi/Applications/DingTalk.app",
                "/Users/yuxi/Applications/钉钉.app",
            ],
            &["DingTalk", "钉钉"],
            "Next: choose a real bridge: DingTalk bot webhook for groups, notification capture, or manual export import.",
        ),
        build_hush_connector(
            "wechat",
            "WeChat",
            &[
                "/Applications/WeChat.app",
                "/Applications/微信.app",
                "/System/Applications/WeChat.app",
                "/Users/yuxi/Applications/WeChat.app",
                "/Users/yuxi/Applications/微信.app",
            ],
            &["WeChat", "微信"],
            "Next: configure a local export or notification bridge. We do not read private chat databases directly.",
        ),
    ])
}

/// Open the native app for a Hush connector. This is the first step before
/// adding OCR/export/session bridges for private message sources.
#[tauri::command]
pub async fn open_hush_connector(connector_id: String) -> Result<(), String> {
    let connector = match connector_id.as_str() {
        "dingtalk" => build_hush_connector(
            "dingtalk",
            "DingTalk",
            &[
                "/Applications/DingTalk.app",
                "/Applications/钉钉.app",
                "/System/Applications/DingTalk.app",
                "/Users/yuxi/Applications/DingTalk.app",
                "/Users/yuxi/Applications/钉钉.app",
            ],
            &["DingTalk", "钉钉"],
            "Next: choose a real bridge: DingTalk bot webhook for groups, notification capture, or manual export import.",
        ),
        "wechat" => build_hush_connector(
            "wechat",
            "WeChat",
            &[
                "/Applications/WeChat.app",
                "/Applications/微信.app",
                "/System/Applications/WeChat.app",
                "/Users/yuxi/Applications/WeChat.app",
                "/Users/yuxi/Applications/微信.app",
            ],
            &["WeChat", "微信"],
            "Next: configure a local export or notification bridge. We do not read private chat databases directly.",
        ),
        other => return Err(format!("Unknown Hush connector: {}", other)),
    };

    let mut command = Command::new("open");
    if let Some(path) = connector.app_path.as_deref() {
        command.arg(path);
    } else {
        command.arg("-a").arg(&connector.name);
    }

    let output = command
        .output()
        .await
        .map_err(|e| format!("Failed to open {}: {}", connector.name, e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn get_hush_inbox(
    store: State<'_, Arc<std::sync::Mutex<HushStore>>>,
) -> Result<HushInboxSummary, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(store.summary())
}

#[tauri::command]
pub async fn clear_hush_inbox(
    store: State<'_, Arc<std::sync::Mutex<HushStore>>>,
) -> Result<(), String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    store.clear()
}

#[tauri::command]
pub async fn get_hush_notification_bridge_status(app: tauri::AppHandle) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        let status = app.state::<
            Arc<std::sync::Mutex<crate::mac_notification_watcher::MacNotificationBridgeStatus>>,
        >();
        let status = status
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?
            .clone();
        return serde_json::to_value(status).map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(serde_json::json!({
            "state": "source_missing",
            "message": "The local notification bridge is available on macOS only.",
            "last_scan_at": null,
            "supported_apps": []
        }))
    }
}

#[tauri::command]
pub async fn open_full_disk_access_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .output()
            .await
            .map_err(|error| format!("Failed to open Full Disk Access settings: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    #[cfg(not(target_os = "macos"))]
    Err("Full Disk Access settings are available on macOS only.".to_string())
}

#[tauri::command]
pub async fn import_dingtalk_local_source(
    app: tauri::AppHandle,
    store: State<'_, Arc<std::sync::Mutex<HushStore>>>,
    path: String,
) -> Result<DingTalkImportReport, String> {
    let source = expand_home_path(path.trim());
    if source.as_os_str().is_empty() {
        return Err("Choose a DingTalk export file or folder first.".to_string());
    }
    if !source.exists() {
        return Err(format!(
            "DingTalk source does not exist: {}",
            source.display()
        ));
    }

    let files = collect_dingtalk_import_files(&source);
    let mut scanned_files = 0usize;
    let mut imported_messages = 0usize;
    let mut skipped_binary_sources = 0usize;
    let mut skipped_files = 0usize;
    let mut errors = Vec::new();

    for file in files {
        if is_dingtalk_binary_source(&file) {
            skipped_binary_sources += 1;
            continue;
        }
        if !is_supported_dingtalk_text_source(&file) {
            skipped_files += 1;
            continue;
        }
        scanned_files += 1;
        match parse_dingtalk_text_source(&file) {
            Ok(messages) => {
                for raw in messages
                    .into_iter()
                    .take(200usize.saturating_sub(imported_messages))
                {
                    let added = {
                        let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
                        store.add_from_value(raw)
                    };
                    match added {
                        Ok(message) => {
                            imported_messages += 1;
                            let _ = app.emit("humhum://hush-message", &message);
                        }
                        Err(error) => errors.push(format!("{}: {}", file.display(), error)),
                    }
                    if imported_messages >= 200 {
                        break;
                    }
                }
            }
            Err(error) => errors.push(format!("{}: {}", file.display(), error)),
        }
        if imported_messages >= 200 {
            break;
        }
    }

    let summary = if imported_messages > 0 {
        format!(
            "Hush imported {} DingTalk messages from {} text/export files. Binary database-like files were detected but not read.",
            imported_messages, scanned_files
        )
    } else if skipped_binary_sources > 0 {
        "Hush found DingTalk database/cache files, but did not read them. Choose an exported JSON/text/log file, or build a dedicated user-approved database parser next.".to_string()
    } else {
        "Hush did not find readable DingTalk message exports in this source yet.".to_string()
    };

    Ok(DingTalkImportReport {
        source_path: source.to_string_lossy().to_string(),
        scanned_files,
        imported_messages,
        skipped_binary_sources,
        skipped_files,
        errors,
        summary,
    })
}

#[tauri::command]
pub async fn diagnose_dingtalk_local_sources() -> Result<DingTalkLocalSourceReport, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let connector = build_hush_connector(
        "dingtalk",
        "DingTalk",
        &[
            "/Applications/DingTalk.app",
            "/Applications/钉钉.app",
            "/System/Applications/DingTalk.app",
            "/Users/yuxi/Applications/DingTalk.app",
            "/Users/yuxi/Applications/钉钉.app",
        ],
        &["DingTalk", "钉钉"],
        "Next: inspect local storage shape, then add an explicit user-approved import bridge.",
    );

    let mut candidates = vec![
        home.join("Library/Application Support/DingTalk"),
        home.join("Library/Application Support/钉钉"),
        home.join("Library/Containers/com.alibaba.DingTalkMac"),
        home.join("Library/Containers/com.alibaba.DingTalk"),
        home.join("Library/Group Containers"),
        home.join("Library/Caches/com.alibaba.DingTalkMac"),
        home.join("Library/Logs/DingTalk"),
    ];

    if let Ok(output) = StdCommand::new("mdfind")
        .arg("kMDItemFSName == '*DingTalk*' || kMDItemFSName == '*钉钉*'")
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines().take(12) {
                let path = PathBuf::from(line.trim());
                if !candidates.iter().any(|item| item == &path) {
                    candidates.push(path);
                }
            }
        }
    }

    let mut reports = Vec::new();
    for path in candidates {
        reports.push(inspect_local_source_candidate(&path));
    }
    reports.sort_by(|a, b| {
        b.exists
            .cmp(&a.exists)
            .then(b.readable.cmp(&a.readable))
            .then(b.file_count.cmp(&a.file_count))
            .then(a.path.cmp(&b.path))
    });
    reports.truncate(12);

    let source_count = reports.iter().filter(|item| item.exists).count();
    let readable_count = reports.iter().filter(|item| item.readable).count();
    let summary = if source_count == 0 {
        "Hush did not find a local Ali Ding storage folder yet. DingTalk may be installed in a sandboxed path, not logged in, or named differently on this Mac.".to_string()
    } else {
        format!(
            "Hush found {} possible Ali Ding local storage locations, {} readable. This is the real starting point for a local message understanding bridge.",
            source_count, readable_count
        )
    };

    Ok(DingTalkLocalSourceReport {
        app_detected: connector.installed,
        app_path: connector.app_path,
        source_count,
        readable_count,
        candidates: reports,
        summary,
        next_step: "Next we should inspect only metadata and supported export files first, then let the user approve which DingTalk source HUMHUM may index. Hush should summarize relationships and tasks, not secretly reply or scrape without consent.".to_string(),
    })
}

fn build_hush_connector(
    id: &str,
    name: &str,
    candidate_paths: &[&str],
    search_names: &[&str],
    next_step: &str,
) -> HushConnectorStatus {
    let app_path = candidate_paths
        .iter()
        .find(|path| std::path::Path::new(path).exists())
        .map(|path| path.to_string())
        .or_else(|| find_application_path(search_names));
    let installed = app_path.is_some();

    HushConnectorStatus {
        id: id.to_string(),
        name: name.to_string(),
        installed,
        bridge_ready: false,
        app_path,
        status: if installed {
            "Native app detected. HUMHUM can launch it, but message ingestion is not connected yet."
                .to_string()
        } else {
            "Native app was not detected in standard app locations or Spotlight.".to_string()
        },
        next_step: next_step.to_string(),
        bridge_mode: "launch-only".to_string(),
    }
}

fn find_application_path(search_names: &[&str]) -> Option<String> {
    for name in search_names {
        let query = format!(
            "kMDItemKind == 'Application' && (kMDItemFSName == '*{}*' || kMDItemDisplayName == '*{}*')",
            name, name
        );
        let Ok(output) = StdCommand::new("mdfind").arg(query).output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(path) = stdout.lines().find(|line| line.ends_with(".app")) {
            return Some(path.to_string());
        }
    }
    None
}

fn inspect_local_source_candidate(path: &Path) -> LocalSourceCandidate {
    let exists = path.exists();
    let kind = if path.is_dir() {
        "directory"
    } else if path.is_file() {
        "file"
    } else {
        "missing"
    }
    .to_string();

    if !exists {
        return LocalSourceCandidate {
            path: path.to_string_lossy().to_string(),
            exists,
            kind,
            readable: false,
            file_count: 0,
            sample_files: Vec::new(),
        };
    }

    if path.is_file() {
        return LocalSourceCandidate {
            path: path.to_string_lossy().to_string(),
            exists,
            kind,
            readable: std::fs::File::open(path).is_ok(),
            file_count: 1,
            sample_files: vec![path.to_string_lossy().to_string()],
        };
    }

    let Ok(_read_dir) = std::fs::read_dir(path) else {
        return LocalSourceCandidate {
            path: path.to_string_lossy().to_string(),
            exists,
            kind,
            readable: false,
            file_count: 0,
            sample_files: Vec::new(),
        };
    };

    let mut file_count = 0usize;
    let mut sample_files = Vec::new();
    let mut queue = VecDeque::from([path.to_path_buf()]);
    let mut visited = 0usize;
    while let Some(dir) = queue.pop_front() {
        if visited > 180 {
            break;
        }
        visited += 1;
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten().take(80) {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                let name = entry_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_lowercase();
                if !["cache", "caches", "crashpad", "gpu"]
                    .iter()
                    .any(|skip| name.contains(skip))
                {
                    queue.push_back(entry_path);
                }
            } else if looks_like_message_source(&entry_path) {
                file_count += 1;
                if sample_files.len() < 8 {
                    sample_files.push(entry_path.to_string_lossy().to_string());
                }
            }
        }
    }

    LocalSourceCandidate {
        path: path.to_string_lossy().to_string(),
        exists,
        kind,
        readable: true,
        file_count,
        sample_files,
    }
}

fn looks_like_message_source(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let name = name.to_lowercase();
    let interesting_ext = [
        ".db", ".sqlite", ".sqlite3", ".json", ".log", ".ldb", ".sst",
    ];
    let interesting_name = [
        "message",
        "msg",
        "conversation",
        "chat",
        "session",
        "ding",
        "im",
    ];
    interesting_ext.iter().any(|ext| name.ends_with(ext))
        || interesting_name.iter().any(|part| name.contains(part))
}

fn expand_home_path(raw: &str) -> PathBuf {
    if raw == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(raw));
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(raw)
}

fn collect_dingtalk_import_files(source: &Path) -> Vec<PathBuf> {
    if source.is_file() {
        return vec![source.to_path_buf()];
    }

    let mut files = Vec::new();
    let mut queue = VecDeque::from([source.to_path_buf()]);
    let mut visited_dirs = 0usize;
    while let Some(dir) = queue.pop_front() {
        if visited_dirs >= 160 || files.len() >= 120 {
            break;
        }
        visited_dirs += 1;
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten().take(120) {
            let path = entry.path();
            if path.is_dir() {
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_lowercase();
                if !["cache", "caches", "crashpad", "gpu", "webkit"]
                    .iter()
                    .any(|skip| name.contains(skip))
                {
                    queue.push_back(path);
                }
            } else if looks_like_message_source(&path) || is_supported_dingtalk_text_source(&path) {
                files.push(path);
                if files.len() >= 120 {
                    break;
                }
            }
        }
    }
    files
}

fn is_dingtalk_binary_source(path: &Path) -> bool {
    let lower = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase();
    [".db", ".sqlite", ".sqlite3", ".ldb", ".sst"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn is_supported_dingtalk_text_source(path: &Path) -> bool {
    let lower = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase();
    [".json", ".jsonl", ".ndjson", ".txt", ".log", ".md"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn parse_dingtalk_text_source(path: &Path) -> Result<Vec<Value>, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("Cannot read metadata: {}", e))?;
    if metadata.len() > 2_000_000 {
        return Err("File is larger than 2MB; export a smaller message slice first.".to_string());
    }
    let content = std::fs::read_to_string(path).map_err(|e| format!("Cannot read text: {}", e))?;
    let source_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("DingTalk export");
    let chat = infer_chat_from_filename(source_name);

    if let Ok(value) = serde_json::from_str::<Value>(&content) {
        let mut messages = Vec::new();
        collect_dingtalk_json_messages(&value, &mut messages);
        if messages.is_empty() && value.is_object() {
            messages.push(normalize_dingtalk_raw(value, chat.as_deref(), path));
        }
        return Ok(messages
            .into_iter()
            .map(|item| normalize_dingtalk_raw(item, chat.as_deref(), path))
            .collect());
    }

    let mut messages = Vec::new();
    for line in content.lines().take(800) {
        let trimmed = line.trim();
        if trimmed.len() < 2 {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            messages.push(normalize_dingtalk_raw(value, chat.as_deref(), path));
        } else if let Some(value) = parse_dingtalk_plain_line(trimmed, chat.as_deref(), path) {
            messages.push(value);
        }
        if messages.len() >= 200 {
            break;
        }
    }
    Ok(messages)
}

fn collect_dingtalk_json_messages(value: &Value, messages: &mut Vec<Value>) {
    if messages.len() >= 200 {
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                collect_dingtalk_json_messages(item, messages);
                if messages.len() >= 200 {
                    break;
                }
            }
        }
        Value::Object(map) => {
            let has_message_shape = [
                "text",
                "content",
                "sender",
                "senderNick",
                "conversationTitle",
            ]
            .iter()
            .any(|key| map.contains_key(*key))
                || value.pointer("/text/content").is_some()
                || value.pointer("/markdown/text").is_some();
            if has_message_shape {
                messages.push(value.clone());
                return;
            }
            for key in ["messages", "items", "data", "list", "records", "result"] {
                if let Some(child) = map.get(key) {
                    collect_dingtalk_json_messages(child, messages);
                    if messages.len() >= 200 {
                        break;
                    }
                }
            }
        }
        _ => {}
    }
}

fn normalize_dingtalk_raw(mut raw: Value, chat: Option<&str>, path: &Path) -> Value {
    let Some(map) = raw.as_object_mut() else {
        return serde_json::json!({
            "platform": "dingtalk",
            "text": raw.to_string(),
            "chat": chat,
            "source": path.to_string_lossy(),
        });
    };
    map.entry("platform".to_string())
        .or_insert_with(|| Value::String("dingtalk".to_string()));
    if let Some(chat) = chat {
        map.entry("chat".to_string())
            .or_insert_with(|| Value::String(chat.to_string()));
    }
    map.entry("source".to_string())
        .or_insert_with(|| Value::String(path.to_string_lossy().to_string()));
    raw
}

fn parse_dingtalk_plain_line(line: &str, chat: Option<&str>, path: &Path) -> Option<Value> {
    if line.contains("DEBUG")
        || line.contains("INFO")
        || line.contains("WARN")
        || line.contains("ERROR")
        || line.starts_with('{')
        || line.starts_with('[')
    {
        return None;
    }

    let mut sender = "Unknown sender".to_string();
    let mut text = line.to_string();
    if let Some((left, right)) = line.split_once(':') {
        if left.chars().count() <= 24 && right.trim().chars().count() >= 2 {
            sender = left.trim().trim_matches(['[', ']', '【', '】']).to_string();
            text = right.trim().to_string();
        }
    } else {
        let tab_parts = line.split('\t').map(str::trim).collect::<Vec<_>>();
        if tab_parts.len() >= 3 {
            sender = tab_parts[1].to_string();
            text = tab_parts[2..].join(" ");
        }
    }

    if text.chars().count() < 3 {
        return None;
    }

    Some(serde_json::json!({
        "platform": "dingtalk",
        "sender": sender,
        "chat": chat,
        "text": text,
        "source": path.to_string_lossy(),
    }))
}

fn infer_chat_from_filename(name: &str) -> Option<String> {
    let trimmed = name
        .trim_end_matches(".jsonl")
        .trim_end_matches(".ndjson")
        .trim_end_matches(".json")
        .trim_end_matches(".txt")
        .trim_end_matches(".log")
        .trim_end_matches(".md")
        .trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Install Claude Code hooks to ~/.claude/settings.json
#[tauri::command]
pub async fn install_hooks(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
) -> Result<String, String> {
    let _port = {
        let config = config.lock().map_err(|e| format!("Lock error: {}", e))?;
        config.hook_port
    };

    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    // Ensure .claude directory exists
    std::fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("Failed to create .claude dir: {}", e))?;

    // Read existing settings or create new
    let mut settings: Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Determine hook script path
    let hook_script = ensure_hook_script_installed(&home)?;
    let hook_cmd = hook_script.to_string_lossy().to_string();

    // Build hooks configuration
    let humhum_hooks = serde_json::json!({
        "PermissionRequest": [{
            "hooks": [{
                "type": "command",
                "command": hook_cmd,
                "timeout": 120000
            }]
        }],
        "Stop": [{
            "hooks": [{
                "type": "command",
                "command": hook_cmd
            }]
        }],
        "TaskCompleted": [{
            "hooks": [{
                "type": "command",
                "command": hook_cmd
            }]
        }],
        "Notification": [{
            "hooks": [{
                "type": "command",
                "command": hook_cmd
            }]
        }]
    });

    // Merge hooks into settings — APPEND to existing hook arrays, don't replace
    if let Some(existing_hooks) = settings.get("hooks").and_then(|h| h.as_object()) {
        let mut merged = existing_hooks.clone();
        if let Some(new_hooks) = humhum_hooks.as_object() {
            for (key, value) in new_hooks {
                if let Some(existing_arr) = merged.get(key).and_then(|v| v.as_array()) {
                    // Check if humhum hook already exists in this event
                    let already_installed = existing_arr.iter().any(|group| {
                        group
                            .get("hooks")
                            .and_then(|h| h.as_array())
                            .map(|hooks| {
                                hooks.iter().any(|h| {
                                    h.get("command")
                                        .and_then(|c| c.as_str())
                                        .map(|c| c.contains("humhum-hook"))
                                        .unwrap_or(false)
                                })
                            })
                            .unwrap_or(false)
                    });
                    if !already_installed {
                        let mut combined = existing_arr.clone();
                        if let Some(new_arr) = value.as_array() {
                            combined.extend(new_arr.iter().cloned());
                        }
                        merged.insert(key.clone(), Value::Array(combined));
                    }
                } else {
                    merged.insert(key.clone(), value.clone());
                }
            }
        }
        settings["hooks"] = Value::Object(merged);
    } else {
        settings["hooks"] = humhum_hooks;
    }

    // Write back
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(format!(
        "Hooks installed in {:?}. Hook script: {:?}",
        settings_path, hook_script
    ))
}

/// Uninstall HumHum hooks from ~/.claude/settings.json
#[tauri::command]
pub async fn uninstall_hooks() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".claude").join("settings.json");

    if !settings_path.exists() {
        return Ok("No Claude Code settings found".to_string());
    }

    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    let mut settings: Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    // Remove only HumHum hook entries, preserve other tools' hooks
    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        let events = ["PermissionRequest", "Stop", "TaskCompleted", "Notification"];
        for event in &events {
            if let Some(arr) = hooks.get_mut(*event).and_then(|v| v.as_array_mut()) {
                arr.retain(|group| {
                    let is_humhum = group
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| {
                            hs.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("humhum"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false);
                    !is_humhum
                });
                if arr.is_empty() {
                    hooks.remove(*event);
                }
            }
        }
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&settings_path, content).map_err(|e| format!("Failed to write: {}", e))?;

    Ok("HumHum hooks removed from Claude Code settings".to_string())
}

/// Get recent events (for the frontend to display)
#[tauri::command]
pub async fn get_events() -> Result<Vec<Value>, String> {
    // For the scaffold, return empty. In production, read from a persistent store.
    Ok(vec![])
}

/// Toggle the settings window visibility
#[tauri::command]
pub async fn toggle_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        if win.is_visible().unwrap_or(false) {
            win.hide().map_err(|e| format!("Failed to hide: {}", e))?;
        } else {
            // Position next to the main window
            if let Some(main_win) = app.get_webview_window("main") {
                if let Ok(pos) = main_win.outer_position() {
                    let sf = main_win.scale_factor().unwrap_or(1.0);
                    let x = (pos.x as f64 / sf) as i32 - 440;
                    let y = (pos.y as f64 / sf) as i32;
                    let _ = win.set_position(tauri::Position::Logical(
                        tauri::LogicalPosition::new(x.max(0) as f64, y.max(0) as f64),
                    ));
                }
            }

            let _ = win.set_shadow(false);

            win.show().map_err(|e| format!("Failed to show: {}", e))?;
            win.set_focus()
                .map_err(|e| format!("Failed to focus: {}", e))?;

            // Set window level & transparency AFTER show/focus so Tauri can't reset it
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSColor, NSWindow};
                use cocoa::base::{id, nil};
                use objc::{msg_send, sel, sel_impl};
                if let Ok(ns_win) = win.ns_window() {
                    let ns_win = ns_win as id;
                    let ns_win_ptr = ns_win as usize;
                    dispatch::Queue::main().exec_async(move || unsafe {
                        let ns_win = ns_win_ptr as id;

                        // Transparent background so CSS rounded corners show through
                        let clear_color: id = NSColor::clearColor(nil);
                        ns_win.setBackgroundColor_(clear_color);
                        ns_win.setOpaque_(false);
                        ns_win.setHasShadow_(false);

                        // Disable WKWebView background
                        let content_view: id = ns_win.contentView();
                        fn clear_webview_bg(view: cocoa::base::id) {
                            unsafe {
                                let class_name: cocoa::base::id = msg_send![view, className];
                                let bytes: *const std::os::raw::c_char =
                                    msg_send![class_name, UTF8String];
                                let class_str =
                                    std::ffi::CStr::from_ptr(bytes).to_str().unwrap_or("");
                                if class_str.contains("WKWebView")
                                    || class_str.contains("WebViewer")
                                {
                                    let _: () =
                                        msg_send![view, setValue: false forKey: "drawsBackground"];
                                    let _: () = msg_send![view, setValue: false forKey: "opaque"];
                                }
                                let subviews: cocoa::base::id = msg_send![view, subviews];
                                let count: usize = msg_send![subviews, count];
                                for i in 0..count {
                                    let subview: cocoa::base::id =
                                        msg_send![subviews, objectAtIndex: i];
                                    clear_webview_bg(subview);
                                }
                            }
                        }
                        clear_webview_bg(content_view);

                        // canJoinAllSpaces(1) | stationary(16) | ignoresCycle(64) | fullScreenAuxiliary(256) | fullScreenDisallowsTiling(4096)
                        let _: () = msg_send![ns_win, setCollectionBehavior: 4433_u64];
                        let _: () = msg_send![ns_win, setLevel: 1500_i64];
                        let _: () = msg_send![ns_win, setHidesOnDeactivate: false];
                        let _: () = msg_send![ns_win, setCanHide: false];
                        let _: () = msg_send![ns_win, setAnimationBehavior: 2_i64];
                    });

                    // Move to SkyLight stationary space so it floats above fullscreen apps
                    crate::move_to_skylight_space(ns_win);

                    // Periodically re-assert window level while visible
                    let win_clone = win.clone();
                    std::thread::spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        if !win_clone.is_visible().unwrap_or(false) {
                            break;
                        }
                        crate::reassert_window_level(&win_clone);
                    });
                }
            }
        }
    }
    Ok(())
}

/// Toggle the Hub window
#[tauri::command]
pub async fn toggle_hub(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hub") {
        if win.is_visible().unwrap_or(false) {
            win.hide().map_err(|e| format!("Failed to hide: {}", e))?;
        } else {
            let _ = win.set_shadow(false);
            win.show().map_err(|e| format!("Failed to show: {}", e))?;
            win.set_focus()
                .map_err(|e| format!("Failed to focus: {}", e))?;

            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSColor, NSWindow};
                use cocoa::base::{id, nil};
                use objc::{msg_send, sel, sel_impl};
                if let Ok(ns_win) = win.ns_window() {
                    let ns_win = ns_win as id;
                    let ns_win_ptr = ns_win as usize;
                    dispatch::Queue::main().exec_async(move || unsafe {
                        let ns_win = ns_win_ptr as id;
                        let clear_color: id = NSColor::clearColor(nil);
                        ns_win.setBackgroundColor_(clear_color);
                        ns_win.setOpaque_(false);
                        ns_win.setHasShadow_(false);

                        let content_view: id = ns_win.contentView();
                        fn clear_webview_bg(view: cocoa::base::id) {
                            unsafe {
                                let class_name: cocoa::base::id = msg_send![view, className];
                                let bytes: *const std::os::raw::c_char =
                                    msg_send![class_name, UTF8String];
                                let class_str =
                                    std::ffi::CStr::from_ptr(bytes).to_str().unwrap_or("");
                                if class_str.contains("WKWebView")
                                    || class_str.contains("WebViewer")
                                {
                                    let _: () =
                                        msg_send![view, setValue: false forKey: "drawsBackground"];
                                    let _: () = msg_send![view, setValue: false forKey: "opaque"];
                                }
                                let subviews: cocoa::base::id = msg_send![view, subviews];
                                let count: usize = msg_send![subviews, count];
                                for i in 0..count {
                                    let subview: cocoa::base::id =
                                        msg_send![subviews, objectAtIndex: i];
                                    clear_webview_bg(subview);
                                }
                            }
                        }
                        clear_webview_bg(content_view);
                    });
                }
            }
        }
    }
    Ok(())
}

/// Send a native system notification
#[tauri::command]
pub async fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| format!("Failed to send notification: {}", e))?;
    Ok(())
}

/// Get all active sessions
#[tauri::command]
pub async fn get_active_sessions(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let sessions = store.get_active_sessions();
    serde_json::to_value(sessions).map_err(|e| format!("Serialize error: {}", e))
}

/// Get all sessions including completed (for Hexa module)
#[tauri::command]
pub async fn get_all_sessions_history(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut sessions: Vec<Session> = store
        .get_all_sessions_with_history()
        .into_iter()
        .cloned()
        .collect();
    drop(store);

    merge_codex_sessions(&mut sessions);
    sessions.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
    serde_json::to_value(sessions).map_err(|e| format!("Serialize error: {}", e))
}

fn change_summary_workspace(
    store: &std::sync::Mutex<SessionStore>,
    session_id: &str,
) -> Result<PathBuf, String> {
    store
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?
        .get_all_sessions_with_history()
        .into_iter()
        .find(|session| session.session_id == session_id)
        .ok_or("This Agent session is no longer available")?
        .cwd
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "This Agent session did not report a workspace".into())
}

#[tauri::command]
pub async fn get_session_change_summary(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    session_id: String,
) -> Result<GitChangeSummary, String> {
    let workspace = change_summary_workspace(&store, &session_id)?;
    crate::git_changes::summarize_workspace(&workspace).await
}

/// Get a specific session by ID
#[tauri::command]
pub async fn get_session(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    session_id: String,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    match store.get_session(&session_id) {
        Some(session) => {
            serde_json::to_value(session).map_err(|e| format!("Serialize error: {}", e))
        }
        None => Err(format!("Session not found: {}", session_id)),
    }
}

fn merge_codex_sessions(sessions: &mut Vec<Session>) {
    let existing: HashSet<String> = sessions
        .iter()
        .map(|session| session.session_id.clone())
        .collect();
    let Ok(files) = collect_codex_session_files(80) else {
        return;
    };

    for file in files {
        if let Some(session) = parse_codex_session_file(&file) {
            if !existing.contains(&session.session_id)
                && !sessions
                    .iter()
                    .any(|item| item.session_id == session.session_id)
            {
                sessions.push(session);
            }
        }
    }
}

fn collect_codex_session_files(limit: usize) -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let root = home.join(".codex").join("sessions");
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    let mut queue = VecDeque::from([root]);
    while let Some(dir) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                queue.push_back(path);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                files.push(path);
            }
        }
    }

    files.sort_by(|a, b| {
        let a_time = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let b_time = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });
    files.truncate(limit);
    Ok(files)
}

fn parse_codex_session_file(path: &Path) -> Option<Session> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut session_id = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("codex-session")
        .to_string();
    let mut cwd: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut last_event_at: Option<String> = None;
    let mut last_message: Option<String> = None;
    let mut recent_tools: Vec<String> = Vec::new();
    let mut event_names: Vec<String> = Vec::new();
    let mut event_count = 0_u32;

    for line in content.lines().take(600) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        event_count += 1;

        if let Some(timestamp) = value.get("timestamp").and_then(Value::as_str) {
            if started_at.is_none() {
                started_at = Some(timestamp.to_string());
            }
            last_event_at = Some(timestamp.to_string());
        }

        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("codex_event")
            .to_string();
        event_names.push(map_codex_event_name(&event_type).to_string());
        if event_names.len() > 50 {
            event_names.remove(0);
        }

        if event_type == "session_meta" {
            if let Some(payload) = value.get("payload") {
                if let Some(id) = payload
                    .get("session_id")
                    .or_else(|| payload.get("id"))
                    .and_then(Value::as_str)
                {
                    session_id = id.to_string();
                }
                if cwd.is_none() {
                    cwd = payload
                        .get("cwd")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
                if started_at.is_none() {
                    started_at = payload
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
            }
        }

        if let Some(tool_name) = extract_codex_tool_name(&value) {
            recent_tools.push(tool_name);
            if recent_tools.len() > 10 {
                recent_tools.remove(0);
            }
        }

        if let Some(message) = extract_codex_message(&value) {
            last_message = Some(message);
        }
    }

    let started_at = started_at.or_else(|| {
        std::fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .map(chrono::DateTime::<chrono::Utc>::from)
            .map(|dt| dt.to_rfc3339())
    })?;
    let last_event_at = last_event_at.unwrap_or_else(|| started_at.clone());

    Some(Session {
        session_id,
        client_type: "codex".to_string(),
        transcript_path: Some(path.to_string_lossy().to_string()),
        cwd: cwd.clone(),
        project_name: cwd
            .as_deref()
            .and_then(|path| path.rsplit('/').next())
            .map(str::to_string)
            .or_else(|| Some("Codex Desktop".to_string())),
        started_at,
        last_event_at,
        event_count,
        status: SessionStatus::Completed,
        last_hook_message: last_message.or_else(|| {
            Some(format!(
                "Imported Codex transcript: {}",
                path.to_string_lossy()
            ))
        }),
        last_tool_name: recent_tools.last().cloned(),
        recent_tools,
        event_names,
        has_pending_permission: false,
        route: None,
    })
}

fn map_codex_event_name(event_type: &str) -> &'static str {
    match event_type {
        "session_meta" => "SessionStart",
        "response_item" => "Notification",
        "turn_context" => "Notification",
        _ => "Notification",
    }
}

fn extract_codex_tool_name(value: &Value) -> Option<String> {
    let payload = value.get("payload")?;
    payload
        .get("tool_name")
        .or_else(|| payload.pointer("/tool_name"))
        .or_else(|| payload.pointer("/name"))
        .or_else(|| payload.pointer("/item/name"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn extract_codex_message(value: &Value) -> Option<String> {
    let payload = value.get("payload")?;
    let content = payload
        .pointer("/content")
        .or_else(|| payload.pointer("/item/content"))?;
    if let Some(text) = content.as_str() {
        return Some(truncate_display_text(text, 180));
    }
    if let Some(items) = content.as_array() {
        for item in items {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                return Some(truncate_display_text(text, 180));
            }
        }
    }
    None
}

fn truncate_display_text(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        text.to_string()
    } else {
        let end = text.floor_char_boundary(limit);
        format!("{}...", &text[..end])
    }
}

/// Respond to a pending permission request from the frontend
#[tauri::command]
pub async fn respond_to_permission(
    pending: State<'_, PendingMap>,
    event_id: String,
    behavior: String,
    reason: Option<String>,
    answer: Option<serde_json::Value>,
) -> Result<(), String> {
    resolve_hook_permission(&pending, &event_id, &behavior, reason, answer).await
}

pub(crate) async fn resolve_hook_permission(
    pending: &PendingMap,
    event_id: &str,
    behavior: &str,
    reason: Option<String>,
    answer: Option<serde_json::Value>,
) -> Result<(), String> {
    log::info!(
        "[Permission] Responding to {} with behavior={} answer={:?}",
        event_id,
        behavior,
        answer
    );
    let mut map = pending.lock().await;
    if let Some(mut pr) = map.remove(event_id) {
        if let Some(sender) = pr.sender.take() {
            let decision = PermissionDecision {
                behavior: behavior.to_string(),
                reason,
                answer,
            };
            match sender.send(decision) {
                Ok(_) => {
                    log::info!("[Permission] Decision sent successfully: {}", behavior);
                    Ok(())
                }
                Err(_) => {
                    log::error!(
                        "[Permission] Receiver dropped — HTTP connection already timed out"
                    );
                    Err("Connection timed out — hook already expired. Try responding faster next time.".to_string())
                }
            }
        } else {
            log::warn!("[Permission] Already responded to {}", event_id);
            Err("Already responded to this request".to_string())
        }
    } else {
        log::warn!("[Permission] No pending request found for {}", event_id);
        Err(format!(
            "No pending permission request with id: {}",
            event_id
        ))
    }
}

/// Focus the terminal application
#[tauri::command]
pub async fn focus_terminal() -> Result<(), String> {
    window_focus::focus_terminal_app()
}

/// Focus the application, terminal session, or tmux pane that owns a Hexa session.
#[tauri::command]
pub async fn focus_agent_session(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    bridge: State<'_, Arc<CodexBridgeState>>,
    session_id: String,
) -> Result<window_focus::FocusResult, String> {
    let (route, workspace, client_type) = {
        let store = store
            .lock()
            .map_err(|error| format!("Lock error: {error}"))?;
        store
            .get_all_sessions_with_history()
            .into_iter()
            .find(|session| session.session_id == session_id)
            .map(|session| {
                (
                    session.route.clone(),
                    session.cwd.clone(),
                    session.client_type.clone(),
                )
            })
            .unwrap_or((None, None, String::new()))
    };
    if client_type == "cursor" {
        if let Some(workspace) = workspace.as_deref() {
            if let Some(route) = route.as_ref() {
                if let Ok(result) = window_focus::focus_cursor_terminal(route, workspace) {
                    return Ok(result);
                }
            }
            if let Ok(result) = window_focus::focus_cursor_workspace(workspace) {
                return Ok(result);
            }
        }
    }
    if route
        .as_ref()
        .is_some_and(|route| route.ghostty_terminal_id.is_some())
    {
        if let Ok(result) = window_focus::focus_agent_route(route.as_ref()) {
            return Ok(result);
        }
    }
    if let (Some(route), Some(workspace)) = (route.as_ref(), workspace.as_deref()) {
        if let Ok(result) = window_focus::focus_ghostty_workspace(route, workspace) {
            return Ok(result);
        }
    }
    if route.is_some() {
        return window_focus::focus_agent_route(route.as_ref());
    }

    let codex_thread = bridge.sessions().into_iter().find_map(|session| {
        let thread_id = session
            .provider_thread_id
            .as_deref()
            .unwrap_or(&session.session_id);
        (session.session_id == session_id || thread_id == session_id).then(|| thread_id.to_string())
    });
    if let Some(thread_id) = codex_thread {
        return window_focus::focus_codex_thread(&thread_id);
    }

    window_focus::focus_agent_route(None)
}

/// Focus the terminal and type text + Enter (for AskUserQuestion responses)
#[tauri::command]
pub async fn type_in_terminal(text: String) -> Result<(), String> {
    window_focus::type_in_terminal_async(&text).await
}

/// Get list of supported clients
#[tauri::command]
pub async fn get_supported_clients() -> Result<Value, String> {
    let clients = client_registry::get_all_clients();
    serde_json::to_value(clients).map_err(|e| format!("Serialize error: {}", e))
}

/// Install hooks for a specific client
#[tauri::command]
pub async fn install_hooks_for_client(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    client_id: String,
) -> Result<String, String> {
    let profile = client_registry::get_client(&client_id)
        .ok_or_else(|| format!("Unknown client: {}", client_id))?;

    let port = {
        let config = config.lock().map_err(|e| format!("Lock error: {}", e))?;
        config.hook_port
    };

    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let config_path = home.join(profile.config_path);

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    let hook_script = ensure_hook_script_installed(&home)?;
    let hook_cmd = format!(
        "{} --client {}",
        shell_quote(&hook_script.to_string_lossy()),
        shell_quote(&client_id)
    );

    match profile.config_format {
        ConfigFormat::Json => install_json_hooks(&config_path, &hook_cmd, profile.hook_events)?,
        ConfigFormat::Toml => install_toml_hooks(&config_path, &hook_cmd, profile.hook_events)?,
        ConfigFormat::FlatJson => {
            install_flat_json_hooks(&config_path, &hook_cmd, profile.hook_events, false)?
        }
        ConfigFormat::CopilotJson => {
            install_flat_json_hooks(&config_path, &hook_cmd, profile.hook_events, true)?
        }
        ConfigFormat::OpenCodePlugin => install_opencode_plugin(&config_path, port)?,
    }
    if client_id == "cursor" {
        crate::cursor_focus_extension::install_at(&home)?;
    }

    Ok(format!(
        "Hooks installed for {} at {:?}",
        profile.name, config_path
    ))
}

/// Uninstall hooks for a specific client
#[tauri::command]
pub async fn uninstall_hooks_for_client(client_id: String) -> Result<String, String> {
    let profile = client_registry::get_client(&client_id)
        .ok_or_else(|| format!("Unknown client: {}", client_id))?;

    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let config_path = home.join(profile.config_path);

    if !config_path.exists() {
        return Ok(format!("No {} config found", profile.name));
    }

    match profile.config_format {
        ConfigFormat::Json => uninstall_json_hooks(&config_path, profile.hook_events)?,
        ConfigFormat::Toml => uninstall_toml_hooks(&config_path, profile.hook_events)?,
        ConfigFormat::FlatJson => {
            uninstall_flat_json_hooks(&config_path, profile.hook_events, false)?
        }
        ConfigFormat::CopilotJson => {
            uninstall_flat_json_hooks(&config_path, profile.hook_events, true)?
        }
        ConfigFormat::OpenCodePlugin => uninstall_opencode_plugin(&config_path)?,
    }
    if client_id == "cursor" {
        crate::cursor_focus_extension::uninstall_at(&home)?;
    }

    Ok(format!("Hooks removed for {}", profile.name))
}

fn install_json_hooks(
    config_path: &std::path::Path,
    hook_cmd: &str,
    events: &[&str],
) -> Result<(), String> {
    let mut settings: Value = if config_path.exists() {
        let content =
            std::fs::read_to_string(config_path).map_err(|e| format!("Failed to read: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let mut hooks = serde_json::Map::new();
    for event in events {
        let timeout = if *event == "PermissionRequest" {
            Some(120000)
        } else {
            None
        };
        let mut hook_obj = serde_json::json!({
            "type": "command",
            "command": hook_cmd
        });
        if let Some(t) = timeout {
            hook_obj["timeout"] = serde_json::json!(t);
        }
        hooks.insert(
            event.to_string(),
            serde_json::json!([{ "matcher": "*", "hooks": [hook_obj] }]),
        );
    }

    if let Some(existing) = settings.get("hooks").and_then(|h| h.as_object()) {
        let mut merged = existing.clone();
        for (k, v) in hooks {
            if let Some(existing_arr) = merged.get(&k).and_then(|val| val.as_array()) {
                let already = existing_arr.iter().any(|group| {
                    group
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| {
                            hs.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("humhum"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                });
                if !already {
                    let mut combined = existing_arr.clone();
                    if let Some(new_arr) = v.as_array() {
                        combined.extend(new_arr.iter().cloned());
                    }
                    merged.insert(k, Value::Array(combined));
                }
            } else {
                merged.insert(k, v);
            }
        }
        settings["hooks"] = Value::Object(merged);
    } else {
        settings["hooks"] = Value::Object(hooks);
    }

    let content =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(config_path, content).map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

fn normalized_hook_event(event: &str) -> &str {
    match event {
        "sessionStart" => "SessionStart",
        "sessionEnd" => "SessionEnd",
        "userPromptSubmitted" | "beforeSubmitPrompt" => "UserPromptSubmit",
        "preToolUse" => "PreToolUse",
        "postToolUse" => "PostToolUse",
        "agentStop" | "stop" => "Stop",
        "subagentStart" => "SubagentStart",
        "subagentStop" => "SubagentStop",
        "preCompact" => "PreCompact",
        "errorOccurred" => "PostToolUseFailure",
        other => other,
    }
}

fn install_flat_json_hooks(
    config_path: &Path,
    hook_cmd: &str,
    events: &[&str],
    copilot: bool,
) -> Result<(), String> {
    let mut config: Value = if config_path.exists() {
        serde_json::from_str(&std::fs::read_to_string(config_path).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    config["version"] = serde_json::json!(1);
    if !config.get("hooks").is_some_and(Value::is_object) {
        config["hooks"] = serde_json::json!({});
    }
    let hooks = config["hooks"].as_object_mut().unwrap();
    for event in events {
        let command = format!(
            "{} --event {}",
            hook_cmd,
            shell_quote(normalized_hook_event(event))
        );
        let entries = hooks
            .entry((*event).to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| format!("Invalid hook array for {event}"))?;
        if entries.iter().any(|entry| {
            entry
                .get(if copilot { "bash" } else { "command" })
                .and_then(Value::as_str)
                .is_some_and(|command| command.contains("humhum"))
        }) {
            continue;
        }
        let mut entry = if copilot {
            serde_json::json!({ "type": "command" })
        } else {
            serde_json::json!({})
        };
        if copilot {
            entry["bash"] = Value::String(command);
            entry["timeoutSec"] = serde_json::json!(10);
        } else {
            entry["command"] = Value::String(command);
            if matches!(*event, "preToolUse" | "postToolUse") {
                entry["matcher"] = Value::String("*".into());
            }
        }
        entries.push(entry);
    }
    write_json_config(config_path, &config)
}

fn uninstall_flat_json_hooks(
    config_path: &Path,
    events: &[&str],
    copilot: bool,
) -> Result<(), String> {
    let mut config: Value = serde_json::from_str(
        &std::fs::read_to_string(config_path).map_err(|error| error.to_string())?,
    )
    .unwrap_or_else(|_| serde_json::json!({}));
    if let Some(hooks) = config.get_mut("hooks").and_then(Value::as_object_mut) {
        for event in events {
            if let Some(entries) = hooks.get_mut(*event).and_then(Value::as_array_mut) {
                entries.retain(|entry| {
                    !entry
                        .get(if copilot { "bash" } else { "command" })
                        .and_then(Value::as_str)
                        .is_some_and(|command| command.contains("humhum"))
                });
                if entries.is_empty() {
                    hooks.remove(*event);
                }
            }
        }
    }
    write_json_config(config_path, &config)
}

fn write_json_config(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    std::fs::write(path, content).map_err(|error| error.to_string())
}

fn install_opencode_plugin(config_path: &Path, port: u16) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let source = HUMHUM_OPENCODE_PLUGIN.replace("__HUMHUM_PORT__", &port.to_string());
    std::fs::write(config_path, source).map_err(|error| error.to_string())
}

fn uninstall_opencode_plugin(config_path: &Path) -> Result<(), String> {
    let source = std::fs::read_to_string(config_path).map_err(|error| error.to_string())?;
    if !source.contains("HUMHUM_OPENCODE_PLUGIN") {
        return Err("Refusing to remove an unmanaged OpenCode plugin".into());
    }
    std::fs::remove_file(config_path).map_err(|error| error.to_string())
}

pub(crate) fn ensure_hook_script_installed(
    home: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let hook_dir = home.join(".humhum").join("hooks");
    std::fs::create_dir_all(&hook_dir).map_err(|e| format!("Failed to create hook dir: {}", e))?;

    let hook_script = hook_dir.join("humhum-hook.sh");
    std::fs::write(&hook_script, HUMHUM_HOOK_SCRIPT)
        .map_err(|e| format!("Failed to write hook script: {}", e))?;

    #[cfg(unix)]
    {
        let mut permissions = std::fs::metadata(&hook_script)
            .map_err(|e| format!("Failed to stat hook script: {}", e))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&hook_script, permissions)
            .map_err(|e| format!("Failed to chmod hook script: {}", e))?;
    }

    Ok(hook_script)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn uninstall_json_hooks(config_path: &std::path::Path, events: &[&str]) -> Result<(), String> {
    let content =
        std::fs::read_to_string(config_path).map_err(|e| format!("Failed to read: {}", e))?;
    let mut settings: Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for event in events {
            if let Some(arr) = hooks.get_mut(*event).and_then(|v| v.as_array_mut()) {
                arr.retain(|group| {
                    let is_humhum = group
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| {
                            hs.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("humhum"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false);
                    !is_humhum
                });
                if arr.is_empty() {
                    hooks.remove(*event);
                }
            }
        }
    }

    let content =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(config_path, content).map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

fn install_toml_hooks(
    config_path: &std::path::Path,
    hook_cmd: &str,
    events: &[&str],
) -> Result<(), String> {
    let mut content = if config_path.exists() {
        std::fs::read_to_string(config_path).map_err(|e| format!("Failed to read: {}", e))?
    } else {
        String::new()
    };

    if !content.contains("[hooks]") {
        content.push_str("\n[hooks]\n");
    }

    for event in events {
        let entry = format!("{} = \"{}\"", event, hook_cmd);
        if !content.contains(&format!("{} =", event)) {
            content.push_str(&entry);
            content.push('\n');
        }
    }

    std::fs::write(config_path, content).map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

fn uninstall_toml_hooks(config_path: &std::path::Path, events: &[&str]) -> Result<(), String> {
    let content =
        std::fs::read_to_string(config_path).map_err(|e| format!("Failed to read: {}", e))?;

    let filtered: Vec<&str> = content
        .lines()
        .filter(|line| !events.iter().any(|e| line.starts_with(&format!("{} =", e))))
        .collect();

    std::fs::write(config_path, filtered.join("\n")).map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

/// Forward WebView console logs to Rust logger
#[tauri::command]
pub fn webview_log(level: String, msg: String) {
    match level.as_str() {
        "error" => log::error!("[WebView] {}", msg),
        "warn" => log::warn!("[WebView] {}", msg),
        _ => log::info!("[WebView] {}", msg),
    }
}

/// Proxy HTTP POST request through Rust — returns text (bypasses CORS)
#[tauri::command]
pub async fn proxy_post(url: String, headers: Value, body: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut req = client.post(&url);

    if let Some(obj) = headers.as_object() {
        for (k, v) in obj {
            if let Some(val) = v.as_str() {
                req = req.header(k.as_str(), val);
            }
        }
    }

    let response = req
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Read body failed: {}", e))?;

    if status >= 400 {
        return Err(format!(
            "HTTP {}: {}",
            status,
            &text[..text.floor_char_boundary(200)]
        ));
    }

    Ok(text)
}

/// Proxy HTTP POST request through Rust — returns binary as base64 (for TTS)
#[tauri::command]
pub async fn proxy_post_binary(
    url: String,
    headers: Value,
    body: String,
) -> Result<String, String> {
    use base64::Engine;

    let client = reqwest::Client::new();
    let mut req = client.post(&url);

    if let Some(obj) = headers.as_object() {
        for (k, v) in obj {
            if let Some(val) = v.as_str() {
                req = req.header(k.as_str(), val);
            }
        }
    }

    let response = req
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    if status >= 400 {
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "HTTP {}: {}",
            status,
            &text[..text.floor_char_boundary(200)]
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read body failed: {}", e))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Play MP3 audio natively via afplay (bypasses WebView audio restrictions)
/// Blocks until playback finishes so AudioQueue can sequence correctly.
#[tauri::command]
pub async fn play_audio(base64_data: String) -> Result<(), String> {
    use base64::Engine;
    use std::io::Write;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let tmp_dir = std::env::temp_dir().join("humhum-audio");
    std::fs::create_dir_all(&tmp_dir).ok();
    let tmp_file = tmp_dir.join(format!("tts-{}.mp3", uuid::Uuid::new_v4()));

    let mut file = std::fs::File::create(&tmp_file)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write audio: {}", e))?;
    drop(file);

    let path_str = tmp_file.to_string_lossy().to_string();
    let mut child = tokio::process::Command::new("afplay")
        .arg(&path_str)
        .spawn()
        .map_err(|e| format!("afplay spawn failed: {}", e))?;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("afplay wait failed: {}", e))?;

    let _ = std::fs::remove_file(&path_str);

    if status.success() {
        Ok(())
    } else {
        Err(format!("afplay exited with: {}", status))
    }
}

/// Stop any currently playing afplay audio
#[tauri::command]
pub async fn stop_audio() -> Result<(), String> {
    tokio::process::Command::new("killall")
        .args(["-9", "afplay"])
        .status()
        .await
        .ok();
    Ok(())
}

#[tauri::command]
pub async fn get_sound_packs(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
) -> Result<Vec<crate::sound_pack::SoundPackInfo>, String> {
    let selected_path = config
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?
        .ui
        .sounds
        .pack_path
        .clone();
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(crate::sound_pack::discover_packs(
        &home,
        selected_path.as_deref(),
    ))
}

#[tauri::command]
pub async fn select_sound_pack(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    path: String,
) -> Result<crate::sound_pack::SoundPackInfo, String> {
    let info = crate::sound_pack::inspect_pack(Path::new(&path))?;
    let mut config = config
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    config.ui.sounds.pack_path = Some(info.path.clone());
    config.ui.sounds.enabled = true;
    config.save()?;
    Ok(info)
}

#[tauri::command]
pub async fn clear_sound_pack(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
) -> Result<(), String> {
    let mut config = config
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    config.ui.sounds.pack_path = None;
    config.save()
}

#[tauri::command]
pub async fn get_sound_clip(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    event: String,
    preview: bool,
) -> Result<Option<crate::sound_pack::SoundClipData>, String> {
    let sounds = config
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?
        .ui
        .sounds
        .clone();
    let event_enabled = match event.as_str() {
        "processingStarted" => sounds.processing_started,
        "attentionRequired" => sounds.attention_required,
        "taskCompleted" => sounds.task_completed,
        "error" => sounds.error,
        "resourceLimit" => sounds.resource_limit,
        _ => return Err(format!("Unknown sound event: {event}")),
    };
    if !preview && (!sounds.enabled || !event_enabled) {
        return Ok(None);
    }
    let Some(path) = sounds.pack_path else {
        return Ok(None);
    };
    crate::sound_pack::read_clip(Path::new(&path), &event)
}

/// Check which clients have HumHum hooks installed
#[tauri::command]
pub async fn check_hooks_status() -> Result<Value, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let mut statuses = serde_json::Map::new();
    for client in client_registry::get_all_clients() {
        let config_path = home.join(client.config_path);
        let installed = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path).unwrap_or_default();
            let hooks_installed = content.contains("humhum");
            if client.id == "cursor" && hooks_installed {
                crate::cursor_focus_extension::ensure_for_managed_hook(&home).unwrap_or(false)
            } else {
                hooks_installed
            }
        } else {
            false
        };
        statuses.insert(client.id.to_string(), Value::Bool(installed));
    }
    Ok(Value::Object(statuses))
}

/// Get aggregated usage statistics
#[tauri::command]
pub async fn get_stats(
    store: State<'_, Arc<std::sync::Mutex<StatsStore>>>,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let stats = store.get_aggregated_stats();
    serde_json::to_value(stats).map_err(|e| format!("Serialize error: {}", e))
}

/// Get per-agent usage statistics for comparison
#[tauri::command]
pub async fn get_agent_stats(
    store: State<'_, Arc<std::sync::Mutex<StatsStore>>>,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let stats = store.get_per_agent_stats();
    serde_json::to_value(stats).map_err(|e| format!("Serialize error: {}", e))
}

#[derive(Debug, Clone, Serialize)]
pub struct HexaReadout {
    pub session_id: String,
    pub project_intent: String,
    pub recent_user_intent: String,
    pub agent_current_work: String,
    pub performance_read: String,
    pub fit_score: u8,
    pub suggested_nudge: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Default)]
struct TranscriptSignals {
    user_messages: Vec<String>,
    assistant_messages: Vec<String>,
    tool_names: Vec<String>,
}

/// Build Hexa's human-readable readouts from local Claude/Codex transcripts when available.
#[tauri::command]
pub async fn get_hexa_readouts(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
) -> Result<Value, String> {
    let sessions = {
        let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
        store
            .get_all_sessions_with_history()
            .into_iter()
            .cloned()
            .collect::<Vec<_>>()
    };

    let readouts: Vec<HexaReadout> = sessions
        .iter()
        .map(|session| build_hexa_readout(session))
        .collect();

    serde_json::to_value(readouts).map_err(|e| format!("Serialize error: {}", e))
}

fn build_hexa_readout(session: &crate::session_store::Session) -> HexaReadout {
    let signals = session
        .transcript_path
        .as_ref()
        .and_then(|path| parse_transcript_signals(path).ok())
        .unwrap_or_default();

    let project_intent = session
        .project_name
        .as_ref()
        .map(|name| format!("{} 项目里的 AI 编程会话", name))
        .unwrap_or_else(|| "本地 AI 编程会话，项目名暂未从 hook 中识别".to_string());

    let recent_user_intent = summarize_recent_user_intent(&signals.user_messages);
    let agent_current_work = if let Some(tool) = session.last_tool_name.as_ref() {
        format!("正在围绕 {} 推进，最近工具是 {}", project_intent, tool)
    } else if let Some(msg) = signals.assistant_messages.last() {
        format!("最近在回应: {}", truncate_text(msg, 90))
    } else {
        "已有 hook 事件，但还缺少 transcript 里的具体动作描述".to_string()
    };

    let mut evidence = Vec::new();
    if !signals.user_messages.is_empty() {
        evidence.push(format!(
            "读到最近 {} 条用户消息",
            signals.user_messages.len().min(10)
        ));
    }
    if !signals.tool_names.is_empty() {
        evidence.push(format!(
            "最近工具: {}",
            signals
                .tool_names
                .iter()
                .rev()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    evidence.push(format!("hook 事件数 {}", session.event_count));

    let recent_events = &session.event_names;
    let completed = recent_events
        .iter()
        .rev()
        .take(10)
        .filter(|e| matches!(e.as_str(), "TaskCompleted" | "Stop" | "SessionEnd"))
        .count();
    let tool_events = recent_events
        .iter()
        .rev()
        .take(10)
        .filter(|e| matches!(e.as_str(), "PreToolUse" | "PostToolUse"))
        .count();
    let repeated_tool = session.recent_tools.len() >= 6
        && session
            .recent_tools
            .iter()
            .rev()
            .take(6)
            .collect::<std::collections::HashSet<_>>()
            .len()
            == 1;

    let mut score: i32 = 48
        + (completed as i32 * 18).min(24)
        + (tool_events as i32 * 4).min(20)
        + (signals.user_messages.len() as i32 * 2).min(8);
    if session.has_pending_permission {
        score -= 22;
    }
    if repeated_tool {
        score -= 20;
    }
    if session.status == crate::session_store::SessionStatus::Completed {
        score += 12;
    }
    score = score.clamp(8, 96);

    let performance_read = if session.has_pending_permission {
        "当前主要卡点是等待用户确认，agent 本身还不能继续推进。".to_string()
    } else if repeated_tool {
        "看起来在重复调用同一类工具，需要留意是否进入局部循环。".to_string()
    } else if completed > 0 {
        "最近有完成信号，整体是在回应用户需求并收口。".to_string()
    } else if tool_events >= 3 {
        "最近工具推进比较密集，像是在认真执行，但还没有明确完成信号。".to_string()
    } else if signals.user_messages.is_empty() {
        "缺少最近用户消息，只能从 hook 事件判断，感官反馈偏弱。".to_string()
    } else {
        "已捕捉到用户意图和部分执行信号，当前处于推进中。".to_string()
    };

    let suggested_nudge = if session.has_pending_permission {
        "提醒用户先处理确认请求。".to_string()
    } else if repeated_tool {
        "提醒 agent 总结当前阻塞点，换策略而不是继续重复工具调用。".to_string()
    } else if completed > 0 {
        "可以要求 agent 给出简短验收结果和下一步。".to_string()
    } else if signals.user_messages.is_empty() {
        "补充 transcript 读取或让 agent 明确复述用户目标。".to_string()
    } else {
        "让 agent 对照最近用户目标说明当前改动是否满足。".to_string()
    };

    HexaReadout {
        session_id: session.session_id.clone(),
        project_intent,
        recent_user_intent,
        agent_current_work,
        performance_read,
        fit_score: score as u8,
        suggested_nudge,
        evidence,
    }
}

fn parse_transcript_signals(path: &str) -> Result<TranscriptSignals, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut signals = TranscriptSignals::default();
    let mut recent_lines = content.lines().rev().take(500).collect::<Vec<_>>();
    recent_lines.reverse();

    for line in recent_lines {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if is_user_entry(&value) {
            if let Some(text) = extract_text(&value) {
                push_limited(&mut signals.user_messages, text, 10);
            }
        } else if is_assistant_entry(&value) {
            if let Some(text) = extract_text(&value) {
                push_limited(&mut signals.assistant_messages, text, 6);
            }
        }

        for tool in extract_tool_names(&value) {
            push_limited(&mut signals.tool_names, tool, 12);
        }
    }

    Ok(signals)
}

fn is_user_entry(value: &Value) -> bool {
    value.get("type").and_then(|v| v.as_str()) == Some("user")
        || value
            .get("message")
            .and_then(|m| m.get("role"))
            .and_then(|v| v.as_str())
            == Some("user")
        || value.get("role").and_then(|v| v.as_str()) == Some("user")
}

fn is_assistant_entry(value: &Value) -> bool {
    value.get("type").and_then(|v| v.as_str()) == Some("assistant")
        || value
            .get("message")
            .and_then(|m| m.get("role"))
            .and_then(|v| v.as_str())
            == Some("assistant")
        || value.get("role").and_then(|v| v.as_str()) == Some("assistant")
}

fn extract_text(value: &Value) -> Option<String> {
    let candidates = [
        value.pointer("/message/content"),
        value.pointer("/content"),
        value.pointer("/payload/message"),
        value.pointer("/payload/content"),
    ];

    for candidate in candidates.into_iter().flatten() {
        if let Some(text) = text_from_value(candidate) {
            return Some(truncate_text(&text, 220));
        }
    }
    None
}

fn text_from_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return clean_text(text);
    }
    if let Some(arr) = value.as_array() {
        let parts = arr
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(|v| v.as_str())
                    .or_else(|| item.get("content").and_then(|v| v.as_str()))
            })
            .filter_map(clean_text)
            .collect::<Vec<_>>();
        if !parts.is_empty() {
            return Some(parts.join(" "));
        }
    }
    None
}

fn extract_tool_names(value: &Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(name) = value.pointer("/payload/name").and_then(|v| v.as_str()) {
        names.push(name.to_string());
    }
    if let Some(name) = value.get("tool_name").and_then(|v| v.as_str()) {
        names.push(name.to_string());
    }
    if let Some(content) = value.pointer("/message/content").and_then(|v| v.as_array()) {
        for item in content {
            if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                    names.push(name.to_string());
                }
            }
        }
    }
    names
}

fn summarize_recent_user_intent(messages: &[String]) -> String {
    if messages.is_empty() {
        return "暂未从 transcript 读到最近用户消息，只能依赖 hook 事件。".to_string();
    }
    let recent = messages
        .iter()
        .rev()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    format!("最近用户主要在说: {}", recent.join(" / "))
}

fn push_limited(items: &mut Vec<String>, value: String, limit: usize) {
    if value.trim().is_empty() {
        return;
    }
    items.push(value);
    if items.len() > limit {
        items.remove(0);
    }
}

fn clean_text(text: &str) -> Option<String> {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in text.chars().enumerate() {
        if idx >= max_chars {
            out.push('…');
            return out;
        }
        out.push(ch);
    }
    out
}

// ===== Knowledge Base commands =====

#[tauri::command]
pub async fn get_knowledge(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    serde_json::to_value(store.get_all()).map_err(|e| format!("Serialize error: {}", e))
}

const HUMI_TOOL_MAX_TEXT: usize = 6000;

pub fn bounded_tool_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

pub fn require_memory_confirmation(confirmed: bool) -> Result<(), String> {
    if confirmed {
        Ok(())
    } else {
        Err("Saving a memory requires explicit user confirmation".to_string())
    }
}

/// Return bounded, user-safe context for Pi's local read tools.
#[tauri::command]
pub async fn get_humi_context_tool(
    tool: String,
    query: Option<String>,
    sessions: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    knowledge: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    stats: State<'_, Arc<std::sync::Mutex<StatsStore>>>,
) -> Result<Value, String> {
    match tool.as_str() {
        "get_recent_sessions" => {
            let sessions = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
            let items = sessions
                .get_all_sessions_with_history()
                .into_iter()
                .take(8)
                .map(|session| {
                    serde_json::json!({
                        "client": session.client_type,
                        "project": session.project_name,
                        "status": session.status,
                        "events": session.event_count,
                        "last_event_at": session.last_event_at,
                        "last_tool": session.last_tool_name,
                        "recent_tools": session.recent_tools.iter().take(6).collect::<Vec<_>>(),
                    })
                })
                .collect::<Vec<_>>();
            Ok(serde_json::json!({ "tool": tool, "items": items }))
        }
        "get_agent_skills" => {
            let knowledge = knowledge.lock().map_err(|e| format!("Lock error: {}", e))?;
            let items = knowledge
                .get_all()
                .agent_assets
                .iter()
                .filter(|asset| asset.asset_type == "skill")
                .take(12)
                .map(|asset| {
                    serde_json::json!({
                        "name": asset.name,
                        "agent": asset.agent_id,
                        "description": bounded_tool_text(&asset.content, 900),
                        "tags": asset.tags.iter().take(8).collect::<Vec<_>>(),
                    })
                })
                .collect::<Vec<_>>();
            Ok(serde_json::json!({ "tool": tool, "items": items }))
        }
        "get_local_memory" => {
            let knowledge = knowledge.lock().map_err(|e| format!("Lock error: {}", e))?;
            let preferences = knowledge
                .get_all()
                .preferences
                .iter()
                .take(20)
                .map(|item| {
                    serde_json::json!({
                        "category": item.category,
                        "content": bounded_tool_text(&item.content, 700),
                        "priority": item.priority,
                    })
                })
                .collect::<Vec<_>>();
            let memories = knowledge
                .get_all()
                .memory_items
                .iter()
                .take(20)
                .map(|item| {
                    serde_json::json!({
                        "agent": item.agent_id,
                        "content": bounded_tool_text(&item.content, 700),
                        "temperature": item.temperature,
                    })
                })
                .collect::<Vec<_>>();
            Ok(
                serde_json::json!({ "tool": tool, "preferences": preferences, "memories": memories }),
            )
        }
        "get_project_context" => {
            let keyword = query.unwrap_or_default();
            let knowledge = knowledge.lock().map_err(|e| format!("Lock error: {}", e))?;
            let result = if keyword.trim().is_empty() {
                knowledge.get_all().clone()
            } else {
                knowledge.query(&keyword)
            };
            let rules = result
                .agent_rules
                .iter()
                .take(12)
                .map(|rule| {
                    serde_json::json!({
                        "agent": rule.agent_id,
                        "type": rule.rule_type,
                        "content": bounded_tool_text(&rule.content, 1000),
                    })
                })
                .collect::<Vec<_>>();
            let assets = result
                .agent_assets
                .iter()
                .take(12)
                .map(|asset| {
                    serde_json::json!({
                        "name": asset.name,
                        "type": asset.asset_type,
                        "agent": asset.agent_id,
                        "content": bounded_tool_text(&asset.content, 1000),
                    })
                })
                .collect::<Vec<_>>();
            Ok(
                serde_json::json!({ "tool": tool, "query": keyword, "rules": rules, "assets": assets }),
            )
        }
        "get_user_preferences" => {
            let knowledge = knowledge.lock().map_err(|e| format!("Lock error: {}", e))?;
            let items = knowledge
                .get_all()
                .preferences
                .iter()
                .take(20)
                .map(|item| {
                    serde_json::json!({
                        "category": item.category,
                        "content": bounded_tool_text(&item.content, 900),
                        "source": bounded_tool_text(&item.source, 240),
                    })
                })
                .collect::<Vec<_>>();
            Ok(serde_json::json!({ "tool": tool, "items": items }))
        }
        "get_usage_signals" => {
            let stats = stats.lock().map_err(|e| format!("Lock error: {}", e))?;
            let items = stats
                .get_per_agent_stats()
                .into_iter()
                .take(8)
                .map(|item| {
                    serde_json::json!({
                        "agent": item.client_type,
                        "sessions": item.total_sessions,
                        "tool_calls": item.total_tool_calls,
                        "top_tools": item.top_tools.iter().take(8).collect::<Vec<_>>(),
                        "models": item.models_used.iter().take(6).collect::<Vec<_>>(),
                    })
                })
                .collect::<Vec<_>>();
            Ok(serde_json::json!({ "tool": tool, "items": items }))
        }
        _ => Err(format!("Unknown HUMI context tool: {}", tool)),
    }
}

#[tauri::command]
pub async fn save_humi_memory(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    id: String,
    category: String,
    content: String,
    source: String,
    priority: u8,
    confirmed: bool,
) -> Result<(), String> {
    require_memory_confirmation(confirmed)?;
    let content = bounded_tool_text(&content, HUMI_TOOL_MAX_TEXT);
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    store.save_preference(Preference {
        id,
        category,
        content,
        source: bounded_tool_text(&source, 240),
        priority,
    });
    Ok(())
}

#[tauri::command]
pub async fn save_preference(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    id: String,
    category: String,
    content: String,
    source: String,
    priority: u8,
) -> Result<(), String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    store.save_preference(Preference {
        id,
        category,
        content,
        source,
        priority,
    });
    Ok(())
}

#[tauri::command]
pub async fn delete_preference(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    id: String,
) -> Result<bool, String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(store.delete_preference(&id))
}

#[tauri::command]
pub async fn scan_agent_rules(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
) -> Result<Value, String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let found = store.scan_agent_rules();
    serde_json::to_value(found).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn scan_agent_assets(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    roots: Option<Vec<String>>,
) -> Result<Value, String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let found = store.scan_agent_assets(roots)?;
    serde_json::to_value(found).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn diagnose_agent_asset_roots(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    roots: Option<Vec<String>>,
) -> Result<Vec<AgentAssetRootDiagnostic>, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    store.diagnose_agent_asset_roots(roots)
}

#[derive(Debug, Deserialize)]
pub struct LocalAgentKernelOptions {
    pub prompt: String,
    pub cwd: Option<String>,
    pub roots: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct LocalAgentKernelResult {
    pub session_id: String,
    pub asset_count: usize,
    pub type_counts: BTreeMap<String, usize>,
    pub agent_counts: BTreeMap<String, usize>,
    pub top_tools: Vec<LocalUsageInsight>,
    pub top_skills: Vec<LocalUsageInsight>,
    pub agent_knowledge: Vec<LocalUsageInsight>,
    pub operational_tools: Vec<LocalUsageInsight>,
    pub suggested_actions: Vec<String>,
    pub memory_path: String,
    pub summary: String,
    pub answer: String,
    pub agent_reply: HumiAgentReply,
    pub context_packet: HumiContextPacket,
}

#[derive(Debug, Serialize, Clone)]
pub struct LocalUsageInsight {
    pub name: String,
    pub count: u64,
    pub source: String,
    pub detail: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct HumiContextPacket {
    pub question: String,
    pub observed_workflows: Vec<String>,
    pub user_preference_candidates: Vec<String>,
    pub memory_candidates: Vec<String>,
    pub risk_notes: Vec<String>,
    pub context_sources: Vec<String>,
    pub evidence_notes: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct HumiAgentReply {
    pub message: String,
    pub confidence: String,
    pub cards: Vec<HumiAgentCard>,
    pub steps: Vec<HumiAgentStep>,
}

#[derive(Debug, Serialize, Clone)]
pub struct HumiAgentCard {
    pub title: String,
    pub body: String,
    pub tone: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct HumiAgentStep {
    pub phase: String,
    pub title: String,
    pub content: String,
}

#[tauri::command]
pub async fn run_local_agent_kernel(
    app: tauri::AppHandle,
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    stats_store: State<'_, Arc<std::sync::Mutex<StatsStore>>>,
    options: LocalAgentKernelOptions,
) -> Result<LocalAgentKernelResult, String> {
    let session_id = format!("local-pi-{}", uuid::Uuid::new_v4());
    let cwd = options.cwd.clone();

    emit_local_kernel_event(
        &app,
        &session_id,
        "SessionStart",
        serde_json::json!({
            "source": "local_humhum_kernel",
            "message": "Local HUMHUM kernel started",
            "prompt": options.prompt,
        }),
        cwd.clone(),
    );

    let assets = {
        let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
        store.scan_agent_assets(options.roots.clone())?
    };

    let mut type_counts = BTreeMap::new();
    let mut agent_counts = BTreeMap::new();
    for asset in &assets {
        *type_counts.entry(asset.asset_type.clone()).or_insert(0) += 1;
        *agent_counts.entry(asset.agent_id.clone()).or_insert(0) += 1;
    }

    let suggested_actions = suggest_local_kernel_actions(&assets, &type_counts, &agent_counts);
    let top_skills = collect_top_skill_assets(&assets);
    let operational_tools = {
        let stats_store = stats_store
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        collect_top_tools_from_stats(&stats_store)
    };
    let agent_knowledge = collect_agent_knowledge(&assets);
    let context_packet = build_humi_context_packet(
        &options.prompt,
        &assets,
        &type_counts,
        &agent_counts,
        &operational_tools,
        &top_skills,
        &agent_knowledge,
        &suggested_actions,
    );
    let agent_reply = build_humi_agent_reply(
        &options.prompt,
        &context_packet,
        &top_skills,
        &agent_knowledge,
        &operational_tools,
    );
    let answer = agent_reply.message.clone();
    let summary = build_local_kernel_summary(&options.prompt, &assets, &type_counts, &agent_counts);
    let memory_path =
        write_local_kernel_memory(&session_id, &options, &summary, &suggested_actions)?;

    emit_local_kernel_event(
        &app,
        &session_id,
        "TaskCompleted",
        serde_json::json!({
            "source": "local_humhum_kernel",
            "message": summary,
            "asset_count": assets.len(),
            "memory_path": memory_path,
            "tool_name": "scan_agent_assets",
            "suggested_actions": suggested_actions,
        }),
        cwd,
    );

    Ok(LocalAgentKernelResult {
        session_id,
        asset_count: assets.len(),
        type_counts,
        agent_counts,
        top_tools: operational_tools
            .iter()
            .filter(|tool| !is_builtin_operation_tool(&tool.name))
            .cloned()
            .collect(),
        top_skills,
        agent_knowledge,
        operational_tools,
        suggested_actions,
        memory_path,
        summary,
        answer,
        agent_reply,
        context_packet,
    })
}

#[tauri::command]
pub async fn set_obsidian_vault_path(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    path: String,
) -> Result<(), String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    store.set_obsidian_vault_path(path)
}

#[tauri::command]
pub async fn scan_obsidian_vault(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    path: Option<String>,
) -> Result<Value, String> {
    let mut store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let found = store.scan_obsidian_vault(path)?;
    serde_json::to_value(found).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn query_knowledge(
    store: State<'_, Arc<std::sync::Mutex<KnowledgeStore>>>,
    keyword: String,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    let result = store.query(&keyword);
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

fn suggest_local_kernel_actions(
    assets: &[AgentAsset],
    type_counts: &BTreeMap<String, usize>,
    agent_counts: &BTreeMap<String, usize>,
) -> Vec<String> {
    let mut actions = Vec::new();

    if assets.is_empty() {
        actions.push("No agent assets were found. Add ~/.codex, ~/.claude, ~/.agents, Obsidian, or project skill roots first.".to_string());
        return actions;
    }

    for required in ["skill", "agent", "memory", "soul", "rule"] {
        if !type_counts.contains_key(required) {
            actions.push(format!(
                "Add or import {} assets so HUMHUM can build a more complete personal agent base.",
                required
            ));
        }
    }

    if agent_counts.len() < 2 {
        actions.push("Only one agent source is indexed. Connect Claude/Codex/Qoder/Pi roots to compare cross-agent context.".to_string());
    }

    let config_count = type_counts.get("config").copied().unwrap_or(0);
    let memory_count = type_counts.get("memory").copied().unwrap_or(0);
    if config_count > 0 && memory_count == 0 {
        actions.push("Configuration exists, but long-term memory is thin. Create a memory.md layer for durable user preferences.".to_string());
    }

    if actions.is_empty() {
        actions.push("The base is healthy. Next step: route new sessions through this index and let Hexa watch progress drift.".to_string());
    }

    actions.truncate(5);
    actions
}

fn collect_top_tools_from_stats(stats_store: &StatsStore) -> Vec<LocalUsageInsight> {
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    let mut sources: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for agent in stats_store.get_per_agent_stats() {
        for (tool, count) in agent.top_tools {
            *counts.entry(tool.clone()).or_insert(0) += count;
            sources
                .entry(tool)
                .or_default()
                .push(agent.client_type.clone());
        }
    }
    let mut items = counts
        .into_iter()
        .map(|(name, count)| {
            let mut source_list = sources.remove(&name).unwrap_or_default();
            source_list.sort();
            source_list.dedup();
            LocalUsageInsight {
                name,
                count,
                source: source_list.join(", "),
                detail: "Observed in local Codex/Claude transcripts".to_string(),
            }
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
    items.truncate(6);
    items
}

fn collect_top_skill_assets(assets: &[AgentAsset]) -> Vec<LocalUsageInsight> {
    let mut counts: BTreeMap<String, (u64, String, String)> = BTreeMap::new();
    for asset in assets.iter().filter(|asset| {
        asset.asset_type == "skill"
            && is_primary_skill_asset(asset)
            && !is_generic_skill_signal(&asset.name)
    }) {
        let entry = counts.entry(asset.name.clone()).or_insert((
            0,
            asset.agent_id.clone(),
            asset.file_path.clone(),
        ));
        entry.0 += 1;
    }

    if counts.is_empty() {
        for asset in assets
            .iter()
            .filter(|asset| asset.asset_type == "skill" && is_primary_skill_asset(asset))
        {
            let entry = counts.entry(asset.name.clone()).or_insert((
                0,
                asset.agent_id.clone(),
                asset.file_path.clone(),
            ));
            entry.0 += 1;
        }
    }

    let mut items = counts
        .into_iter()
        .map(|(name, (count, source, detail))| LocalUsageInsight {
            name,
            count,
            source,
            detail,
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
    items.truncate(6);
    items
}

fn collect_agent_knowledge(assets: &[AgentAsset]) -> Vec<LocalUsageInsight> {
    let mut counts: BTreeMap<String, (u64, Vec<String>)> = BTreeMap::new();
    for asset in assets.iter().filter(|asset| {
        matches!(
            asset.asset_type.as_str(),
            "agent" | "rule" | "memory" | "soul" | "config"
        )
    }) {
        let entry = counts
            .entry(asset.agent_id.clone())
            .or_insert((0, Vec::new()));
        entry.0 += 1;
        if entry.1.len() < 3 {
            entry.1.push(asset.name.clone());
        }
    }

    let mut items = counts
        .into_iter()
        .map(|(name, (count, samples))| LocalUsageInsight {
            name,
            count,
            source: "agent knowledge base".to_string(),
            detail: samples.join(", "),
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
    items.truncate(6);
    items
}

fn is_primary_skill_asset(asset: &AgentAsset) -> bool {
    let lower_path = asset.file_path.to_lowercase();
    lower_path.ends_with("/skill.md") || lower_path.ends_with("\\skill.md")
}

fn is_builtin_operation_tool(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "bash"
            | "read"
            | "edit"
            | "write"
            | "multiedit"
            | "grep"
            | "glob"
            | "ls"
            | "todo_write"
            | "todowrite"
            | "webfetch"
            | "websearch"
            | "exec_command"
            | "write_stdin"
            | "apply_patch"
            | "view_image"
            | "update_plan"
    )
}

fn is_generic_skill_signal(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        lower.as_str(),
        "access"
            | "auth"
            | "api"
            | "configuration"
            | "config"
            | "readme"
            | "gotchas"
            | "index"
            | "test"
            | "tests"
            | "common"
            | "default"
            | "utils"
    ) || lower.len() < 4
}

fn format_insight_names(items: &[LocalUsageInsight], limit: usize) -> String {
    let names = items
        .iter()
        .take(limit)
        .map(|item| item.name.clone())
        .collect::<Vec<_>>();
    if names.is_empty() {
        "还没有足够线索".to_string()
    } else {
        names.join("、")
    }
}

fn build_humi_agent_reply(
    prompt: &str,
    context: &HumiContextPacket,
    top_skills: &[LocalUsageInsight],
    agent_knowledge: &[LocalUsageInsight],
    operational_tools: &[LocalUsageInsight],
) -> HumiAgentReply {
    let question = prompt.to_lowercase();
    let visible_tools = operational_tools
        .iter()
        .filter(|tool| !is_builtin_operation_tool(&tool.name))
        .cloned()
        .collect::<Vec<_>>();
    let builtin_count = operational_tools
        .iter()
        .filter(|tool| is_builtin_operation_tool(&tool.name))
        .count();
    let primary_skill = top_skills.first();
    let primary_is_generic = primary_skill
        .map(|skill| is_generic_skill_signal(&skill.name))
        .unwrap_or(false);

    let confidence = if top_skills.is_empty() {
        "low"
    } else if primary_is_generic || visible_tools.is_empty() {
        "medium"
    } else {
        "high"
    }
    .to_string();

    let mut steps = vec![
        HumiAgentStep {
            phase: "observe".to_string(),
            title: "先看知识，不先看数量".to_string(),
            content: format!(
                "我读取了 Skill 知识库、Agent 规则/记忆/配置，以及本地会话里的工具统计。问题是：{}",
                if context.question.is_empty() {
                    "你想让我理解最近的工作方式".to_string()
                } else {
                    context.question.clone()
                }
            ),
        },
        HumiAgentStep {
            phase: "filter".to_string(),
            title: "过滤内置工具噪音".to_string(),
            content: if builtin_count > 0 {
                "Bash、Read、Edit、Write 这类内置操作只说明你在密集工程落地，不会被当成真实 skill 偏好。".to_string()
            } else {
                "当前没有明显的内置工具噪音，继续优先看真实 skill 和 agent 规则。".to_string()
            },
        },
    ];

    let skill_read = if let Some(skill) = primary_skill {
        if primary_is_generic {
            format!(
                "`{}` 是一个过泛的 Skill 文件名，我不会把它直接判断成你最常用的技能；它只能说明知识库里存在一类需要继续读描述和标签的能力线索。",
                skill.name
            )
        } else {
            format!(
                "当前最清晰的 Skill 知识线索是 `{}`，来源是 {}。这代表可复用能力覆盖，不等同于真实调用次数。",
                skill.name, skill.source
            )
        }
    } else {
        "我还没有读到足够明确的 SKILL.md，所以暂时不能判断你最常用的技能。".to_string()
    };
    steps.push(HumiAgentStep {
        phase: "assess".to_string(),
        title: "区分 skill 覆盖和真实使用".to_string(),
        content: skill_read.clone(),
    });

    let agent_read = if let Some(agent) = agent_knowledge.first() {
        format!(
            "Agent 知识库里 `{}` 的规则/记忆/配置线索最多，样本包括：{}。",
            agent.name,
            if agent.detail.is_empty() {
                "暂无样本名".to_string()
            } else {
                agent.detail.clone()
            }
        )
    } else {
        "Agent 规则和长期记忆还不够厚，需要继续沉淀。".to_string()
    };
    steps.push(HumiAgentStep {
        phase: "act".to_string(),
        title: "把线索变成用户画像".to_string(),
        content: agent_read,
    });

    let user_preference = context
        .user_preference_candidates
        .first()
        .cloned()
        .unwrap_or_else(|| "少展示底层文件，多给可执行结论和温柔下一步。".to_string());
    let next_memory = context
        .memory_candidates
        .first()
        .cloned()
        .unwrap_or_else(|| "把常用技能、表达偏好、易错点沉淀成个人长期记忆。".to_string());

    let message = if question.contains("最多")
        || question.contains("most")
        || question.contains("top")
        || question.contains("技能")
        || question.contains("skill")
    {
        if primary_is_generic {
            let name = primary_skill
                .map(|skill| skill.name.as_str())
                .unwrap_or("某个 skill");
            format!(
                "这次我不能再简单回答 `{}`。更准确地说：我现在能确认的是，你的本地知识库已经有一批 Skill 描述，但 `{}` 这种名字太泛，不能代表“最常用技能”。我会把 Bash/Read/Edit 这类内置工具排除，只把它们当成工程节奏证据；真正要继续判断的是哪些 SKILL.md 被项目反复引用、哪些规则被会话实际采纳。",
                name, name
            )
        } else if let Some(skill) = primary_skill {
            format!(
                "我现在可以比较稳地说：`{}` 是当前最明显的 Skill 知识线索，但这仍然是“知识库覆盖”，不是百分百真实调用次数。你的工作画像更像是：围绕工程实现快速迭代，同时在把可复用 skill、规则和偏好沉淀成自己的 Agent 底座。",
                skill.name
            )
        } else {
            "我现在还不能判断哪个 skill 用得最多。原因是本地只读到了操作工具和部分 agent 资产，但缺少真实 skill 调用记录。更负责的做法是先建立 skill 索引，再把后续会话里的真实引用写进 HUMHUM 记忆。".to_string()
        }
    } else if question.contains("上下文")
        || question.contains("context")
        || question.contains("怎么喂")
    {
        "现在喂给 Humi 的不是原始文件列表，而是一包整理后的上下文：Skill 知识、Agent 规则/记忆、非内置工具信号、用户偏好候选、风险提醒和下一步记忆。Humi 会先过滤噪音，再把这些转成你能用的个人画像。".to_string()
    } else {
        format!(
            "我会把本地 Agent 线索先翻译成你的个人画像，而不是展示一堆文件。当前最有价值的判断是：{}。我会优先记住：{}",
            skill_read, user_preference
        )
    };

    let cards = vec![
        HumiAgentCard {
            title: "Skill knowledge".to_string(),
            body: if top_skills.is_empty() {
                "还没有足够明确的 SKILL.md 证据。下一步应该建立 skill 索引，而不是猜测使用偏好。"
                    .to_string()
            } else if primary_is_generic {
                format!(
                    "看到了 {}，但首位名称偏泛。Humi 会继续读取描述、标签和真实会话引用，再判断它是不是你的核心能力。",
                    format_insight_names(top_skills, 3)
                )
            } else {
                format!(
                    "当前清晰线索：{}。这代表知识库覆盖，后续需要叠加真实调用记录。",
                    format_insight_names(top_skills, 3)
                )
            },
            tone: "blue".to_string(),
        },
        HumiAgentCard {
            title: "Personal pattern".to_string(),
            body: user_preference,
            tone: "purple".to_string(),
        },
        HumiAgentCard {
            title: "Gentle next step".to_string(),
            body: next_memory,
            tone: "green".to_string(),
        },
    ];

    HumiAgentReply {
        message,
        confidence,
        cards,
        steps,
    }
}

#[cfg(test)]
mod humi_tool_tests {
    use super::{bounded_tool_text, require_memory_confirmation};

    #[test]
    fn tool_text_is_bounded() {
        let text = "x".repeat(7000);
        assert_eq!(bounded_tool_text(&text, 100).len(), 100);
    }

    #[test]
    fn saving_memory_requires_explicit_confirmation() {
        assert!(require_memory_confirmation(false).is_err());
        assert!(require_memory_confirmation(true).is_ok());
    }
}

fn build_humi_context_packet(
    prompt: &str,
    assets: &[AgentAsset],
    type_counts: &BTreeMap<String, usize>,
    agent_counts: &BTreeMap<String, usize>,
    top_tools: &[LocalUsageInsight],
    top_skills: &[LocalUsageInsight],
    agent_knowledge: &[LocalUsageInsight],
    suggested_actions: &[String],
) -> HumiContextPacket {
    let mut observed_workflows = Vec::new();
    let real_tools = top_tools
        .iter()
        .filter(|tool| !is_builtin_operation_tool(&tool.name))
        .collect::<Vec<_>>();
    if let Some(skill) = top_skills.first() {
        observed_workflows.push(format!(
            "Skill 知识库画像：{} 是当前最明显的可复用技能线索",
            skill.name
        ));
    }
    if let Some(agent) = agent_knowledge.first() {
        observed_workflows.push(format!(
            "Agent 知识库画像：{} 的规则、记忆或配置沉淀最多",
            agent.name
        ));
    }
    if let Some(tool) = real_tools.first() {
        observed_workflows.push(format!(
            "专项工具画像：真实非内置工具里最突出的是 {}",
            tool.name
        ));
    }
    if type_counts.get("memory").copied().unwrap_or(0) > 0
        || type_counts.get("note").copied().unwrap_or(0) > 0
    {
        observed_workflows.push("记忆沉淀：已有 memory/note 线索，可以提炼成长期偏好".to_string());
    }
    if observed_workflows.is_empty() {
        observed_workflows.push("上下文仍在建立：先观察常用 Agent 和最近项目文件".to_string());
    }

    let mut user_preference_candidates = Vec::new();
    let mut memory_candidates = Vec::new();
    let mut risk_notes = Vec::new();
    for asset in assets.iter().take(240) {
        let text = format!(
            "{} {}",
            asset.name.to_lowercase(),
            asset.content.to_lowercase()
        );
        if text.contains("raw internals") || text.contains("少看配置") || text.contains("隐藏技术")
        {
            push_unique(
                &mut user_preference_candidates,
                "不要把原始配置、路径、资产数量直接摊给用户；优先解释成可用结论。",
            );
        }
        if text.contains("warm")
            || text.contains("soft")
            || text.contains("温暖")
            || text.contains("可爱")
        {
            push_unique(
                &mut user_preference_candidates,
                "界面应该温暖、柔软、可爱，接近 Humi 的白色和淡彩气质。",
            );
        }
        if text.contains("local-first") || text.contains("本地") {
            push_unique(
                &mut memory_candidates,
                "本地优先是 HUMHUM 的核心优势：先理解用户主机上的上下文。",
            );
        }
        if text.contains("dingtalk") || text.contains("钉钉") || text.contains("阿里钉") {
            push_unique(
                &mut risk_notes,
                "阿里钉不能只做打开 App；需要用户确认后的本地只读索引。",
            );
        }
        if text.contains("dashboard") || text.contains("看板") {
            push_unique(&mut risk_notes, "避免把 HUMHUM 做成数据看板或插件列表。");
        }
    }
    if user_preference_candidates.is_empty() {
        user_preference_candidates
            .push("用户更需要被理解后的结论，而不是扫描过程本身。".to_string());
    }
    if memory_candidates.is_empty() {
        memory_candidates.push("把常用技能、表达偏好、易错点沉淀成个人长期记忆。".to_string());
    }

    let mut context_sources = vec![
        "Skill 知识库：本地 SKILL.md 与 skill metadata".to_string(),
        "Agent 知识库：agent rules / memory / soul / config".to_string(),
        "操作工具统计：Codex / Claude transcript，仅作辅助证据".to_string(),
        "~/.humhum 下的知识、统计和 Humi 记忆文件".to_string(),
    ];
    for agent in agent_counts.keys().take(4) {
        context_sources.push(format!("Agent source: {}", agent));
    }

    let mut evidence_notes = Vec::new();
    if let Some(skill) = top_skills.first() {
        evidence_notes.push(format!(
            "Skill 知识库主信号：{}，来源 {}",
            skill.name, skill.source
        ));
    }
    if let Some(agent) = agent_knowledge.first() {
        evidence_notes.push(format!(
            "Agent 知识库主信号：{}，{} 个相关资产",
            agent.name, agent.count
        ));
    }
    if let Some(tool) = real_tools.first() {
        evidence_notes.push(format!(
            "非内置工具辅助信号：{}，来源 {}",
            tool.name,
            if tool.source.is_empty() {
                "local transcripts"
            } else {
                &tool.source
            }
        ));
    } else if top_tools
        .iter()
        .any(|tool| is_builtin_operation_tool(&tool.name))
    {
        evidence_notes.push(
            "Bash/Read/Edit/Write 等内置工具只作为操作节奏证据，不参与技能画像。".to_string(),
        );
    }
    let top_types = type_counts
        .iter()
        .rev()
        .take(3)
        .map(|(kind, _count)| {
            match kind.as_str() {
                "skill" => "技能",
                "config" => "配置",
                "memory" => "记忆",
                "note" => "笔记",
                "rule" => "规则",
                "agent" => "Agent 角色",
                other => other,
            }
            .to_string()
        })
        .collect::<Vec<_>>()
        .join("、");
    if !top_types.is_empty() {
        evidence_notes.push(format!("知识底座的主要类型：{}", top_types));
    }
    for action in suggested_actions.iter().take(2) {
        evidence_notes.push(format!("系统建议：{}", action));
    }

    HumiContextPacket {
        question: prompt.trim().to_string(),
        observed_workflows,
        user_preference_candidates,
        memory_candidates,
        risk_notes,
        context_sources,
        evidence_notes,
    }
}

fn push_unique(items: &mut Vec<String>, value: &str) {
    if !items.iter().any(|item| item == value) {
        items.push(value.to_string());
    }
}

fn build_local_kernel_summary(
    prompt: &str,
    assets: &[AgentAsset],
    type_counts: &BTreeMap<String, usize>,
    agent_counts: &BTreeMap<String, usize>,
) -> String {
    let top_types = type_counts
        .iter()
        .rev()
        .take(4)
        .map(|(kind, count)| format!("{} {}", count, kind))
        .collect::<Vec<_>>()
        .join(", ");
    let top_agents = agent_counts
        .iter()
        .rev()
        .take(4)
        .map(|(agent, count)| format!("{} {}", count, agent))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "Local HUMHUM kernel processed {} assets for: {}. Asset mix: {}. Agent sources: {}.",
        assets.len(),
        prompt.trim(),
        if top_types.is_empty() {
            "none".to_string()
        } else {
            top_types
        },
        if top_agents.is_empty() {
            "none".to_string()
        } else {
            top_agents
        }
    )
}

fn write_local_kernel_memory(
    session_id: &str,
    options: &LocalAgentKernelOptions,
    summary: &str,
    suggested_actions: &[String],
) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let memory_path = home.join(".humhum").join("local-agent-memory.md");
    if let Some(parent) = memory_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create local memory dir: {}", e))?;
    }

    let mut entry = String::new();
    entry.push_str("\n\n## Local Agent Kernel Run\n");
    entry.push_str(&format!("- session: `{}`\n", session_id));
    entry.push_str(&format!("- time: `{}`\n", chrono::Utc::now().to_rfc3339()));
    if let Some(cwd) = &options.cwd {
        entry.push_str(&format!("- cwd: `{}`\n", cwd));
    }
    entry.push_str(&format!("- prompt: {}\n", options.prompt.trim()));
    entry.push_str(&format!("- summary: {}\n", summary));
    entry.push_str("- next actions:\n");
    for action in suggested_actions {
        entry.push_str(&format!("  - {}\n", action));
    }

    let mut content = if memory_path.exists() {
        std::fs::read_to_string(&memory_path).unwrap_or_default()
    } else {
        "# HUMHUM Local Agent Memory\n\nThis file is maintained by HUMHUM's local fallback agent kernel.\n".to_string()
    };
    content.push_str(&entry);
    std::fs::write(&memory_path, content)
        .map_err(|e| format!("Failed to write local kernel memory: {}", e))?;

    Ok(memory_path.to_string_lossy().to_string())
}

fn emit_local_kernel_event(
    app_handle: &tauri::AppHandle,
    session_id: &str,
    hook_event_name: &str,
    payload: Value,
    cwd: Option<String>,
) {
    let event = HookEvent {
        id: uuid::Uuid::new_v4().to_string(),
        hook_event_name: hook_event_name.to_string(),
        session_id: session_id.to_string(),
        transcript_path: None,
        cwd,
        client_type: "local-humhum".to_string(),
        payload,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    if let Some(store) = app_handle.try_state::<Arc<std::sync::Mutex<SessionStore>>>() {
        if let Ok(mut store) = store.lock() {
            store.update_from_event(&event);
        }
    }

    event_bus::emit_hook_event(app_handle, &event);
}

#[cfg(test)]
mod humi_agent_kernel_tests {
    use super::*;

    fn asset(
        asset_type: &str,
        agent_id: &str,
        name: &str,
        relative_path: &str,
        content: &str,
    ) -> AgentAsset {
        AgentAsset {
            id: format!("{}:{}:{}", agent_id, asset_type, relative_path),
            asset_type: asset_type.to_string(),
            agent_id: agent_id.to_string(),
            name: name.to_string(),
            file_path: format!("/tmp/humhum/{}", relative_path),
            relative_path: relative_path.to_string(),
            source: "test".to_string(),
            content: content.to_string(),
            tags: Vec::new(),
            modified_at: None,
        }
    }

    #[test]
    fn top_skill_assets_prioritize_real_skill_over_generic_files() {
        let assets = vec![
            asset(
                "skill",
                "codex",
                "access",
                "access/SKILL.md",
                "generic access helper",
            ),
            asset(
                "skill",
                "codex",
                "configuration",
                "configuration/SKILL.md",
                "generic configuration helper",
            ),
            asset(
                "skill",
                "codex",
                "github:yeet",
                "github/yeet/SKILL.md",
                "Publish local changes to GitHub safely.",
            ),
        ];

        let top_skills = collect_top_skill_assets(&assets);

        assert_eq!(
            top_skills.first().map(|item| item.name.as_str()),
            Some("github:yeet")
        );
        assert!(!top_skills.iter().any(|item| item.name == "access"));
    }

    #[test]
    fn humi_reply_uses_filtered_skill_profile_instead_of_builtin_tools() {
        let top_skills = vec![LocalUsageInsight {
            name: "github:yeet".to_string(),
            count: 1,
            source: "codex".to_string(),
            detail: "/tmp/humhum/github/yeet/SKILL.md".to_string(),
        }];
        let operational_tools = vec![
            LocalUsageInsight {
                name: "Bash".to_string(),
                count: 47,
                source: "claude-code".to_string(),
                detail: "Observed in local transcripts".to_string(),
            },
            LocalUsageInsight {
                name: "Read".to_string(),
                count: 42,
                source: "claude-code".to_string(),
                detail: "Observed in local transcripts".to_string(),
            },
        ];
        let context = HumiContextPacket {
            question: "现在技能用得最多的是啥？".to_string(),
            observed_workflows: vec!["工程实现和发布流很明显".to_string()],
            user_preference_candidates: vec!["少展示原始配置，多给结论和下一步。".to_string()],
            memory_candidates: vec!["把常用技能、表达偏好、易错点沉淀成个人长期记忆。".to_string()],
            risk_notes: Vec::new(),
            context_sources: Vec::new(),
            evidence_notes: Vec::new(),
        };

        let reply = build_humi_agent_reply(
            "现在技能用得最多的是啥？",
            &context,
            &top_skills,
            &[],
            &operational_tools,
        );

        assert!(reply.message.contains("github:yeet"));
        assert!(reply
            .steps
            .iter()
            .any(|step| step.content.contains("内置操作")));
        assert!(!reply.message.contains("Bash 是当前最常用技能"));
    }
}
