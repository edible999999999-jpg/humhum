use crate::event_bus::HookEvent;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub session_id: String,
    pub client_type: String,
    pub cwd: Option<String>,
    pub project_name: Option<String>,
    pub started_at: String,
    pub last_event_at: String,
    pub event_count: u32,
    pub status: SessionStatus,
    pub last_hook_message: Option<String>,
    pub last_tool_name: Option<String>,
    pub recent_tools: Vec<String>,
    pub event_names: Vec<String>,
    pub has_pending_permission: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Active,
    Idle,
    Completed,
}

const MAX_RECENT_TOOLS: usize = 10;
const MAX_EVENT_NAMES: usize = 50;
const MAX_COMPLETED_SESSIONS: usize = 30;

#[derive(Debug, Default)]
pub struct SessionStore {
    sessions: HashMap<String, Session>,
    completed_sessions: Vec<Session>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            completed_sessions: Vec::new(),
        }
    }

    pub fn update_from_event(&mut self, event: &HookEvent) {
        let client_type = event.client_type.clone();

        let project_name = event
            .cwd
            .as_ref()
            .and_then(|cwd| cwd.rsplit('/').next().map(String::from))
            .or_else(|| match event.client_type.as_str() {
                "qoderwork" => Some("QoderWork".to_string()),
                _ => None,
            });

        let session = self
            .sessions
            .entry(event.session_id.clone())
            .or_insert_with(|| Session {
                session_id: event.session_id.clone(),
                client_type: client_type.clone(),
                cwd: event.cwd.clone(),
                project_name: project_name.clone(),
                started_at: event.timestamp.clone(),
                last_event_at: event.timestamp.clone(),
                event_count: 0,
                status: SessionStatus::Active,
                last_hook_message: None,
                last_tool_name: None,
                recent_tools: Vec::new(),
                event_names: Vec::new(),
                has_pending_permission: false,
            });

        session.last_event_at = event.timestamp.clone();
        session.event_count += 1;

        session.event_names.push(event.hook_event_name.clone());
        if session.event_names.len() > MAX_EVENT_NAMES {
            session.event_names.remove(0);
        }

        // Extract message or tool info from payload
        if let Some(msg) = event.payload.get("message").and_then(|v| v.as_str()) {
            session.last_hook_message = Some(msg.to_string());
        }
        if let Some(tool) = event.payload.get("tool_name").and_then(|v| v.as_str()) {
            let tool_str = tool.to_string();
            session.last_tool_name = Some(tool_str.clone());
            session.recent_tools.push(tool_str);
            if session.recent_tools.len() > MAX_RECENT_TOOLS {
                session.recent_tools.remove(0);
            }
        }

        session.has_pending_permission = event.hook_event_name == "PermissionRequest";

        if event.cwd.is_some() && session.cwd.is_none() {
            session.cwd = event.cwd.clone();
            session.project_name = project_name;
        }

        match event.hook_event_name.as_str() {
            "Stop" | "SessionEnd" => {
                session.status = SessionStatus::Completed;
                if let Some(completed) = self.sessions.remove(&event.session_id) {
                    self.completed_sessions.push(completed);
                    if self.completed_sessions.len() > MAX_COMPLETED_SESSIONS {
                        self.completed_sessions.remove(0);
                    }
                }
            }
            "TaskCompleted" => {
                session.status = SessionStatus::Idle;
            }
            _ => {
                session.status = SessionStatus::Active;
            }
        }
    }

    pub fn get_active_sessions(&self) -> Vec<&Session> {
        let mut sessions: Vec<&Session> = self
            .sessions
            .values()
            .filter(|s| s.status != SessionStatus::Completed)
            .collect();
        sessions.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
        sessions
    }

    pub fn get_all_sessions(&self) -> Vec<&Session> {
        let mut sessions: Vec<&Session> = self.sessions.values().collect();
        sessions.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
        sessions
    }

    pub fn get_session(&self, session_id: &str) -> Option<&Session> {
        self.sessions.get(session_id)
    }

    pub fn get_all_sessions_with_history(&self) -> Vec<&Session> {
        let mut all: Vec<&Session> = self
            .sessions
            .values()
            .chain(self.completed_sessions.iter())
            .collect();
        all.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
        all
    }

    pub fn clear_pending_permission(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.has_pending_permission = false;
        }
    }
}
