use crate::codex_bridge::transport::{command_for_cli_with_untrusted_args, resolve_cli_binary};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

pub fn followup_args(session_id: &str) -> Result<Vec<String>, String> {
    let session_id = session_id.trim();
    uuid::Uuid::parse_str(session_id).map_err(|_| "Claude session id must be a UUID")?;
    Ok([
        "--print",
        "--resume",
        session_id,
        "--permission-mode",
        "dontAsk",
        "--output-format",
        "json",
        "--",
    ]
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
        .map_err(|error| format!("Claude workspace is unavailable: {error}"))?;
    if !workspace.is_dir() {
        return Err("Claude workspace must be a directory".into());
    }
    let binary = claude_binary();
    let mut command = command_for_cli_with_untrusted_args(&binary).map_err(|error| {
        format!(
            "Could not safely prepare Claude CLI at {}: {error}",
            binary.display()
        )
    })?;
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
        .map_err(|_| "Claude follow-up timed out after 10 minutes")?
        .map_err(|error| {
            format!(
                "Could not start Claude CLI at {}: {error}",
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
        format!("Claude CLI exited with {}", output.status)
    } else {
        format!("Claude CLI failed: {}", stderr.trim())
    })
}

fn claude_binary() -> PathBuf {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
        #[cfg(target_os = "windows")]
        {
            candidates.push(home.join(".local/bin/claude.exe"));
            candidates.push(home.join(".local/bin/claude.cmd"));
            candidates.push(home.join(".claude/local/claude.exe"));
            candidates.push(home.join(".claude/local/claude.cmd"));
        }
    }
    resolve_cli_binary("claude", candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_noninteractive_resume_args_for_a_stable_claude_session() {
        let args = followup_args("019f2dc3-34d4-7051-81fe-d1d5ab043849").unwrap();

        assert_eq!(
            args,
            vec![
                "--print",
                "--resume",
                "019f2dc3-34d4-7051-81fe-d1d5ab043849",
                "--permission-mode",
                "dontAsk",
                "--output-format",
                "json",
                "--",
            ]
        );
    }

    #[test]
    fn rejects_values_that_could_be_cli_options_or_unstable_names() {
        assert!(followup_args("--continue").is_err());
        assert!(followup_args("not-a-uuid").is_err());
    }
}
