use serde_json::{json, Value};
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

type PendingSender = oneshot::Sender<Result<Value, JsonRpcTransportError>>;

#[derive(Debug)]
pub enum JsonRpcTransportError {
    Io(String),
    InvalidMessage(String),
    Rpc { code: i64, message: String },
    ProcessExited,
    Timeout { method: String },
}

impl fmt::Display for JsonRpcTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => write!(formatter, "Codex connection failed: {message}"),
            Self::InvalidMessage(message) => {
                write!(formatter, "Codex sent an invalid message: {message}")
            }
            Self::Rpc { code, message } => write!(formatter, "Codex error {code}: {message}"),
            Self::ProcessExited => write!(formatter, "Codex app-server stopped"),
            Self::Timeout { method } => write!(formatter, "Codex did not answer {method}"),
        }
    }
}

impl std::error::Error for JsonRpcTransportError {}

#[derive(Debug, Clone)]
pub enum IncomingMessage {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
}

struct TransportInner {
    writer: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, PendingSender>>,
    next_id: AtomicU64,
}

pub struct JsonRpcTransport {
    inner: Arc<TransportInner>,
    incoming: Mutex<mpsc::Receiver<IncomingMessage>>,
}

pub(crate) fn resolve_cli_binary(
    name: &str,
    preferred: impl IntoIterator<Item = PathBuf>,
) -> PathBuf {
    let mut candidates = Vec::new();
    for candidate in preferred {
        push_unique(&mut candidates, candidate);
    }

    #[cfg(target_os = "windows")]
    {
        let executable = format!("{name}.exe");
        let command_script = format!("{name}.cmd");
        let batch_script = format!("{name}.bat");

        if let Some(app_data) = std::env::var_os("APPDATA").map(PathBuf::from) {
            push_unique(&mut candidates, app_data.join("npm").join(&executable));
            push_unique(&mut candidates, app_data.join("npm").join(&command_script));
        }
        if let Some(data_dir) = dirs::data_dir() {
            push_unique(&mut candidates, data_dir.join("npm").join(&executable));
            push_unique(&mut candidates, data_dir.join("npm").join(&command_script));
        }

        extend_path_candidates(
            &mut candidates,
            [&executable, &command_script, &batch_script, name],
        );
    }

    #[cfg(not(target_os = "windows"))]
    extend_path_candidates(&mut candidates, [name]);

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from(name))
}

fn extend_path_candidates<'a>(
    candidates: &mut Vec<PathBuf>,
    names: impl IntoIterator<Item = &'a str>,
) {
    let names = names.into_iter().collect::<Vec<_>>();
    let Some(path) = std::env::var_os("PATH") else {
        return;
    };
    for directory in std::env::split_paths(&path) {
        for name in &names {
            push_unique(candidates, directory.join(name));
        }
    }
}

fn push_unique(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.contains(&candidate) {
        candidates.push(candidate);
    }
}

pub(crate) fn command_for_cli(binary: &Path) -> Command {
    #[cfg(target_os = "windows")]
    let mut command = if is_windows_command_script(binary) {
        command_for_npm_shim(binary).unwrap_or_else(|_| {
            let interpreter = std::env::var_os("COMSPEC")
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| OsString::from("cmd.exe"));
            let mut command = Command::new(interpreter);
            command.args(["/D", "/S", "/C"]).arg(binary);
            command
        })
    } else {
        Command::new(binary)
    };

    #[cfg(not(target_os = "windows"))]
    let command = Command::new(binary);

    #[cfg(target_os = "windows")]
    hide_windows_console(&mut command);

    command
}

#[cfg(any(target_os = "windows", test))]
fn is_windows_command_script(binary: &Path) -> bool {
    binary
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        })
}

