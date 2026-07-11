use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_QUEUE_ENTRIES: usize = 100;
const MAX_MESSAGE_CHARS: usize = 20_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InterventionStatus {
    Pending,
    Sending,
    Failed,
    Delivered,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueuedIntervention {
    pub id: String,
    pub thread_id: String,
    pub message: String,
    pub created_at: String,
    pub attempts: u32,
    pub status: InterventionStatus,
    pub last_error: Option<String>,
}

pub struct InterventionQueue {
    path: PathBuf,
    entries: Vec<QueuedIntervention>,
}

impl InterventionQueue {
    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(humhum_dir)
            .map_err(|error| format!("Could not create HUMHUM directory: {error}"))?;
        let path = humhum_dir.join("intervention-queue.json");
        let mut entries = if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|error| format!("Could not read intervention queue: {error}"))?;
            if content.trim().is_empty() {
                Vec::new()
            } else {
                serde_json::from_str::<Vec<QueuedIntervention>>(&content)
                    .map_err(|error| format!("Could not parse intervention queue: {error}"))?
            }
        } else {
            Vec::new()
        };

        let mut recovered = false;
        for entry in &mut entries {
            if entry.status == InterventionStatus::Sending {
                entry.status = InterventionStatus::Failed;
                entry.last_error = Some("Delivery was interrupted before completion".into());
                recovered = true;
            }
        }
        let before_cleanup = entries.len();
        entries.retain(|entry| entry.status != InterventionStatus::Delivered);
        recovered |= entries.len() != before_cleanup;

        let queue = Self { path, entries };
        if recovered {
            queue.persist()?;
        }
        Ok(queue)
    }

    pub fn entries(&self) -> Vec<QueuedIntervention> {
        self.entries.clone()
    }

    pub fn is_next_for_thread(&self, id: &str) -> Result<bool, String> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| format!("Queued intervention not found: {id}"))?;
        let thread_id = &self.entries[index].thread_id;
        Ok(!self.entries[..index].iter().any(|entry| {
            entry.thread_id == *thread_id && entry.status != InterventionStatus::Delivered
        }))
    }

    pub fn enqueue(
        &mut self,
        thread_id: &str,
        message: &str,
    ) -> Result<QueuedIntervention, String> {
        let thread_id = thread_id.trim();
        let message = message.trim();
        if thread_id.is_empty() {
            return Err("Thread id cannot be empty".into());
        }
        if message.is_empty() {
            return Err("Message cannot be empty".into());
        }
        if message.chars().count() > MAX_MESSAGE_CHARS {
            return Err(format!("Message exceeds {MAX_MESSAGE_CHARS} characters"));
        }
        if self.entries.len() >= MAX_QUEUE_ENTRIES {
            return Err(format!(
                "Intervention queue is full ({MAX_QUEUE_ENTRIES} entries)"
            ));
        }

        let entry = QueuedIntervention {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: thread_id.to_string(),
            message: message.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            attempts: 0,
            status: InterventionStatus::Pending,
            last_error: None,
        };
        self.entries.push(entry.clone());
        self.persist()?;
        Ok(entry)
    }

    pub fn mark_sending(&mut self, id: &str) -> Result<QueuedIntervention, String> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| format!("Queued intervention not found: {id}"))?;
        if self.entries[index].status == InterventionStatus::Sending {
            return Err(format!("Queued intervention is already sending: {id}"));
        }
        if !self.is_next_for_thread(id)? {
            return Err("An earlier intervention for this thread must be delivered first".into());
        }
        let entry = self
            .entries
            .get_mut(index)
            .ok_or_else(|| format!("Queued intervention not found: {id}"))?;
        entry.status = InterventionStatus::Sending;
        entry.attempts = entry.attempts.saturating_add(1);
        entry.last_error = None;
        let updated = entry.clone();
        self.persist()?;
        Ok(updated)
    }

    pub fn mark_failed(&mut self, id: &str, error: &str) -> Result<(), String> {
        let entry = self
            .entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .ok_or_else(|| format!("Queued intervention not found: {id}"))?;
        entry.status = InterventionStatus::Failed;
        entry.last_error = Some(error.chars().take(500).collect());
        self.persist()
    }

    pub fn mark_delivered(&mut self, id: &str) -> Result<(), String> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| format!("Queued intervention not found: {id}"))?;
        self.entries[index].status = InterventionStatus::Delivered;
        self.entries[index].last_error = None;
        self.persist()?;
        self.entries.remove(index);
        // The durable delivered marker is the duplicate-send boundary. If compacting
        // the file fails, startup cleanup will remove that marker safely later.
        let _ = self.persist();
        Ok(())
    }

    fn persist(&self) -> Result<(), String> {
        let content = serde_json::to_vec_pretty(&self.entries)
            .map_err(|error| format!("Could not serialize intervention queue: {error}"))?;
        let temp_path = self.path.with_extension("json.tmp");
        std::fs::write(&temp_path, content)
            .map_err(|error| format!("Could not write intervention queue: {error}"))?;
        set_owner_only(&temp_path)?;
        std::fs::rename(&temp_path, &self.path)
            .map_err(|error| format!("Could not replace intervention queue: {error}"))?;
        set_owner_only(&self.path)
    }
}

