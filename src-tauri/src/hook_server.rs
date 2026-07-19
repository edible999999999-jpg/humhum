use crate::event_bus::{self, HookEvent, PermissionDecision};
use crate::hexa_goal_store::{
    HexaAttemptResultRequest, HexaAttemptResultStatus, HexaGoalAttemptContext, HexaGoalLinkRequest,
    HexaGoalStore,
};
use crate::hexa_watch_store::{
    HexaAuditMutation, HexaAuditMutationRequest, HexaPlanSyncRequest, HexaWatchDeleteRequest,
    HexaWatchRegisterRequest, HexaWatchStore, HexaWatchUpdateRequest,
};
use crate::local_api_auth::{LocalApiAuth, TOKEN_HEADER};
use crate::mobile_bridge::MobileBridgeState;
use crate::remote_bridge::RemoteBridgeState;
use crate::session_store::SessionStore;
use crate::stats_store::StatsStore;
use http_body_util::{BodyExt, Full, LengthLimitError, Limited};
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::Value;
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

const MAX_HEXA_AUDIT_BODY_BYTES: usize = 64 * 1024;
const MAX_HEXA_GOAL_BODY_BYTES: usize = 64 * 1024;

/// Stores a pending permission request with its event info
pub struct PendingRequest {
    pub sender: Option<oneshot::Sender<PermissionDecision>>,
    pub event: HookEvent,
}

/// Shared state for pending permission requests
/// Maps event_id -> pending request (sender + event info)
pub type PendingMap = Arc<Mutex<HashMap<String, PendingRequest>>>;

/// Start the local HTTP server that receives hook events from Claude Code
pub async fn start_server(app_handle: tauri::AppHandle) {
    let config = {
        let config_state = app_handle.state::<Arc<std::sync::Mutex<crate::config::AppConfig>>>();
        let config = config_state.lock().unwrap();
        config.clone()
    };

    let port = config.hook_port;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

    // Store pending map in app state for commands to access
    app_handle.manage(pending.clone());

    log::info!("HumHum hook server starting on http://{}", addr);

    // Periodically clean up stale pending requests whose HTTP connections were dropped
    let cleanup_pending = pending.clone();
    let cleanup_app = app_handle.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            let mut map = cleanup_pending.lock().await;
            let now = chrono::Utc::now();
            let stale_ids: Vec<String> = map
                .iter()
                .filter(|(_, pr)| {
                    if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&pr.event.timestamp) {
                        (now - ts.with_timezone(&chrono::Utc)).num_seconds() > 125
                    } else {
                        true
                    }
                })
                .map(|(id, _)| id.clone())
                .collect();

            for id in &stale_ids {
                map.remove(id);
                cleanup_app
                    .emit("humhum://permission-timeout", id)
                    .unwrap_or_else(|e| log::error!("[Cleanup] emit failed: {}", e));
                log::info!("[Cleanup] Removed stale pending request: {}", id);
            }
        }
    });

    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to bind hook server port {}: {}", port, e);
            return;
        }
    };

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::error!("Failed to accept connection: {}", e);
                continue;
            }
        };

        let app = app_handle.clone();
        let pending = pending.clone();
        let auth = app_handle.state::<Arc<LocalApiAuth>>().inner().clone();

        tokio::task::spawn(async move {
            let service = service_fn(move |req| {
                let app = app.clone();
                let pending = pending.clone();
                let auth = auth.clone();
                async move { handle_request(req, app, pending, auth).await }
            });

            let io = TokioIo::new(stream);
            if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
                log::error!("Error serving connection: {}", e);
            }
        });
    }
}

async fn handle_request(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
    pending: PendingMap,
    auth: Arc<LocalApiAuth>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    log::debug!("{} {}", method, path);

    if path != "/health" {
        let candidate = req
            .headers()
            .get(TOKEN_HEADER)
            .and_then(|value| value.to_str().ok());
        let remote_authorized = app_handle
            .try_state::<Arc<RemoteBridgeState>>()
            .is_some_and(|remote| remote.authorizes_event(&path, candidate));
        if !auth.authorizes(candidate) && !remote_authorized {
            return Ok(json_response(
                StatusCode::UNAUTHORIZED,
                &serde_json::json!({"error": "local API token required"}),
            ));
        }
    }

    match (method.as_str(), path.as_str()) {
        ("OPTIONS", _) => Ok(json_response(
            StatusCode::METHOD_NOT_ALLOWED,
            &serde_json::json!({"error": "browser access is disabled"}),
        )),
        ("POST", "/event") => handle_event(req, app_handle, pending).await,
        ("GET", "/health") => Ok(json_response(
            StatusCode::OK,
            &serde_json::json!({
                "status": "ok",
                "name": "HumHum",
                "version": env!("CARGO_PKG_VERSION"),
            }),
        )),
        ("GET", "/pending") => handle_pending(pending).await,
        ("POST", "/respond") => handle_respond(req, pending).await,
        ("GET", "/knowledge") => handle_knowledge_query(req, app_handle).await,
        ("POST", "/hexa/register") => handle_hexa_register(req, app_handle).await,
        ("POST", "/hexa/update") => handle_hexa_update(req, app_handle).await,
        ("POST", "/hexa/plan") => handle_hexa_plan(req, app_handle).await,
        ("POST", "/hexa/audit") => handle_hexa_audit(req, app_handle).await,
        ("POST", "/hexa/delete") => handle_hexa_delete(req, app_handle).await,
        ("POST", "/hexa/goal/link") => handle_hexa_goal_link(req, app_handle).await,
        ("POST", "/hexa/goal/result") => handle_hexa_goal_result(req, app_handle).await,
        ("GET", "/hush/inbox") => handle_hush_inbox_query(app_handle).await,
        ("POST", "/hush/inbox") => handle_hush_inbox_post(req, app_handle).await,
        ("GET", "/mobile/status") => handle_mobile_status(app_handle).await,
        ("POST", "/mobile/enable") => handle_mobile_enable(app_handle).await,
        ("POST", "/mobile/disable") => handle_mobile_disable(app_handle).await,
        ("POST", "/mobile/pair") => handle_mobile_pairing(req, app_handle).await,
        ("POST", "/mobile/revoke") => handle_mobile_revoke(app_handle).await,
        ("GET", "/autostart/status") => handle_autostart_status(app_handle).await,
        ("POST", "/autostart/enable") => handle_autostart_change(app_handle, true).await,
        ("POST", "/autostart/disable") => handle_autostart_change(app_handle, false).await,
        _ => Ok(json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({"error": "not found"}),
        )),
    }
}

