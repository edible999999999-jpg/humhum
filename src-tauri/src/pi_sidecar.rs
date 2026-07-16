use crate::event_bus::{self, HookEvent};
use crate::session_store::SessionStore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

const PI_CLIENT_TYPE: &str = "pi";
#[cfg(target_os = "windows")]
const PI_EXECUTABLE: &str = "pi.cmd";
#[cfg(not(target_os = "windows"))]
const PI_EXECUTABLE: &str = "pi";

#[derive(Debug, Clone, Serialize)]
pub struct PiInstallStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PiRuntimeState {
    Starting,
    Idle,
    Running,
    Aborted,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct PiSessionStatus {
    pub session_id: String,
    pub state: PiRuntimeState,
    pub cwd: Option<String>,
    pub session_file: Option<String>,
    pub message_count: u32,
    pub last_event_type: Option<String>,
    pub last_error: Option<String>,
    pub started_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PiStartOptions {
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Default)]
pub struct PiSidecarState {
    sessions: Mutex<HashMap<String, PiSessionHandle>>,
}

#[derive(Debug)]
struct PiSessionHandle {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    status: Arc<Mutex<PiSessionStatus>>,
}

impl PiSidecarState {
    pub async fn status(&self, session_id: &str) -> Option<PiSessionStatus> {
        let status = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_id).map(|handle| handle.status.clone())
        }?;
        let snapshot = status.lock().await.clone();
        Some(snapshot)
    }

    pub async fn send_prompt(&self, session_id: &str, message: String) -> Result<(), String> {
        self.write_rpc(
            session_id,
            serde_json::json!({
                "id": Uuid::new_v4().to_string(),
                "type": "prompt",
                "message": message,
                "streamingBehavior": "steer",
            }),
        )
        .await
    }

    pub async fn abort(&self, session_id: &str) -> Result<(), String> {
        self.write_rpc(
            session_id,
            serde_json::json!({
                "id": Uuid::new_v4().to_string(),
                "type": "abort",
            }),
        )
        .await?;

        if let Some(status) = self.status_handle(session_id).await {
            let mut status = status.lock().await;
            status.state = PiRuntimeState::Aborted;
            status.updated_at = chrono::Utc::now().to_rfc3339();
        }

        Ok(())
    }

    pub async fn stop(
        &self,
        app_handle: &tauri::AppHandle,
        session_id: &str,
    ) -> Result<(), String> {
        let handle = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(session_id)
        };

        let Some(handle) = handle else {
            return Err(format!("Pi session not found: {}", session_id));
        };

        {
            let mut child = handle.child.lock().await;
            terminate_process_tree(&mut child).await;
        }

        let mut status = handle.status.lock().await;
        status.state = PiRuntimeState::Stopped;
        status.updated_at = chrono::Utc::now().to_rfc3339();

        emit_pi_event(
            app_handle,
            &status.session_id,
            "SessionEnd",
            serde_json::json!({
                "source": "pi_sidecar",
                "message": "Pi session stopped by HumHum",
            }),
            status.cwd.clone(),
        );

        Ok(())
    }

    async fn write_rpc(&self, session_id: &str, payload: Value) -> Result<(), String> {
        let stdin = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .map(|handle| handle.stdin.clone())
                .ok_or_else(|| format!("Pi session not found: {}", session_id))?
        };

        let mut stdin = stdin.lock().await;
        let mut line = serde_json::to_vec(&payload)
            .map_err(|e| format!("Failed to serialize Pi RPC command: {}", e))?;
        line.push(b'\n');
        stdin
            .write_all(&line)
            .await
            .map_err(|e| format!("Failed to write to Pi RPC stdin: {}", e))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush Pi RPC stdin: {}", e))
    }

    async fn status_handle(&self, session_id: &str) -> Option<Arc<Mutex<PiSessionStatus>>> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).map(|handle| handle.status.clone())
    }
}

pub async fn check_installed() -> PiInstallStatus {
    let mut command = Command::new(PI_EXECUTABLE);
    command.arg("--version").kill_on_drop(true);
    configure_background_process(&mut command);
    let result = tokio::time::timeout(std::time::Duration::from_secs(3), command.output()).await;

    match result {
        Ok(Ok(output)) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            PiInstallStatus {
                installed: true,
                version: if version.is_empty() {
                    None
                } else {
                    Some(version)
                },
                error: None,
            }
        }
        Ok(Ok(output)) => PiInstallStatus {
            installed: false,
            version: None,
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        },
        Ok(Err(e)) => PiInstallStatus {
            installed: false,
            version: None,
            error: Some(e.to_string()),
        },
        Err(_) => PiInstallStatus {
            installed: false,
            version: None,
            error: Some("Timed out while checking pi --version".to_string()),
        },
    }
}