fn set_owner_only(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(|error| format!("Could not inspect intervention queue: {error}"))?
            .permissions();
        permissions.set_mode(0o600);
        std::fs::set_permissions(path, permissions)
            .map_err(|error| format!("Could not protect intervention queue: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_messages_in_enqueue_order_and_removes_only_delivered_entries() {
        let temp = tempfile::tempdir().unwrap();
        let mut queue = InterventionQueue::load_or_create(temp.path()).unwrap();
        let first = queue.enqueue("thread-1", "first").unwrap();
        let second = queue.enqueue("thread-1", "second").unwrap();

        queue.mark_sending(&first.id).unwrap();
        queue.mark_failed(&first.id, "offline").unwrap();
        queue.mark_delivered(&second.id).unwrap();

        let entries = queue.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, first.id);
        assert_eq!(entries[0].status, InterventionStatus::Failed);
        assert_eq!(entries[0].attempts, 1);
        assert_eq!(entries[0].last_error.as_deref(), Some("offline"));
    }

    #[test]
    fn recovers_interrupted_sends_as_retryable_failures() {
        let temp = tempfile::tempdir().unwrap();
        let entry_id = {
            let mut queue = InterventionQueue::load_or_create(temp.path()).unwrap();
            let entry = queue.enqueue("thread-1", "continue").unwrap();
            queue.mark_sending(&entry.id).unwrap();
            entry.id
        };

        let queue = InterventionQueue::load_or_create(temp.path()).unwrap();
        let recovered = queue
            .entries()
            .into_iter()
            .find(|entry| entry.id == entry_id)
            .unwrap();
        assert_eq!(recovered.status, InterventionStatus::Failed);
        assert!(recovered.last_error.unwrap().contains("interrupted"));
    }

    #[cfg(unix)]
    #[test]
    fn queue_file_uses_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let mut queue = InterventionQueue::load_or_create(temp.path()).unwrap();
        queue.enqueue("thread-1", "private instruction").unwrap();

        let mode = std::fs::metadata(temp.path().join("intervention-queue.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn prevents_out_of_order_and_concurrent_delivery() {
        let temp = tempfile::tempdir().unwrap();
        let mut queue = InterventionQueue::load_or_create(temp.path()).unwrap();
        let first = queue.enqueue("thread-1", "first").unwrap();
        let second = queue.enqueue("thread-1", "second").unwrap();

        assert!(queue
            .mark_sending(&second.id)
            .unwrap_err()
            .contains("earlier"));
        queue.mark_sending(&first.id).unwrap();
        assert!(queue
            .mark_sending(&first.id)
            .unwrap_err()
            .contains("already sending"));
    }

    #[test]
    fn delivered_marker_is_removed_after_a_clean_restart() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("intervention-queue.json");
        let entry = QueuedIntervention {
            id: "delivered-1".into(),
            thread_id: "thread-1".into(),
            message: "already accepted".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            attempts: 1,
            status: InterventionStatus::Delivered,
            last_error: None,
        };
        std::fs::write(&path, serde_json::to_vec(&vec![entry]).unwrap()).unwrap();

        let queue = InterventionQueue::load_or_create(temp.path()).unwrap();

        assert!(queue.entries().is_empty());
        assert_eq!(std::fs::read_to_string(path).unwrap().trim(), "[]");
    }
}
