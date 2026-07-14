use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaWatchStatus {
    Starting,
    Working,
    Waiting,
    Idle,
    Completed,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaWatchRegisterRequest {
    pub session_id: Option<String>,
    pub agent: String,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub workspace: Option<String>,
    pub goal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaWatchUpdateRequest {
    pub session_id: String,
    pub status: HexaWatchStatus,
    pub current_step: Option<String>,
    pub blocked_reason: Option<String>,
    pub need_user: Option<bool>,
    pub confidence: Option<String>,
    pub goal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaWatchedSession {
    pub session_id: String,
    pub agent: String,
    pub name: String,
    pub provider: String,
    pub workspace: Option<String>,
    pub goal: Option<String>,
    pub status: HexaWatchStatus,
    pub current_step: Option<String>,
    pub blocked_reason: Option<String>,
    pub need_user: bool,
    pub confidence: Option<String>,
    pub started_at: String,
    pub updated_at: String,
}

#[derive(Debug, Default)]
pub struct HexaWatchStore {
    sessions: HashMap<String, HexaWatchedSession>,
}

impl HexaWatchStore {
    pub fn register(&mut self, request: HexaWatchRegisterRequest) -> HexaWatchedSession {
        let now = chrono::Utc::now().to_rfc3339();
        let session_id = request
            .session_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let agent = clean_text(request.agent).unwrap_or_else(|| "agent".to_string());
        let provider = request
            .provider
            .and_then(clean_text)
            .unwrap_or_else(|| agent.clone());
        let name = request
            .name
            .and_then(clean_text)
            .or_else(|| {
                request
                    .goal
                    .as_ref()
                    .and_then(|goal| clean_text(goal.clone()))
            })
            .unwrap_or_else(|| format!("{} watched session", agent));

        let session =
            self.sessions
                .entry(session_id.clone())
                .or_insert_with(|| HexaWatchedSession {
                    session_id: session_id.clone(),
                    agent: agent.clone(),
                    name: name.clone(),
                    provider: provider.clone(),
                    workspace: request.workspace.clone().and_then(clean_text),
                    goal: request.goal.clone().and_then(clean_text),
                    status: HexaWatchStatus::Starting,
                    current_step: None,
                    blocked_reason: None,
                    need_user: false,
                    confidence: None,
                    started_at: now.clone(),
                    updated_at: now.clone(),
                });

        session.agent = agent;
        session.name = name;
        session.provider = provider;
        if let Some(workspace) = request.workspace.and_then(clean_text) {
            session.workspace = Some(workspace);
        }
        if let Some(goal) = request.goal.and_then(clean_text) {
            session.goal = Some(goal);
        }
        session.updated_at = now;
        session.clone()
    }

    pub fn update(&mut self, request: HexaWatchUpdateRequest) -> Option<HexaWatchedSession> {
        let session = self.sessions.get_mut(&request.session_id)?;
        session.status = request.status;
        session.current_step = request.current_step.and_then(clean_text);
        session.blocked_reason = request.blocked_reason.and_then(clean_text);
        if let Some(need_user) = request.need_user {
            session.need_user = need_user;
        }
        session.confidence = request.confidence.and_then(clean_text);
        if let Some(goal) = request.goal.and_then(clean_text) {
            session.goal = Some(goal);
        }
        session.updated_at = chrono::Utc::now().to_rfc3339();
        Some(session.clone())
    }

    pub fn sessions(&self) -> Vec<HexaWatchedSession> {
        let mut sessions: Vec<_> = self.sessions.values().cloned().collect();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        sessions
    }
}

fn clean_text(value: String) -> Option<String> {
    let item = value.trim().to_string();
    (!item.is_empty()).then_some(item)
}