async fn handle_autostart_status(
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    use tauri_plugin_autostart::ManagerExt;
    match app_handle.autolaunch().is_enabled() {
        Ok(enabled) => Ok(json_response(
            StatusCode::OK,
            &serde_json::json!({ "enabled": enabled }),
        )),
        Err(error) => Ok(json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error.to_string() }),
        )),
    }
}

async fn handle_autostart_change(
    app_handle: tauri::AppHandle,
    enabled: bool,
) -> Result<Response<Full<Bytes>>, Infallible> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app_handle.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = result {
        return Ok(json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error.to_string() }),
        ));
    }
    handle_autostart_status(app_handle).await
}

async fn handle_mobile_status(
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let state = app_handle.state::<Arc<MobileBridgeState>>();
    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(state.status()).unwrap_or_default(),
    ))
}

async fn handle_mobile_enable(
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let state = app_handle.state::<Arc<MobileBridgeState>>().inner().clone();
    match state.enable(app_handle).await {
        Ok(status) => Ok(json_response(
            StatusCode::OK,
            &serde_json::to_value(status).unwrap_or_default(),
        )),
        Err(error) => Ok(json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        )),
    }
}

async fn handle_mobile_disable(
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let state = app_handle.state::<Arc<MobileBridgeState>>();
    match state.disable() {
        Ok(status) => Ok(json_response(
            StatusCode::OK,
            &serde_json::to_value(status).unwrap_or_default(),
        )),
        Err(error) => Ok(json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        )),
    }
}

async fn handle_mobile_pairing(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let state = app_handle.state::<Arc<MobileBridgeState>>();
    match state
        .inner()
        .create_pairing_for_android(
            mobile_pairing_scope(req.uri().query()),
            mobile_pairing_network(req.uri().query()),
        )
        .await
    {
        Ok(pairing) => Ok(json_response(
            StatusCode::OK,
            &serde_json::to_value(pairing).unwrap_or_default(),
        )),
        Err(error) => Ok(json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        )),
    }
}

fn mobile_pairing_scope(query: Option<&str>) -> crate::mobile_bridge::MobileDeviceScope {
    let control = query.unwrap_or_default().split('&').any(|pair| {
        pair.split_once('=')
            .is_some_and(|(key, value)| key == "scope" && value == "control")
    });
    if control {
        crate::mobile_bridge::MobileDeviceScope::Control
    } else {
        crate::mobile_bridge::MobileDeviceScope::Read
    }
}

fn mobile_pairing_network(query: Option<&str>) -> crate::mobile_bridge::MobileNetwork {
    let tailnet = query.unwrap_or_default().split('&').any(|pair| {
        pair.split_once('=')
            .is_some_and(|(key, value)| key == "network" && value == "tailnet")
    });
    if tailnet {
        crate::mobile_bridge::MobileNetwork::Tailnet
    } else {
        crate::mobile_bridge::MobileNetwork::Lan
    }
}

async fn handle_mobile_revoke(
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let state = app_handle.state::<Arc<MobileBridgeState>>();
    match state.revoke_devices() {
        Ok(status) => Ok(json_response(
            StatusCode::OK,
            &serde_json::to_value(status).unwrap_or_default(),
        )),
        Err(error) => Ok(json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        )),
    }
}

