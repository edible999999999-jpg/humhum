use serde::Serialize;
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::RwLock;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const MAX_SSH_TARGET_LEN: usize = 255;
const DEFAULT_REMOTE_PORT: u16 = 41_275;
const HUMHUM_HOOK_SCRIPT: &str = include_str!("../../hooks/humhum-hook.sh");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshTarget(String);

impl SshTarget {
    pub fn parse(value: &str) -> Result<Self, String> {
        let value = value.trim();
        if value.is_empty() || value.len() > MAX_SSH_TARGET_LEN || value.starts_with('-') {
            return Err("SSH target is empty or invalid".into());
        }
        if !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '@' | '.' | '_' | '-')
        }) {
            return Err("SSH target contains unsupported characters".into());
        }
        let parts = value.split('@').collect::<Vec<_>>();
        if parts.len() > 2 || parts.iter().any(|part| part.is_empty()) {
            return Err("SSH target must be host or user@host".into());
        }
        Ok(Self(value.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub fn reverse_tunnel_args(target: &SshTarget, remote_port: u16, local_port: u16) -> Vec<String> {
    vec![
        "-N".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        "ServerAliveInterval=30".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
        "-R".into(),
        format!("127.0.0.1:{remote_port}:127.0.0.1:{local_port}"),
        target.as_str().into(),
    ]
}

#[derive(Debug, Clone)]
pub struct RemoteIngressAuth {
    token_digest: [u8; 32],
}

impl RemoteIngressAuth {
    pub fn new(token: &str) -> Self {
        Self {
            token_digest: Sha256::digest(token.as_bytes()).into(),
        }
    }

    pub fn authorizes(&self, path: &str, candidate: Option<&str>) -> bool {
        if path != "/event" {
            return false;
        }
        let Some(candidate) = candidate else {
            return false;
        };
        let digest: [u8; 32] = Sha256::digest(candidate.as_bytes()).into();
        self.token_digest
            .iter()
            .zip(digest.iter())
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteBridgeStatus {
    pub status: String,
    pub target: Option<String>,
    pub remote_port: u16,
    pub message: String,
}

struct RemoteRuntime {
    child: Option<Child>,
    target: Option<SshTarget>,
    last_error: Option<String>,
}

pub struct RemoteBridgeState {
    runtime: Mutex<RemoteRuntime>,
    ingress: RwLock<Option<RemoteIngressAuth>>,
}

impl Default for RemoteBridgeState {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(RemoteRuntime {
                child: None,
                target: None,
                last_error: None,
            }),
            ingress: RwLock::new(None),
        }
    }
}

impl RemoteBridgeState {
    pub fn authorizes_event(&self, path: &str, candidate: Option<&str>) -> bool {
        self.ingress
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|auth| auth.authorizes(path, candidate))
    }

    pub async fn status(&self) -> RemoteBridgeStatus {
        let mut runtime = self.runtime.lock().await;
        if let Some(child) = runtime.child.as_mut() {
            if let Ok(Some(exit)) = child.try_wait() {
                runtime.child = None;
                runtime.last_error = Some(format!("SSH tunnel exited with {exit}"));
                *self
                    .ingress
                    .write()
                    .unwrap_or_else(|error| error.into_inner()) = None;
            }
        }
        status_from_runtime(&runtime)
    }

    pub async fn connect(
        &self,
        target: &str,
        local_port: u16,
    ) -> Result<RemoteBridgeStatus, String> {
        let target = SshTarget::parse(target)?;
        let mut runtime = self.runtime.lock().await;
        if runtime.child.is_some() {
            return Err("Disconnect the current SSH bridge first".into());
        }

        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        bootstrap_remote(&target, DEFAULT_REMOTE_PORT, &token).await?;

        let ssh = ssh_executable()?;
        let mut command = ssh_command(&ssh);
        command
            .args(reverse_tunnel_args(
                &target,
                DEFAULT_REMOTE_PORT,
                local_port,
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            format!("Could not start SSH tunnel with {}: {error}", ssh.display())
        })?;
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        if let Some(exit) = child
            .try_wait()
            .map_err(|error| format!("Could not inspect SSH tunnel: {error}"))?
        {
            let mut detail = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                use tokio::io::AsyncReadExt;
                let _ = stderr.read_to_string(&mut detail).await;
            }
            return Err(format!("SSH tunnel exited with {exit}: {}", detail.trim()));
        }

        *self.ingress.write().map_err(|error| error.to_string())? =
            Some(RemoteIngressAuth::new(&token));
        runtime.child = Some(child);
        runtime.target = Some(target);
        runtime.last_error = None;
        Ok(status_from_runtime(&runtime))
    }

    pub async fn disconnect(&self) -> Result<RemoteBridgeStatus, String> {
        let mut runtime = self.runtime.lock().await;
        if let Some(mut child) = runtime.child.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        *self.ingress.write().map_err(|error| error.to_string())? = None;
        runtime.target = None;
        runtime.last_error = None;
        Ok(status_from_runtime(&runtime))
    }
}

