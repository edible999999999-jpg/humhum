use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

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
pub struct HexaWatchDeleteRequest {
    pub session_id: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaWatchedAgent {
    pub key: String,
    pub provider: String,
    pub name: String,
    pub workspace: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub runs: Vec<HexaWatchedSession>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HexaWatchStoreSnapshot {
    #[serde(default)]
    agents: HashMap<String, HexaWatchedAgent>,
}

#[derive(Debug)]
pub struct HexaWatchStore {
    agents: HashMap<String, HexaWatchedAgent>,
    storage_path: Option<PathBuf>,
}

impl Default for HexaWatchStore {
    fn default() -> Self {
        Self {
            agents: HashMap::new(),
            storage_path: None,
        }
    }
}

impl HexaWatchStore {
    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        let storage_path = humhum_dir.join("hexa-watch.json");
        let agents = match fs::read_to_string(&storage_path) {
            Ok(contents) => {
                serde_json::from_str::<HexaWatchStoreSnapshot>(&contents)
                    .map_err(|error| {
                        format!(
                            "Could not parse Hexa watch store {}: {error}",
                            storage_path.display()
                        )
                    })?
                    .agents
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => {
                return Err(format!(
                    "Could not read Hexa watch store {}: {error}",
                    storage_path.display()
                ));
            }
        };

        Ok(Self {
            agents,
            storage_path: Some(storage_path),
        })
    }

    pub fn register(
        &mut self,
        request: HexaWatchRegisterRequest,
    ) -> Result<HexaWatchedSession, String> {
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

        let workspace = request.workspace.and_then(clean_text);
        let goal = request.goal.and_then(clean_text);
        let mut agents = self.agents.clone();

        let existing_run = agents.iter().find_map(|(key, watched_agent)| {
            watched_agent
                .runs
                .iter()
                .find(|session| session.session_id == session_id)
                .map(|_| key.clone())
        });

        let session = if let Some(agent_key) = existing_run {
            let watched_agent = agents
                .get_mut(&agent_key)
                .expect("agent containing a found run must exist");
            let session = watched_agent
                .runs
                .iter_mut()
                .find(|session| session.session_id == session_id)
                .expect("a found run must still exist");
            session.agent = agent;
            session.name = name;
            session.provider = provider;
            if let Some(workspace) = workspace {
                session.workspace = Some(workspace);
            }
            if let Some(goal) = goal {
                session.goal = Some(goal);
            }
            session.updated_at = now;
            watched_agent.updated_at = session.updated_at.clone();
            session.clone()
        } else {
            let key = agent_key(&provider, workspace.as_deref(), &name);
            let watched_agent = agents
                .entry(key.clone())
                .or_insert_with(|| HexaWatchedAgent {
                    key,
                    provider: provider.clone(),
                    name: name.clone(),
                    workspace: workspace.clone(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    runs: Vec::new(),
                });
            let session = HexaWatchedSession {
                session_id,
                agent,
                name,
                provider,
                workspace,
                goal,
                status: HexaWatchStatus::Starting,
                current_step: None,
                blocked_reason: None,
                need_user: false,
                confidence: None,
                started_at: now.clone(),
                updated_at: now,
            };
            watched_agent.updated_at = session.updated_at.clone();
            watched_agent.runs.push(session.clone());
            session
        };

        self.persist_agents(&agents)?;
        self.agents = agents;
        Ok(session)
    }

    pub fn update(
        &mut self,
        request: HexaWatchUpdateRequest,
    ) -> Result<Option<HexaWatchedSession>, String> {
        let mut agents = self.agents.clone();
        let now = chrono::Utc::now().to_rfc3339();
        let mut updated = None;

        for watched_agent in agents.values_mut() {
            let Some(session) = watched_agent
                .runs
                .iter_mut()
                .find(|session| session.session_id == request.session_id)
            else {
                continue;
            };

            session.status = request.status.clone();
            session.current_step = request.current_step.clone().and_then(clean_text);
            session.blocked_reason = request.blocked_reason.clone().and_then(clean_text);
            if let Some(need_user) = request.need_user {
                session.need_user = need_user;
            }
            session.confidence = request.confidence.clone().and_then(clean_text);
            if let Some(goal) = request.goal.clone().and_then(clean_text) {
                session.goal = Some(goal);
            }
            session.updated_at = now.clone();
            watched_agent.updated_at = now.clone();
            updated = Some(session.clone());
            break;
        }

        if updated.is_some() {
            self.persist_agents(&agents)?;
            self.agents = agents;
        }
        Ok(updated)
    }

    pub fn delete(&mut self, session_id: &str) -> Result<Option<HexaWatchedSession>, String> {
        let mut agents = self.agents.clone();
        let run_location = agents.iter().find_map(|(key, watched_agent)| {
            watched_agent
                .runs
                .iter()
                .position(|session| session.session_id == session_id)
                .map(|index| (key.clone(), index))
        });

        let Some((agent_key, run_index)) = run_location else {
            return Ok(None);
        };

        let deleted = {
            let watched_agent = agents
                .get_mut(&agent_key)
                .expect("agent containing a found run must exist");
            let deleted = watched_agent.runs.remove(run_index);
            watched_agent.updated_at = chrono::Utc::now().to_rfc3339();
            deleted
        };
        if agents
            .get(&agent_key)
            .is_some_and(|watched_agent| watched_agent.runs.is_empty())
        {
            agents.remove(&agent_key);
        }

        self.persist_agents(&agents)?;
        self.agents = agents;
        Ok(Some(deleted))
    }

    pub fn agents(&self) -> Vec<HexaWatchedAgent> {
        let mut agents: Vec<_> = self.agents.values().cloned().collect();
        agents.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        agents
    }

    pub fn sessions(&self) -> Vec<HexaWatchedSession> {
        let mut sessions: Vec<_> = self
            .agents()
            .into_iter()
            .flat_map(|watched_agent| watched_agent.runs.into_iter())
            .collect();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        sessions
    }

    fn persist_agents(&self, agents: &HashMap<String, HexaWatchedAgent>) -> Result<(), String> {
        let Some(storage_path) = &self.storage_path else {
            return Ok(());
        };
        let parent = storage_path.parent().ok_or_else(|| {
            format!(
                "Could not determine parent directory for Hexa watch store {}",
                storage_path.display()
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create Hexa watch store directory {}: {error}",
                parent.display()
            )
        })?;

        let snapshot = HexaWatchStoreSnapshot {
            agents: agents.clone(),
        };
        let contents = serde_json::to_vec_pretty(&snapshot)
            .map_err(|error| format!("Could not serialize Hexa watch store: {error}"))?;
        let temporary_path =
            storage_path.with_extension(format!("json.tmp-{}", uuid::Uuid::new_v4()));
        let write_result = (|| -> Result<(), String> {
            let mut temporary_file = fs::File::create(&temporary_path).map_err(|error| {
                format!(
                    "Could not create temporary Hexa watch store {}: {error}",
                    temporary_path.display()
                )
            })?;
            temporary_file.write_all(&contents).map_err(|error| {
                format!(
                    "Could not write temporary Hexa watch store {}: {error}",
                    temporary_path.display()
                )
            })?;
            temporary_file.sync_all().map_err(|error| {
                format!(
                    "Could not sync temporary Hexa watch store {}: {error}",
                    temporary_path.display()
                )
            })?;
            fs::rename(&temporary_path, storage_path).map_err(|error| {
                format!(
                    "Could not replace Hexa watch store {}: {error}",
                    storage_path.display()
                )
            })?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary_path);
        }
        write_result
    }
}

fn agent_key(provider: &str, workspace: Option<&str>, name: &str) -> String {
    serde_json::to_string(&(provider, workspace.unwrap_or_default(), name))
        .expect("agent key components are serializable")
}

fn clean_text(value: String) -> Option<String> {
    let item = value.trim().to_string();
    (!item.is_empty()).then_some(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn register_request() -> HexaWatchRegisterRequest {
        HexaWatchRegisterRequest {
            session_id: Some("run-1".to_string()),
            agent: "codex".to_string(),
            name: Some("Codex".to_string()),
            provider: Some("openai".to_string()),
            workspace: Some("/workspace/humhum".to_string()),
            goal: Some("Persist Hexa supervision".to_string()),
        }
    }

    #[test]
    fn persists_registered_agent_run_across_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaWatchStore::load_or_create(directory.path()).unwrap();
        let session = store.register(register_request()).unwrap();
        drop(store);

        let restored = HexaWatchStore::load_or_create(directory.path()).unwrap();
        let agents = restored.agents();

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].runs.len(), 1);
        assert_eq!(agents[0].runs[0].session_id, session.session_id);
        assert_eq!(agents[0].provider, "openai");
        assert_eq!(agents[0].workspace.as_deref(), Some("/workspace/humhum"));
        assert_eq!(agents[0].name, "Codex");
    }

    #[test]
    fn persists_run_updates_across_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaWatchStore::load_or_create(directory.path()).unwrap();
        store.register(register_request()).unwrap();
        store
            .update(HexaWatchUpdateRequest {
                session_id: "run-1".to_string(),
                status: HexaWatchStatus::Blocked,
                current_step: Some("Waiting for credentials".to_string()),
                blocked_reason: Some("Missing API key".to_string()),
                need_user: Some(true),
                confidence: Some("agent-bound".to_string()),
                goal: None,
            })
            .unwrap();
        drop(store);

        let restored = HexaWatchStore::load_or_create(directory.path()).unwrap();
        let session = restored.sessions().pop().unwrap();

        assert_eq!(session.status, HexaWatchStatus::Blocked);
        assert_eq!(
            session.current_step.as_deref(),
            Some("Waiting for credentials")
        );
        assert_eq!(session.blocked_reason.as_deref(), Some("Missing API key"));
        assert!(session.need_user);
    }

    #[test]
    fn persists_run_deletion_across_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaWatchStore::load_or_create(directory.path()).unwrap();
        store.register(register_request()).unwrap();
        assert!(store.delete("run-1").unwrap().is_some());
        drop(store);

        let restored = HexaWatchStore::load_or_create(directory.path()).unwrap();

        assert!(restored.sessions().is_empty());
        assert!(restored.agents().is_empty());
    }
}