async fn handle_event(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
    pending: PendingMap,
) -> Result<Response<Full<Bytes>>, Infallible> {
    // Extract query params before consuming the body
    let query_string = req.uri().query().unwrap_or("").to_string();

    // Read the request body (JSON from hook script)
    let body = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            log::error!("Failed to read request body: {}", e);
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": "failed to read body"}),
            ));
        }
    };

    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            log::error!("Failed to parse JSON: {}", e);
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": "invalid JSON"}),
            ));
        }
    };
    let mut payload = normalize_agent_payload(payload);

    let source_hook_event_name = payload
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let event_id = Uuid::new_v4().to_string();

    // Determine client type from query param or payload
    let client_type = query_string
        .split('&')
        .find_map(|pair| {
            let mut kv = pair.splitn(2, '=');
            match (kv.next(), kv.next()) {
                (Some("client"), Some(v)) => Some(v.to_string()),
                _ => None,
            }
        })
        .or_else(|| {
            payload
                .get("client_type")
                .and_then(|v| v.as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| "claude-code".to_string());

    let hook_event_name = canonical_hook_event_name(&client_type, &source_hook_event_name);
    enrich_ghostty_route(&mut payload, hook_event_name);
    let hook_event = HookEvent {
        id: event_id.clone(),
        hook_event_name: hook_event_name.to_string(),
        session_id: payload
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        transcript_path: payload
            .get("transcript_path")
            .and_then(|v| v.as_str())
            .map(String::from),
        cwd: payload
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(String::from),
        client_type,
        payload: payload.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    // Update session store
    if let Some(store) = app_handle.try_state::<Arc<std::sync::Mutex<SessionStore>>>() {
        if let Ok(mut store) = store.lock() {
            store.update_from_event(&hook_event);
        }
    }

    // Record stats on session end events.
    if matches!(hook_event_name, "Stop" | "TaskCompleted" | "SessionEnd") {
        let analytics_enabled = app_handle
            .try_state::<Arc<std::sync::Mutex<crate::config::AppConfig>>>()
            .and_then(|config| config.lock().ok().map(|config| config.ui.analytics_enabled))
            .unwrap_or(false);
        if analytics_enabled {
            if let Some(transcript_path) = &hook_event.transcript_path {
                if let Some(store) = app_handle.try_state::<Arc<std::sync::Mutex<StatsStore>>>() {
                    if let Ok(mut store) = store.lock() {
                        if let Err(e) = store.record_session_end(
                            transcript_path,
                            &hook_event.session_id,
                            &hook_event.client_type,
                        ) {
                            log::error!("[Stats] Failed to record session: {}", e);
                        }
                    }
                }
            }
        }
    }

    if hook_event_name == "SessionEnd" {
        if let Some(config) =
            app_handle.try_state::<Arc<std::sync::Mutex<crate::config::AppConfig>>>()
        {
            if let Ok(mut current) = config.lock() {
                let mut updated = current.clone();
                if updated
                    .ui
                    .auto_confirm_sessions
                    .remove(&hook_event.session_id)
                {
                    if let Err(error) = updated.save() {
                        log::warn!("Could not expire session auto-approve: {error}");
                    } else {
                        *current = updated;
                    }
                }
            }
        }
    }

    // Emit event to frontend
    event_bus::emit_hook_event(&app_handle, &hook_event);

    let tool_name = payload
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    log::info!(
        "[HookServer] event={} client={} tool_name='{}'",
        hook_event_name,
        hook_event.client_type,
        tool_name
    );

    let is_ask_question = tool_name == "AskUserQuestion";

    // PermissionRequest for AskUserQuestion: auto-allow immediately (answer goes via PreToolUse)
    if hook_event_name == "PermissionRequest" && is_ask_question {
        let response = permission_hook_response(&hook_event.client_type, "allow");
        return Ok(json_response(StatusCode::OK, &response));
    }

    // Block for: PermissionRequest (non-AskUserQuestion), AND PreToolUse with AskUserQuestion
    let needs_blocking = hook_event_name == "PermissionRequest"
        || (hook_event_name == "PreToolUse" && is_ask_question);

    if needs_blocking {
        // Rage mode: auto-confirm without waiting
        let config_arc = app_handle
            .state::<Arc<std::sync::Mutex<crate::config::AppConfig>>>()
            .inner()
            .clone();
        let auto_confirm = config_arc
            .lock()
            .map(|config| session_auto_confirm_enabled(&config, &hook_event.session_id))
            .unwrap_or(false);

        if auto_confirm && !is_ask_question {
            log::info!("Auto-confirm permission for event {}", event_id);
            if let Ok(mut store) = app_handle
                .state::<Arc<std::sync::Mutex<SessionStore>>>()
                .inner()
                .lock()
            {
                store.clear_pending_permission(&hook_event.session_id);
            }
            let _ = app_handle.emit("humhum://permission-auto-confirmed", &event_id);
            let response = permission_hook_response(&hook_event.client_type, "allow");
            event_bus::emit_status_change(&app_handle, "idle");
            return Ok(json_response(StatusCode::OK, &response));
        }

        event_bus::emit_status_change(&app_handle, "waiting-confirmation");

        let (tx, rx) = oneshot::channel();

        // Store the sender so the frontend command can use it
        {
            let mut map = pending.lock().await;
            map.insert(
                event_id.clone(),
                PendingRequest {
                    sender: Some(tx),
                    event: hook_event.clone(),
                },
            );
        }

        // Wait for the frontend to respond with a decision (timeout: 120s)
        let decision = tokio::time::timeout(std::time::Duration::from_secs(120), rx).await;

        // Clean up PendingMap entry regardless of outcome
        {
            let mut map = pending.lock().await;
            map.remove(&event_id);
        }

        match decision {
            Ok(Ok(d)) => {
                let hook_behavior = if d.behavior == "allowAlways" {
                    "allow"
                } else {
                    &d.behavior
                };
                log::info!(
                    "Permission decided for {}: {} (hook: {}) answer={:?}",
                    event_id,
                    d.behavior,
                    hook_behavior,
                    d.answer
                );

                let response = if is_ask_question && hook_event_name == "PreToolUse" {
                    // PreToolUse + AskUserQuestion: must wrap in hookSpecificOutput with permissionDecision
                    if let Some(answer) = &d.answer {
                        serde_json::json!({
                            "hookSpecificOutput": {
                                "hookEventName": "PreToolUse",
                                "permissionDecision": "allow",
                                "updatedInput": answer
                            }
                        })
                    } else {
                        serde_json::json!({
                            "hookSpecificOutput": {
                                "hookEventName": "PreToolUse",
                                "permissionDecision": "allow"
                            }
                        })
                    }
                } else {
                    permission_hook_response(&hook_event.client_type, hook_behavior)
                };

                event_bus::emit_status_change(&app_handle, "idle");
                Ok(json_response(StatusCode::OK, &response))
            }
            Ok(Err(_)) => {
                log::warn!("Permission sender dropped for event {}", event_id);
                event_bus::emit_status_change(&app_handle, "idle");
                Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": "internal error"}),
                ))
            }
            Err(_) => {
                log::warn!("Permission request timed out for event {}", event_id);
                // Notify frontend to dismiss the stale ConfirmToast
                app_handle
                    .emit("humhum://permission-timeout", &event_id)
                    .unwrap_or_else(|e| log::error!("Failed to emit timeout: {}", e));
                event_bus::emit_status_change(&app_handle, "idle");
                Ok(json_response(
                    StatusCode::GATEWAY_TIMEOUT,
                    &serde_json::json!({"error": "timeout"}),
                ))
            }
        }
    } else {
        // Non-blocking events: return immediately
        Ok(empty_response(StatusCode::NO_CONTENT))
    }
}