/// Prepare a CLI process that will receive arguments containing user text.
///
/// Windows batch files are command language, not ordinary executables. Passing
/// an argument such as `prompt&calc` through `cmd.exe /C` can execute the text
/// after `&`. npm's generated shims are deliberately simple, so resolve those
/// shims to their Node.js entry point and bypass `cmd.exe` entirely. Unknown
/// batch formats fail closed rather than attempting to quote command language.
pub(crate) fn command_for_cli_with_untrusted_args(binary: &Path) -> Result<Command, String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = if is_windows_command_script(binary) {
            command_for_npm_shim(binary)?
        } else {
            let executable = resolve_windows_executable(binary).ok_or_else(|| {
                format!(
                    "Windows CLI executable could not be resolved safely: {}",
                    binary.display()
                )
            })?;
            Command::new(executable)
        };
        hide_windows_console(&mut command);
        return Ok(command);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(command_for_cli(binary))
    }
}

#[cfg(target_os = "windows")]
fn hide_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.as_std_mut().creation_flags(0x0800_0000);
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct NpmShimInvocation {
    program: PathBuf,
    prefix_args: Vec<PathBuf>,
}

#[cfg(any(target_os = "windows", test))]
impl NpmShimInvocation {
    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.prefix_args);
        command
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NpmShimReference<'a> {
    Node(&'a str),
    Native(&'a str),
}

#[cfg(any(target_os = "windows", test))]
fn command_for_npm_shim(binary: &Path) -> Result<Command, String> {
    let invocation = resolve_npm_shim(binary)?.ok_or_else(|| {
        format!(
            "Refusing to pass user text through unrecognized Windows command script {}",
            binary.display()
        )
    })?;
    Ok(invocation.command())
}

#[cfg(any(target_os = "windows", test))]
fn resolve_npm_shim(binary: &Path) -> Result<Option<NpmShimInvocation>, String> {
    if !is_windows_command_script(binary) {
        return Ok(None);
    }
    let metadata = std::fs::metadata(binary)
        .map_err(|error| format!("Could not inspect Windows CLI shim: {error}"))?;
    if !metadata.is_file() {
        return Err("Windows CLI shim is not a file".to_string());
    }
    if metadata.len() > 128 * 1024 {
        return Err("Windows CLI shim is unexpectedly large".to_string());
    }
    let source = std::fs::read_to_string(binary)
        .map_err(|error| format!("Could not read Windows CLI shim: {error}"))?;
    let Some(reference) = npm_shim_invocation_reference(&source) else {
        return Ok(None);
    };
    let parent = binary
        .parent()
        .ok_or_else(|| "Windows CLI shim has no parent directory".to_string())?;
    let invocation = match reference {
        NpmShimReference::Node(reference) => {
            let entrypoint = resolve_npm_target(parent, reference)?;
            let node = resolve_node_for_npm_shim(parent)?;
            NpmShimInvocation {
                program: node,
                prefix_args: vec![entrypoint],
            }
        }
        NpmShimReference::Native(reference) => {
            let executable = resolve_npm_target(parent, reference)?;
            let safe_extension = executable
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    extension.eq_ignore_ascii_case("exe") || extension.eq_ignore_ascii_case("com")
                });
            if !safe_extension {
                return Err("npm shim native target is not a Windows executable".to_string());
            }
            NpmShimInvocation {
                program: executable,
                prefix_args: Vec::new(),
            }
        }
    };
    Ok(Some(invocation))
}

#[cfg(any(target_os = "windows", test))]
fn npm_shim_invocation_reference(source: &str) -> Option<NpmShimReference<'_>> {
    source.lines().find_map(|line| {
        let line = line.trim();
        let command = line.strip_suffix("%*")?.trim_end();
        let quoted = quoted_fields(command);
        let target = *quoted.last()?;
        npm_shim_relative_reference(target)?;
        if quoted.len() == 1 {
            return Some(NpmShimReference::Native(target));
        }
        let program = quoted.get(quoted.len() - 2)?;
        is_npm_node_program(program).then_some(NpmShimReference::Node(target))
    })
}

#[cfg(any(target_os = "windows", test))]
fn quoted_fields(value: &str) -> Vec<&str> {
    let mut fields = Vec::new();
    let mut remainder = value;
    while let Some(start) = remainder.find('"') {
        remainder = &remainder[start + 1..];
        let Some(end) = remainder.find('"') else {
            break;
        };
        fields.push(&remainder[..end]);
        remainder = &remainder[end + 1..];
    }
    fields
}

