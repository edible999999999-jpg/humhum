use crate::event_bus::{self, HookEvent, PermissionDecision};
use crate::session_store::SessionStore;
use crate::stats_store::StatsStore;
use http_body_util::{BodyExt, Full};
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
use tokio::sync::{Mutex, oneshot};
use uuid::Uuid;

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

        tokio::task::spawn(async move {
            let service = service_fn(move |req| {
                let app = app.clone();
                let pending = pending.clone();
                async move { handle_request(req, app, pending).await }
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
) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    log::debug!("{} {}", method, path);

    match (method.as_str(), path.as_str()) {
        ("OPTIONS", _) => Ok(cors_preflight_response()),
        ("POST", "/event") => handle_event(req, app_handle, pending).await,
        ("GET", "/health") => Ok(json_response(StatusCode::OK, &serde_json::json!({
            "status": "ok",
            "name": "HumHum",
            "version": env!("CARGO_PKG_VERSION"),
        }))),
        ("GET", "/pending") => handle_pending(pending).await,
        ("POST", "/respond") => handle_respond(req, pending).await,
        _ => Ok(json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({"error": "not found"}),
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

    let hook_event_name = payload
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

    let hook_event = HookEvent {
        id: event_id.clone(),
        hook_event_name: hook_event_name.clone(),
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

    // Record stats on session end events
    if matches!(hook_event_name.as_str(), "Stop" | "TaskCompleted" | "SessionEnd") {
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

    // Emit event to frontend
    event_bus::emit_hook_event(&app_handle, &hook_event);

    // AskUserQuestion doesn't need to block — answer goes to terminal, not back through hook
    let tool_name = payload.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
    let needs_blocking = hook_event_name == "PermissionRequest" && tool_name != "AskUserQuestion";

    // For PermissionRequest events (except AskUserQuestion), wait for user decision
    if needs_blocking {
        event_bus::emit_status_change(&app_handle, "waiting-confirmation");

        let (tx, rx) = oneshot::channel();

        // Store the sender so the frontend command can use it
        {
            let mut map = pending.lock().await;
            map.insert(event_id.clone(), PendingRequest {
                sender: Some(tx),
                event: hook_event.clone(),
            });
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
                // Hook protocol only accepts "allow" or "deny" — map allowAlways → allow
                let hook_behavior = if d.behavior == "allowAlways" { "allow" } else { &d.behavior };
                log::info!("Permission decided for {}: {} (hook: {})", event_id, d.behavior, hook_behavior);
                let response = serde_json::json!({
                    "hookSpecificOutput": {
                        "hookEventName": "PermissionRequest",
                        "decision": {
                            "behavior": hook_behavior,
                        }
                    }
                });
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
                app_handle.emit("humhum://permission-timeout", &event_id)
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
        Ok(json_response(
            StatusCode::OK,
            &serde_json::json!({"status": "received"}),
        ))
    }
}

/// GET /pending — list all pending permission requests
async fn handle_pending(
    pending: PendingMap,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let map = pending.lock().await;
    let events: Vec<&HookEvent> = map.values().map(|pr| &pr.event).collect();
    Ok(json_response(StatusCode::OK, &serde_json::json!({
        "pending": events,
        "count": events.len(),
    })))
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
                reason: payload.get("reason").and_then(|v| v.as_str()).map(String::from),
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

fn cors_preflight_response() -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, POST, OPTIONS")
        .header("access-control-allow-headers", "content-type")
        .header("access-control-max-age", "86400")
        .body(Full::new(Bytes::new()))
        .unwrap()
}

fn json_response(status: StatusCode, body: &Value) -> Response<Full<Bytes>> {
    let json = serde_json::to_string(body).unwrap_or_default();
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, POST, OPTIONS")
        .header("access-control-allow-headers", "content-type")
        .body(Full::new(Bytes::from(json)))
        .unwrap()
}
