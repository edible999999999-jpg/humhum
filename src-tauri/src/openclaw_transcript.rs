use crate::event_bus::{self, HookEvent};
use crate::session_store::SessionStore;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

const MAX_RECENT_SESSIONS: usize = 30;

#[derive(Debug, Clone, Serialize)]
struct DiscoveredSession {
    session_id: String,
    transcript_path: PathBuf,
    cwd: Option<String>,
    updated_at: i64,
    client_type: &'static str,
}

pub fn start_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let mut seen = HashMap::<String, i64>::new();
        loop {
            match discover_recent(&home) {
                Ok(sessions) => {
                    for session in sessions {
                        if seen.get(&session.session_id) == Some(&session.updated_at) {
                            continue;
                        }
                        seen.insert(session.session_id.clone(), session.updated_at);
                        let event = session.into_event();
                        if let Ok(mut store) =
                            app.state::<Arc<Mutex<SessionStore>>>().inner().lock()
                        {
                            store.update_from_event(&event);
                        }
                        event_bus::emit_hook_event(&app, &event);
                    }
                }
                Err(error) => log::warn!("OpenClaw transcript refresh failed: {error}"),
            }
            std::thread::sleep(Duration::from_secs(20));
        }
    });
}

impl DiscoveredSession {
    fn into_event(self) -> HookEvent {
        let timestamp = DateTime::<Utc>::from_timestamp_millis(self.updated_at)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();
        HookEvent {
            id: format!("{}-transcript-{}", self.session_id, self.updated_at),
            hook_event_name: "TranscriptBackfill".into(),
            session_id: self.session_id,
            transcript_path: Some(self.transcript_path.to_string_lossy().into_owned()),
            cwd: self.cwd,
            client_type: self.client_type.into(),
            payload: serde_json::json!({"thread_source": "openclaw-transcript"}),
            timestamp,
        }
    }
}

fn discover_recent(home: &Path) -> Result<Vec<DiscoveredSession>, String> {
    let agents_root = home.join(".openclaw/agents");
    if !agents_root.exists() {
        return Ok(Vec::new());
    }
    let canonical_root = agents_root
        .canonicalize()
        .map_err(|error| format!("Could not resolve OpenClaw agents directory: {error}"))?;
    let mut discovered = Vec::new();
    let agents = std::fs::read_dir(&agents_root)
        .map_err(|error| format!("Could not inspect OpenClaw agents: {error}"))?;
    for agent in agents.flatten() {
        let index_path = agent.path().join("sessions/sessions.json");
        if !index_path.is_file() {
            continue;
        }
        let Ok(source) = std::fs::read_to_string(&index_path) else {
            continue;
        };
        let Ok(Value::Object(index)) = serde_json::from_str::<Value>(&source) else {
            continue;
        };
        for entry in index.values() {
            let Some(session_id) = entry.get("sessionId").and_then(Value::as_str) else {
                continue;
            };
            let Some(session_file) = entry.get("sessionFile").and_then(Value::as_str) else {
                continue;
            };
            let Some(updated_at) = entry.get("updatedAt").and_then(Value::as_i64) else {
                continue;
            };
            let path = PathBuf::from(session_file);
            let Ok(canonical_path) = path.canonicalize() else {
                continue;
            };
            if canonical_path.extension().and_then(|value| value.to_str()) != Some("jsonl")
                || !canonical_path.starts_with(&canonical_root)
            {
                continue;
            }
            discovered.push(DiscoveredSession {
                session_id: format!("openclaw-{session_id}"),
                cwd: transcript_cwd(&canonical_path),
                transcript_path: canonical_path,
                updated_at,
                client_type: "openclaw",
            });
        }
    }
    discovered.sort_by_key(|item| std::cmp::Reverse(item.updated_at));
    discovered.truncate(MAX_RECENT_SESSIONS);
    Ok(discovered)
}

