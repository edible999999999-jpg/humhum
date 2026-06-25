use crate::client_registry::{self, ConfigFormat};
use crate::window_focus;
use crate::config::AppConfig;
use crate::event_bus::PermissionDecision;
use crate::hook_server::PendingMap;
use crate::session_store::SessionStore;
use serde_json::Value;
use std::sync::Arc;
use tauri::{Manager, State};

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
    std::fs::create_dir_all(&claude_dir).map_err(|e| format!("Failed to create .claude dir: {}", e))?;

    // Read existing settings or create new
    let mut settings: Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Determine hook script path
    let hook_script = home.join(".devpod").join("hooks").join("devpod-hook.sh");
    let hook_cmd = hook_script.to_string_lossy().to_string();

    // Build hooks configuration
    let devpod_hooks = serde_json::json!({
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
        if let Some(new_hooks) = devpod_hooks.as_object() {
            for (key, value) in new_hooks {
                if let Some(existing_arr) = merged.get(key).and_then(|v| v.as_array()) {
                    // Check if devpod hook already exists in this event
                    let already_installed = existing_arr.iter().any(|group| {
                        group.get("hooks")
                            .and_then(|h| h.as_array())
                            .map(|hooks| hooks.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("devpod-hook"))
                                    .unwrap_or(false)
                            }))
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
        settings["hooks"] = devpod_hooks;
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

/// Uninstall DevPod hooks from ~/.claude/settings.json
#[tauri::command]
pub async fn uninstall_hooks() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".claude").join("settings.json");

    if !settings_path.exists() {
        return Ok("No Claude Code settings found".to_string());
    }

    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    let mut settings: Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    // Remove DevPod hook events
    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        let events = [
            "PermissionRequest",
            "Stop",
            "TaskCompleted",
            "Notification",
        ];
        for event in &events {
            hooks.remove(*event);
        }
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write: {}", e))?;

    Ok("DevPod hooks removed from Claude Code settings".to_string())
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
            win.show().map_err(|e| format!("Failed to show: {}", e))?;
            win.set_focus().map_err(|e| format!("Failed to focus: {}", e))?;
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
    let sessions = store.get_all_sessions();
    serde_json::to_value(sessions).map_err(|e| format!("Serialize error: {}", e))
}

/// Get a specific session by ID
#[tauri::command]
pub async fn get_session(
    store: State<'_, Arc<std::sync::Mutex<SessionStore>>>,
    session_id: String,
) -> Result<Value, String> {
    let store = store.lock().map_err(|e| format!("Lock error: {}", e))?;
    match store.get_session(&session_id) {
        Some(session) => serde_json::to_value(session).map_err(|e| format!("Serialize error: {}", e)),
        None => Err(format!("Session not found: {}", session_id)),
    }
}

/// Respond to a pending permission request from the frontend
#[tauri::command]
pub async fn respond_to_permission(
    pending: State<'_, PendingMap>,
    event_id: String,
    behavior: String,
    reason: Option<String>,
) -> Result<(), String> {
    let mut map = pending.lock().await;
    if let Some(mut pr) = map.remove(&event_id) {
        if let Some(sender) = pr.sender.take() {
            let decision = PermissionDecision {
                behavior,
                reason,
            };
            sender
                .send(decision)
                .map_err(|_| "Failed to send decision (receiver dropped)".to_string())?;
            Ok(())
        } else {
            Err("Already responded to this request".to_string())
        }
    } else {
        Err(format!("No pending permission request with id: {}", event_id))
    }
}

/// Focus the terminal application
#[tauri::command]
pub async fn focus_terminal() -> Result<(), String> {
    window_focus::focus_terminal_app()
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

    let _port = {
        let config = config.lock().map_err(|e| format!("Lock error: {}", e))?;
        config.hook_port
    };

    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let config_path = home.join(profile.config_path);

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    let hook_script = home.join(".devpod").join("hooks").join("devpod-hook.sh");
    let hook_cmd = format!("{}?client={}", hook_script.to_string_lossy(), client_id);

    match profile.config_format {
        ConfigFormat::Json => install_json_hooks(&config_path, &hook_cmd, profile.hook_events)?,
        ConfigFormat::Toml => install_toml_hooks(&config_path, &hook_cmd, profile.hook_events)?,
    }

    Ok(format!("Hooks installed for {} at {:?}", profile.name, config_path))
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
    }

    Ok(format!("Hooks removed for {}", profile.name))
}

fn install_json_hooks(
    config_path: &std::path::Path,
    hook_cmd: &str,
    events: &[&str],
) -> Result<(), String> {
    let mut settings: Value = if config_path.exists() {
        let content = std::fs::read_to_string(config_path)
            .map_err(|e| format!("Failed to read: {}", e))?;
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
            serde_json::json!([{ "hooks": [hook_obj] }]),
        );
    }

    if let Some(existing) = settings.get("hooks").and_then(|h| h.as_object()) {
        let mut merged = existing.clone();
        for (k, v) in hooks {
            if let Some(existing_arr) = merged.get(&k).and_then(|val| val.as_array()) {
                let already = existing_arr.iter().any(|group| {
                    group.get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| hs.iter().any(|h| {
                            h.get("command")
                                .and_then(|c| c.as_str())
                                .map(|c| c.contains("devpod"))
                                .unwrap_or(false)
                        }))
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

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(config_path, content)
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

fn uninstall_json_hooks(config_path: &std::path::Path, events: &[&str]) -> Result<(), String> {
    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read: {}", e))?;
    let mut settings: Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for event in events {
            hooks.remove(*event);
        }
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(config_path, content)
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

fn install_toml_hooks(
    config_path: &std::path::Path,
    hook_cmd: &str,
    events: &[&str],
) -> Result<(), String> {
    let mut content = if config_path.exists() {
        std::fs::read_to_string(config_path)
            .map_err(|e| format!("Failed to read: {}", e))?
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

    std::fs::write(config_path, content)
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

fn uninstall_toml_hooks(config_path: &std::path::Path, events: &[&str]) -> Result<(), String> {
    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read: {}", e))?;

    let filtered: Vec<&str> = content
        .lines()
        .filter(|line| !events.iter().any(|e| line.starts_with(&format!("{} =", e))))
        .collect();

    std::fs::write(config_path, filtered.join("\n"))
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

/// Check which clients have DevPod hooks installed
#[tauri::command]
pub async fn check_hooks_status() -> Result<Value, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let mut statuses = serde_json::Map::new();
    for client in client_registry::get_all_clients() {
        let config_path = home.join(client.config_path);
        let installed = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path).unwrap_or_default();
            content.contains("devpod")
        } else {
            false
        };
        statuses.insert(client.id.to_string(), Value::Bool(installed));
    }
    Ok(Value::Object(statuses))
}
