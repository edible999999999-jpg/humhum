use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Represents an event received from a Claude Code hook
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEvent {
    pub id: String,
    pub hook_event_name: String,
    pub session_id: String,
    pub transcript_path: Option<String>,
    pub cwd: Option<String>,
    pub client_type: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

/// State shared across the application for pending permission requests
#[derive(Debug)]
pub struct PendingPermission {
    pub event_id: String,
    pub sender: tokio::sync::oneshot::Sender<PermissionDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionDecision {
    pub behavior: String, // "allow" | "deny"
    pub reason: Option<String>,
}

/// Event history for the frontend
#[derive(Debug, Default)]
pub struct EventBusState {
    pub events: Vec<HookEvent>,
    pub pending_permission: Option<PendingPermission>,
}

/// Emit a hook event to the frontend via Tauri's event system
pub fn emit_hook_event(app_handle: &tauri::AppHandle, event: &HookEvent) {
    app_handle
        .emit("humhum://hook-event", event)
        .unwrap_or_else(|e| {
            log::error!("Failed to emit hook event: {}", e);
        });
}

/// Emit a status change to the frontend (e.g., pet state transition)
pub fn emit_status_change(app_handle: &tauri::AppHandle, status: &str) {
    app_handle
        .emit("humhum://status-change", status)
        .unwrap_or_else(|e| {
            log::error!("Failed to emit status change: {}", e);
        });
}
