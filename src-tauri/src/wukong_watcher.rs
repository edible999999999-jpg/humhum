use crate::event_bus::{self, HookEvent};
use crate::session_store::SessionStore;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

const POLL_INTERVAL_SECS: u64 = 5;

/// Start watching the r2c SQLite database for Wukong tool calls
pub fn start_watcher(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        log::info!("[Wukong] r2c database watcher started");
        run_watcher(app_handle);
    });
}

fn get_db_path() -> Option<std::path::PathBuf> {
    let path = dirs::home_dir()?.join(".r2c/logs/session-capture.db");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn run_watcher(app_handle: tauri::AppHandle) {
    let db_path = match get_db_path() {
        Some(p) => p,
        None => {
            log::warn!("[Wukong] r2c database not found at ~/.r2c/logs/session-capture.db");
            return;
        }
    };

    let mut last_tool_ts = latest_tool_timestamp(&db_path).unwrap_or_default();
    let mut last_session_id = String::new();

    loop {
        std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));

        // Query new tool calls since last check
        if let Some(events) = query_new_tool_calls(&db_path, &last_tool_ts) {
            for (ts, tool_name, session_id, status) in &events {
                let event = HookEvent {
                    id: uuid::Uuid::new_v4().to_string(),
                    hook_event_name: if status == "success" {
                        "PostToolUse".to_string()
                    } else {
                        "PreToolUse".to_string()
                    },
                    session_id: session_id.clone(),
                    transcript_path: None,
                    cwd: None,
                    client_type: "wukong".to_string(),
                    payload: serde_json::json!({
                        "source": "wukong",
                        "tool_name": tool_name,
                        "status": status,
                        "timestamp": ts,
                    }),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                };

                // Detect session changes
                if !session_id.is_empty() && *session_id != last_session_id {
                    last_session_id = session_id.clone();
                    log::info!(
                        "[Wukong] New session: {}",
                        &session_id[..session_id.len().min(40)]
                    );
                }

                log::debug!("[Wukong] Tool: {} ({})", tool_name, status);
                event_bus::emit_hook_event(&app_handle, &event);
                update_session(&app_handle, &event);

                if ts > &last_tool_ts {
                    last_tool_ts = ts.clone();
                }
            }
        }
    }
}

fn latest_tool_timestamp(db_path: &std::path::Path) -> Option<String> {
    query_new_tool_calls(db_path, "")
        .and_then(|events| events.into_iter().next())
        .map(|(ts, _, _, _)| ts)
}

/// Query session_tool_call table for new wukong entries
fn query_new_tool_calls(
    db_path: &std::path::Path,
    since: &str,
) -> Option<Vec<(String, String, String, String)>> {
    let query = if since.is_empty() {
        "SELECT gmt_create, tool_name, session_id, status FROM session_tool_call WHERE client_type='wukong' ORDER BY gmt_create DESC LIMIT 1".to_string()
    } else {
        format!(
            "SELECT gmt_create, tool_name, session_id, status FROM session_tool_call WHERE client_type='wukong' AND gmt_create > '{}' ORDER BY gmt_create ASC LIMIT 50",
            since.replace('\'', "")
        )
    };

    let output = Command::new("sqlite3")
        .arg("-separator")
        .arg("|")
        .arg(db_path)
        .arg(&query)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let results: Vec<(String, String, String, String)> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() >= 4 {
                Some((
                    parts[0].to_string(),
                    parts[1].to_string(),
                    parts[2].to_string(),
                    parts[3].to_string(),
                ))
            } else {
                None
            }
        })
        .collect();

    if results.is_empty() {
        None
    } else {
        Some(results)
    }
}

fn update_session(app_handle: &tauri::AppHandle, event: &HookEvent) {
    use tauri::Manager;
    if let Some(store) = app_handle.try_state::<Arc<std::sync::Mutex<SessionStore>>>() {
        if let Ok(mut store) = store.lock() {
            store.update_from_event(event);
        }
    }
}
