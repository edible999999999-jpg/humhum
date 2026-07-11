use crate::hexa_protocol::{
    scope_provider_item, HexaEvent, HexaEventKind, HexaProjectionStore, HexaSensitivity,
    HexaSessionProjection,
};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, RwLock};
use tauri::Emitter;
use tokio::process::Command;
use tokio::sync::RwLock as AsyncRwLock;

use transport::{IncomingMessage, JsonRpcTransport};

pub mod protocol;
pub mod transport;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexBridgeStatus {
    Starting,
    Connected,
    CodexMissing,
    Unsupported,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexBridgeHealth {
    pub status: CodexBridgeStatus,
    pub version: Option<String>,
    pub last_connected_at: Option<String>,
    pub message: String,
}

impl Default for CodexBridgeHealth {
    fn default() -> Self {
        Self {
            status: CodexBridgeStatus::Starting,
            version: None,
            last_connected_at: None,
            message: "Connecting to local Codex".to_string(),
        }
    }
}

pub struct CodexBridgeState {
    health: RwLock<CodexBridgeHealth>,
    projections: Mutex<HexaProjectionStore>,
    transport: AsyncRwLock<Option<Arc<JsonRpcTransport>>>,
}

impl Default for CodexBridgeState {
    fn default() -> Self {
        Self {
            health: RwLock::new(CodexBridgeHealth::default()),
            projections: Mutex::new(HexaProjectionStore::default()),
            transport: AsyncRwLock::new(None),
        }
    }
}

impl CodexBridgeState {
    pub fn start(app: tauri::AppHandle, state: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            let mut backoff_seconds = 2_u64;
            loop {
                if let Err(error) = state.connect_and_listen(&app).await {
                    let current = state.blocking_health();
                    if !matches!(
                        current.status,
                        CodexBridgeStatus::CodexMissing | CodexBridgeStatus::Unsupported
                    ) {
                        state.set_health(
                            &app,
                            CodexBridgeStatus::Disconnected,
                            current.version,
                            format!("Codex connection paused: {error}"),
                        );
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(backoff_seconds)).await;
                backoff_seconds = (backoff_seconds * 2).min(30);
            }
        });
    }

    pub fn blocking_health(&self) -> CodexBridgeHealth {
        self.health
            .read()
            .map(|health| health.clone())
            .unwrap_or_else(|_| CodexBridgeHealth {
                status: CodexBridgeStatus::Error,
                version: None,
                last_connected_at: None,
                message: "Codex bridge state is unavailable".to_string(),
            })
    }

    pub fn sessions(&self) -> Vec<HexaSessionProjection> {
        self.projections
            .lock()
            .map(|store| store.sessions())
            .unwrap_or_default()
    }

    async fn connect_and_listen(&self, app: &tauri::AppHandle) -> Result<(), String> {
        self.set_health(
            app,
            CodexBridgeStatus::Starting,
            None,
            "Connecting to local Codex".to_string(),
        );
        let version = match detect_codex_version().await {
            Ok(version) => version,
            Err(error) => {
                self.set_health(
                    app,
                    CodexBridgeStatus::CodexMissing,
                    None,
                    "Install Codex to connect live sessions".to_string(),
                );
                return Err(error);
            }
        };
        if !supports_app_server(&version) {
            self.set_health(
                app,
                CodexBridgeStatus::Unsupported,
                Some(version.clone()),
                "Update Codex to use live Hexa sessions".to_string(),
            );
            return Err("installed Codex does not support app-server".to_string());
        }

        let transport = Arc::new(
            JsonRpcTransport::spawn_codex()
                .await
                .map_err(|error| error.to_string())?,
        );
        transport
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "humhum",
                        "title": "HUMHUM Hexa",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": {"experimentalApi": false}
                }),
            )
            .await
            .map_err(|error| error.to_string())?;
        transport
            .notify("initialized", json!({}))
            .await
            .map_err(|error| error.to_string())?;

        let listed = transport
            .request(
                "thread/list",
                json!({
                    "limit": 50,
                    "archived": false,
                    "sortKey": "updated_at",
                    "sortDirection": "desc"
                }),
            )
            .await
            .map_err(|error| error.to_string())?;
        for event in thread_list_events(&listed) {
            self.apply_event(app, event);
        }

        *self.transport.write().await = Some(transport.clone());
        self.set_health(
            app,
            CodexBridgeStatus::Connected,
            Some(version),
            "Reading live Codex sessions".to_string(),
        );

        while let Some(message) = transport.next_incoming().await {
            let (method, params) = match message {
                IncomingMessage::Request { method, params, .. }
                | IncomingMessage::Notification { method, params } => (method, params),
            };
            if let Some(event) = normalize_codex_message(&method, params) {
                self.apply_event(app, event);
            }
        }

        *self.transport.write().await = None;
        Err("app-server stopped".to_string())
    }

    fn apply_event(&self, app: &tauri::AppHandle, event: HexaEvent) {
        let projection = self.projections.lock().ok().and_then(|mut store| {
            store.apply(&event);
            store.session(&event.session_id).cloned()
        });
        if let Some(projection) = projection {
            let _ = app.emit("humhum://hexa-session-changed", projection);
        }
    }

    fn set_health(
        &self,
        app: &tauri::AppHandle,
        status: CodexBridgeStatus,
        version: Option<String>,
        message: String,
    ) {
        let previous = self.blocking_health();
        let health = CodexBridgeHealth {
            last_connected_at: if status == CodexBridgeStatus::Connected {
                Some(chrono::Utc::now().to_rfc3339())
            } else {
                previous.last_connected_at
            },
            status,
            version: version.or(previous.version),
            message,
        };
        if let Ok(mut stored) = self.health.write() {
            *stored = health.clone();
        }
        let _ = app.emit("humhum://codex-bridge-health", health);
    }
}

