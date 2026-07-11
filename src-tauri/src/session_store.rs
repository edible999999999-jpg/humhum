use crate::event_bus::HookEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionRoute {
    pub term_program: Option<String>,
    pub term_program_version: Option<String>,
    pub tty: Option<String>,
    pub tmux: Option<String>,
    pub tmux_pane: Option<String>,
    pub iterm_session_id: Option<String>,
    pub ghostty_terminal_id: Option<String>,
    pub parent_pid: Option<u32>,
    pub transport: Option<String>,
    pub remote_host: Option<String>,
}

impl SessionRoute {
    fn from_payload(payload: &serde_json::Value) -> Option<Self> {
        let mut route: Self = serde_json::from_value(payload.get("route")?.clone()).ok()?;
        route.normalize();
        route.has_values().then_some(route)
    }

    fn merge(&mut self, newer: Self) {
        merge_text(&mut self.term_program, newer.term_program);
        merge_text(&mut self.term_program_version, newer.term_program_version);
        merge_text(&mut self.tty, newer.tty);
        merge_text(&mut self.tmux, newer.tmux);
        merge_text(&mut self.tmux_pane, newer.tmux_pane);
        merge_text(&mut self.iterm_session_id, newer.iterm_session_id);
        merge_text(&mut self.ghostty_terminal_id, newer.ghostty_terminal_id);
        if newer.parent_pid.is_some() {
            self.parent_pid = newer.parent_pid;
        }
        merge_text(&mut self.transport, newer.transport);
        merge_text(&mut self.remote_host, newer.remote_host);
    }

    fn normalize(&mut self) {
        for value in [
            &mut self.term_program,
            &mut self.term_program_version,
            &mut self.tty,
            &mut self.tmux,
            &mut self.tmux_pane,
            &mut self.iterm_session_id,
            &mut self.ghostty_terminal_id,
            &mut self.transport,
            &mut self.remote_host,
        ] {
            *value = value
                .take()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty());
        }
        self.tty = self
            .tty
            .take()
            .map(|item| item.strip_prefix("/dev/").unwrap_or(&item).to_string());
    }

    fn has_values(&self) -> bool {
        self.term_program.is_some()
            || self.term_program_version.is_some()
            || self.tty.is_some()
            || self.tmux.is_some()
            || self.tmux_pane.is_some()
            || self.iterm_session_id.is_some()
            || self.ghostty_terminal_id.is_some()
            || self.parent_pid.is_some()
            || self.transport.is_some()
            || self.remote_host.is_some()
    }
}

fn merge_text(current: &mut Option<String>, newer: Option<String>) {
    if newer.as_deref().is_some_and(|value| !value.is_empty()) {
        *current = newer;
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub session_id: String,
    pub client_type: String,
    pub transcript_path: Option<String>,
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
    pub route: Option<SessionRoute>,
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
                transcript_path: event.transcript_path.clone(),
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
                route: SessionRoute::from_payload(&event.payload),
            });

        session.last_event_at = event.timestamp.clone();
        session.event_count += 1;

        if event.transcript_path.is_some() {
            session.transcript_path = event.transcript_path.clone();
        }

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

        if let Some(route) = SessionRoute::from_payload(&event.payload) {
            if let Some(existing) = session.route.as_mut() {
                existing.merge(route);
            } else {
                session.route = Some(route);
            }
        }

        if event.cwd.is_some() && session.cwd.is_none() {
            session.cwd = event.cwd.clone();
            session.project_name = project_name;
        }

        match event.hook_event_name.as_str() {
            "SessionEnd" => {
                session.status = SessionStatus::Completed;
                if let Some(completed) = self.sessions.remove(&event.session_id) {
                    self.completed_sessions.push(completed);
                    if self.completed_sessions.len() > MAX_COMPLETED_SESSIONS {
                        self.completed_sessions.remove(0);
                    }
                }
            }
            "Stop" | "TaskCompleted" => {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::HookEvent;
    use serde_json::json;

    fn event(payload: serde_json::Value) -> HookEvent {
        HookEvent {
            id: "event-1".into(),
            hook_event_name: "Notification".into(),
            session_id: "session-1".into(),
            transcript_path: None,
            cwd: Some("/tmp/humhum".into()),
            client_type: "claude-code".into(),
            payload,
            timestamp: "2026-07-12T00:00:00Z".into(),
        }
    }

    #[test]
    fn captures_route_metadata_from_hook_payload() {
        let mut store = SessionStore::new();
        store.update_from_event(&event(json!({
            "route": {
                "term_program": "iTerm.app",
                "tty": "/dev/ttys007",
                "tmux_pane": "%12",
                "iterm_session_id": "w0t1p0:ABC",
                "ghostty_terminal_id": "terminal-ABC",
                "transport": "ssh",
                "remote_host": "dev@example.com"
            }
        })));

        let route = store
            .get_session("session-1")
            .unwrap()
            .route
            .as_ref()
            .unwrap();
        assert_eq!(route.term_program.as_deref(), Some("iTerm.app"));
        assert_eq!(route.tty.as_deref(), Some("ttys007"));
        assert_eq!(route.tmux_pane.as_deref(), Some("%12"));
        assert_eq!(route.iterm_session_id.as_deref(), Some("w0t1p0:ABC"));
        assert_eq!(route.ghostty_terminal_id.as_deref(), Some("terminal-ABC"));
        assert_eq!(route.transport.as_deref(), Some("ssh"));
        assert_eq!(route.remote_host.as_deref(), Some("dev@example.com"));
    }

    #[test]
    fn stop_is_idle_and_only_session_end_moves_history() {
        let mut store = SessionStore::new();
        let mut stop = event(json!({}));
        stop.hook_event_name = "Stop".into();

        store.update_from_event(&stop);

        assert_eq!(
            store.get_session("session-1").unwrap().status,
            SessionStatus::Idle
        );
        assert!(store.completed_sessions.is_empty());

        let mut end = stop;
        end.hook_event_name = "SessionEnd".into();
        store.update_from_event(&end);

        assert!(store.get_session("session-1").is_none());
        assert_eq!(store.completed_sessions.len(), 1);
    }

    #[test]
    fn later_empty_route_fields_do_not_erase_exact_identifiers() {
        let mut store = SessionStore::new();
        store.update_from_event(&event(json!({
            "route": { "term_program": "Ghostty", "tty": "ttys004", "tmux_pane": "%3" }
        })));
        store.update_from_event(&event(json!({
            "route": { "term_program": "", "tty": null, "tmux_pane": "" }
        })));

        let route = store
            .get_session("session-1")
            .unwrap()
            .route
            .as_ref()
            .unwrap();
        assert_eq!(route.term_program.as_deref(), Some("Ghostty"));
        assert_eq!(route.tty.as_deref(), Some("ttys004"));
        assert_eq!(route.tmux_pane.as_deref(), Some("%3"));
    }
}
