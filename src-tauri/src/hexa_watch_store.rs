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
    pub(crate) fn unavailable_at(humhum_dir: &Path) -> Self {
        Self {
            agents: HashMap::new(),
            storage_path: Some(humhum_dir.join("hexa-watch.json")),
        }
    }

    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        let storage_path = humhum_dir.join("hexa-watch.json");
        let agents = read_agents(&storage_path)?;

        Ok(Self {
            agents,
            storage_path: Some(storage_path),
        })
    }

    pub(crate) fn reload_from_disk(&mut self) -> Result<(), String> {
        let Some(storage_path) = &self.storage_path else {
            return Ok(());
        };
        self.agents = read_agents(storage_path)?;
        Ok(())
    }

    pub fn register(
        &mut self,
        request: HexaWatchRegisterRequest,
    ) -> Result<HexaWatchedSession, String> {
        self.reload_from_disk()?;
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

        let requested_workspace = request.workspace.and_then(clean_text);
        let goal = request.goal.and_then(clean_text);
        let mut agents = self.agents.clone();

        let existing_run = agents.iter().find_map(|(key, watched_agent)| {
            watched_agent
                .runs
                .iter()
                .position(|session| session.session_id == session_id)
                .map(|index| (key.clone(), index))
        });

        let (session, target_agent_key) =
            if let Some((previous_agent_key, run_index)) = existing_run {
                let mut session = agents
                    .get_mut(&previous_agent_key)
                    .expect("agent containing a found run must exist")
                    .runs
                    .remove(run_index);
                let workspace = requested_workspace
                    .clone()
                    .or_else(|| session.workspace.clone());
                session.agent = agent.clone();
                session.name = name.clone();
                session.provider = provider.clone();
                session.workspace = workspace.clone();
                if let Some(goal) = goal {
                    session.goal = Some(goal);
                }
                session.updated_at = now.clone();

                let target_agent_key = agent_key(&provider, workspace.as_deref());
                if previous_agent_key != target_agent_key
                    && agents
                        .get(&previous_agent_key)
                        .is_some_and(|watched_agent| watched_agent.runs.is_empty())
                {
                    agents.remove(&previous_agent_key);
                }
                (session, target_agent_key)
            } else {
                let session = HexaWatchedSession {
                    session_id,
                    agent,
                    name: name.clone(),
                    provider: provider.clone(),
                    workspace: requested_workspace.clone(),
                    goal,
                    status: HexaWatchStatus::Starting,
                    current_step: None,
                    blocked_reason: None,
                    need_user: false,
                    confidence: None,
                    started_at: now.clone(),
                    updated_at: now.clone(),
                };
                let target_agent_key = agent_key(&provider, requested_workspace.as_deref());
                (session, target_agent_key)
            };

        let watched_agent =
            agents
                .entry(target_agent_key.clone())
                .or_insert_with(|| HexaWatchedAgent {
                    key: target_agent_key,
                    provider: provider.clone(),
                    name: name.clone(),
                    workspace: session.workspace.clone(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    runs: Vec::new(),
                });
        watched_agent.provider = provider;
        watched_agent.name = name;
        watched_agent.workspace = session.workspace.clone();
        watched_agent.updated_at = session.updated_at.clone();
        watched_agent.runs.push(session.clone());

        self.persist_agents(&agents)?;
        self.agents = agents;
        Ok(session)
    }

    pub fn update(
        &mut self,
        request: HexaWatchUpdateRequest,
    ) -> Result<Option<HexaWatchedSession>, String> {
        self.reload_from_disk()?;
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
        self.reload_from_disk()?;
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
            sync_parent_directory(parent)?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary_path);
        }
        write_result
    }
}

fn read_agents(storage_path: &Path) -> Result<HashMap<String, HexaWatchedAgent>, String> {
    match fs::read_to_string(storage_path) {
        Ok(contents) => match serde_json::from_str::<HexaWatchStoreSnapshot>(&contents) {
            Ok(snapshot) => Ok(snapshot.agents),
            Err(error) => {
                log::warn!(
                    "Could not parse Hexa watch store {}; starting with an empty durable store: {error}",
                    storage_path.display()
                );
                Ok(HashMap::new())
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(format!(
            "Could not read Hexa watch store {}: {error}",
            storage_path.display()
        )),
    }
}

fn agent_key(provider: &str, workspace: Option<&str>) -> String {
    serde_json::to_string(&(provider, workspace.unwrap_or_default()))
        .expect("agent key components are serializable")
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> Result<(), String> {
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            format!(
                "Could not sync Hexa watch store directory {}: {error}",
                parent.display()
            )
        })
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> Result<(), String> {
    // std::fs cannot portably sync directory handles on non-Unix platforms.
    Ok(())
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

    #[test]
    fn reuses_agent_when_display_name_changes() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaWatchStore::load_or_create(directory.path()).unwrap();
        store.register(register_request()).unwrap();
        store
            .register(HexaWatchRegisterRequest {
                session_id: Some("run-2".to_string()),
                name: Some("Codex nightly".to_string()),
                ..register_request()
            })
            .unwrap();

        let agents = store.agents();

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "Codex nightly");
        assert_eq!(agents[0].runs.len(), 2);
    }

    #[test]
    fn moves_reregistered_run_to_new_provider_workspace_agent() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaWatchStore::load_or_create(directory.path()).unwrap();
        store.register(register_request()).unwrap();
        store
            .register(HexaWatchRegisterRequest {
                session_id: Some("run-1".to_string()),
                agent: "claude".to_string(),
                name: Some("Claude review".to_string()),
                provider: Some("anthropic".to_string()),
                workspace: Some("/workspace/review".to_string()),
                goal: Some("Review persistence".to_string()),
            })
            .unwrap();
        drop(store);

        let restored = HexaWatchStore::load_or_create(directory.path()).unwrap();
        let agents = restored.agents();

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].provider, "anthropic");
        assert_eq!(agents[0].workspace.as_deref(), Some("/workspace/review"));
        assert_eq!(agents[0].name, "Claude review");
        assert_eq!(agents[0].runs[0].session_id, "run-1");
    }

    #[test]
    fn recovers_invalid_snapshot_with_a_durable_store() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("hexa-watch.json"), "not JSON").unwrap();

        let mut store = HexaWatchStore::load_or_create(directory.path()).unwrap();
        store.register(register_request()).unwrap();
        drop(store);

        let restored = HexaWatchStore::load_or_create(directory.path()).unwrap();

        assert_eq!(restored.sessions().len(), 1);
    }

    #[test]
    fn rejects_non_not_found_read_failures() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("hexa-watch.json")).unwrap();

        let result = HexaWatchStore::load_or_create(directory.path());

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Could not read Hexa watch store"));
    }

    #[test]
    fn unhealthy_store_blocks_mutation_and_recovers_on_retry() {
        let directory = tempfile::tempdir().unwrap();
        let storage_path = directory.path().join("hexa-watch.json");
        fs::create_dir(&storage_path).unwrap();
        fs::write(storage_path.join("sentinel"), "keep me").unwrap();
        let mut store = HexaWatchStore::unavailable_at(directory.path());

        assert!(store.reload_from_disk().is_err());
        assert!(store.register(register_request()).is_err());
        assert_eq!(
            fs::read_to_string(storage_path.join("sentinel")).unwrap(),
            "keep me"
        );

        fs::remove_dir_all(&storage_path).unwrap();
        store.reload_from_disk().unwrap();
        store.register(register_request()).unwrap();

        let restored = HexaWatchStore::load_or_create(directory.path()).unwrap();
        assert_eq!(restored.sessions().len(), 1);
    }
}