fn session_auto_confirm_enabled(config: &crate::config::AppConfig, session_id: &str) -> bool {
    config.ui.auto_confirm || config.ui.auto_confirm_sessions.contains(session_id)
}

fn enrich_ghostty_route(payload: &mut Value, hook_event_name: &str) {
    if !matches!(hook_event_name, "SessionStart" | "UserPromptSubmit") {
        return;
    }
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    let workspace = object
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::to_string);
    let Some(route) = object.get_mut("route").and_then(Value::as_object_mut) else {
        return;
    };
    let is_ghostty = route
        .get("term_program")
        .and_then(Value::as_str)
        .is_some_and(|value| value.to_ascii_lowercase().contains("ghostty"));
    if !is_ghostty || route.contains_key("ghostty_terminal_id") {
        return;
    }
    if let Some(terminal_id) = workspace
        .as_deref()
        .and_then(crate::window_focus::capture_ghostty_terminal_id)
    {
        route.insert("ghostty_terminal_id".into(), Value::String(terminal_id));
    }
}

fn normalize_agent_payload(mut payload: Value) -> Value {
    let Some(object) = payload.as_object_mut() else {
        return payload;
    };
    let has_session = object
        .get("session_id")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if !has_session {
        let session_id = [
            "sessionId",
            "conversation_id",
            "conversationId",
            "task_id",
            "taskId",
            "generation_id",
        ]
        .into_iter()
        .find_map(|key| {
            object
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });
        if let Some(session_id) = session_id {
            object.insert("session_id".into(), Value::String(session_id));
        }
    }

    let has_cwd = object
        .get("cwd")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if !has_cwd {
        let cwd = ["workspace_roots", "workspaceRoots"]
            .into_iter()
            .find_map(|key| object.get(key).and_then(Value::as_array))
            .and_then(|roots| roots.first())
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                ["working_directory", "workspace_path", "project_dir"]
                    .into_iter()
                    .find_map(|key| object.get(key).and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
        if let Some(cwd) = cwd {
            object.insert("cwd".into(), Value::String(cwd));
        }
    }
    payload
}

/// GET /pending — list all pending permission requests
async fn handle_pending(pending: PendingMap) -> Result<Response<Full<Bytes>>, Infallible> {
    let map = pending.lock().await;
    let events: Vec<&HookEvent> = map.values().map(|pr| &pr.event).collect();
    Ok(json_response(
        StatusCode::OK,
        &serde_json::json!({
            "pending": events,
            "count": events.len(),
        }),
    ))
}

/// POST /respond — respond to a pending permission request
/// Body: { "event_id": "...", "behavior": "allow" | "deny" }
async fn handle_respond(
    req: Request<hyper::body::Incoming>,
    pending: PendingMap,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("failed to read body: {}", e)}),
            ));
        }
    };

    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {}", e)}),
            ));
        }
    };

    let event_id = match payload.get("event_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": "missing event_id"}),
            ));
        }
    };

    let behavior = match payload.get("behavior").and_then(|v| v.as_str()) {
        Some(b) if b == "allow" || b == "deny" || b == "allowAlways" => b.to_string(),
        _ => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": "behavior must be 'allow' or 'deny'"}),
            ));
        }
    };

    let mut map = pending.lock().await;
    if let Some(mut pr) = map.remove(&event_id) {
        if let Some(sender) = pr.sender.take() {
            let decision = PermissionDecision {
                behavior: behavior.clone(),
                reason: payload
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                answer: payload.get("answer").cloned(),
            };
            match sender.send(decision) {
                Ok(_) => Ok(json_response(
                    StatusCode::OK,
                    &serde_json::json!({"status": "responded", "behavior": behavior}),
                )),
                Err(_) => Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": "failed to send decision (receiver dropped)"}),
                )),
            }
        } else {
            Ok(json_response(
                StatusCode::CONFLICT,
                &serde_json::json!({"error": "already responded to this request"}),
            ))
        }
    } else {
        Ok(json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({"error": format!("no pending request with id: {}", event_id)}),
        ))
    }
}

