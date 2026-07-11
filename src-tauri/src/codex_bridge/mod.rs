use crate::hexa_protocol::{
    scope_provider_item, HexaEvent, HexaEventKind, HexaProjectionStore, HexaSensitivity,
    HexaSessionProjection,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use tauri::Emitter;
use tokio::process::Command;
use tokio::sync::{Mutex as AsyncMutex, RwLock as AsyncRwLock};

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

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexRemoteControlStatus {
    Unavailable,
    Disabled,
    Connecting,
    Connected,
    Errored,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct CodexRemoteControlState {
    pub status: CodexRemoteControlStatus,
    pub server_name: String,
    pub installation_id: String,
    pub environment_id: Option<String>,
    pub message: String,
}

impl Default for CodexRemoteControlState {
    fn default() -> Self {
        Self {
            status: CodexRemoteControlStatus::Unavailable,
            server_name: String::new(),
            installation_id: String::new(),
            environment_id: None,
            message: "Codex mobile access is unavailable".to_string(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct CodexRemotePairing {
    pub pairing_code: String,
    pub manual_pairing_code: Option<String>,
    pub environment_id: String,
    pub expires_at: i64,
}

impl CodexRemotePairing {
    fn is_expired_at(&self, unix_seconds: i64) -> bool {
        unix_seconds >= self.expires_at
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    AllowOnce,
    Deny,
}

#[derive(Debug)]
pub enum CodexBridgeError {
    NotConnected,
    InvalidWorkspace,
    EmptyMessage,
    SessionNotFound,
    StaleTurn,
    ApprovalNotFound,
    ApprovalExpired,
    InvalidAnswer,
    Transport(String),
    InvalidResponse(String),
}

impl fmt::Display for CodexBridgeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::NotConnected => "Codex is not connected",
            Self::InvalidWorkspace => "Choose an existing workspace folder",
            Self::EmptyMessage => "Write a message before sending",
            Self::SessionNotFound => "This Codex session is no longer available",
            Self::StaleTurn => "This Codex turn has already changed",
            Self::ApprovalNotFound => "This approval is no longer waiting",
            Self::ApprovalExpired => "This approval has expired",
            Self::InvalidAnswer => "The question answer is invalid",
            Self::Transport(message) | Self::InvalidResponse(message) => message,
        };
        write!(formatter, "{message}")
    }
}

impl std::error::Error for CodexBridgeError {}

#[derive(Debug, Clone)]
struct PendingCodexRequest {
    rpc_id: Value,
    method: String,
    session_id: String,
    turn_id: Option<String>,
    expires_at: chrono::DateTime<chrono::Utc>,
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
    attached_threads: AsyncMutex<HashSet<String>>,
    pending_requests: Mutex<std::collections::HashMap<String, PendingCodexRequest>>,
    remote_control: RwLock<CodexRemoteControlState>,
}

impl Default for CodexBridgeState {
    fn default() -> Self {
        Self {
            health: RwLock::new(CodexBridgeHealth::default()),
            projections: Mutex::new(HexaProjectionStore::default()),
            transport: AsyncRwLock::new(None),
            attached_threads: AsyncMutex::new(HashSet::new()),
            pending_requests: Mutex::new(std::collections::HashMap::new()),
            remote_control: RwLock::new(CodexRemoteControlState::default()),
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

    pub fn remote_control(&self) -> CodexRemoteControlState {
        self.remote_control
            .read()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub async fn read_remote_control(&self) -> Result<CodexRemoteControlState, CodexBridgeError> {
        self.request_remote_control("remoteControl/status/read", json!({}))
            .await
    }

    pub async fn enable_remote_control(&self) -> Result<CodexRemoteControlState, CodexBridgeError> {
        self.request_remote_control("remoteControl/enable", json!({"ephemeral": false}))
            .await
    }

    pub async fn disable_remote_control(
        &self,
    ) -> Result<CodexRemoteControlState, CodexBridgeError> {
        self.request_remote_control("remoteControl/disable", json!({"ephemeral": false}))
            .await
    }

    pub async fn start_remote_pairing(&self) -> Result<CodexRemotePairing, CodexBridgeError> {
        let response = self
            .connected_transport()
            .await?
            .request("remoteControl/pairing/start", json!({"manualCode": true}))
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        parse_remote_pairing(&response).map_err(CodexBridgeError::InvalidResponse)
    }

    async fn request_remote_control(
        &self,
        method: &str,
        params: Value,
    ) -> Result<CodexRemoteControlState, CodexBridgeError> {
        let response = self
            .connected_transport()
            .await?
            .request(method, params)
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        let state =
            parse_remote_control_state(&response).map_err(CodexBridgeError::InvalidResponse)?;
        if let Ok(mut stored) = self.remote_control.write() {
            *stored = state.clone();
        }
        Ok(state)
    }

    pub async fn start_thread(&self, workspace: &str) -> Result<String, CodexBridgeError> {
        let path = Path::new(workspace);
        if !path.is_absolute() || !path.is_dir() {
            return Err(CodexBridgeError::InvalidWorkspace);
        }
        let transport = self.connected_transport().await?;
        let response = transport
            .request(
                "thread/start",
                json!({
                    "cwd": workspace,
                    "approvalPolicy": "on-request",
                    "approvalsReviewer": "user",
                    "serviceName": "humhum"
                }),
            )
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        let thread_id = response
            .get("thread")
            .and_then(|thread| string_at(thread, "id"))
            .map(String::from)
            .ok_or_else(|| {
                CodexBridgeError::InvalidResponse("Codex did not return a thread".into())
            })?;
        self.attached_threads.lock().await.insert(thread_id.clone());
        Ok(thread_id)
    }

    pub async fn resume_thread(&self, thread_id: &str) -> Result<String, CodexBridgeError> {
        if self
            .projections
            .lock()
            .ok()
            .and_then(|store| store.session(thread_id).cloned())
            .is_none()
        {
            return Err(CodexBridgeError::SessionNotFound);
        }
        let transport = self.connected_transport().await?;
        self.ensure_thread_attached(&transport, thread_id).await
    }

    async fn ensure_thread_attached(
        &self,
        transport: &Arc<JsonRpcTransport>,
        thread_id: &str,
    ) -> Result<String, CodexBridgeError> {
        let mut attached = self.attached_threads.lock().await;
        if attached.contains(thread_id) {
            return Ok(thread_id.to_string());
        }

        let response = transport
            .request(
                "thread/resume",
                json!({
                    "threadId": thread_id,
                    "approvalPolicy": "on-request",
                    "approvalsReviewer": "user"
                }),
            )
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        let resumed_id = response
            .get("thread")
            .and_then(|thread| string_at(thread, "id"))
            .map(String::from)
            .ok_or_else(|| {
                CodexBridgeError::InvalidResponse("Codex did not resume the thread".into())
            })?;
        attached.insert(resumed_id.clone());
        Ok(resumed_id)
    }

    pub async fn send_message(
        &self,
        thread_id: &str,
        message: &str,
    ) -> Result<String, CodexBridgeError> {
        let message = message.trim();
        if message.is_empty() {
            return Err(CodexBridgeError::EmptyMessage);
        }
        if self
            .projections
            .lock()
            .ok()
            .and_then(|store| store.session(thread_id).cloned())
            .is_none()
        {
            return Err(CodexBridgeError::SessionNotFound);
        }
        let transport = self.connected_transport().await?;
        self.ensure_thread_attached(&transport, thread_id).await?;
        let response = transport
            .request(
                "turn/start",
                json!({
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": message, "text_elements": []}],
                    "approvalPolicy": "on-request",
                    "approvalsReviewer": "user"
                }),
            )
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        response
            .get("turn")
            .and_then(|turn| string_at(turn, "id"))
            .map(String::from)
            .ok_or_else(|| CodexBridgeError::InvalidResponse("Codex did not start a turn".into()))
    }

    pub async fn interrupt(&self, thread_id: &str, turn_id: &str) -> Result<(), CodexBridgeError> {
        let current_turn = self
            .projections
            .lock()
            .ok()
            .and_then(|store| store.session(thread_id).cloned())
            .ok_or(CodexBridgeError::SessionNotFound)?
            .current_turn_id;
        if current_turn.as_deref() != Some(turn_id) {
            return Err(CodexBridgeError::StaleTurn);
        }
        self.connected_transport()
            .await?
            .request(
                "turn/interrupt",
                json!({"threadId": thread_id, "turnId": turn_id}),
            )
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        Ok(())
    }

    pub async fn resolve_approval(
        &self,
        approval_id: &str,
        decision: ApprovalDecision,
    ) -> Result<(), CodexBridgeError> {
        let pending = self
            .pending_requests
            .lock()
            .map_err(|_| CodexBridgeError::ApprovalNotFound)?
            .get(approval_id)
            .cloned()
            .ok_or(CodexBridgeError::ApprovalNotFound)?;
        if chrono::Utc::now() >= pending.expires_at {
            return Err(CodexBridgeError::ApprovalExpired);
        }
        if !matches!(
            pending.method.as_str(),
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval"
        ) {
            return Err(CodexBridgeError::ApprovalNotFound);
        }
        let provider_decision = match decision {
            ApprovalDecision::AllowOnce => "accept",
            ApprovalDecision::Deny => "decline",
        };
        self.connected_transport()
            .await?
            .respond(pending.rpc_id, json!({"decision": provider_decision}))
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        self.pending_requests
            .lock()
            .map_err(|_| CodexBridgeError::ApprovalNotFound)?
            .remove(approval_id);
        self.apply_resolution_event(
            &pending.session_id,
            pending.turn_id,
            HexaEventKind::ApprovalResolved,
            json!({"approval_id": approval_id, "decision": provider_decision}),
        );
        Ok(())
    }

    pub async fn answer_question(
        &self,
        question_id: &str,
        answers: Value,
    ) -> Result<(), CodexBridgeError> {
        if !answers.is_object() {
            return Err(CodexBridgeError::InvalidAnswer);
        }
        let pending = self
            .pending_requests
            .lock()
            .map_err(|_| CodexBridgeError::ApprovalNotFound)?
            .get(question_id)
            .cloned()
            .ok_or(CodexBridgeError::ApprovalNotFound)?;
        if pending.method != "item/tool/requestUserInput" {
            return Err(CodexBridgeError::InvalidAnswer);
        }
        if chrono::Utc::now() >= pending.expires_at {
            return Err(CodexBridgeError::ApprovalExpired);
        }
        self.connected_transport()
            .await?
            .respond(pending.rpc_id, json!({"answers": answers}))
            .await
            .map_err(|error| CodexBridgeError::Transport(error.to_string()))?;
        self.pending_requests
            .lock()
            .map_err(|_| CodexBridgeError::ApprovalNotFound)?
            .remove(question_id);
        self.apply_resolution_event(
            &pending.session_id,
            pending.turn_id,
            HexaEventKind::UserQuestionResolved,
            json!({"question_id": question_id}),
        );
        Ok(())
    }

    async fn connected_transport(&self) -> Result<Arc<JsonRpcTransport>, CodexBridgeError> {
        self.transport
            .read()
            .await
            .clone()
            .ok_or(CodexBridgeError::NotConnected)
    }

    fn apply_resolution_event(
        &self,
        session_id: &str,
        turn_id: Option<String>,
        kind: HexaEventKind,
        payload: Value,
    ) {
        let event = HexaEvent {
            event_id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            provider: "codex".to_string(),
            provider_thread_id: Some(session_id.to_string()),
            turn_id,
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind,
            payload,
            sensitivity: HexaSensitivity::Private,
        };
        if let Ok(mut store) = self.projections.lock() {
            store.apply(&event);
        }
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
                    "capabilities": {"experimentalApi": true}
                }),
            )
            .await
            .map_err(|error| error.to_string())?;
        transport
            .notify("initialized", json!({}))
            .await
            .map_err(|error| error.to_string())?;
        self.attached_threads.lock().await.clear();

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

        if let Ok(response) = transport
            .request("remoteControl/status/read", json!({}))
            .await
        {
            if let Ok(remote) = parse_remote_control_state(&response) {
                self.set_remote_control(app, remote);
            }
        }

        while let Some(message) = transport.next_incoming().await {
            match message {
                IncomingMessage::Request { id, method, params } => {
                    if let Some(event) = normalize_codex_message(&method, params.clone()) {
                        if let Some(request_key) = pending_key_for_event(&event) {
                            let timeout_ms = params
                                .get("autoResolutionMs")
                                .and_then(Value::as_u64)
                                .unwrap_or(120_000)
                                .min(120_000);
                            let pending = PendingCodexRequest {
                                rpc_id: id,
                                method,
                                session_id: event.session_id.clone(),
                                turn_id: event.turn_id.clone(),
                                expires_at: chrono::Utc::now()
                                    + chrono::Duration::milliseconds(timeout_ms as i64),
                            };
                            if let Ok(mut requests) = self.pending_requests.lock() {
                                requests.insert(request_key, pending);
                            }
                        }
                        self.apply_event(app, event);
                    }
                }
                IncomingMessage::Notification { method, params } => {
                    if method == "remoteControl/status/changed" {
                        if let Ok(remote) = parse_remote_control_state(&params) {
                            self.set_remote_control(app, remote);
                        }
                        continue;
                    }
                    if let Some(event) = normalize_codex_message(&method, params) {
                        self.apply_event(app, event);
                    }
                }
            }
        }

        *self.transport.write().await = None;
        self.attached_threads.lock().await.clear();
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

    fn set_remote_control(&self, app: &tauri::AppHandle, state: CodexRemoteControlState) {
        if let Ok(mut stored) = self.remote_control.write() {
            *stored = state.clone();
        }
        let _ = app.emit("humhum://codex-remote-control-changed", state);
    }
}

fn parse_remote_control_state(value: &Value) -> Result<CodexRemoteControlState, String> {
    let status = match string_at(value, "status") {
        Some("disabled") => CodexRemoteControlStatus::Disabled,
        Some("connecting") => CodexRemoteControlStatus::Connecting,
        Some("connected") => CodexRemoteControlStatus::Connected,
        Some("errored") => CodexRemoteControlStatus::Errored,
        Some(other) => return Err(format!("Codex returned an unknown remote status: {other}")),
        None => return Err("Codex did not return a remote status".to_string()),
    };
    let message = match status {
        CodexRemoteControlStatus::Disabled => "Codex mobile access is off",
        CodexRemoteControlStatus::Connecting => "Connecting Codex mobile access",
        CodexRemoteControlStatus::Connected => "Codex mobile access is ready",
        CodexRemoteControlStatus::Errored => "Codex mobile access needs attention",
        CodexRemoteControlStatus::Unavailable => "Codex mobile access is unavailable",
    };
    Ok(CodexRemoteControlState {
        status,
        server_name: string_at(value, "serverName")
            .unwrap_or_default()
            .to_string(),
        installation_id: string_at(value, "installationId")
            .unwrap_or_default()
            .to_string(),
        environment_id: string_at(value, "environmentId").map(String::from),
        message: message.to_string(),
    })
}

fn parse_remote_pairing(value: &Value) -> Result<CodexRemotePairing, String> {
    let pairing = CodexRemotePairing {
        pairing_code: string_at(value, "pairingCode")
            .ok_or_else(|| "Codex did not return a pairing code".to_string())?
            .to_string(),
        manual_pairing_code: string_at(value, "manualPairingCode").map(String::from),
        environment_id: string_at(value, "environmentId")
            .ok_or_else(|| "Codex did not return a pairing environment".to_string())?
            .to_string(),
        expires_at: value
            .get("expiresAt")
            .and_then(Value::as_i64)
            .ok_or_else(|| "Codex did not return a pairing expiry".to_string())?,
    };
    if pairing.is_expired_at(chrono::Utc::now().timestamp()) {
        return Err("The Codex pairing code already expired".to_string());
    }
    Ok(pairing)
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

fn pending_key_for_event(event: &HexaEvent) -> Option<String> {
    match event.kind {
        HexaEventKind::ApprovalRequested => event
            .payload
            .get("approval_id")
            .and_then(Value::as_str)
            .map(String::from),
        HexaEventKind::UserQuestionRequested => event
            .payload
            .get("question_id")
            .and_then(Value::as_str)
            .map(String::from),
        _ => None,
    }
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
        "item/tool/requestUserInput" => {
            let item_id = scope_provider_item(
                Some(&thread_id),
                string_at(&params, "itemId").unwrap_or("unknown"),
            );
            (
                HexaEventKind::UserQuestionRequested,
                json!({
                    "question_id": item_id,
                    "questions": params.get("questions").cloned().unwrap_or(Value::Array(Vec::new())),
                    "auto_resolution_ms": params.get("autoResolutionMs").cloned().unwrap_or(Value::Null),
                }),
            )
        }
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

    #[tokio::test]
    async fn action_rejects_an_expired_approval_before_transport_use() {
        let state = CodexBridgeState::default();
        state.pending_requests.lock().unwrap().insert(
            "approval-1".to_string(),
            PendingCodexRequest {
                rpc_id: json!(61),
                method: "item/commandExecution/requestApproval".to_string(),
                session_id: "thread-1".to_string(),
                turn_id: Some("turn-1".to_string()),
                expires_at: chrono::Utc::now() - chrono::Duration::seconds(1),
            },
        );

        let error = state
            .resolve_approval("approval-1", ApprovalDecision::AllowOnce)
            .await
            .unwrap_err();
        assert!(matches!(error, CodexBridgeError::ApprovalExpired));
    }

    #[tokio::test]
    async fn action_interrupt_requires_the_current_turn() {
        let state = CodexBridgeState::default();
        let event = normalize_codex_message(
            "turn/started",
            json!({"threadId": "thread-1", "turn": {"id": "turn-new", "status": "inProgress", "items": []}}),
        )
        .unwrap();
        state.projections.lock().unwrap().apply(&event);

        let error = state.interrupt("thread-1", "turn-old").await.unwrap_err();
        assert!(matches!(error, CodexBridgeError::StaleTurn));
    }

    #[tokio::test]
    async fn sending_to_a_listed_thread_resumes_it_before_starting_a_turn() {
        let transport = Arc::new(
            JsonRpcTransport::spawn_command(
                "/bin/sh",
                &[
                    "-c",
                    r#"
                    read first
                    case "$first" in
                      *'"method":"thread/resume"'*)
                        printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"thread-1"}}}'
                        read second
                        case "$second" in
                          *'"method":"turn/start"'*)
                            printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"turn":{"id":"turn-1"}}}'
                            ;;
                        esac
                        ;;
                      *)
                        printf '%s\n' '{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"thread not found: thread-1"}}'
                        ;;
                    esac
                    sleep 1
                    "#,
                ],
            )
            .await
            .unwrap(),
        );
        let state = CodexBridgeState::default();
        let listed = thread_list_events(&json!({
            "data": [{
                "id": "thread-1",
                "cwd": "/tmp/humhum",
                "name": "Listed session",
                "preview": "Previous work"
            }]
        }));
        state.projections.lock().unwrap().apply(&listed[0]);
        *state.transport.write().await = Some(transport);

        let turn_id = state.send_message("thread-1", "continue").await.unwrap();

        assert_eq!(turn_id, "turn-1");
    }

    #[test]
    fn remote_control_parses_status_snapshots() {
        let state = parse_remote_control_state(&json!({
            "status": "connected",
            "serverName": "Yun's Mac",
            "installationId": "install-1",
            "environmentId": "env-1"
        }))
        .unwrap();

        assert_eq!(state.status, CodexRemoteControlStatus::Connected);
        assert_eq!(state.server_name, "Yun's Mac");
        assert_eq!(state.installation_id, "install-1");
        assert_eq!(state.environment_id.as_deref(), Some("env-1"));
    }

    #[test]
    fn remote_control_parses_manual_pairing_artifact() {
        let pairing = parse_remote_pairing(&json!({
            "pairingCode": "pair-opaque",
            "manualPairingCode": "HUM-HUM",
            "environmentId": "env-1",
            "expiresAt": 2_000_000_000
        }))
        .unwrap();

        assert_eq!(pairing.manual_pairing_code.as_deref(), Some("HUM-HUM"));
        assert_eq!(pairing.environment_id, "env-1");
        assert!(!pairing.is_expired_at(1_999_999_999));
        assert!(pairing.is_expired_at(2_000_000_000));
    }
}
