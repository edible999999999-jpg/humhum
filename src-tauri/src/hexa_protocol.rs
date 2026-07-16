use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaEventKind {
    SessionStarted,
    SessionResumed,
    SessionStateChanged,
    TurnStarted,
    TurnCompleted,
    TurnFailed,
    TurnInterrupted,
    AssistantTextDelta,
    AssistantTextCompleted,
    ReasoningSummary,
    PlanUpdated,
    ToolStarted,
    ToolUpdated,
    ToolCompleted,
    FileChangeProposed,
    FileChangeApplied,
    ApprovalRequested,
    ApprovalResolved,
    UserQuestionRequested,
    UserQuestionResolved,
    UsageUpdated,
    ErrorReported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaSensitivity {
    Public,
    Private,
    Sensitive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaEvent {
    pub event_id: String,
    pub session_id: String,
    pub provider: String,
    pub provider_thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub timestamp: String,
    pub kind: HexaEventKind,
    pub payload: Value,
    pub sensitivity: HexaSensitivity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaSessionStatus {
    Starting,
    Working,
    Waiting,
    Idle,
    Completed,
    Failed,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaApprovalOperation {
    Command,
    FileChange,
    McpTool,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaApproval {
    pub approval_id: String,
    pub operation: HexaApprovalOperation,
    pub summary: String,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaSessionProjection {
    pub session_id: String,
    pub provider: String,
    pub provider_thread_id: Option<String>,
    pub workspace: Option<String>,
    pub project_name: Option<String>,
    pub status: HexaSessionStatus,
    pub current_turn_id: Option<String>,
    pub current_activity: Option<String>,
    pub pending_approvals: Vec<HexaApproval>,
    pub started_at: String,
    pub last_activity_at: String,
}

impl HexaSessionProjection {
    fn from_event(event: &HexaEvent) -> Self {
        Self {
            session_id: event.session_id.clone(),
            provider: event.provider.clone(),
            provider_thread_id: event.provider_thread_id.clone(),
            workspace: string_field(&event.payload, "workspace"),
            project_name: string_field(&event.payload, "project_name"),
            status: HexaSessionStatus::Starting,
            current_turn_id: None,
            current_activity: None,
            pending_approvals: Vec::new(),
            started_at: event.timestamp.clone(),
            last_activity_at: event.timestamp.clone(),
        }
    }
}

#[derive(Debug, Default)]
pub struct HexaProjectionStore {
    sessions: HashMap<String, HexaSessionProjection>,
}

impl HexaProjectionStore {
    pub fn apply(&mut self, event: &HexaEvent) {
        let session = self
            .sessions
            .entry(event.session_id.clone())
            .or_insert_with(|| HexaSessionProjection::from_event(event));

        session.last_activity_at = event.timestamp.clone();
        if session.provider_thread_id.is_none() {
            session.provider_thread_id = event
                .provider_thread_id
                .clone()
                .or_else(|| string_field(&event.payload, "provider_thread_id"));
        }
        if session.workspace.is_none() {
            session.workspace = string_field(&event.payload, "workspace");
        }

        match event.kind {
            HexaEventKind::SessionStarted | HexaEventKind::SessionResumed => {
                session.status = HexaSessionStatus::Idle;
            }
            HexaEventKind::TurnStarted => {
                session.current_turn_id = event
                    .turn_id
                    .clone()
                    .or_else(|| string_field(&event.payload, "turn_id"));
                session.status = HexaSessionStatus::Working;
            }
            HexaEventKind::TurnCompleted
            | HexaEventKind::TurnFailed
            | HexaEventKind::TurnInterrupted => {
                let completed_turn = event
                    .turn_id
                    .as_deref()
                    .or_else(|| event.payload.get("turn_id").and_then(Value::as_str));
                if completed_turn.is_none() || completed_turn == session.current_turn_id.as_deref()
                {
                    session.current_turn_id = None;
                    session.current_activity = None;
                    session.status = match event.kind {
                        HexaEventKind::TurnFailed => HexaSessionStatus::Failed,
                        _ => HexaSessionStatus::Idle,
                    };
                }
            }
            HexaEventKind::ApprovalRequested => {
                if let Some(approval) = approval_from_payload(&event.payload) {
                    session
                        .pending_approvals
                        .retain(|item| item.approval_id != approval.approval_id);
                    session.pending_approvals.push(approval);
                    session.current_activity = Some("Waiting for your decision".to_string());
                    session.status = HexaSessionStatus::Waiting;
                }
            }
            HexaEventKind::ApprovalResolved => {
                if let Some(approval_id) = event.payload.get("approval_id").and_then(Value::as_str)
                {
                    session
                        .pending_approvals
                        .retain(|item| item.approval_id != approval_id);
                    if session.pending_approvals.is_empty() {
                        session.current_activity = None;
                        session.status = if session.current_turn_id.is_some() {
                            HexaSessionStatus::Working
                        } else {
                            HexaSessionStatus::Idle
                        };
                    }
                }
            }
            HexaEventKind::ToolStarted
            | HexaEventKind::ToolUpdated
            | HexaEventKind::ToolCompleted
            | HexaEventKind::FileChangeProposed
            | HexaEventKind::FileChangeApplied
            | HexaEventKind::AssistantTextCompleted
            | HexaEventKind::ReasoningSummary => {
                if let Some(activity) = string_field(&event.payload, "activity") {
                    session.current_activity = Some(activity);
                }
                if session.status != HexaSessionStatus::Waiting {
                    session.status = HexaSessionStatus::Working;
                }
            }
            HexaEventKind::PlanUpdated => {
                session.current_activity = Some("Codex updated its work plan".to_string());
                session.status = HexaSessionStatus::Working;
            }
            HexaEventKind::ErrorReported => session.status = HexaSessionStatus::Failed,
            _ => {}
        }
    }

    pub fn session(&self, session_id: &str) -> Option<&HexaSessionProjection> {
        self.sessions.get(session_id)
    }

    pub fn sessions(&self) -> Vec<HexaSessionProjection> {
        let mut sessions: Vec<_> = self.sessions.values().cloned().collect();
        sessions.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));
        sessions
    }
}

pub fn scope_provider_item(thread_id: Option<&str>, item_id: &str) -> String {
    match thread_id.filter(|value| !value.is_empty()) {
        Some(thread_id) => format!("{thread_id}:{item_id}"),
        None => item_id.to_string(),
    }
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(Value::as_str).map(String::from)
}

fn approval_from_payload(payload: &Value) -> Option<HexaApproval> {
    let operation = match payload.get("operation").and_then(Value::as_str) {
        Some("command") => HexaApprovalOperation::Command,
        Some("file_change") => HexaApprovalOperation::FileChange,
        Some("mcp_tool") => HexaApprovalOperation::McpTool,
        Some(_) | None => HexaApprovalOperation::Other,
    };

    Some(HexaApproval {
        approval_id: string_field(payload, "approval_id")?,
        operation,
        summary: string_field(payload, "summary").unwrap_or_else(|| "Needs approval".into()),
        reason: string_field(payload, "reason"),
        expires_at: string_field(payload, "expires_at"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn event(session_id: &str, kind: HexaEventKind, payload: Value) -> HexaEvent {
        HexaEvent {
            event_id: format!("event-{session_id}"),
            session_id: session_id.to_string(),
            provider: "codex".to_string(),
            provider_thread_id: payload
                .get("provider_thread_id")
                .and_then(Value::as_str)
                .map(String::from),
            turn_id: payload
                .get("turn_id")
                .and_then(Value::as_str)
                .map(String::from),
            timestamp: "2026-07-11T00:00:00Z".to_string(),
            kind,
            payload,
            sensitivity: HexaSensitivity::Private,
        }
    }

    #[test]
    fn scopes_item_ids_by_provider_thread() {
        assert_eq!(
            scope_provider_item(Some("thread-a"), "item-1"),
            "thread-a:item-1"
        );
        assert_eq!(scope_provider_item(None, "item-1"), "item-1");
    }

    #[test]
    fn approval_resolution_updates_the_matching_session() {
        let mut store = HexaProjectionStore::default();
        store.apply(&event(
            "s1",
            HexaEventKind::SessionStarted,
            json!({
                "provider": "codex",
                "provider_thread_id": "t1",
                "workspace": "/tmp/demo"
            }),
        ));
        store.apply(&event(
            "s1",
            HexaEventKind::ApprovalRequested,
            json!({
                "approval_id": "t1:item-1",
                "operation": "command",
                "summary": "Run tests"
            }),
        ));
        assert_eq!(store.session("s1").unwrap().pending_approvals.len(), 1);

        store.apply(&event(
            "s1",
            HexaEventKind::ApprovalResolved,
            json!({
                "approval_id": "t1:item-1",
                "decision": "deny"
            }),
        ));
        assert!(store.session("s1").unwrap().pending_approvals.is_empty());
    }

    #[test]
    fn stale_turn_completion_does_not_finish_a_newer_turn() {
        let mut store = HexaProjectionStore::default();
        store.apply(&event(
            "s1",
            HexaEventKind::TurnStarted,
            json!({"turn_id": "new"}),
        ));
        store.apply(&event(
            "s1",
            HexaEventKind::TurnCompleted,
            json!({"turn_id": "old"}),
        ));
        assert_eq!(
            store.session("s1").unwrap().status,
            HexaSessionStatus::Working
        );
    }

    #[test]
    fn meaningful_provider_events_update_current_activity() {
        let mut store = HexaProjectionStore::default();
        store.apply(&event(
            "s1",
            HexaEventKind::ToolStarted,
            json!({"activity": "Running tests", "item_id": "t1:item-1"}),
        ));
        assert_eq!(
            store.session("s1").unwrap().current_activity.as_deref(),
            Some("Running tests")
        );
    }
}