/// GET /hush/inbox — current Hush message inbox.
async fn handle_hush_inbox_query(
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let store =
        app_handle.state::<std::sync::Arc<std::sync::Mutex<crate::hush_store::HushStore>>>();
    let store = match store.lock() {
        Ok(s) => s,
        Err(e) => {
            return Ok(json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &serde_json::json!({"error": format!("lock error: {}", e)}),
            ));
        }
    };

    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(store.summary()).unwrap_or_default(),
    ))
}

/// POST /hush/inbox — ingest one DingTalk/WeChat/social message into Hush.
async fn handle_hush_inbox_post(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("failed to read body: {}", e)}),
            ));
        }
    };

    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {}", e)}),
            ));
        }
    };

    let (message, summary) = {
        let store =
            app_handle.state::<std::sync::Arc<std::sync::Mutex<crate::hush_store::HushStore>>>();
        let mut store = match store.lock() {
            Ok(s) => s,
            Err(e) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {}", e)}),
                ));
            }
        };

        match store.add_from_value(payload) {
            Ok(message) => {
                let summary = store.summary();
                (message, summary)
            }
            Err(error) => {
                return Ok(json_response(
                    StatusCode::BAD_REQUEST,
                    &serde_json::json!({"error": error}),
                ));
            }
        }
    };

    let _ = app_handle.emit("humhum://hush-message", &message);
    Ok(json_response(
        StatusCode::OK,
        &serde_json::json!({
            "status": "received",
            "message": message,
            "summary": summary,
        }),
    ))
}

fn canonical_hook_event_name<'a>(client_type: &str, source_event: &'a str) -> &'a str {
    match (client_type, source_event) {
        ("gemini-cli", "AfterAgent") => "TaskCompleted",
        ("gemini-cli", "BeforeTool") => "PreToolUse",
        ("gemini-cli", "AfterTool") => "PostToolUse",
        _ => source_event,
    }
}

fn permission_hook_response(client_type: &str, behavior: &str) -> Value {
    let _ = client_type;
    let behavior = if behavior == "deny" { "deny" } else { "allow" };
    serde_json::json!({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": { "behavior": behavior }
        }
    })
}

/// GET /knowledge?q=<keyword> — query the knowledge base
async fn handle_knowledge_query(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    use tauri::Manager;

    let query_string = req.uri().query().unwrap_or("");
    let keyword = query_string
        .split('&')
        .find_map(|pair| {
            let (key, val) = pair.split_once('=')?;

            if key == "q" {
                Some(val.to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    let store = app_handle
        .state::<std::sync::Arc<std::sync::Mutex<crate::knowledge_store::KnowledgeStore>>>();
    let store = match store.lock() {
        Ok(s) => s,
        Err(e) => {
            return Ok(json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &serde_json::json!({"error": format!("lock error: {}", e)}),
            ));
        }
    };

    let result = if keyword.is_empty() {
        serde_json::to_value(store.get_all()).unwrap_or_default()
    } else {
        serde_json::to_value(store.query(&keyword)).unwrap_or_default()
    };

    Ok(json_response(StatusCode::OK, &result))
}

async fn handle_hexa_register(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("failed to read body: {}", e)}),
            ));
        }
    };
    let request: HexaWatchRegisterRequest = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {}", e)}),
            ));
        }
    };

    let session = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaWatchStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(e) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {}", e)}),
                ));
            }
        };
        match store.register(request) {
            Ok(session) => session,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("could not persist watched session: {error}")}),
                ));
            }
        }
    };

    app_handle
        .emit("humhum://hexa-session-changed", &session)
        .unwrap_or_else(|e| log::error!("Failed to emit Hexa watch register: {}", e));
    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(session).unwrap_or_default(),
    ))
}

async fn handle_hexa_update(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("failed to read body: {}", e)}),
            ));
        }
    };
    let request: HexaWatchUpdateRequest = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {}", e)}),
            ));
        }
    };

    let session = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaWatchStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(e) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {}", e)}),
                ));
            }
        };
        match store.update(request) {
            Ok(session) => session,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("could not persist watched session: {error}")}),
                ));
            }
        }
    };

    let Some(session) = session else {
        return Ok(json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({"error": "watched session not found"}),
        ));
    };

    app_handle
        .emit("humhum://hexa-session-changed", &session)
        .unwrap_or_else(|e| log::error!("Failed to emit Hexa watch update: {}", e));
    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(session).unwrap_or_default(),
    ))
}