fn transcript_cwd(path: &Path) -> Option<String> {
    let first_line = BufReader::new(File::open(path).ok()?)
        .lines()
        .next()?
        .ok()?;
    let value: Value = serde_json::from_str(&first_line).ok()?;
    value
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write_session(home: &std::path::Path, agent: &str, id: &str, updated_at: i64) {
        let sessions_dir = home.join(".openclaw/agents").join(agent).join("sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();
        let transcript = sessions_dir.join(format!("{id}.jsonl"));
        std::fs::write(
            &transcript,
            format!(
                "{}\n{}\n",
                json!({"type":"session","id":id,"timestamp":"2026-07-12T00:00:00Z","cwd":"/tmp/project"}),
                json!({"type":"message","id":"m1","timestamp":"2026-07-12T00:01:00Z","message":{"role":"user","content":[{"type":"text","text":"private"}]}})
            ),
        )
        .unwrap();
        let index_path = sessions_dir.join("sessions.json");
        let mut index = std::fs::read_to_string(&index_path)
            .ok()
            .and_then(|source| serde_json::from_str::<serde_json::Value>(&source).ok())
            .unwrap_or_else(|| json!({}));
        index[format!("agent:{agent}:{id}")] = json!({
            "sessionId": id,
            "sessionFile": transcript,
            "updatedAt": updated_at
        });
        std::fs::write(index_path, serde_json::to_vec(&index).unwrap()).unwrap();
    }

    #[test]
    fn discovers_openclaw_schema_without_copying_message_text() {
        let temp = tempfile::tempdir().unwrap();
        write_session(temp.path(), "main", "session-a", 1_783_824_060_000);

        let sessions = discover_recent(temp.path()).unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "openclaw-session-a");
        assert_eq!(sessions[0].cwd.as_deref(), Some("/tmp/project"));
        assert_eq!(sessions[0].client_type, "openclaw");
        assert_eq!(sessions[0].updated_at, 1_783_824_060_000);
        let serialized = serde_json::to_value(&sessions[0]).unwrap();
        let fields = serialized.as_object().unwrap();
        assert_eq!(fields.len(), 5);
        assert!(!fields.contains_key("message"));
        assert!(!fields.contains_key("content"));
    }

    #[test]
    fn rejects_transcript_paths_outside_openclaw_agents() {
        let temp = tempfile::tempdir().unwrap();
        let sessions_dir = temp.path().join(".openclaw/agents/main/sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();
        let outside = temp.path().join("private.jsonl");
        std::fs::write(&outside, "{}\n").unwrap();
        std::fs::write(
            sessions_dir.join("sessions.json"),
            serde_json::to_vec(&json!({
                "agent:main:main": {
                    "sessionId": "escaped",
                    "sessionFile": outside,
                    "updatedAt": 1_783_824_060_000_i64
                }
            }))
            .unwrap(),
        )
        .unwrap();

        assert!(discover_recent(temp.path()).unwrap().is_empty());
    }

    #[test]
    fn keeps_only_the_thirty_most_recent_sessions() {
        let temp = tempfile::tempdir().unwrap();
        for index in 0..35 {
            write_session(
                temp.path(),
                "main",
                &format!("session-{index:02}"),
                1_783_824_060_000 + index,
            );
        }

        let sessions = discover_recent(temp.path()).unwrap();

        assert_eq!(sessions.len(), 30);
        assert_eq!(sessions[0].session_id, "openclaw-session-34");
        assert_eq!(sessions[29].session_id, "openclaw-session-05");
    }

    #[test]
    #[ignore = "requires HUMHUM_OPENCLAW_LIVE_HOME"]
    fn discovers_an_explicit_live_openclaw_home() {
        let home = std::env::var("HUMHUM_OPENCLAW_LIVE_HOME").unwrap();
        let sessions = discover_recent(Path::new(&home)).unwrap();
        assert!(!sessions.is_empty());
        assert!(sessions.iter().all(|session| {
            session.client_type == "openclaw"
                && session.session_id.starts_with("openclaw-")
                && session.transcript_path.starts_with(
                    Path::new(&home)
                        .join(".openclaw/agents")
                        .canonicalize()
                        .unwrap(),
                )
        }));
    }
}