#[cfg(any(target_os = "windows", test))]
fn is_npm_node_program(value: &str) -> bool {
    value.eq_ignore_ascii_case("%_prog%")
        || value.eq_ignore_ascii_case("node")
        || value.eq_ignore_ascii_case("node.exe")
        || npm_shim_relative_reference(value).is_some_and(|relative| {
            relative
                .replace('\\', "/")
                .trim_start_matches('/')
                .eq_ignore_ascii_case("node.exe")
        })
}

#[cfg(any(target_os = "windows", test))]
fn npm_shim_relative_reference(value: &str) -> Option<&str> {
    strip_prefix_ascii_case(value, "%dp0%").or_else(|| strip_prefix_ascii_case(value, "%~dp0"))
}

#[cfg(any(target_os = "windows", test))]
fn strip_prefix_ascii_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let head = value.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &value[prefix.len()..])
}

#[cfg(any(target_os = "windows", test))]
fn resolve_npm_target(parent: &Path, reference: &str) -> Result<PathBuf, String> {
    let relative = npm_shim_relative_reference(reference)
        .ok_or_else(|| "npm shim entry point is not relative to its own directory".to_string())?;
    if relative.is_empty()
        || relative.chars().any(|character| {
            matches!(
                character,
                '%' | '!' | '&' | '|' | '<' | '>' | '"' | '\r' | '\n'
            )
        })
    {
        return Err("npm shim entry point contains command language".to_string());
    }

    let mut entrypoint = parent.to_path_buf();
    let mut components = 0_usize;
    for component in relative.split(['\\', '/']) {
        match component {
            "" | "." => {}
            ".." => {
                if !entrypoint.pop() {
                    return Err("npm shim entry point escapes the filesystem root".to_string());
                }
            }
            value if value.contains(':') => {
                return Err("npm shim entry point contains an absolute path".to_string());
            }
            value => {
                entrypoint.push(value);
                components += 1;
            }
        }
    }
    if components == 0 {
        return Err("npm shim entry point is empty".to_string());
    }
    let entrypoint = entrypoint
        .canonicalize()
        .map_err(|error| format!("npm shim entry point is unavailable: {error}"))?;
    if !entrypoint.is_file() {
        return Err("npm shim entry point is not a file".to_string());
    }
    Ok(entrypoint)
}

#[cfg(any(target_os = "windows", test))]
fn resolve_node_for_npm_shim(shim_directory: &Path) -> Result<PathBuf, String> {
    let sibling = shim_directory.join("node.exe");
    if sibling.is_file() {
        return sibling
            .canonicalize()
            .map_err(|error| format!("Could not resolve npm shim Node.js executable: {error}"));
    }
    let mut candidates = Vec::new();
    extend_path_candidates(&mut candidates, ["node.exe"]);
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "Node.js executable was not found for npm CLI shim".to_string())?
        .canonicalize()
        .map_err(|error| format!("Could not resolve npm shim Node.js executable: {error}"))
}

#[cfg(target_os = "windows")]
fn resolve_windows_executable(binary: &Path) -> Option<PathBuf> {
    if binary.is_file() {
        return binary.canonicalize().ok();
    }
    if binary.components().count() != 1 {
        return None;
    }

    let mut names = vec![binary.to_path_buf()];
    if binary.extension().is_none() {
        let mut executable = binary.as_os_str().to_os_string();
        executable.push(".exe");
        names.push(PathBuf::from(executable));
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|directory| {
        names.iter().find_map(|name| {
            let candidate = directory.join(name);
            candidate
                .is_file()
                .then(|| candidate.canonicalize().ok())
                .flatten()
        })
    })
}

impl JsonRpcTransport {
    pub async fn spawn_codex() -> Result<Self, JsonRpcTransportError> {
        let binary = codex_binary();
        Self::spawn_command_path(&binary, &["app-server", "--listen", "stdio://"]).await
    }

    pub async fn spawn_command(
        program: &str,
        arguments: &[&str],
    ) -> Result<Self, JsonRpcTransportError> {
        Self::spawn_command_path(Path::new(program), arguments).await
    }

