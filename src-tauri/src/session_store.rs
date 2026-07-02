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
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Active,
    Idle,
    Completed,
}

#[derive(Debug, Default)]
pub struct SessionStore {
    sessions: HashMap<String, Session>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn update_from_event(&mut self, event: &HookEvent) {
        let client_type = event.client_type.clone();

        let project_name = event.cwd.as_ref().and_then(|cwd| {
            cwd.rsplit('/').next().map(String::from)
        }).or_else(|| {
            match event.client_type.as_str() {
                "qoderwork" => Some("QoderWork".to_string()),
                _ => None,
            }
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
            });

        session.last_event_at = event.timestamp.clone();
        session.event_count += 1;

        // Extract message or tool info from payload
        if let Some(msg) = event.payload.get("message").and_then(|v| v.as_str()) {
            session.last_hook_message = Some(msg.to_string());
        }
        if let Some(tool) = event.payload.get("tool_name").and_then(|v| v.as_str()) {
            session.last_tool_name = Some(tool.to_string());
        }

        if event.cwd.is_some() && session.cwd.is_none() {
            session.cwd = event.cwd.clone();
            session.project_name = project_name;
        }

        match event.hook_event_name.as_str() {
            "Stop" | "SessionEnd" => {
                session.status = SessionStatus::Completed;
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
}