pub async fn start_session(
    app_handle: tauri::AppHandle,
    state: Arc<PiSidecarState>,
    options: PiStartOptions,
) -> Result<PiSessionStatus, String> {
    let session_id = format!("pi-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let session_dir = pi_session_dir()?;
    std::fs::create_dir_all(&session_dir)
        .map_err(|e| format!("Failed to create Pi session dir: {}", e))?;

    let mut command = Command::new(PI_EXECUTABLE);
    configure_background_process(&mut command);
    command
        .arg("--mode")
        .arg("rpc")
        .arg("--session-dir")
        .arg(&session_dir)
        .arg("--no-approve")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    command.kill_on_drop(true);

    if let Some(cwd) = &options.cwd {
        command.current_dir(cwd);
    }
    if let Some(name) = &options.name {
        command.arg("--name").arg(name);
    }
    if let Some(provider) = &options.provider {
        command.arg("--provider").arg(provider);
    }
    if let Some(model) = &options.model {
        command.arg("--model").arg(model);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start pi --mode rpc: {}", e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Pi RPC stdin was not available".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Pi RPC stdout was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Pi RPC stderr was not available".to_string())?;

    let status = Arc::new(Mutex::new(PiSessionStatus {
        session_id: session_id.clone(),
        state: PiRuntimeState::Starting,
        cwd: options.cwd.clone(),
        session_file: None,
        message_count: 0,
        last_event_type: Some("SessionStart".to_string()),
        last_error: None,
        started_at: now.clone(),
        updated_at: now,
    }));

    let handle = PiSessionHandle {
        stdin: Arc::new(Mutex::new(stdin)),
        child: Arc::new(Mutex::new(child)),
        status: status.clone(),
    };

    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(session_id.clone(), handle);
    }

    emit_pi_event(
        &app_handle,
        &session_id,
        "SessionStart",
        serde_json::json!({
            "source": "pi_sidecar",
            "message": "Pi RPC sidecar started",
            "session_dir": session_dir,
        }),
        options.cwd.clone(),
    );

    spawn_stdout_reader(
        app_handle.clone(),
        session_id.clone(),
        options.cwd.clone(),
        status.clone(),
        stdout,
    );
    spawn_stderr_reader(app_handle, session_id, options.cwd, status.clone(), stderr);

    let snapshot = status.lock().await.clone();
    Ok(snapshot)
}

fn configure_background_process(_command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        _command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
}

async fn terminate_process_tree(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        if let Some(process_id) = child.id() {
            let mut taskkill = Command::new("taskkill.exe");
            taskkill.args(["/PID", &process_id.to_string(), "/T", "/F"]);
            configure_background_process(&mut taskkill);
            if taskkill
                .status()
                .await
                .map(|status| status.success())
                .unwrap_or(false)
            {
                let _ = child.wait().await;
                return;
            }
        }
    }

    let _ = child.kill().await;
}

fn spawn_stdout_reader(
    app_handle: tauri::AppHandle,
    session_id: String,
    cwd: Option<String>,
    status: Arc<Mutex<PiSessionStatus>>,
    stdout: tokio::process::ChildStdout,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let parsed: Result<Value, _> = serde_json::from_str(&line);
                    match parsed {
                        Ok(value) => {
                            update_status_from_pi_event(&status, &value).await;
                            let hook_name = map_pi_event_to_hook_name(&value);
                            let payload = normalize_pi_payload(value);
                            emit_pi_event(
                                &app_handle,
                                &session_id,
                                hook_name,
                                payload,
                                cwd.clone(),
                            );
                        }
                        Err(e) => {
                            update_status_error(&status, format!("Invalid Pi JSONL event: {}", e))
                                .await;
                            emit_pi_event(
                                &app_handle,
                                &session_id,
                                "Notification",
                                serde_json::json!({
                                    "source": "pi_sidecar",
                                    "message": line,
                                    "parse_error": e.to_string(),
                                }),
                                cwd.clone(),
                            );
                        }
                    }
                }
                Ok(None) => {
                    update_status_stopped(&status).await;
                    emit_pi_event(
                        &app_handle,
                        &session_id,
                        "SessionEnd",
                        serde_json::json!({
                            "source": "pi_sidecar",
                            "message": "Pi RPC stdout closed",
                        }),
                        cwd.clone(),
                    );
                    break;
                }
                Err(e) => {
                    update_status_error(&status, e.to_string()).await;
                    emit_pi_event(
                        &app_handle,
                        &session_id,
                        "Notification",
                        serde_json::json!({
                            "source": "pi_sidecar",
                            "message": "Pi RPC stdout read failed",
                            "error": e.to_string(),
                        }),
                        cwd.clone(),
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_reader(
    app_handle: tauri::AppHandle,
    session_id: String,
    cwd: Option<String>,
    status: Arc<Mutex<PiSessionStatus>>,
    stderr: tokio::process::ChildStderr,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            update_status_error(&status, line.clone()).await;
            emit_pi_event(
                &app_handle,
                &session_id,
                "Notification",
                serde_json::json!({
                    "source": "pi_sidecar",
                    "message": line,
                    "stream": "stderr",
                }),
                cwd.clone(),
            );
        }
    });
}

