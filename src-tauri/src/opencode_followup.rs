use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

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
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(600), command.output())
        .await
        .map_err(|_| "OpenCode follow-up timed out after 10 minutes")?
        .map_err(|error| {
            format!(
                "Could not start OpenCode CLI at {}: {error}",
                binary.display()
            )
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr: String = String::from_utf8_lossy(&output.stderr)
        .chars()
        .take(500)
        .collect();
    Err(if stderr.trim().is_empty() {
        format!("OpenCode CLI exited with {}", output.status)
    } else {
        format!("OpenCode CLI failed: {}", stderr.trim())
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
}