fn thread_list_events(response: &Value) -> Vec<HexaEvent> {
    response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|thread| normalize_codex_message("thread/started", json!({"thread": thread})))
        .collect()
}

async fn detect_codex_version() -> Result<String, String> {
    let output = Command::new("codex")
        .arg("--version")
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("codex --version failed".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn supports_app_server(version: &str) -> bool {
    let Some(version) = version.split_whitespace().find(|part| {
        part.chars()
            .next()
            .is_some_and(|value| value.is_ascii_digit())
            && part.contains('.')
    }) else {
        return false;
    };
    let mut parts = version.split('.');
    let major = parts.next().and_then(|value| value.parse::<u64>().ok());
    let minor = parts.next().and_then(|value| value.parse::<u64>().ok());
    matches!((major, minor), (Some(major), Some(minor)) if major > 0 || minor >= 100)
}

pub(crate) fn normalize_codex_message(method: &str, params: Value) -> Option<HexaEvent> {
    let thread = params.get("thread");
    let thread_id = string_at(&params, "threadId")
        .or_else(|| thread.and_then(|value| string_at(value, "id")))?;
    let turn = params.get("turn");
    let turn_id =
        string_at(&params, "turnId").or_else(|| turn.and_then(|value| string_at(value, "id")));
    let item = params.get("item");

    let (kind, payload) = match method {
        "thread/started" => {
            let thread = thread?;
            (
                HexaEventKind::SessionStarted,
                json!({
                    "provider_thread_id": thread_id,
                    "workspace": string_at(thread, "cwd"),
                    "project_name": string_at(thread, "name"),
                    "preview": string_at(thread, "preview"),
                }),
            )
        }
        "thread/status/changed" => (
            HexaEventKind::SessionStateChanged,
            json!({"status": params.get("status").cloned().unwrap_or(Value::Null)}),
        ),
        "turn/started" => (
            HexaEventKind::TurnStarted,
            json!({"turn_id": turn_id, "activity": "Codex is working"}),
        ),
        "turn/completed" => {
            let status = turn
                .and_then(|value| string_at(value, "status"))
                .unwrap_or("completed");
            let kind = match status {
                "failed" => HexaEventKind::TurnFailed,
                "cancelled" | "canceled" | "interrupted" => HexaEventKind::TurnInterrupted,
                _ => HexaEventKind::TurnCompleted,
            };
            (kind, json!({"turn_id": turn_id, "status": status}))
        }
        "item/started" => normalize_item(item?, &thread_id, true)?,
        "item/completed" => normalize_item(item?, &thread_id, false)?,
        "item/agentMessage/delta" => (
            HexaEventKind::AssistantTextDelta,
            json!({
                "item_id": scope_provider_item(Some(&thread_id), string_at(&params, "itemId")?),
                "delta": string_at(&params, "delta").unwrap_or_default(),
            }),
        ),
        "thread/tokenUsage/updated" => (
            HexaEventKind::UsageUpdated,
            json!({"token_usage": params.get("tokenUsage").cloned().unwrap_or(Value::Null)}),
        ),
        "error" => (
            HexaEventKind::ErrorReported,
            json!({
                "message": params
                    .get("error")
                    .and_then(|value| string_at(value, "message"))
                    .unwrap_or("Codex reported an error"),
                "will_retry": params.get("willRetry").and_then(Value::as_bool).unwrap_or(false),
            }),
        ),
        "item/commandExecution/requestApproval" => {
            normalize_approval(&params, &thread_id, "command")
        }
        "item/fileChange/requestApproval" => normalize_approval(&params, &thread_id, "file_change"),
        _ => return None,
    };

    Some(HexaEvent {
        event_id: uuid::Uuid::new_v4().to_string(),
        session_id: thread_id.to_string(),
        provider: "codex".to_string(),
        provider_thread_id: Some(thread_id.to_string()),
        turn_id: turn_id.map(String::from),
        timestamp: chrono::Utc::now().to_rfc3339(),
        kind,
        payload,
        sensitivity: HexaSensitivity::Private,
    })
}

fn normalize_item(item: &Value, thread_id: &str, started: bool) -> Option<(HexaEventKind, Value)> {
    let item_id = scope_provider_item(Some(thread_id), string_at(item, "id")?);
    let item_type = string_at(item, "type")?;
    let (kind, activity) = match (item_type, started) {
        ("commandExecution", true) => (HexaEventKind::ToolStarted, "Running a command"),
        ("commandExecution", false) => (HexaEventKind::ToolCompleted, "Command finished"),
        ("mcpToolCall" | "dynamicToolCall" | "collabAgentToolCall", true) => {
            (HexaEventKind::ToolStarted, "Using a tool")
        }
        ("mcpToolCall" | "dynamicToolCall" | "collabAgentToolCall", false) => {
            (HexaEventKind::ToolCompleted, "Tool finished")
        }
        ("fileChange", true) => (HexaEventKind::FileChangeProposed, "Preparing file changes"),
        ("fileChange", false) => (HexaEventKind::FileChangeApplied, "File changes finished"),
        ("agentMessage", false) => (
            HexaEventKind::AssistantTextCompleted,
            "Codex finished a response",
        ),
        ("reasoning", false) => (HexaEventKind::ReasoningSummary, "Reasoning updated"),
        _ => return None,
    };

    Some((
        kind,
        json!({
            "item_id": item_id,
            "item_type": item_type,
            "activity": activity,
            "command": string_at(item, "command"),
            "status": item.get("status").cloned().unwrap_or(Value::Null),
            "changes": item.get("changes").cloned().unwrap_or(Value::Null),
            "text": string_at(item, "text"),
        }),
    ))
}

fn normalize_approval(params: &Value, thread_id: &str, operation: &str) -> (HexaEventKind, Value) {
    let raw_item_id = string_at(params, "itemId").unwrap_or("unknown");
    let item_id = scope_provider_item(Some(thread_id), raw_item_id);
    let raw_approval_id = string_at(params, "approvalId").unwrap_or(raw_item_id);
    let approval_id = scope_provider_item(Some(thread_id), raw_approval_id);
    let command = string_at(params, "command");
    let summary = match (operation, command) {
        ("command", Some(command)) => format!("Allow command: {command}"),
        ("command", None) => "Allow this command".to_string(),
        _ => "Allow these file changes".to_string(),
    };

    (
        HexaEventKind::ApprovalRequested,
        json!({
            "approval_id": approval_id,
            "item_id": item_id,
            "operation": operation,
            "summary": summary,
            "reason": string_at(params, "reason"),
            "command": command,
            "cwd": string_at(params, "cwd"),
            "started_at_ms": params.get("startedAtMs").cloned().unwrap_or(Value::Null),
        }),
    )
}

fn string_at<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_command_approval_to_the_same_scoped_item() {
        let started = normalize_codex_message(
            "item/started",
            json!({
                "threadId": "t1",
                "turnId": "turn-1",
                "item": {
                    "id": "item-3",
                    "type": "commandExecution",
                    "command": "npm test"
                }
            }),
        )
        .unwrap();
        let approval = normalize_codex_message(
            "item/commandExecution/requestApproval",
            json!({
                "threadId": "t1",
                "turnId": "turn-1",
                "itemId": "item-3",
                "reason": "Run tests"
            }),
        )
        .unwrap();
        assert_eq!(started.payload["item_id"], approval.payload["item_id"]);
        assert_eq!(approval.payload["item_id"], "t1:item-3");
    }

    #[test]
    fn maps_turn_completion_status_without_guessing() {
        let completed = normalize_codex_message(
            "turn/completed",
            json!({
                "threadId": "t1",
                "turn": {"id": "turn-1", "status": "completed", "items": []}
            }),
        )
        .unwrap();
        assert_eq!(
            completed.kind,
            crate::hexa_protocol::HexaEventKind::TurnCompleted
        );

        let failed = normalize_codex_message(
            "turn/completed",
            json!({
                "threadId": "t1",
                "turn": {"id": "turn-2", "status": "failed", "items": []}
            }),
        )
        .unwrap();
        assert_eq!(failed.kind, crate::hexa_protocol::HexaEventKind::TurnFailed);
    }

    #[test]
    fn ignores_unknown_notifications() {
        assert!(normalize_codex_message("account/updated", json!({})).is_none());
    }

    #[test]
    fn bridge_health_starts_in_starting_state() {
        let state = CodexBridgeState::default();
        let health = state.blocking_health();
        assert_eq!(health.status, CodexBridgeStatus::Starting);
    }

    #[test]
    fn maps_thread_list_into_session_events() {
        let events = thread_list_events(&json!({
            "data": [{
                "id": "thread-1",
                "cwd": "/tmp/humhum",
                "name": "Bridge work",
                "preview": "Connect Hexa",
                "createdAt": 1,
                "updatedAt": 2,
                "status": {"type": "idle"}
            }]
        }));
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].session_id, "thread-1");
        assert_eq!(events[0].payload["project_name"], "Bridge work");
    }
}