async fn update_status_from_pi_event(status: &Arc<Mutex<PiSessionStatus>>, event: &Value) {
    let now = chrono::Utc::now().to_rfc3339();
    let event_type = event
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let mut status = status.lock().await;
    status.last_event_type = Some(event_type.clone());
    status.updated_at = now;

    match event_type.as_str() {
        "agent_start" | "turn_start" | "message_start" | "tool_execution_start" => {
            status.state = PiRuntimeState::Running;
        }
        "agent_end" | "turn_end" => {
            status.state = PiRuntimeState::Idle;
        }
        "response" => {
            if let Some(data) = event.get("data") {
                if let Some(session_file) = data.get("sessionFile").and_then(|v| v.as_str()) {
                    status.session_file = Some(session_file.to_string());
                }
                if let Some(count) = data.get("messageCount").and_then(|v| v.as_u64()) {
                    status.message_count = count as u32;
                }
                if data.get("isStreaming").and_then(|v| v.as_bool()) == Some(true) {
                    status.state = PiRuntimeState::Running;
                } else {
                    status.state = PiRuntimeState::Idle;
                }
            }
            if event.get("success").and_then(|v| v.as_bool()) == Some(false) {
                status.state = PiRuntimeState::Error;
                status.last_error = event
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(String::from);
            }
        }
        _ => {}
    }
}

async fn update_status_error(status: &Arc<Mutex<PiSessionStatus>>, error: String) {
    let mut status = status.lock().await;
    status.state = PiRuntimeState::Error;
    status.last_error = Some(error);
    status.updated_at = chrono::Utc::now().to_rfc3339();
}

async fn update_status_stopped(status: &Arc<Mutex<PiSessionStatus>>) {
    let mut status = status.lock().await;
    status.state = PiRuntimeState::Stopped;
    status.updated_at = chrono::Utc::now().to_rfc3339();
}

fn normalize_pi_payload(mut event: Value) -> Value {
    if let Some(obj) = event.as_object_mut() {
        obj.insert(
            "source".to_string(),
            Value::String("pi_sidecar".to_string()),
        );
        if let Some(pi_type) = obj.get("type").cloned() {
            obj.insert("pi_event_type".to_string(), pi_type);
        }

        if let Some(tool_name) = obj.get("toolName").cloned() {
            obj.insert("tool_name".to_string(), tool_name);
        }

        if !obj.contains_key("message") {
            if let Some(message) = extract_message_text(&Value::Object(obj.clone())) {
                obj.insert("message".to_string(), Value::String(message));
            }
        }
    }
    event
}

fn extract_message_text(event: &Value) -> Option<String> {
    event
        .get("assistantMessageEvent")
        .and_then(|v| v.get("delta").or_else(|| v.get("content")))
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| {
            event
                .get("error")
                .and_then(|v| v.as_str())
                .map(String::from)
        })
}

fn map_pi_event_to_hook_name(event: &Value) -> &'static str {
    match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
        "agent_start" => "SessionStart",
        "agent_end" => "TaskCompleted",
        "turn_end" => "TaskCompleted",
        "tool_execution_start" => "PreToolUse",
        "tool_execution_end" => "PostToolUse",
        "extension_ui_request" => "PermissionRequest",
        _ => "Notification",
    }
}

fn emit_pi_event(
    app_handle: &tauri::AppHandle,
    session_id: &str,
    hook_event_name: &str,
    payload: Value,
    cwd: Option<String>,
) {
    let event = HookEvent {
        id: Uuid::new_v4().to_string(),
        hook_event_name: hook_event_name.to_string(),
        session_id: session_id.to_string(),
        transcript_path: None,
        cwd,
        client_type: PI_CLIENT_TYPE.to_string(),
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

fn pi_session_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(".humhum").join("pi-sessions"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_pi_tool_events_to_tool_hooks() {
        let start = serde_json::json!({"type": "tool_execution_start"});
        let end = serde_json::json!({"type": "tool_execution_end"});

        assert_eq!(map_pi_event_to_hook_name(&start), "PreToolUse");
        assert_eq!(map_pi_event_to_hook_name(&end), "PostToolUse");
    }

    #[test]
    fn normalizes_tool_name_for_session_store() {
        let payload = normalize_pi_payload(serde_json::json!({
            "type": "tool_execution_start",
            "toolName": "bash"
        }));

        assert_eq!(payload["source"], "pi_sidecar");
        assert_eq!(payload["pi_event_type"], "tool_execution_start");
        assert_eq!(payload["tool_name"], "bash");
    }
}
