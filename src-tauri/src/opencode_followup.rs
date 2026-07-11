use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

pub fn followup_args(session_id: &str) -> Result<Vec<String>, String> {
    let session_id = session_id.trim();
    let suffix = session_id
        .strip_prefix("ses_")
        .filter(|suffix| (8..=64).contains(&suffix.len()))
        .filter(|suffix| {
            suffix
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        })
        .ok_or("OpenCode session id is invalid")?;
    debug_assert!(!suffix.is_empty());
    Ok(["run", "--session", session_id, "--format", "json", "--"]
        .into_iter()
        .map(str::to_string)
        .collect())
}

pub async fn send_followup(
    session_id: &str,
    workspace: &Path,
    message: &str,
) -> Result<(), String> {
    let args = followup_args(session_id)?;
    let workspace = workspace
        .canonicalize()
        .map_err(|error| format!("OpenCode workspace is unavailable: {error}"))?;
    if !workspace.is_dir() {
        return Err("OpenCode workspace must be a directory".into());
    }
    let binary = opencode_binary();
    let mut command = tokio::process::Command::new(&binary);
    command
        .args(args)
        .arg(message)
        .current_dir(&workspace)
        .env("PWD", &workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start OpenCode CLI at {}: {error}",
            binary.display()
        )
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or("OpenCode stdout is unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("OpenCode stderr is unavailable")?;
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut chunk = [0_u8; 1024];
        let mut retained = Vec::new();
        loop {
            match reader.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let remaining = 500_usize.saturating_sub(retained.len());
                    retained.extend_from_slice(&chunk[..read.min(remaining)]);
                }
            }
        }
        String::from_utf8_lossy(&retained).to_string()
    });
    let completion = async {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if is_completion_line(&line, session_id) {
                return true;
            }
        }
        false
    };
    let completed = tokio::time::timeout(Duration::from_secs(600), completion)
        .await
        .map_err(|_| "OpenCode follow-up timed out after 10 minutes")?;
    if completed {
        if tokio::time::timeout(Duration::from_secs(3), child.wait())
            .await
            .is_err()
        {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        let _ = stderr_task.await;
        return Ok(());
    }
    let status = child
        .wait()
        .await
        .map_err(|error| format!("Could not wait for OpenCode CLI: {error}"))?;
    let stderr = stderr_task.await.unwrap_or_default();
    Err(if stderr.trim().is_empty() {
        format!("OpenCode CLI exited without a completion marker ({status})")
    } else {
        format!("OpenCode CLI failed: {}", stderr.trim())
    })
}

fn is_completion_line(line: &str, session_id: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(line).is_ok_and(|event| {
        event.get("type").and_then(serde_json::Value::as_str) == Some("step_finish")
            && event.get("sessionID").and_then(serde_json::Value::as_str) == Some(session_id)
    })
}

fn opencode_binary() -> std::path::PathBuf {
    let mut candidates = vec![
        std::path::PathBuf::from("/opt/homebrew/bin/opencode"),
        std::path::PathBuf::from("/usr/local/bin/opencode"),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".opencode/bin/opencode"));
        candidates.push(home.join(".local/bin/opencode"));
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| std::path::PathBuf::from("opencode"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_scoped_noninteractive_resume_command() {
        assert_eq!(
            followup_args("ses_0ad12408effenrGFefa18FXWMs").unwrap(),
            vec![
                "run",
                "--session",
                "ses_0ad12408effenrGFefa18FXWMs",
                "--format",
                "json",
                "--",
            ]
        );
    }

    #[test]
    fn rejects_option_injection_and_unstable_session_names() {
        assert!(followup_args("--continue").is_err());
        assert!(followup_args("ses_bad/../../value").is_err());
        assert!(followup_args("session-name").is_err());
    }

    #[test]
    fn accepts_only_the_matching_session_completion_marker() {
        let session = "ses_0ad12408effenrGFefa18FXWMs";
        assert!(is_completion_line(
            r#"{"type":"step_finish","sessionID":"ses_0ad12408effenrGFefa18FXWMs"}"#,
            session,
        ));
        assert!(!is_completion_line(
            r#"{"type":"step_finish","sessionID":"ses_other123"}"#,
            session,
        ));
        assert!(!is_completion_line("not-json", session));
    }
}
