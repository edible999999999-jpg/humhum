use crate::event_bus::{self, HookEvent};
use crate::session_store::SessionStore;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::sync::Arc;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const QODER_LOG_DIR: &str = ".qoderwork/logs/sessions";
const POLL_INTERVAL_SECS: u64 = 2;
const STALE_FILE_THRESHOLD_SECS: u64 = 300; // 5 minutes without updates = stale

/// Start watching QoderWork session logs for events
pub fn start_watcher(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        log::info!("QoderWork log watcher started");
        run_watcher(app_handle);
    });
}

fn run_watcher(app_handle: tauri::AppHandle) {
    let log_dir = dirs::home_dir()
        .map(|h| h.join(QODER_LOG_DIR))
        .unwrap_or_else(|| PathBuf::from(QODER_LOG_DIR));

    if !log_dir.exists() {
        log::warn!("QoderWork log directory does not exist: {:?}", log_dir);
        return;
    }

    let mut current_file: Option<PathBuf> = None;
    let mut last_line: usize = 0;
    let mut processed_events: HashSet<String> = HashSet::new();

    loop {
        // Find the most recently modified JSONL file
        let latest_file = find_latest_jsonl(&log_dir);

        // Switch to new file if found
        if let Some(ref new_file) = latest_file {
            if current_file.as_ref() != Some(new_file) {
                log::info!("Switching to new log file: {:?}", new_file);
                current_file = Some(new_file.clone());
                last_line = 0;
                processed_events.clear();
            }
        }

        // Read new lines from current file
        if let Some(ref file_path) = current_file {
            match read_new_lines(file_path, last_line) {
                Ok((new_lines, total_lines)) => {
                    for line in new_lines {
                        process_log_line(&line, &app_handle, &mut processed_events);
                    }
                    last_line = total_lines;
                }
                Err(e) => {
                    log::error!("Failed to read log file: {}", e);
                }
            }

            // Check if file is stale (no updates for a while)
            if is_stale(file_path) {
                log::debug!("Log file is stale, will look for newer file");
            }
        }

        std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
    }
}

/// Find the most recently modified JSONL file in the sessions directory
fn find_latest_jsonl(log_dir: &Path) -> Option<PathBuf> {
    let mut latest: Option<(SystemTime, PathBuf)> = None;

    if let Ok(entries) = fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Check segments subdirectory
                let segments_dir = path.join("segments");
                if segments_dir.exists() {
                    if let Ok(seg_entries) = fs::read_dir(&segments_dir) {
                        for seg_entry in seg_entries.flatten() {
                            let seg_path = seg_entry.path();
                            if seg_path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                                if let Ok(metadata) = fs::metadata(&seg_path) {
                                    if let Ok(modified) = metadata.modified() {
                                        if latest.is_none() || Some(modified) > latest.as_ref().map(|(t, _)| *t) {
                                            latest = Some((modified, seg_path));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    latest.map(|(_, path)| path)
}

/// Read new lines from a file starting from a given line number
fn read_new_lines(file_path: &Path, start_line: usize) -> Result<(Vec<String>, usize), std::io::Error> {
    let file = fs::File::open(file_path)?;
    let reader = BufReader::new(file);
    let mut lines: Vec<String> = Vec::new();
    let mut total = 0;

    for (i, line) in reader.lines().enumerate() {
        if i >= start_line {
            if let Ok(l) = line {
                lines.push(l);
            }
        }
        total = i + 1;
    }

    Ok((lines, total))
}

/// Check if a file hasn't been modified recently
fn is_stale(file_path: &Path) -> bool {
    if let Ok(metadata) = fs::metadata(file_path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.elapsed() {
                return elapsed.as_secs() > STALE_FILE_THRESHOLD_SECS;
            }
        }
    }
    true
}

/// Process a single log line and emit events if needed
fn process_log_line(line: &str, app_handle: &tauri::AppHandle, processed: &mut HashSet<String>) {
    // Parse JSON
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return, // Not valid JSON, skip
    };

    let event_type = match value.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return,
    };

    // Generate a unique key for this event to avoid duplicates
    let event_key = format!("{}-{}", 
        value.get("seq").and_then(|v| v.as_u64()).unwrap_or(0),
        event_type
    );

    if processed.contains(&event_key) {
        return;
    }
    processed.insert(event_key);

    let timestamp = value
        .get("ts")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    match event_type {
        "permission.requested" => {
            // Permission request — needs user confirmation
            let tool_name = value
                .get("data")
                .and_then(|d| d.get("tool_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            let event = HookEvent {
                id: uuid::Uuid::new_v4().to_string(),
                hook_event_name: "PermissionRequest".to_string(),
                session_id: value
                    .get("turn_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                transcript_path: None,
                cwd: None,
                client_type: "qoderwork".to_string(),
                payload: serde_json::json!({
                    "source": "qoderwork",
                    "tool_name": tool_name,
                    "timestamp": timestamp,
                }),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };

            log::info!("QoderWork permission requested: {}", tool_name);
            event_bus::emit_hook_event(app_handle, &event);
            update_session(app_handle, &event);
            event_bus::emit_status_change(app_handle, "waiting-confirmation");
        }

        "session.phase.finished" => {
            // Session phase completed — only emit for meaningful agent phases
            let phase = value
                .get("data")
                .and_then(|d| d.get("phase"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Skip internal/attachment phases, only emit for agent response phases
            let is_meaningful = phase.contains("agent")
                || phase.contains("response")
                || phase == "turn"
                || phase.contains("execution")
                || (phase.contains("finished") && !phase.contains("attachments"));

            if is_meaningful {
                let event = HookEvent {
                    id: uuid::Uuid::new_v4().to_string(),
                    hook_event_name: "TaskCompleted".to_string(),
                    session_id: value
                        .get("turn_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    transcript_path: None,
                    cwd: None,
                    client_type: "qoderwork".to_string(),
                    payload: serde_json::json!({
                        "source": "qoderwork",
                        "phase": phase,
                        "timestamp": timestamp,
                    }),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                };

                log::info!("QoderWork task completed: phase={}", phase);
                event_bus::emit_hook_event(app_handle, &event);
            update_session(app_handle, &event);
            } else {
                log::debug!("QoderWork phase finished (skipped): {}", phase);
            }
        }

        "tool.shell.started" => {
            // Shell command started
            let command = value
                .get("data")
                .and_then(|d| d.get("command"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let event = HookEvent {
                id: uuid::Uuid::new_v4().to_string(),
                hook_event_name: "ToolExecution".to_string(),
                session_id: value
                    .get("turn_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                transcript_path: None,
                cwd: None,
                client_type: "qoderwork".to_string(),
                payload: serde_json::json!({
                    "source": "qoderwork",
                    "tool_name": "Bash",
                    "command": command,
                    "timestamp": timestamp,
                }),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };

            log::info!("QoderWork shell started: {}", &command[..command.len().min(50)]);
            event_bus::emit_hook_event(app_handle, &event);
            update_session(app_handle, &event);
        }

        "model.response.completed" => {
            // Model response completed
            let event = HookEvent {
                id: uuid::Uuid::new_v4().to_string(),
                hook_event_name: "ResponseCompleted".to_string(),
                session_id: value
                    .get("turn_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                transcript_path: None,
                cwd: None,
                client_type: "qoderwork".to_string(),
                payload: serde_json::json!({
                    "source": "qoderwork",
                    "timestamp": timestamp,
                }),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };

            log::info!("QoderWork response completed");
            event_bus::emit_hook_event(app_handle, &event);
            update_session(app_handle, &event);
        }

        _ => {
            // Other events — ignore for now
        }
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
