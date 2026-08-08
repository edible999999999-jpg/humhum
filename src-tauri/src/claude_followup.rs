use crate::codex_bridge::transport::{command_for_cli_with_untrusted_args, resolve_cli_binary};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

/// One Humi conversation turn answered by the local Claude Code CLI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeBrainReply {
    /// Claude session id to resume on the next turn.
    pub session_id: String,
    /// The assistant's reply text to show in Humi's chat.
    pub text: String,
}

/// The subset of `claude --print --output-format json` we consume.
#[derive(Debug, Deserialize)]
struct ClaudePrintResult {
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    result: String,
    #[serde(default)]
    is_error: bool,
}

/// Build args for a Humi brain turn. On the first turn `previous_session` is
/// None and Claude starts a fresh session; later turns resume it. Unlike the
/// fire-and-forget follow-up, this keeps the JSON on stdout so we can read the
/// reply back into Humi's chat.
fn brain_turn_args(previous_session: Option<&str>) -> Result<Vec<String>, String> {
    let mut args = vec!["--print".to_string()];
    if let Some(session_id) = previous_session {
        let session_id = session_id.trim();
        uuid::Uuid::parse_str(session_id).map_err(|_| "Claude session id must be a UUID")?;
        args.push("--resume".to_string());
        args.push(session_id.to_string());
    }
    // `default` keeps the permission gate live (same rationale as send_followup).
    args.extend(
        [
            "--permission-mode",
            "default",
            "--output-format",
            "json",
            "--",
        ]
        .into_iter()
        .map(str::to_string),
    );
    Ok(args)
}

/// Run one Humi conversation turn through the local Claude CLI and return its
/// reply text plus the session id to resume next time.
pub async fn run_brain_turn(
    previous_session: Option<&str>,
    workspace: &Path,
    message: &str,
) -> Result<ClaudeBrainReply, String> {
    let args = brain_turn_args(previous_session)?;
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(120), command.output())
        .await
        .map_err(|_| "Claude 回复超时，请再试一次")?
        .map_err(|error| {
            format!(
                "Could not start Claude CLI at {}: {error}",
                binary.display()
            )
        })?;
    if !output.status.success() {
        let stderr: String = String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(500)
            .collect();
        return Err(if stderr.trim().is_empty() {
            format!("Claude CLI exited with {}", output.status)
        } else {
            format!("Claude CLI failed: {}", stderr.trim())
        });
    }
    parse_brain_reply(&output.stdout)
}

/// Parse the `--output-format json` payload into a Humi reply.
fn parse_brain_reply(stdout: &[u8]) -> Result<ClaudeBrainReply, String> {
    let parsed: ClaudePrintResult =
        serde_json::from_slice(stdout).map_err(|_| "Claude 返回了无法解析的结果".to_string())?;
    if parsed.is_error {
        return Err("Claude 处理这次对话时出错了".into());
    }
    let text = parsed.result.trim();
    if text.is_empty() {
        return Err("Claude 这次没有返回可显示的回复".into());
    }
    if parsed.session_id.trim().is_empty() {
        return Err("Claude 未返回会话标识，无法继续对话".into());
    }
    Ok(ClaudeBrainReply {
        session_id: parsed.session_id.trim().to_string(),
        text: text.to_string(),
    })
}

pub fn followup_args(session_id: &str) -> Result<Vec<String>, String> {
    let session_id = session_id.trim();
    uuid::Uuid::parse_str(session_id).map_err(|_| "Claude session id must be a UUID")?;
    Ok([
        "--print",
        "--resume",
        session_id,
        // `default`, not `dontAsk`: a remotely dispatched turn must still go
        // through the same PermissionRequest hook a local turn does, so a
        // high-risk tool (Bash, file writes) surfaces an approval the user can
        // grant from their phone rather than running unattended. This matches
        // the QoderWork follow-up, which already uses `default`. Low-risk tool
        // calls are still auto-allowed by Claude under `default`.
        "--permission-mode",
        "default",
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

/// Whether a real Claude CLI is installed, so Humi can offer it as a brain.
/// `resolve_cli_binary` falls back to the bare name when nothing exists, so a
/// resolved path that is not an actual file means Claude is not installed.
pub fn is_available() -> bool {
    claude_binary().is_file()
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
                "default",
                "--output-format",
                "json",
                "--",
            ]
        );
    }

    #[test]
    fn remote_followup_never_bypasses_the_permission_gate() {
        // Regression guard for the remote-approval contract: a phone-dispatched
        // turn must not silently auto-approve tools. `dontAsk` and the
        // skip-permissions escape hatches must never appear in the resume args.
        let args = followup_args("019f2dc3-34d4-7051-81fe-d1d5ab043849").unwrap();
        assert!(!args.iter().any(|arg| arg == "dontAsk"));
        assert!(!args
            .iter()
            .any(|arg| arg.contains("dangerously") || arg.contains("skip-permissions")));
        // The gate is explicitly `default`, which routes through the hook.
        let mode = args.iter().position(|arg| arg == "--permission-mode");
        assert_eq!(
            mode.and_then(|i| args.get(i + 1)).map(String::as_str),
            Some("default")
        );
    }

    #[test]
    fn rejects_values_that_could_be_cli_options_or_unstable_names() {
        assert!(followup_args("--continue").is_err());
        assert!(followup_args("not-a-uuid").is_err());
    }

    #[test]
    fn brain_turn_starts_a_fresh_session_then_resumes_it() {
        let first = brain_turn_args(None).unwrap();
        assert_eq!(first.first().map(String::as_str), Some("--print"));
        assert!(!first.iter().any(|arg| arg == "--resume"));

        let resumed = brain_turn_args(Some("019f2dc3-34d4-7051-81fe-d1d5ab043849")).unwrap();
        let idx = resumed.iter().position(|arg| arg == "--resume").unwrap();
        assert_eq!(
            resumed.get(idx + 1).map(String::as_str),
            Some("019f2dc3-34d4-7051-81fe-d1d5ab043849")
        );
    }

    #[test]
    fn brain_turn_keeps_the_permission_gate_and_rejects_bad_sessions() {
        let args = brain_turn_args(None).unwrap();
        assert!(!args.iter().any(|arg| arg == "dontAsk"));
        let mode = args.iter().position(|arg| arg == "--permission-mode");
        assert_eq!(
            mode.and_then(|i| args.get(i + 1)).map(String::as_str),
            Some("default")
        );
        assert!(brain_turn_args(Some("not-a-uuid")).is_err());
    }

    #[test]
    fn parses_a_claude_print_reply_and_keeps_the_session_id() {
        let payload = r#"{"session_id":"019f2dc3-34d4-7051-81fe-d1d5ab043849","result":"你好，我看了你最近的工作。","is_error":false}"#;
        let reply = parse_brain_reply(payload.as_bytes()).unwrap();
        assert_eq!(reply.session_id, "019f2dc3-34d4-7051-81fe-d1d5ab043849");
        assert_eq!(reply.text, "你好，我看了你最近的工作。");
    }

    #[test]
    fn rejects_error_empty_or_sessionless_replies() {
        assert!(
            parse_brain_reply(r#"{"session_id":"s","result":"x","is_error":true}"#.as_bytes())
                .is_err()
        );
        assert!(parse_brain_reply(r#"{"session_id":"s","result":"   "}"#.as_bytes()).is_err());
        assert!(parse_brain_reply(r#"{"session_id":"","result":"hi"}"#.as_bytes()).is_err());
        assert!(parse_brain_reply(b"not json").is_err());
    }
}
