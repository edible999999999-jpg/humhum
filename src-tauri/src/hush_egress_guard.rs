use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use tokio::process::Command;

const POLICY_VERSION: u8 = 1;
const SANDBOX_EXECUTABLE: &str = "/usr/bin/sandbox-exec";
const SANDBOX_PREFLIGHT_EXECUTABLE: &str = "/usr/bin/true";
const NETWORK_DENY_PROFILE: &str = "(version 1)\n(allow default)\n(deny network*)";
const POLICY_MESSAGE: &str = "聊天正文仅保存在这台 Mac，不会发送给 AI、Relay、手机或外部服务。";
const SANDBOX_ERROR: &str = "系统网络隔离不可用；为保护聊天隐私，微信本地读取已停止";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HushEgressGuardStatus {
    pub enforced: bool,
    pub policy_version: u8,
    pub message: String,
    pub process_sandbox_available: bool,
}

pub fn status() -> HushEgressGuardStatus {
    HushEgressGuardStatus {
        enforced: true,
        policy_version: POLICY_VERSION,
        message: POLICY_MESSAGE.to_string(),
        process_sandbox_available: verify_network_sandbox().is_ok(),
    }
}

pub(crate) fn network_sandboxed_command(executable: &Path) -> Result<Command, String> {
    verify_network_sandbox()?;
    let sandbox = sandbox_executable()?;
    let mut command = Command::new(sandbox);
    command.arg("-p").arg(NETWORK_DENY_PROFILE).arg(executable);
    Ok(command)
}

fn verify_network_sandbox() -> Result<(), String> {
    static RESULT: OnceLock<Result<(), String>> = OnceLock::new();
    RESULT
        .get_or_init(|| {
            let sandbox = sandbox_executable()?;
            #[cfg(target_os = "macos")]
            sandbox_executable_at(Path::new(SANDBOX_PREFLIGHT_EXECUTABLE))?;
            run_sandbox_preflight(sandbox, NETWORK_DENY_PROFILE)
        })
        .clone()
}

fn sandbox_executable() -> Result<&'static Path, String> {
    #[cfg(target_os = "macos")]
    {
        let path = Path::new(SANDBOX_EXECUTABLE);
        sandbox_executable_at(path)?;
        Ok(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(SANDBOX_ERROR.to_string())
    }
}

#[cfg(target_os = "macos")]
fn sandbox_executable_at(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let metadata = std::fs::symlink_metadata(path).map_err(|_| SANDBOX_ERROR.to_string())?;
    let mode = metadata.permissions().mode();
    if !sandbox_properties_are_safe(
        metadata.uid(),
        mode,
        metadata.is_file(),
        metadata.file_type().is_symlink(),
    ) {
        return Err(SANDBOX_ERROR.to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn sandbox_properties_are_safe(uid: u32, mode: u32, is_file: bool, is_symlink: bool) -> bool {
    uid == 0 && mode & 0o111 != 0 && mode & 0o022 == 0 && is_file && !is_symlink
}

#[cfg(target_os = "macos")]
fn run_sandbox_preflight(sandbox: &Path, profile: &str) -> Result<(), String> {
    let status = std::process::Command::new(sandbox)
        .arg("-p")
        .arg(profile)
        .arg(SANDBOX_PREFLIGHT_EXECUTABLE)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| SANDBOX_ERROR.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(SANDBOX_ERROR.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn run_sandbox_preflight(_sandbox: &Path, _profile: &str) -> Result<(), String> {
    Err(SANDBOX_ERROR.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiled_policy_is_always_enforced_and_has_no_disable_flag() {
        let status = status();
        assert!(status.enforced);
        assert_eq!(status.policy_version, 1);
        assert!(status
            .message
            .contains("不会发送给 AI、Relay、手机或外部服务"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_validation_rejects_missing_and_symlinked_binaries() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");
        assert!(sandbox_executable_at(&missing).is_err());

        let linked = temp.path().join("sandbox-link");
        symlink(Path::new("/usr/bin/sandbox-exec"), &linked).unwrap();
        assert!(sandbox_executable_at(&linked).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_property_validation_checks_each_security_dimension() {
        assert!(sandbox_properties_are_safe(0, 0o755, true, false));
        assert!(!sandbox_properties_are_safe(501, 0o755, true, false));
        assert!(!sandbox_properties_are_safe(0, 0o777, true, false));
        assert!(!sandbox_properties_are_safe(0, 0o644, true, false));
        assert!(!sandbox_properties_are_safe(0, 0o755, false, false));
        assert!(!sandbox_properties_are_safe(0, 0o755, true, true));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_preflight_rejects_an_invalid_profile() {
        assert!(run_sandbox_preflight(
            Path::new("/usr/bin/sandbox-exec"),
            "(version 1) (deny network*"
        )
        .is_err());
    }
}
