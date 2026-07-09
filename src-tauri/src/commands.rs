use crate::client_registry::{self, ConfigFormat};
use crate::window_focus;
use crate::config::AppConfig;
use crate::event_bus::PermissionDecision;
use crate::hook_server::PendingMap;
use crate::session_store::SessionStore;
use crate::stats_store::StatsStore;
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use tauri::{Manager, State};

const HUMHUM_HOOK_SCRIPT: &str = include_str!("../../hooks/humhum-hook.sh");

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
                        group.get("hooks")
                            .and_then(|h| h.as_array())
                            .map(|hooks| hooks.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("humhum-hook"))
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
    let mut settings: Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    // Remove HumHum hook events
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
                    let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                        x.max(0) as f64,
                        y.max(0) as f64,
                    )));
                }
            }

            win.show().map_err(|e| format!("Failed to show: {}", e))?;
            win.set_focus().map_err(|e| format!("Failed to focus: {}", e))?;

            // Set window level AFTER show/focus so Tauri can't reset it
            #[cfg(target_os = "macos")]
            {
                use cocoa::base::id;
                use objc::{msg_send, sel, sel_impl};
                if let Ok(ns_win) = win.ns_window() {
                    let ns_win = ns_win as id;
                    let ns_win_ptr = ns_win as usize;
                    dispatch::Queue::main().exec_async(move || unsafe {
                        let ns_win = ns_win_ptr as id;
                        // Same collection behavior as main window
                        let _: () = msg_send![ns_win, setCollectionBehavior: 4433_u64];
                        let _: () = msg_send![ns_win, setLevel: 1501_i64];
                        let _: () = msg_send![ns_win, setHidesOnDeactivate: false];
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
    log::info!("[Permission] Responding to {} with behavior={}", event_id, behavior);
    let mut map = pending.lock().await;
    if let Some(mut pr) = map.remove(&event_id) {
        if let Some(sender) = pr.sender.take() {
            let decision = PermissionDecision {
                behavior: behavior.clone(),
                reason,
            };
            match sender.send(decision) {
                Ok(_) => {
                    log::info!("[Permission] Decision sent successfully: {}", behavior);
                    Ok(())
                }
                Err(_) => {
                    log::error!("[Permission] Receiver dropped — HTTP connection already timed out");
                    Err("Connection timed out — hook already expired. Try responding faster next time.".to_string())
                }
            }
        } else {
            log::warn!("[Permission] Already responded to {}", event_id);
            Err("Already responded to this request".to_string())
        }
    } else {
        log::warn!("[Permission] No pending request found for {}", event_id);
        Err(format!("No pending permission request with id: {}", event_id))
    }
}

/// Focus the terminal application
#[tauri::command]
pub async fn focus_terminal() -> Result<(), String> {
    window_focus::focus_terminal_app()
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

    let hook_script = ensure_hook_script_installed(&home)?;
    let hook_cmd = format!(
        "{} --client {}",
        shell_quote(&hook_script.to_string_lossy()),
        shell_quote(&client_id)
    );

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
                                .map(|c| c.contains("humhum"))
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

fn ensure_hook_script_installed(home: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let hook_dir = home.join(".humhum").join("hooks");
    std::fs::create_dir_all(&hook_dir)
        .map_err(|e| format!("Failed to create hook dir: {}", e))?;

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
    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read: {}", e))?;
    let mut settings: Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for event in events {
            if let Some(arr) = hooks.get_mut(*event).and_then(|v| v.as_array_mut()) {
                // Remove only humhum-specific hook groups, preserve others
                arr.retain(|group| {
                    !group.get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| hs.iter().any(|h| {
                            h.get("command")
                                .and_then(|c| c.as_str())
                                .map(|c| c.contains("humhum"))
                                .unwrap_or(false)
                        }))
                        .unwrap_or(false)
                });
                // Remove the event key entirely if no hooks remain
                if arr.is_empty() {
                    hooks.remove(*event);
                }
            }
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
        return Err(format!("HTTP {}: {}", status, &text[..text.len().min(200)]));
    }

    Ok(text)
}

/// Proxy HTTP POST request through Rust — returns binary as base64 (for TTS)
#[tauri::command]
pub async fn proxy_post_binary(url: String, headers: Value, body: String) -> Result<String, String> {
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
        return Err(format!("HTTP {}: {}", status, &text[..text.len().min(200)]));
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

    let status = child.wait().await
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

/// Check which clients have HumHum hooks installed
#[tauri::command]
pub async fn check_hooks_status() -> Result<Value, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let mut statuses = serde_json::Map::new();
    for client in client_registry::get_all_clients() {
        let config_path = home.join(client.config_path);
        let installed = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path).unwrap_or_default();
            content.contains("humhum")
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

// ============================================================
// Qoder IDE Auto-Allow (Rage Mode)
// ============================================================

const QODER_AUTO_ALLOW_SCRIPT: &str = r#"#!/bin/bash
# Qoder IDE Auto-Allow Permission Hook — managed by HumHum
# Supports both PreToolUse and PermissionRequest events
set -euo pipefail
trap 'exit 0' ERR
read -r PAYLOAD 2>/dev/null || true
HOOK_EVENT="$(echo "$PAYLOAD" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null || true)"
if [ "$HOOK_EVENT" = "PreToolUse" ] || [ "$HOOK_EVENT" = "PermissionRequest" ]; then
    echo '{"hookSpecificOutput":{"permissionDecision":"allow","continueWithPrompt":false}}'
fi
exit 0
"#;

/// Enable or disable Qoder IDE auto-allow (rage mode)
#[tauri::command]
pub async fn toggle_qoder_auto_allow(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    enable: bool,
) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".qoder").join("settings.json");

    if enable {
        // 1. Write auto-allow hook script
        let hook_dir = home.join(".qoder").join("hooks");
        std::fs::create_dir_all(&hook_dir)
            .map_err(|e| format!("Failed to create hooks dir: {}", e))?;
        let hook_script = hook_dir.join("auto-allow-permission.sh");
        std::fs::write(&hook_script, QODER_AUTO_ALLOW_SCRIPT)
            .map_err(|e| format!("Failed to write hook script: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&hook_script)
                .map_err(|e| format!("Failed to stat: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&hook_script, perms)
                .map_err(|e| format!("Failed to chmod: {}", e))?;
        }

        // 2. Add PreToolUse + PermissionRequest hooks to ~/.qoder/settings.json
        let mut settings: Value = if settings_path.exists() {
            let content = std::fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read settings: {}", e))?;
            serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        let hook_entry = serde_json::json!({
            "matcher": "*",
            "hooks": [{"type": "command", "command": "~/.qoder/hooks/auto-allow-permission.sh", "timeout": 5}]
        });

        let hooks = settings
            .as_object_mut()
            .map(|obj| obj.entry("hooks"))
            .and_then(|e| e.or_insert_with(|| serde_json::json!({})).as_object_mut());

        if let Some(hooks_obj) = hooks {
            // Append to existing array or create new one
            let upsert_hook = |obj: &mut serde_json::Map<String, Value>, key: &str, entry: &Value| {
                if let Some(existing) = obj.get_mut(key).and_then(|v| v.as_array_mut()) {
                    existing.push(entry.clone());
                } else {
                    obj.insert(key.to_string(), serde_json::json!([entry]));
                }
            };
            upsert_hook(hooks_obj, "PermissionRequest", &hook_entry);
            upsert_hook(hooks_obj, "PreToolUse", &hook_entry);
        }

        let content = serde_json::to_string_pretty(&settings)
            .map_err(|e| format!("Serialize error: {}", e))?;
        std::fs::write(&settings_path, content)
            .map_err(|e| format!("Write error: {}", e))?;

        // 3. Persist to humhum config
        {
            let mut cfg = config.lock().map_err(|e| format!("Lock error: {}", e))?;
            cfg.qoder_auto_allow = true;
            cfg.save()?;
        }

        log::info!("[QoderRage] Enabled — PreToolUse + PermissionRequest auto-allow installed");
        Ok(true)
    } else {
        // Disable: remove PermissionRequest + PreToolUse from ~/.qoder/settings.json
        if settings_path.exists() {
            let content = std::fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read: {}", e))?;
            let mut settings: Value =
                serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
            if let Some(hooks) = settings
                .as_object_mut()
                .and_then(|obj| obj.get_mut("hooks"))
                .and_then(|v| v.as_object_mut())
            {
                hooks.remove("PermissionRequest");
                hooks.remove("PreToolUse");
            }
            let content = serde_json::to_string_pretty(&settings)
                .map_err(|e| format!("Serialize error: {}", e))?;
            std::fs::write(&settings_path, content)
                .map_err(|e| format!("Write error: {}", e))?;
        }

        // Persist to humhum config
        {
            let mut cfg = config.lock().map_err(|e| format!("Lock error: {}", e))?;
            cfg.qoder_auto_allow = false;
            cfg.save()?;
        }

        log::info!("[QoderRage] Disabled — PreToolUse + PermissionRequest hooks removed");
        Ok(false)
    }
}

/// Check if Qoder IDE auto-allow is enabled
#[tauri::command]
pub async fn get_qoder_auto_allow_status() -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".qoder").join("settings.json");
    if !settings_path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read: {}", e))?;
    let settings: Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
    Ok(settings
        .get("hooks")
        .and_then(|h| h.get("PreToolUse"))
        .is_some())
}

// ============================================================
// QoderWork Auto-Allow (Rage Mode)
// ============================================================

const QODERWORK_AUTO_ALLOW_SCRIPT: &str = r#"#!/bin/bash
# QoderWork Auto-Allow Permission Hook — managed by HumHum
set -euo pipefail
trap 'exit 0' ERR
read -r PAYLOAD 2>/dev/null || true
HOOK_EVENT="$(echo "$PAYLOAD" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null || true)"
if [ "$HOOK_EVENT" = "PermissionRequest" ]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
fi
exit 0
"#;

/// Enable or disable QoderWork auto-allow (rage mode)
#[tauri::command]
pub async fn toggle_qoderwork_auto_allow(
    config: State<'_, Arc<std::sync::Mutex<AppConfig>>>,
    enable: bool,
) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".qoderwork").join("settings.json");

    if enable {
        // 1. Write auto-allow hook script
        let hook_dir = home.join(".qoderwork").join("hooks");
        std::fs::create_dir_all(&hook_dir)
            .map_err(|e| format!("Failed to create hooks dir: {}", e))?;
        let hook_script = hook_dir.join("auto-allow-permission.sh");
        std::fs::write(&hook_script, QODERWORK_AUTO_ALLOW_SCRIPT)
            .map_err(|e| format!("Failed to write hook script: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&hook_script)
                .map_err(|e| format!("Failed to stat: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&hook_script, perms)
                .map_err(|e| format!("Failed to chmod: {}", e))?;
        }

        // 2. Add PermissionRequest hook to ~/.qoderwork/settings.json
        let mut settings: Value = if settings_path.exists() {
            let content = std::fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read settings: {}", e))?;
            serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        let hook_entry = serde_json::json!({
            "matcher": "*",
            "hooks": [{"type": "command", "command": "~/.qoderwork/hooks/auto-allow-permission.sh", "timeout": 5}]
        });

        let hooks = settings
            .as_object_mut()
            .map(|obj| obj.entry("hooks"))
            .and_then(|e| e.or_insert_with(|| serde_json::json!({})).as_object_mut());

        if let Some(hooks_obj) = hooks {
            if !hooks_obj.contains_key("PermissionRequest") {
                hooks_obj.insert(
                    "PermissionRequest".to_string(),
                    serde_json::json!([hook_entry]),
                );
            }
        }

        let content = serde_json::to_string_pretty(&settings)
            .map_err(|e| format!("Serialize error: {}", e))?;
        std::fs::write(&settings_path, content)
            .map_err(|e| format!("Write error: {}", e))?;

        // 3. Persist to humhum config
        {
            let mut cfg = config.lock().map_err(|e| format!("Lock error: {}", e))?;
            cfg.qoderwork_auto_allow = true;
            cfg.save()?;
        }

        log::info!("[QoderWorkRage] Enabled — PermissionRequest auto-allow installed");
        Ok(true)
    } else {
        if settings_path.exists() {
            let content = std::fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read: {}", e))?;
            let mut settings: Value =
                serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
            if let Some(hooks) = settings
                .as_object_mut()
                .and_then(|obj| obj.get_mut("hooks"))
                .and_then(|v| v.as_object_mut())
            {
                hooks.remove("PermissionRequest");
            }
            let content = serde_json::to_string_pretty(&settings)
                .map_err(|e| format!("Serialize error: {}", e))?;
            std::fs::write(&settings_path, content)
                .map_err(|e| format!("Write error: {}", e))?;
        }

        {
            let mut cfg = config.lock().map_err(|e| format!("Lock error: {}", e))?;
            cfg.qoderwork_auto_allow = false;
            cfg.save()?;
        }

        log::info!("[QoderWorkRage] Disabled — PermissionRequest hook removed");
        Ok(false)
    }
}

/// Check if QoderWork auto-allow is enabled
#[tauri::command]
pub async fn get_qoderwork_auto_allow_status() -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".qoderwork").join("settings.json");
    if !settings_path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read: {}", e))?;
    let settings: Value =
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
    Ok(settings
        .get("hooks")
        .and_then(|h| h.get("PermissionRequest"))
        .is_some())
}