    async fn spawn_command_path(
        program: &Path,
        arguments: &[&str],
    ) -> Result<Self, JsonRpcTransportError> {
        let mut child =
            command_for_cli_with_untrusted_args(program).map_err(JsonRpcTransportError::Io)?;
        let mut child = child
            .args(arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| JsonRpcTransportError::Io(error.to_string()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| JsonRpcTransportError::Io("stdin is unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| JsonRpcTransportError::Io("stdout is unavailable".into()))?;
        let pending = Mutex::new(HashMap::new());
        let inner = Arc::new(TransportInner {
            writer: Mutex::new(stdin),
            child: Mutex::new(child),
            pending,
            next_id: AtomicU64::new(1),
        });
        let (incoming_tx, incoming_rx) = mpsc::channel(128);

        let reader_inner = inner.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Err(error) = route_line(&reader_inner, &incoming_tx, &line).await {
                            log::warn!("[CodexBridge] ignored app-server message: {error}");
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        log::warn!("[CodexBridge] app-server read failed: {error}");
                        break;
                    }
                }
            }

            reject_all_pending(&reader_inner).await;
        });

        Ok(Self {
            inner,
            incoming: Mutex::new(incoming_rx),
        })
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, JsonRpcTransportError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, sender);

        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(error) = write_message(&self.inner, &message).await {
            self.inner.pending.lock().await.remove(&id);
            return Err(error);
        }

        match tokio::time::timeout(std::time::Duration::from_secs(30), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(JsonRpcTransportError::ProcessExited),
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                Err(JsonRpcTransportError::Timeout {
                    method: method.to_string(),
                })
            }
        }
    }

    pub async fn respond(&self, id: Value, result: Value) -> Result<(), JsonRpcTransportError> {
        write_message(
            &self.inner,
            &json!({"jsonrpc": "2.0", "id": id, "result": result}),
        )
        .await
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), JsonRpcTransportError> {
        write_message(
            &self.inner,
            &json!({"jsonrpc": "2.0", "method": method, "params": params}),
        )
        .await
    }

    pub async fn next_incoming(&self) -> Option<IncomingMessage> {
        self.incoming.lock().await.recv().await
    }

    pub async fn shutdown(&self) -> Result<(), JsonRpcTransportError> {
        self.inner
            .child
            .lock()
            .await
            .kill()
            .await
            .map_err(|error| JsonRpcTransportError::Io(error.to_string()))
    }
}

pub(crate) fn codex_binary() -> PathBuf {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".codex/bin/codex"));
        #[cfg(target_os = "windows")]
        {
            candidates.push(home.join(".codex/bin/codex.exe"));
            candidates.push(home.join(".codex/bin/codex.cmd"));
        }
    }
    resolve_cli_binary("codex", candidates)
}

async fn write_message(
    inner: &Arc<TransportInner>,
    message: &Value,
) -> Result<(), JsonRpcTransportError> {
    let mut bytes = serde_json::to_vec(message)
        .map_err(|error| JsonRpcTransportError::InvalidMessage(error.to_string()))?;
    bytes.push(b'\n');
    let mut writer = inner.writer.lock().await;
    writer
        .write_all(&bytes)
        .await
        .map_err(|error| JsonRpcTransportError::Io(error.to_string()))?;
    writer
        .flush()
        .await
        .map_err(|error| JsonRpcTransportError::Io(error.to_string()))
}

async fn route_line(
    inner: &Arc<TransportInner>,
    incoming: &mpsc::Sender<IncomingMessage>,
    line: &str,
) -> Result<(), JsonRpcTransportError> {
    let message: Value = serde_json::from_str(line)
        .map_err(|error| JsonRpcTransportError::InvalidMessage(error.to_string()))?;

    if let Some(method) = message.get("method").and_then(Value::as_str) {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let incoming_message = match message.get("id") {
            Some(id) => IncomingMessage::Request {
                id: id.clone(),
                method: method.to_string(),
                params,
            },
            None => IncomingMessage::Notification {
                method: method.to_string(),
                params,
            },
        };
        incoming
            .send(incoming_message)
            .await
            .map_err(|_| JsonRpcTransportError::ProcessExited)?;
        return Ok(());
    }

    let id = message.get("id").and_then(Value::as_u64).ok_or_else(|| {
        JsonRpcTransportError::InvalidMessage("response has no numeric id".into())
    })?;
    let Some(sender) = inner.pending.lock().await.remove(&id) else {
        return Ok(());
    };

    let result = if let Some(error) = message.get("error") {
        Err(JsonRpcTransportError::Rpc {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(-1),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Unknown Codex error")
                .to_string(),
        })
    } else {
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    };
    let _ = sender.send(result);
    Ok(())
}

