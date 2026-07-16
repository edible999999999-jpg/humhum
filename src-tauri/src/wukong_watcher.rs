use crate::event_bus::{self, HookEvent};
use crate::session_store::SessionStore;
use rusqlite::{params, Connection, OpenFlags};
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
    let mut last_tool_ts = String::new();
    let mut last_session_id = String::new();
    let mut logged_missing = false;
    let mut initialized = false;

    loop {
        let Some(db_path) = get_db_path() else {
            if !logged_missing {
                log::info!("[Wukong] Waiting for ~/.r2c/logs/session-capture.db");
                logged_missing = true;
            }
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
            continue;
        };
        if logged_missing {
            log::info!("[Wukong] r2c database is now available");
            logged_missing = false;
        }

        if !initialized {
            last_tool_ts = latest_tool_timestamp(&db_path).unwrap_or_default();
            initialized = true;
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
            continue;
        }

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

        std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
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
    let connection = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let _ = connection.busy_timeout(Duration::from_millis(250));
    let rows = if since.is_empty() {
        let mut statement = connection
            .prepare(
                "SELECT gmt_create, tool_name, session_id, status \
                 FROM session_tool_call \
                 WHERE client_type = 'wukong' \
                 ORDER BY gmt_create DESC LIMIT 1",
            )
            .ok()?;
        let mapped = statement
            .query_map([], map_tool_call_row)
            .ok()?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        mapped
    } else {
        let mut statement = connection
            .prepare(
                "SELECT gmt_create, tool_name, session_id, status \
                 FROM session_tool_call \
                 WHERE client_type = 'wukong' AND gmt_create > ?1 \
                 ORDER BY gmt_create ASC LIMIT 50",
            )
            .ok()?;
        let mapped = statement
            .query_map(params![since], map_tool_call_row)
            .ok()?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        mapped
    };

    if rows.is_empty() {
        None
    } else {
        Some(rows)
    }
}

fn map_tool_call_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(String, String, String, String)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}

fn update_session(app_handle: &tauri::AppHandle, event: &HookEvent) {
    use tauri::Manager;
    if let Some(store) = app_handle.try_state::<Arc<std::sync::Mutex<SessionStore>>>() {
        if let Ok(mut store) = store.lock() {
            store.update_from_event(event);
        }
    }
}