fn status_from_runtime(runtime: &RemoteRuntime) -> RemoteBridgeStatus {
    let connected = runtime.child.is_some();
    RemoteBridgeStatus {
        status: if connected {
            "connected".into()
        } else if runtime.last_error.is_some() {
            "error".into()
        } else {
            "disconnected".into()
        },
        target: runtime
            .target
            .as_ref()
            .map(|target| target.as_str().to_string()),
        remote_port: DEFAULT_REMOTE_PORT,
        message: runtime.last_error.clone().unwrap_or_else(|| {
            if connected {
                "Remote Claude events are flowing through SSH".into()
            } else {
                "No SSH remote is connected".into()
            }
        }),
    }
}

async fn bootstrap_remote(target: &SshTarget, remote_port: u16, token: &str) -> Result<(), String> {
    run_remote_write(
        target,
        r#"umask 077; mkdir -p "$HOME/.humhum/hooks"; cat > "$HOME/.humhum/hooks/humhum-hook.sh"; chmod 700 "$HOME/.humhum/hooks/humhum-hook.sh""#,
        HUMHUM_HOOK_SCRIPT.as_bytes(),
    )
    .await?;
    run_remote_write(
        target,
        r#"umask 077; mkdir -p "$HOME/.humhum"; cat > "$HOME/.humhum/remote-ingress-token"; chmod 600 "$HOME/.humhum/remote-ingress-token""#,
        token.as_bytes(),
    )
    .await?;
    let installer = remote_claude_installer(remote_port, target.as_str());
    run_remote_write(target, "python3 -", installer.as_bytes()).await
}

async fn run_remote_write(
    target: &SshTarget,
    remote_command: &str,
    input: &[u8],
) -> Result<(), String> {
    let ssh = ssh_executable()?;
    let mut command = ssh_command(&ssh);
    command
        .args(ssh_connection_args(target))
        .arg(remote_command)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start SSH bootstrap with {}: {error}",
            ssh.display()
        )
    })?;
    child
        .stdin
        .take()
        .ok_or("SSH bootstrap stdin is unavailable")?
        .write_all(input)
        .await
        .map_err(|error| format!("Could not send SSH bootstrap: {error}"))?;
    let output = tokio::time::timeout(std::time::Duration::from_secs(20), child.wait_with_output())
        .await
        .map_err(|_| {
            "SSH bootstrap timed out; trust the host in Terminal and verify key access".to_string()
        })?
        .map_err(|error| format!("SSH bootstrap failed: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "SSH bootstrap failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn ssh_connection_args(target: &SshTarget) -> Vec<String> {
    vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        target.as_str().into(),
    ]
}

fn ssh_command(program: &Path) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new(program);
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(program)
    }
}

#[cfg(target_os = "windows")]
fn ssh_executable() -> Result<PathBuf, String> {
    let system_root = std::env::var_os("SystemRoot")
        .or_else(|| std::env::var_os("WINDIR"))
        .map(PathBuf::from);
    let candidates =
        windows_ssh_candidates(system_root.as_deref(), std::env::var_os("PATH").as_deref());
    first_existing_executable(&candidates).ok_or_else(|| {
        let searched = candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Windows OpenSSH client was not found. Install the Windows OpenSSH Client optional feature. Searched: {searched}"
        )
    })
}

#[cfg(not(target_os = "windows"))]
fn ssh_executable() -> Result<PathBuf, String> {
    let system_ssh = PathBuf::from("/usr/bin/ssh");
    if system_ssh.is_file() {
        return Ok(system_ssh);
    }
    let candidates = path_ssh_candidates(std::env::var_os("PATH").as_deref(), &["ssh"]);
    first_existing_executable(&candidates)
        .ok_or_else(|| "OpenSSH client was not found at /usr/bin/ssh or on PATH".to_string())
}

#[cfg(any(target_os = "windows", test))]
fn windows_ssh_candidates(system_root: Option<&Path>, path: Option<&OsStr>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = system_root {
        push_unique_path(
            &mut candidates,
            root.join("System32").join("OpenSSH").join("ssh.exe"),
        );
        // A 32-bit process reaches the native System32 directory through Sysnative.
        push_unique_path(
            &mut candidates,
            root.join("Sysnative").join("OpenSSH").join("ssh.exe"),
        );
    }
    for candidate in path_ssh_candidates(path, &["ssh.exe", "ssh"]) {
        push_unique_path(&mut candidates, candidate);
    }
    candidates
}

fn path_ssh_candidates(path: Option<&OsStr>, names: &[&str]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = path {
        for directory in std::env::split_paths(path) {
            for name in names {
                push_unique_path(&mut candidates, directory.join(name));
            }
        }
    }
    candidates
}

fn first_existing_executable(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.contains(&path) {
        paths.push(path);
    }
}