async fn handle_hexa_audit(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match Limited::new(req.into_body(), MAX_HEXA_AUDIT_BODY_BYTES)
        .collect()
        .await
    {
        Ok(collected) => collected.to_bytes(),
        Err(error) => {
            let (status, message) = if error.downcast_ref::<LengthLimitError>().is_some() {
                (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Hexa audit body is too large",
                )
            } else {
                (StatusCode::BAD_REQUEST, "failed to read Hexa audit body")
            };
            return Ok(json_response(
                status,
                &serde_json::json!({"error": format!("{message}: {error}")}),
            ));
        }
    };
    let request: HexaAuditMutationRequest = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {error}")}),
            ));
        }
    };
    if !hexa_audit_mutation_allowed_over_agent_api(&request.mutation) {
        return Ok(json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({
                "error": "user review can only be recorded from the desktop UI"
            }),
        ));
    }

    let session = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaWatchStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {error}")}),
                ));
            }
        };
        match store.mutate_audit(request) {
            Ok(session) => session,
            Err(error) => {
                return Ok(json_response(
                    hexa_audit_error_status(&error),
                    &serde_json::json!({"error": error}),
                ));
            }
        }
    };

    app_handle
        .emit("humhum://hexa-session-changed", &session)
        .unwrap_or_else(|error| log::error!("Failed to emit Hexa audit update: {error}"));
    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(session).unwrap_or_default(),
    ))
}

async fn handle_hexa_plan(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(error) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("failed to read body: {error}")}),
            ))
        }
    };
    let request: HexaPlanSyncRequest = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {error}")}),
            ))
        }
    };
    let session = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaWatchStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {error}")}),
                ))
            }
        };
        match store.sync_plan(request) {
            Ok(session) => session,
            Err(error) => {
                return Ok(json_response(
                    hexa_audit_error_status(&error),
                    &serde_json::json!({"error": error}),
                ))
            }
        }
    };
    app_handle
        .emit("humhum://hexa-session-changed", &session)
        .unwrap_or_else(|error| log::error!("Failed to emit Hexa plan update: {error}"));
    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(session).unwrap_or_default(),
    ))
}

fn hexa_audit_mutation_allowed_over_agent_api(mutation: &HexaAuditMutation) -> bool {
    !matches!(mutation, HexaAuditMutation::SetUserReview { .. })
}

fn hexa_audit_error_status(error: &str) -> StatusCode {
    if error.contains("watched session not found") {
        StatusCode::NOT_FOUND
    } else if error.contains("workflow cycle")
        || error.contains("unknown dependency")
        || error.contains("unknown work item")
        || error.contains("cannot remove work item")
        || error.contains("work item not found")
        || error.contains("cannot be empty")
        || error.contains("requires evidence")
    {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

async fn handle_hexa_delete(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("failed to read body: {}", e)}),
            ));
        }
    };
    let request: HexaWatchDeleteRequest = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(e) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {}", e)}),
            ));
        }
    };

    let deleted = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaWatchStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(e) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {}", e)}),
                ));
            }
        };
        match store.delete(&request.session_id) {
            Ok(session) => session,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("could not persist watched session: {error}")}),
                ));
            }
        }
    };

    if deleted.is_none() {
        return Ok(json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({"error": "watched session not found"}),
        ));
    }

    app_handle
        .emit("humhum://hexa-session-changed", &request.session_id)
        .unwrap_or_else(|e| log::error!("Failed to emit Hexa watch delete: {}", e));
    Ok(json_response(
        StatusCode::OK,
        &serde_json::json!({"status": "deleted", "session_id": request.session_id}),
    ))
}

async fn read_hexa_goal_body(
    req: Request<hyper::body::Incoming>,
) -> Result<Bytes, Response<Full<Bytes>>> {
    match Limited::new(req.into_body(), MAX_HEXA_GOAL_BODY_BYTES)
        .collect()
        .await
    {
        Ok(collected) => Ok(collected.to_bytes()),
        Err(error) => {
            let (status, message) = if error.downcast_ref::<LengthLimitError>().is_some() {
                (StatusCode::PAYLOAD_TOO_LARGE, "Hexa goal body is too large")
            } else {
                (StatusCode::BAD_REQUEST, "failed to read Hexa goal body")
            };
            Err(json_response(
                status,
                &serde_json::json!({"error": format!("{message}: {error}")}),
            ))
        }
    }
}

async fn handle_hexa_goal_link(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match read_hexa_goal_body(req).await {
        Ok(body) => body,
        Err(response) => return Ok(response),
    };
    let request: HexaGoalLinkRequest = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {error}")}),
            ));
        }
    };
    let watched_session = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaWatchStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {error}")}),
                ));
            }
        };
        if let Err(error) = store.reload_from_disk() {
            return Ok(json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &serde_json::json!({"error": error}),
            ));
        }
        match store
            .sessions()
            .into_iter()
            .find(|session| session.session_id == request.session_id)
        {
            Some(session) => session,
            None => {
                return Ok(json_response(
                    StatusCode::NOT_FOUND,
                    &serde_json::json!({"error": "watched session not found"}),
                ));
            }
        }
    };
    let goal = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaGoalStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {error}")}),
                ));
            }
        };
        match store.link_attempt(
            request,
            HexaGoalAttemptContext {
                agent_family: watched_session.agent,
                workspace: watched_session.workspace,
            },
        ) {
            Ok(goal) => goal,
            Err(error) => {
                return Ok(json_response(
                    hexa_goal_error_status(&error),
                    &serde_json::json!({"error": error}),
                ));
            }
        }
    };
    app_handle
        .emit("humhum://hexa-goal-changed", &goal)
        .unwrap_or_else(|error| log::error!("Failed to emit Hexa goal link: {error}"));
    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(goal).unwrap_or_default(),
    ))
}

