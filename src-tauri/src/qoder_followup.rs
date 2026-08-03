use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QoderSurface {
    Ide,
    Work,
}

pub async fn send_followup(
    surface: QoderSurface,
    workspace: &Path,
    message: &str,
) -> Result<(), String> {
    if !workspace.is_absolute() || !workspace.is_dir() {
        return Err("Qoder workspace is unavailable".into());
    }
    let message = message.trim();
    if message.is_empty() || message.chars().count() > 20_000 {
        return Err("Qoder follow-up must contain 1 to 20000 characters".into());
    }
    match surface {
        QoderSurface::Ide => send_to_ide(workspace, message).await,
        QoderSurface::Work => send_to_work(workspace, message).await,
    }
}

async fn send_to_ide(workspace: &Path, message: &str) -> Result<(), String> {
    let program = first_existing(qoder_ide_candidates())
        .ok_or("Qoder IDE is not installed or its chat command is unavailable")?;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        Command::new(program)
            .arg("chat")
            .arg("--reuse-window")
            .arg("--mode")
            .arg("agent")
            .arg(message)
            .current_dir(workspace)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "Qoder IDE did not accept the task in time".to_string())?
    .map_err(|error| format!("Could not open Qoder IDE chat: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Qoder IDE rejected the task".into())
    }
}

async fn send_to_work(workspace: &Path, message: &str) -> Result<(), String> {
    let program = first_existing(qoder_work_candidates())
        .ok_or("QoderWork is not installed or its local Agent is unavailable")?;
    let mut child = Command::new(program)
        .arg("--cwd")
        .arg(workspace)
        .arg("--permission-mode")
        .arg("default")
        .arg("--print")
        .arg(message)
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start the local QoderWork Agent: {error}"))?;
    tokio::spawn(async move {
        if !child.wait().await.is_ok_and(|status| status.success()) {
            log::warn!("A phone-started QoderWork task did not complete successfully");
        }
    });
    Ok(())
}

fn first_existing(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|path| std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file()))
}

#[cfg(target_os = "macos")]
fn qoder_ide_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(
        "/Applications/Qoder.app/Contents/Resources/app/bin/code",
    )];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications/Qoder.app/Contents/Resources/app/bin/code"));
    }
    candidates
}

#[cfg(not(target_os = "macos"))]
fn qoder_ide_candidates() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn qoder_work_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(
        "/Applications/QoderWork.app/Contents/Resources/bin/qodercli",
    )];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications/QoderWork.app/Contents/Resources/bin/qodercli"));
    }
    candidates
}

#[cfg(not(target_os = "macos"))]
fn qoder_work_candidates() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn qoder_candidates_are_fixed_application_paths() {
        let ide = qoder_ide_candidates();
        let work = qoder_work_candidates();

        assert!(ide.iter().all(|path| path.is_absolute()));
        assert!(work.iter().all(|path| path.is_absolute()));
        assert!(ide.iter().all(|path| path.ends_with("app/bin/code")));
        assert!(work.iter().all(|path| path.ends_with("bin/qodercli")));
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn qoder_candidates_are_empty_on_unsupported_platforms() {
        assert!(qoder_ide_candidates().is_empty());
        assert!(qoder_work_candidates().is_empty());
    }

    #[test]
    fn qoderwork_phone_tasks_keep_the_default_permission_boundary() {
        let source = include_str!("qoder_followup.rs");

        assert!(source.contains(".arg(\"default\")"));
        assert!(!source.contains(".arg(\"auto\")"));
        assert!(!source.contains(&["--dangerously", "-skip-permissions"].concat()));
        assert!(!source.contains(&["bypass", "_permissions"].concat()));
    }

    #[tokio::test]
    async fn rejects_non_workspace_targets_before_starting_qoder() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");

        assert!(send_followup(QoderSurface::Ide, &missing, "continue")
            .await
            .unwrap_err()
            .contains("workspace"));
    }
}