fn remote_claude_installer(remote_port: u16, target: &str) -> String {
    let command = format!(
        "HUMHUM_PORT={remote_port} HUMHUM_REMOTE_HOST='{target}' HUMHUM_TOKEN_FILE=\"$HOME/.humhum/remote-ingress-token\" \"$HOME/.humhum/hooks/humhum-hook.sh\" --client 'claude-code'"
    );
    format!(
        r#"import json, os
path = os.path.expanduser('~/.claude/settings.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    with open(path) as source: config = json.load(source)
except Exception:
    config = {{}}
hooks = config.setdefault('hooks', {{}})
command = {command:?}
for event in ['UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','SessionStart','SessionEnd']:
    entries = hooks.setdefault(event, [])
    managed = {{'matcher':'*','hooks':[{{'type':'command','command':command}}]}}
    entries = [entry for entry in entries if 'humhum-hook.sh' not in str(entry)]
    entries.append(managed)
    hooks[event] = entries
with open(path, 'w') as output: json.dump(config, output, indent=2)
os.chmod(path, 0o600)
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_targets_reject_options_and_shell_syntax() {
        assert_eq!(
            SshTarget::parse("dev@example.com").unwrap().as_str(),
            "dev@example.com"
        );
        assert_eq!(
            SshTarget::parse("build-host.local").unwrap().as_str(),
            "build-host.local"
        );
        for invalid in [
            "-oProxyCommand=bad",
            "host; rm -rf ~",
            "host name",
            "",
            "user@@host",
        ] {
            assert!(
                SshTarget::parse(invalid).is_err(),
                "accepted unsafe target: {invalid}"
            );
        }
    }

    #[test]
    fn reverse_tunnel_arguments_are_separate_and_loopback_only() {
        let target = SshTarget::parse("dev@example.com").unwrap();
        let args = reverse_tunnel_args(&target, 41_275, 31_275);

        assert_eq!(args.last().map(String::as_str), Some("dev@example.com"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-R", "127.0.0.1:41275:127.0.0.1:31275"]));
        assert!(args.windows(2).any(|pair| pair == ["-o", "BatchMode=yes"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "StrictHostKeyChecking=yes"]));
        assert!(!args.join(" ").contains("0.0.0.0"));
    }

    #[test]
    fn windows_ssh_candidates_prefer_system_openssh_then_path() {
        let system_root = PathBuf::from("C:/Windows");
        let path =
            std::env::join_paths([PathBuf::from("/tools"), PathBuf::from("/secondary")]).unwrap();

        let candidates = windows_ssh_candidates(Some(&system_root), Some(&path));

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from("C:/Windows/System32/OpenSSH/ssh.exe"))
        );
        assert!(candidates.contains(&PathBuf::from("/tools/ssh.exe")));
        assert!(candidates.contains(&PathBuf::from("/tools/ssh")));
        assert_eq!(
            candidates
                .iter()
                .filter(|path| path.ends_with("ssh.exe"))
                .count(),
            4
        );
    }

    #[test]
    fn executable_resolution_reports_only_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing-ssh.exe");
        let existing = temp.path().join("ssh.exe");
        std::fs::write(&existing, b"fixture").unwrap();

        assert_eq!(
            first_existing_executable(&[missing, existing.clone()]),
            Some(existing)
        );
    }

    #[test]
    fn ingress_credentials_authorize_events_only() {
        let auth = RemoteIngressAuth::new("remote-token");

        assert!(auth.authorizes("/event", Some("remote-token")));
        assert!(!auth.authorizes("/knowledge", Some("remote-token")));
        assert!(!auth.authorizes("/event", Some("wrong")));
    }

    #[test]
    fn remote_installer_preserves_home_expansion_and_managed_events() {
        let installer = remote_claude_installer(41_275, "dev@example.com");

        assert!(installer.contains("HUMHUM_REMOTE_HOST='dev@example.com'"));
        assert!(installer.contains("remote-ingress-token"));
        assert!(installer.contains("\\\"$HOME/.humhum/hooks/humhum-hook.sh\\\""));
        assert!(installer.contains("PermissionRequest"));
        assert!(installer.contains("humhum-hook.sh"));
        assert!(installer.contains("if 'humhum-hook.sh' not in str(entry)"));
        assert!(!installer.contains("if not any('humhum-hook.sh'"));
    }

    #[tokio::test]
    async fn disconnect_revokes_an_active_ingress_credential() {
        let state = RemoteBridgeState::default();
        *state.ingress.write().unwrap() = Some(RemoteIngressAuth::new("temporary"));
        assert!(state.authorizes_event("/event", Some("temporary")));

        state.disconnect().await.unwrap();

        assert!(!state.authorizes_event("/event", Some("temporary")));
    }

    #[tokio::test]
    async fn unsafe_target_fails_before_starting_a_connection() {
        let state = RemoteBridgeState::default();

        assert!(state.connect("host; touch /tmp/bad", 31_275).await.is_err());

        assert_eq!(state.status().await.status, "disconnected");
    }
}
