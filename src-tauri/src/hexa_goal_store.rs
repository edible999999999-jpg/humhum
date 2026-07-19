use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaAgentSurface {
    CodexDesktop,
    CodexCli,
    QoderIde,
    QoderCli,
    QoderWorker,
    Terminal,
    RemoteWorker,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaAttemptResultStatus {
    #[default]
    Unverified,
    Verified,
    Failed,
    Superseded,
    Accepted,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HexaGoalStatus {
    #[default]
    Active,
    Waiting,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaGoalAttempt {
    pub session_id: String,
    pub agent_family: String,
    #[serde(default)]
    pub surface: HexaAgentSurface,
    pub workspace: Option<String>,
    pub branch: Option<String>,
    pub worktree: Option<String>,
    #[serde(default)]
    pub result_status: HexaAttemptResultStatus,
    #[serde(default)]
    pub evidence: Vec<crate::hexa_watch_store::HexaEvidenceRef>,
    pub linked_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaDevelopmentGoal {
    pub id: String,
    pub project_key: String,
    pub title: String,
    #[serde(default)]
    pub success_criteria: Vec<String>,
    #[serde(default)]
    pub status: HexaGoalStatus,
    #[serde(default)]
    pub attempts: Vec<HexaGoalAttempt>,
    pub accepted_attempt_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaGoalLinkRequest {
    pub goal_id: Option<String>,
    pub project_key: String,
    pub title: String,
    #[serde(default)]
    pub success_criteria: Vec<String>,
    pub session_id: String,
    #[serde(default)]
    pub surface: HexaAgentSurface,
    pub branch: Option<String>,
    pub worktree: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HexaGoalAttemptContext {
    pub agent_family: String,
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaAttemptResultRequest {
    pub goal_id: String,
    pub session_id: String,
    pub result_status: HexaAttemptResultStatus,
    #[serde(default)]
    pub evidence: Vec<crate::hexa_watch_store::HexaEvidenceInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexaGoalAcceptRequest {
    pub goal_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct HexaGoalStoreSnapshot {
    #[serde(default)]
    goals: HashMap<String, HexaDevelopmentGoal>,
}

#[derive(Debug)]
pub struct HexaGoalStore {
    goals: HashMap<String, HexaDevelopmentGoal>,
    storage_path: Option<PathBuf>,
}

impl Default for HexaGoalStore {
    fn default() -> Self {
        Self {
            goals: HashMap::new(),
            storage_path: None,
        }
    }
}

impl HexaGoalStore {
    pub(crate) fn unavailable_at(humhum_dir: &Path) -> Self {
        Self {
            goals: HashMap::new(),
            storage_path: Some(humhum_dir.join("hexa-goals.json")),
        }
    }

    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        let storage_path = humhum_dir.join("hexa-goals.json");
        let goals = read_goals(&storage_path)?;
        Ok(Self {
            goals,
            storage_path: Some(storage_path),
        })
    }

    pub fn reload_from_disk(&mut self) -> Result<(), String> {
        let Some(storage_path) = &self.storage_path else {
            return Ok(());
        };
        self.goals = read_goals(storage_path)?;
        Ok(())
    }

    pub fn goals(&self) -> Vec<HexaDevelopmentGoal> {
        let mut goals: Vec<_> = self.goals.values().cloned().collect();
        goals.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        goals
    }

    pub fn link_attempt(
        &mut self,
        request: HexaGoalLinkRequest,
        context: HexaGoalAttemptContext,
    ) -> Result<HexaDevelopmentGoal, String> {
        self.reload_from_disk()?;
        let now = chrono::Utc::now().to_rfc3339();
        let session_id = required_text(request.session_id, "goal session_id")?;
        let goal_id = request
            .goal_id
            .and_then(clean_text)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut goals = self.goals.clone();
        if !goals.contains_key(&goal_id) {
            let project_key = required_text(request.project_key, "goal project_key")?;
            let title = required_text(request.title, "goal title")?;
            goals.insert(
                goal_id.clone(),
                HexaDevelopmentGoal {
                    id: goal_id.clone(),
                    project_key,
                    title,
                    success_criteria: request.success_criteria.clone(),
                    status: HexaGoalStatus::Active,
                    attempts: Vec::new(),
                    accepted_attempt_id: None,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                },
            );
        }
        let goal = goals
            .get_mut(&goal_id)
            .ok_or_else(|| format!("Hexa goal not found: {goal_id}"))?;
        if goal
            .attempts
            .iter()
            .all(|attempt| attempt.session_id != session_id)
        {
            goal.attempts.push(HexaGoalAttempt {
                session_id,
                agent_family: required_text(context.agent_family, "agent family")?,
                surface: request.surface,
                workspace: clean_optional(context.workspace),
                branch: clean_optional(request.branch),
                worktree: clean_optional(request.worktree),
                result_status: HexaAttemptResultStatus::Unverified,
                evidence: Vec::new(),
                linked_at: now.clone(),
                completed_at: None,
            });
        }
        goal.updated_at = now;
        recompute_goal_status(goal);
        let result = goal.clone();
        self.persist_goals(&goals)?;
        self.goals = goals;
        Ok(result)
    }

    pub fn update_attempt_result(
        &mut self,
        request: HexaAttemptResultRequest,
    ) -> Result<HexaDevelopmentGoal, String> {
        if request.result_status == HexaAttemptResultStatus::Accepted {
            return Err("Hexa attempt acceptance requires explicit user acceptance".into());
        }
        self.reload_from_disk()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut goals = self.goals.clone();
        let goal = goals
            .get_mut(&request.goal_id)
            .ok_or_else(|| format!("Hexa goal not found: {}", request.goal_id))?;
        if goal.accepted_attempt_id.as_deref() == Some(request.session_id.as_str()) {
            return Err(format!(
                "Hexa accepted attempt cannot be overwritten: {}",
                request.session_id
            ));
        }
        let attempt = goal
            .attempts
            .iter_mut()
            .find(|attempt| attempt.session_id == request.session_id)
            .ok_or_else(|| format!("Hexa goal attempt not found: {}", request.session_id))?;
        let evidence = request
            .evidence
            .into_iter()
            .map(|input| evidence_ref(input, &now))
            .collect::<Result<Vec<_>, _>>()?;
        attempt.result_status = request.result_status;
        attempt.evidence = evidence;
        attempt.completed_at = Some(now.clone());
        goal.updated_at = now;
        recompute_goal_status(goal);
        let result = goal.clone();
        self.persist_goals(&goals)?;
        self.goals = goals;
        Ok(result)
    }

    pub fn accept_attempt(
        &mut self,
        request: HexaGoalAcceptRequest,
    ) -> Result<HexaDevelopmentGoal, String> {
        self.reload_from_disk()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut goals = self.goals.clone();
        let goal = goals
            .get_mut(&request.goal_id)
            .ok_or_else(|| format!("Hexa goal not found: {}", request.goal_id))?;
        if goal
            .attempts
            .iter()
            .all(|attempt| attempt.session_id != request.session_id)
        {
            return Err(format!(
                "Hexa goal attempt not found: {}",
                request.session_id
            ));
        }
        for attempt in &mut goal.attempts {
            if attempt.session_id == request.session_id {
                attempt.result_status = HexaAttemptResultStatus::Accepted;
                if attempt.completed_at.is_none() {
                    attempt.completed_at = Some(now.clone());
                }
            } else if attempt.result_status == HexaAttemptResultStatus::Accepted {
                attempt.result_status = HexaAttemptResultStatus::Superseded;
            }
        }
        goal.accepted_attempt_id = Some(request.session_id);
        goal.updated_at = now;
        recompute_goal_status(goal);
        let result = goal.clone();
        self.persist_goals(&goals)?;
        self.goals = goals;
        Ok(result)
    }

    pub fn delete_goal(&mut self, goal_id: &str) -> Result<(), String> {
        self.reload_from_disk()?;
        let mut goals = self.goals.clone();
        goals.remove(goal_id);
        self.persist_goals(&goals)?;
        self.goals = goals;
        Ok(())
    }

    fn persist_goals(&self, goals: &HashMap<String, HexaDevelopmentGoal>) -> Result<(), String> {
        let Some(storage_path) = &self.storage_path else {
            return Ok(());
        };
        let parent = storage_path.parent().ok_or_else(|| {
            format!(
                "Could not determine parent directory for Hexa goal store {}",
                storage_path.display()
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create Hexa goal store directory {}: {error}",
                parent.display()
            )
        })?;
        let snapshot = HexaGoalStoreSnapshot {
            goals: goals.clone(),
        };
        let contents = serde_json::to_vec_pretty(&snapshot)
            .map_err(|error| format!("Could not serialize Hexa goal store: {error}"))?;
        crate::local_api_auth::write_private_file_atomically(storage_path, &contents).map_err(
            |error| {
                format!(
                    "Could not write Hexa goal store {}: {error}",
                    storage_path.display()
                )
            },
        )?;
        sync_parent_directory(parent)
    }
}

fn read_goals(storage_path: &Path) -> Result<HashMap<String, HexaDevelopmentGoal>, String> {
    match fs::symlink_metadata(storage_path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!(
                "Hexa goal store cannot be a symbolic link: {}",
                storage_path.display()
            ));
        }
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err(format!(
                "Could not read Hexa goal store {}: path is not a regular file",
                storage_path.display()
            ));
        }
        Ok(_) => crate::local_api_auth::protect_owner_only(storage_path).map_err(|error| {
            format!(
                "Could not protect Hexa goal store {}: {error}",
                storage_path.display()
            )
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HashMap::new());
        }
        Err(error) => {
            return Err(format!(
                "Could not inspect Hexa goal store {}: {error}",
                storage_path.display()
            ));
        }
    }
    let contents = fs::read_to_string(storage_path).map_err(|error| {
        format!(
            "Could not read Hexa goal store {}: {error}",
            storage_path.display()
        )
    })?;
    let snapshot: HexaGoalStoreSnapshot = serde_json::from_str(&contents).map_err(|error| {
        format!(
            "Could not parse Hexa goal store {}: {error}",
            storage_path.display()
        )
    })?;
    Ok(snapshot.goals)
}

fn recompute_goal_status(goal: &mut HexaDevelopmentGoal) {
    if goal.accepted_attempt_id.is_some() {
        goal.status = HexaGoalStatus::Completed;
        return;
    }
    let has_attempts = !goal.attempts.is_empty();
    let all_terminal = goal
        .attempts
        .iter()
        .all(|attempt| attempt.completed_at.is_some());
    goal.status = if has_attempts && all_terminal {
        HexaGoalStatus::Waiting
    } else {
        HexaGoalStatus::Active
    };
}

fn evidence_ref(
    input: crate::hexa_watch_store::HexaEvidenceInput,
    now: &str,
) -> Result<crate::hexa_watch_store::HexaEvidenceRef, String> {
    let label = required_text(input.label, "goal evidence label")?;
    Ok(crate::hexa_watch_store::HexaEvidenceRef {
        id: uuid::Uuid::new_v4().to_string(),
        kind: required_text(input.kind, "goal evidence kind")?,
        label,
        location: clean_optional(input.location),
        observed_at: now.to_string(),
    })
}

fn required_text(value: String, field: &str) -> Result<String, String> {
    clean_text(value).ok_or_else(|| format!("Hexa {field} cannot be empty"))
}

fn clean_text(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(clean_text)
}

fn sync_parent_directory(parent: &Path) -> Result<(), String> {
    let directory = fs::File::open(parent)
        .map_err(|error| format!("Could not open Hexa goal store directory: {error}"))?;
    directory
        .sync_all()
        .map_err(|error| format!("Could not sync Hexa goal store directory: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link_request(
        goal_id: Option<&str>,
        session_id: &str,
        surface: HexaAgentSurface,
    ) -> HexaGoalLinkRequest {
        HexaGoalLinkRequest {
            goal_id: goal_id.map(str::to_string),
            project_key: "repo:/work/humhum".into(),
            title: "修复 Hush 消息分类".into(),
            success_criteria: vec![],
            session_id: session_id.into(),
            surface,
            branch: None,
            worktree: None,
        }
    }

    fn attempt_context(family: &str) -> HexaGoalAttemptContext {
        HexaGoalAttemptContext {
            agent_family: family.into(),
            workspace: Some("/work/humhum".into()),
        }
    }

    #[test]
    fn links_multiple_agent_surfaces_to_one_goal_and_restores_them() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();

        let first = store
            .link_attempt(
                link_request(
                    Some("goal-hush"),
                    "session-codex",
                    HexaAgentSurface::CodexDesktop,
                ),
                attempt_context("codex"),
            )
            .unwrap();
        store
            .link_attempt(
                link_request(
                    Some(&first.id),
                    "session-worker",
                    HexaAgentSurface::QoderWorker,
                ),
                attempt_context("qoder"),
            )
            .unwrap();

        let restored = HexaGoalStore::load_or_create(directory.path()).unwrap();
        assert_eq!(restored.goals().len(), 1);
        assert_eq!(restored.goals()[0].attempts.len(), 2);
    }

    #[test]
    fn joining_an_existing_goal_preserves_identity_and_criteria_across_worktrees() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
        let mut first_request = link_request(
            Some("goal-hush"),
            "session-codex",
            HexaAgentSurface::CodexDesktop,
        );
        first_request.success_criteria = vec!["npm test 通过".into()];
        let first = store
            .link_attempt(first_request, attempt_context("codex"))
            .unwrap();

        let mut joining_request = link_request(
            Some(&first.id),
            "session-worker",
            HexaAgentSurface::QoderWorker,
        );
        joining_request.project_key = "repo:/work/humhum-worker".into();
        joining_request.title = "来自另一个 worktree 的显示标题".into();
        joining_request.success_criteria = vec![];
        joining_request.worktree = Some("/work/humhum-worker".into());
        let joined = store
            .link_attempt(
                joining_request,
                HexaGoalAttemptContext {
                    agent_family: "qoder".into(),
                    workspace: Some("/work/humhum-worker".into()),
                },
            )
            .unwrap();

        assert_eq!(joined.project_key, "repo:/work/humhum");
        assert_eq!(joined.title, "修复 Hush 消息分类");
        assert_eq!(joined.success_criteria, vec!["npm test 通过"]);
        assert_eq!(joined.attempts.len(), 2);
        assert_eq!(
            joined.attempts[1].workspace.as_deref(),
            Some("/work/humhum-worker")
        );
    }

    #[test]
    fn old_or_missing_goal_files_do_not_change_hexa_watch_storage() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("hexa-watch.json"),
            r#"{"agents":{"legacy":{"provider":"qoder","runs":[]}}}"#,
        )
        .unwrap();

        let store = HexaGoalStore::load_or_create(directory.path()).unwrap();
        assert!(store.goals().is_empty());
        assert!(directory.path().join("hexa-watch.json").exists());
    }

    #[test]
    fn corrupt_goal_storage_returns_an_error_without_touching_watch_storage() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("hexa-goals.json"), "{broken").unwrap();
        std::fs::write(directory.path().join("hexa-watch.json"), "{}").unwrap();

        assert!(HexaGoalStore::load_or_create(directory.path()).is_err());
        assert_eq!(
            std::fs::read_to_string(directory.path().join("hexa-watch.json")).unwrap(),
            "{}",
        );
    }

    #[test]
    fn agent_completion_remains_unverified_until_user_acceptance() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
        let goal = store
            .link_attempt(
                link_request(
                    Some("goal-hush"),
                    "session-codex",
                    HexaAgentSurface::CodexDesktop,
                ),
                attempt_context("codex"),
            )
            .unwrap();

        let completed = store
            .update_attempt_result(HexaAttemptResultRequest {
                goal_id: goal.id.clone(),
                session_id: "session-codex".into(),
                result_status: HexaAttemptResultStatus::Unverified,
                evidence: vec![],
            })
            .unwrap();
        assert_eq!(
            completed.attempts[0].result_status,
            HexaAttemptResultStatus::Unverified
        );
        assert!(completed.attempts[0].completed_at.is_some());
        assert_eq!(completed.status, HexaGoalStatus::Waiting);

        let accepted = store
            .accept_attempt(HexaGoalAcceptRequest {
                goal_id: goal.id,
                session_id: "session-codex".into(),
            })
            .unwrap();
        assert_eq!(
            accepted.accepted_attempt_id.as_deref(),
            Some("session-codex")
        );
        assert_eq!(
            accepted.attempts[0].result_status,
            HexaAttemptResultStatus::Accepted
        );
    }

    #[test]
    fn update_result_cannot_accept_or_overwrite_the_accepted_attempt() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
        let goal = store
            .link_attempt(
                link_request(
                    Some("goal-hush"),
                    "session-codex",
                    HexaAgentSurface::CodexDesktop,
                ),
                attempt_context("codex"),
            )
            .unwrap();

        let bypass = store.update_attempt_result(HexaAttemptResultRequest {
            goal_id: goal.id.clone(),
            session_id: "session-codex".into(),
            result_status: HexaAttemptResultStatus::Accepted,
            evidence: vec![],
        });
        assert!(bypass.is_err());
        let unchanged = store.goals()[0].clone();
        assert_eq!(unchanged.accepted_attempt_id, None);
        assert_eq!(unchanged.attempts[0].completed_at, None);

        store
            .accept_attempt(HexaGoalAcceptRequest {
                goal_id: goal.id.clone(),
                session_id: "session-codex".into(),
            })
            .unwrap();
        let overwrite = store.update_attempt_result(HexaAttemptResultRequest {
            goal_id: goal.id,
            session_id: "session-codex".into(),
            result_status: HexaAttemptResultStatus::Verified,
            evidence: vec![],
        });
        assert!(overwrite.is_err());
        let accepted = store.goals()[0].clone();
        assert_eq!(
            accepted.accepted_attempt_id.as_deref(),
            Some("session-codex")
        );
        assert_eq!(
            accepted.attempts[0].result_status,
            HexaAttemptResultStatus::Accepted
        );
    }

    #[cfg(unix)]
    #[test]
    fn goal_storage_rejects_symlinks_and_non_regular_files() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("goal-target.json");
        std::fs::write(&target, "{}").unwrap();
        symlink(&target, directory.path().join("hexa-goals.json")).unwrap();

        let symlink_error = HexaGoalStore::load_or_create(directory.path()).unwrap_err();
        assert!(symlink_error.contains("symbolic link"));

        std::fs::remove_file(directory.path().join("hexa-goals.json")).unwrap();
        std::fs::create_dir(directory.path().join("hexa-goals.json")).unwrap();
        let directory_error = HexaGoalStore::load_or_create(directory.path()).unwrap_err();
        assert!(directory_error.contains("regular file"));
    }

    #[cfg(unix)]
    #[test]
    fn goal_storage_is_owner_only_on_unix() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
        store
            .link_attempt(
                link_request(None, "session-codex", HexaAgentSurface::CodexDesktop),
                attempt_context("codex"),
            )
            .unwrap();

        let mode = std::fs::metadata(directory.path().join("hexa-goals.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn deleting_a_goal_never_deletes_watched_session_storage() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("hexa-watch.json"), r#"{"agents":{}}"#).unwrap();
        let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
        let goal = store
            .link_attempt(
                link_request(None, "session-codex", HexaAgentSurface::CodexDesktop),
                attempt_context("codex"),
            )
            .unwrap();

        store.delete_goal(&goal.id).unwrap();
        assert!(store.goals().is_empty());
        assert!(directory.path().join("hexa-watch.json").exists());
    }

    #[test]
    fn reload_failure_keeps_the_last_successful_goal_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HexaGoalStore::load_or_create(directory.path()).unwrap();
        store
            .link_attempt(
                link_request(
                    Some("goal-hush"),
                    "session-codex",
                    HexaAgentSurface::CodexDesktop,
                ),
                attempt_context("codex"),
            )
            .unwrap();
        std::fs::write(directory.path().join("hexa-goals.json"), "{broken").unwrap();

        assert!(store.reload_from_disk().is_err());
        assert_eq!(store.goals().len(), 1);
    }
}