async fn handle_hexa_goal_result(
    req: Request<hyper::body::Incoming>,
    app_handle: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let body = match read_hexa_goal_body(req).await {
        Ok(body) => body,
        Err(response) => return Ok(response),
    };
    let mut request: HexaAttemptResultRequest = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json_response(
                StatusCode::BAD_REQUEST,
                &serde_json::json!({"error": format!("invalid JSON: {error}")}),
            ));
        }
    };
    if !agent_result_status_allowed(&request.result_status) {
        return Ok(json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({
                "error": "agents can only report unverified, failed, or superseded results"
            }),
        ));
    }
    normalize_agent_result_evidence(&mut request);
    let goal = {
        let store = app_handle.state::<Arc<std::sync::Mutex<HexaGoalStore>>>();
        let mut store = match store.lock() {
            Ok(store) => store,
            Err(error) => {
                return Ok(json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &serde_json::json!({"error": format!("lock error: {error}")}),
                ));
            }
        };
        match store.update_attempt_result(request) {
            Ok(goal) => goal,
            Err(error) => {
                return Ok(json_response(
                    hexa_goal_error_status(&error),
                    &serde_json::json!({"error": error}),
                ));
            }
        }
    };
    app_handle
        .emit("humhum://hexa-goal-changed", &goal)
        .unwrap_or_else(|error| log::error!("Failed to emit Hexa goal result: {error}"));
    Ok(json_response(
        StatusCode::OK,
        &serde_json::to_value(goal).unwrap_or_default(),
    ))
}

fn agent_result_status_allowed(status: &HexaAttemptResultStatus) -> bool {
    matches!(
        status,
        HexaAttemptResultStatus::Unverified
            | HexaAttemptResultStatus::Failed
            | HexaAttemptResultStatus::Superseded
    )
}

fn normalize_agent_result_evidence(request: &mut HexaAttemptResultRequest) {
    for evidence in &mut request.evidence {
        evidence.kind = "agent_report".into();
    }
}

fn hexa_goal_error_status(error: &str) -> StatusCode {
    if error.contains("goal not found") || error.contains("goal attempt not found") {
        StatusCode::NOT_FOUND
    } else if error.contains("cannot be empty")
        || error.contains("mismatch")
        || error.contains("acceptance requires")
        || error.contains("accepted attempt cannot")
    {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

fn json_response(status: StatusCode, body: &Value) -> Response<Full<Bytes>> {
    let json = serde_json::to_string(body).unwrap_or_default();
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(json)))
        .unwrap()
}

fn empty_response(status: StatusCode) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .body(Full::new(Bytes::new()))
        .unwrap()
}

#[cfg(test)]
mod mobile_pairing_scope_tests {
    use super::*;

    #[test]
    fn control_scope_requires_an_explicit_query_value() {
        assert_eq!(
            mobile_pairing_scope(Some("scope=control")),
            crate::mobile_bridge::MobileDeviceScope::Control
        );
        assert_eq!(
            mobile_pairing_scope(Some("scope=read")),
            crate::mobile_bridge::MobileDeviceScope::Read
        );
        assert_eq!(
            mobile_pairing_scope(None),
            crate::mobile_bridge::MobileDeviceScope::Read
        );
    }

    #[test]
    fn tailnet_pairing_requires_an_explicit_query_value() {
        assert_eq!(
            mobile_pairing_network(Some("scope=control&network=tailnet")),
            crate::mobile_bridge::MobileNetwork::Tailnet
        );
        assert_eq!(
            mobile_pairing_network(Some("scope=control&network=lan")),
            crate::mobile_bridge::MobileNetwork::Lan
        );
        assert_eq!(
            mobile_pairing_network(None),
            crate::mobile_bridge::MobileNetwork::Lan
        );
    }
}

#[cfg(test)]
mod agent_payload_tests {
    use super::*;

    #[test]
    fn cursor_conversation_and_workspace_fields_become_a_stable_session() {
        let payload = normalize_agent_payload(serde_json::json!({
            "conversation_id": "cursor-conversation-42",
            "generation_id": "cursor-turn-7",
            "workspace_roots": ["/Users/test/project"],
            "prompt": "private prompt"
        }));

        assert_eq!(payload["session_id"], "cursor-conversation-42");
        assert_eq!(payload["cwd"], "/Users/test/project");
        assert_eq!(payload["prompt"], "private prompt");
    }

    #[test]
    fn existing_normalized_fields_take_priority() {
        let payload = normalize_agent_payload(serde_json::json!({
            "session_id": "native-session",
            "conversation_id": "cursor-session",
            "cwd": "/native/project",
            "workspace_roots": ["/cursor/project"]
        }));

        assert_eq!(payload["session_id"], "native-session");
        assert_eq!(payload["cwd"], "/native/project");
    }
}