async fn reject_all_pending(inner: &Arc<TransportInner>) {
    let pending = std::mem::take(&mut *inner.pending.lock().await);
    for (_, sender) in pending {
        let _ = sender.send(Err(JsonRpcTransportError::ProcessExited));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn npm_shim_bypasses_cmd_for_untrusted_metacharacter_arguments() {
        let temp = tempfile::tempdir().unwrap();
        let shim = temp.path().join("agent.cmd");
        let node = temp.path().join("node.exe");
        let entrypoint = temp.path().join("node_modules/agent/cli.js");
        std::fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();
        std::fs::write(&node, []).unwrap();
        std::fs::write(&entrypoint, "// fixture\n").unwrap();
        std::fs::write(
            &shim,
            r#"@ECHO off
SETLOCAL
SET "_prog=node"
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\node_modules\agent\cli.js" %*
"#,
        )
        .unwrap();

        let invocation = resolve_npm_shim(&shim).unwrap().unwrap();
        assert_eq!(invocation.program, node.canonicalize().unwrap());
        assert_eq!(
            invocation.prefix_args,
            vec![entrypoint.canonicalize().unwrap()]
        );

        let mut command = invocation.command();
        command.args(["--", "&calc", "&echo"]);
        let command = command.as_std();
        assert_eq!(command.get_program(), node.canonicalize().unwrap());
        assert_eq!(
            command
                .get_args()
                .map(|argument| argument.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
            vec![
                entrypoint.canonicalize().unwrap().to_string_lossy(),
                "--".into(),
                "&calc".into(),
                "&echo".into(),
            ]
        );

        #[cfg(target_os = "windows")]
        {
            let mut strict = command_for_cli_with_untrusted_args(&shim).unwrap();
            strict.args(["--", "&calc", "&echo"]);
            let strict = strict.as_std();
            assert_eq!(strict.get_program(), node.canonicalize().unwrap());
            assert!(strict
                .get_args()
                .any(|argument| argument == std::ffi::OsStr::new("&calc")));
            assert!(strict
                .get_args()
                .any(|argument| argument == std::ffi::OsStr::new("&echo")));
        }
    }

    #[test]
    fn npm_native_shim_bypasses_cmd_for_untrusted_arguments() {
        let temp = tempfile::tempdir().unwrap();
        let shim = temp.path().join("agent.cmd");
        let executable = temp.path().join("node_modules/agent/bin/agent.exe");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, []).unwrap();
        std::fs::write(
            &shim,
            r#"@ECHO off
GOTO start
:start
"%dp0%\node_modules\agent\bin\agent.exe" %*
"#,
        )
        .unwrap();

        let invocation = resolve_npm_shim(&shim).unwrap().unwrap();
        assert_eq!(invocation.program, executable.canonicalize().unwrap());
        assert!(invocation.prefix_args.is_empty());

        let mut command = invocation.command();
        command.args(["&calc", "&echo"]);
        let command = command.as_std();
        assert_eq!(command.get_program(), executable.canonicalize().unwrap());
        assert_eq!(
            command
                .get_args()
                .map(|argument| argument.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
            ["&calc", "&echo"]
        );
    }

    #[test]
    fn unrecognized_batch_is_rejected_for_untrusted_arguments() {
        let temp = tempfile::tempdir().unwrap();
        let shim = temp.path().join("agent.bat");
        std::fs::write(&shim, "@echo off\r\nagent.exe %*\r\n").unwrap();

        assert!(resolve_npm_shim(&shim).unwrap().is_none());
        let error = command_for_npm_shim(&shim).unwrap_err();
        assert!(error.contains("Refusing to pass user text"));
    }

    #[test]
    fn npm_shim_entrypoint_cannot_contain_command_language() {
        let temp = tempfile::tempdir().unwrap();
        let shim = temp.path().join("agent.cmd");
        std::fs::write(
            &shim,
            r#"@echo off
"%_prog%" "%dp0%\node_modules\agent\cli.js&calc" %*
"#,
        )
        .unwrap();

        let error = resolve_npm_shim(&shim).unwrap_err();
        assert!(error.contains("command language"));
    }

    #[derive(Clone, Copy)]
    enum FakeScenario {
        OutOfOrder,
        Approval,
        ExitAfterRead,
        Notification,
    }

    #[cfg(unix)]
    async fn fake_transport(scenario: FakeScenario) -> JsonRpcTransport {
        let script = match scenario {
            FakeScenario::OutOfOrder => {
                r#"read first
read second
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"method":"two"}}'
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"method":"one"}}'"#
            }
            FakeScenario::Approval => {
                r#"printf '%s\n' '{"jsonrpc":"2.0","id":61,"method":"item/commandExecution/requestApproval","params":{"itemId":"item-1"}}'"#
            }
            FakeScenario::ExitAfterRead => "read request; exit 0",
            FakeScenario::Notification => {
                r#"read notification
case "$notification" in
  *'"method":"initialized"'*)
    printf '%s\n' '{"method":"test/observed","params":{"ok":true}}'
    ;;
esac"#
            }
        };
        JsonRpcTransport::spawn_command("/bin/sh", &["-c", script])
            .await
            .unwrap()
    }

    #[cfg(target_os = "windows")]
    async fn fake_transport(scenario: FakeScenario) -> JsonRpcTransport {
        let script = match scenario {
            FakeScenario::OutOfOrder => {
                r#"set /p first= & set /p second= & echo {"jsonrpc":"2.0","id":2,"result":{"method":"two"}} & echo {"jsonrpc":"2.0","id":1,"result":{"method":"one"}}"#
            }
            FakeScenario::Approval => {
                r#"echo {"jsonrpc":"2.0","id":61,"method":"item/commandExecution/requestApproval","params":{"itemId":"item-1"}}"#
            }
            FakeScenario::ExitAfterRead => "set /p request= & exit /b 0",
            FakeScenario::Notification => {
                r#"set /p notification= & echo {"method":"test/observed","params":{"ok":true}}"#
            }
        };
        JsonRpcTransport::spawn_command("cmd.exe", &["/D", "/S", "/C", script])
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn correlates_out_of_order_responses() {
        let transport = fake_transport(FakeScenario::OutOfOrder).await;

        let first = transport.request("one", json!({}));
        let second = transport.request("two", json!({}));
        let (a, b) = tokio::join!(first, second);
        assert_eq!(a.unwrap()["method"], "one");
        assert_eq!(b.unwrap()["method"], "two");
    }

    #[tokio::test]
    async fn forwards_server_requests_for_approval() {
        let transport = fake_transport(FakeScenario::Approval).await;

        let incoming = transport.next_incoming().await.unwrap();
        assert!(matches!(
            incoming,
            IncomingMessage::Request { method, .. }
                if method == "item/commandExecution/requestApproval"
        ));
    }

    #[tokio::test]
    async fn rejects_pending_requests_when_process_exits() {
        let transport = fake_transport(FakeScenario::ExitAfterRead).await;
        let error = transport.request("never", json!({})).await.unwrap_err();
        assert!(matches!(error, JsonRpcTransportError::ProcessExited));
    }

    #[tokio::test]
    async fn sends_notifications_without_waiting_for_a_response() {
        let transport = fake_transport(FakeScenario::Notification).await;
        transport.notify("initialized", json!({})).await.unwrap();
        let incoming = transport.next_incoming().await.unwrap();
        assert!(matches!(
            incoming,
            IncomingMessage::Notification { method, params }
                if method == "test/observed" && params["ok"] == true
        ));
    }
}