#[cfg(test)]
mod session_auto_confirm_tests {
    use super::*;

    #[test]
    fn a_saved_session_is_approved_without_enabling_global_rage_mode() {
        let mut config = crate::config::AppConfig::default();
        config
            .ui
            .auto_confirm_sessions
            .insert("claude-session-1".into());

        assert!(session_auto_confirm_enabled(&config, "claude-session-1"));
        assert!(!session_auto_confirm_enabled(&config, "claude-session-2"));
    }

    #[test]
    fn global_rage_mode_still_approves_every_session() {
        let mut config = crate::config::AppConfig::default();
        config.ui.auto_confirm = true;

        assert!(session_auto_confirm_enabled(&config, "any-session"));
    }
}

#[cfg(test)]
mod hook_protocol_tests {
    use super::{canonical_hook_event_name, permission_hook_response};

    #[test]
    fn codex_permission_response_uses_nested_decision() {
        let response = permission_hook_response("codex", "allowAlways");
        assert_eq!(
            response.pointer("/hookSpecificOutput/decision/behavior"),
            Some(&serde_json::json!("allow"))
        );
        assert!(response
            .pointer("/hookSpecificOutput/permissionDecision")
            .is_none());
    }

    #[test]
    fn claude_permission_response_keeps_nested_decision() {
        let response = permission_hook_response("claude-code", "deny");
        assert_eq!(
            response.pointer("/hookSpecificOutput/decision/behavior"),
            Some(&serde_json::json!("deny"))
        );
    }

    #[test]
    fn gemini_after_agent_is_normalized_to_task_completed() {
        assert_eq!(
            canonical_hook_event_name("gemini-cli", "AfterAgent"),
            "TaskCompleted"
        );
        assert_eq!(
            canonical_hook_event_name("claude-code", "AfterAgent"),
            "AfterAgent"
        );
    }
}

#[cfg(test)]
mod hexa_audit_endpoint_tests {
    use super::*;

    #[test]
    fn audit_validation_errors_have_actionable_http_statuses() {
        assert_eq!(
            hexa_audit_error_status("workflow cycle detected at work item build"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            hexa_audit_error_status("unknown dependency verify for work item ship"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            hexa_audit_error_status("watched session not found: missing"),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            hexa_audit_error_status("Could not write Hexa watch store"),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn agent_api_cannot_impersonate_a_user_review() {
        let user_review = HexaAuditMutation::SetUserReview {
            review: crate::hexa_watch_store::HexaReviewInput {
                rating: crate::hexa_watch_store::HexaReviewRating::Satisfied,
                summary: "Looks good".into(),
                evidence: vec![],
            },
        };
        let hexa_review = HexaAuditMutation::SetHexaReview {
            review: crate::hexa_watch_store::HexaReviewInput {
                rating: crate::hexa_watch_store::HexaReviewRating::Satisfied,
                summary: "Evidence-backed review".into(),
                evidence: vec![crate::hexa_watch_store::HexaEvidenceInput {
                    kind: "test".into(),
                    label: "cargo test passed".into(),
                    location: None,
                }],
            },
        };

        assert!(!hexa_audit_mutation_allowed_over_agent_api(&user_review));
        assert!(hexa_audit_mutation_allowed_over_agent_api(&hexa_review));
    }
}

#[cfg(test)]
mod hexa_goal_endpoint_tests {
    use super::*;
    use crate::hexa_goal_store::HexaAttemptResultRequest;
    use crate::hexa_watch_store::HexaEvidenceInput;

    #[test]
    fn agent_result_status_allows_only_unverified_failed_and_superseded() {
        for status in ["unverified", "failed", "superseded"] {
            let request: HexaAttemptResultRequest = serde_json::from_value(serde_json::json!({
                "goal_id": "goal-hush",
                "session_id": "session-codex",
                "result_status": status,
                "evidence": []
            }))
            .unwrap();
            assert!(agent_result_status_allowed(&request.result_status));
        }

        let accepted: HexaAttemptResultRequest = serde_json::from_value(serde_json::json!({
            "goal_id": "goal-hush",
            "session_id": "session-codex",
            "result_status": "accepted",
            "evidence": []
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&accepted).unwrap()["result_status"],
            "accepted"
        );
        assert!(!agent_result_status_allowed(&accepted.result_status));
    }

    #[test]
    fn agent_result_evidence_is_always_downgraded_to_agent_report() {
        let mut request = HexaAttemptResultRequest {
            goal_id: "goal-hush".into(),
            session_id: "session-codex".into(),
            result_status: HexaAttemptResultStatus::Unverified,
            evidence: vec![
                HexaEvidenceInput {
                    kind: "system_fact".into(),
                    label: "Agent claims a trusted fact".into(),
                    location: None,
                },
                HexaEvidenceInput {
                    kind: "test".into(),
                    label: "Agent claims tests passed".into(),
                    location: Some("npm test".into()),
                },
            ],
        };

        normalize_agent_result_evidence(&mut request);

        assert!(request
            .evidence
            .iter()
            .all(|evidence| evidence.kind == "agent_report"));
    }
}
