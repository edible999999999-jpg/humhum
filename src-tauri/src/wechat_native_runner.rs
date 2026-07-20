use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

pub(crate) const MAX_STDOUT_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 16 * 1024;
const MAX_REQUEST_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WechatReaderAction {
    Status,
    Sessions,
    Timeline,
}

impl WechatReaderAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Sessions => "sessions",
            Self::Timeline => "timeline",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WechatReaderRequest {
    version: u8,
    action: WechatReaderAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    types: Option<[String; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    talker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    after: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include_media_paths: Option<bool>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    keys: BTreeMap<String, String>,
}

impl WechatReaderRequest {
    pub(crate) fn status(keys: BTreeMap<String, String>) -> Self {
        Self {
            version: 1,
            action: WechatReaderAction::Status,
            types: None,
            limit: None,
            talker: None,
            after: None,
            include_media_paths: None,
            keys,
        }
    }

    pub(crate) fn sessions(keys: BTreeMap<String, String>) -> Self {
        Self {
            version: 1,
            action: WechatReaderAction::Sessions,
            types: Some(["private".to_string(), "group".to_string()]),
            limit: Some(100),
            talker: None,
            after: None,
            include_media_paths: None,
            keys,
        }
    }

    pub(crate) fn timeline(
        talker: String,
        after: i64,
        keys: BTreeMap<String, String>,
    ) -> Result<Self, WechatReaderError> {
        if talker.trim() != talker
            || talker.is_empty()
            || talker.starts_with('-')
            || talker.len() > 512
            || after < 0
        {
            return Err(WechatReaderError::new(
                "invalid_request",
                "微信会话请求无效",
            ));
        }
        Ok(Self {
            version: 1,
            action: WechatReaderAction::Timeline,
            types: None,
            limit: Some(100),
            talker: Some(talker),
            after: Some(after),
            include_media_paths: Some(false),
            keys,
        })
    }

    #[cfg(test)]
    fn argument_count(&self) -> usize {
        0
    }

    #[cfg(test)]
    pub(crate) fn action_name(&self) -> &'static str {
        self.action.as_str()
    }

    #[cfg(test)]
    pub(crate) fn talker(&self) -> Option<&str> {
        self.talker.as_deref()
    }
}

impl fmt::Debug for WechatReaderRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WechatReaderRequest")
            .field("version", &self.version)
            .field("action", &self.action.as_str())
            .field("talker_present", &self.talker.is_some())
            .field("after", &self.after)
            .field("key_count", &self.keys.len())
            .finish()
    }
}

#[derive(Debug, Clone)]
pub(crate) struct WechatCommandOutput {
    pub(crate) stdout: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WechatReaderError {
    code: String,
    message: String,
}

impl WechatReaderError {
    pub(crate) fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    #[cfg(test)]
    pub(crate) fn code(&self) -> &str {
        &self.code
    }
}

impl fmt::Display for WechatReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for WechatReaderError {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeManifest {
    format_version: u8,
    reader: ManifestFile,
    wcdb: ManifestFile,
}

#[derive(Deserialize)]
struct ManifestFile {
    #[allow(dead_code)]
    file: String,
    sha256: String,
}

#[derive(Deserialize)]
struct ReaderEnvelope {
    ok: bool,
    version: u8,
    action: String,
    #[serde(default)]
    error: Option<ReaderFailure>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReaderFailure {
    code: String,
    message: String,
    #[serde(default)]
    next_action: String,
}

pub(crate) struct WechatNativeRunner {
    executable_path: PathBuf,
    wcdb_path: PathBuf,
    manifest_path: PathBuf,
}

impl WechatNativeRunner {
    pub(crate) fn new(
        executable_path: PathBuf,
        wcdb_path: PathBuf,
        manifest_path: PathBuf,
    ) -> Self {
        Self {
            executable_path,
            wcdb_path,
            manifest_path,
        }
    }

    pub(crate) async fn run(
        &self,
        request: &WechatReaderRequest,
        timeout: Duration,
    ) -> Result<WechatCommandOutput, WechatReaderError> {
        self.verify_identity()?;
        let request_json = serde_json::to_vec(request)
            .map_err(|_| WechatReaderError::new("invalid_request", "无法准备微信读取请求"))?;
        if request_json.len() > MAX_REQUEST_BYTES {
            return Err(WechatReaderError::new(
                "invalid_request",
                "微信读取请求超过安全上限",
            ));
        }

        let mut command = Command::new(&self.executable_path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_environment(&mut command);
        let mut child = command
            .spawn()
            .map_err(|_| WechatReaderError::new("reader_not_bundled", "无法启动内置微信读取器"))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| WechatReaderError::new("reader_failed", "无法打开微信读取输入"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| WechatReaderError::new("reader_failed", "无法打开微信读取输出"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| WechatReaderError::new("reader_failed", "无法打开微信读取错误通道"))?;

        let operation = async {
            stdin
                .write_all(&request_json)
                .await
                .map_err(|_| WechatReaderError::new("reader_failed", "无法发送微信读取请求"))?;
            stdin
                .shutdown()
                .await
                .map_err(|_| WechatReaderError::new("reader_failed", "无法关闭微信读取输入"))?;
            drop(stdin);
            let stdout_future = read_bounded(stdout, MAX_STDOUT_BYTES, "微信读取输出");
            let stderr_future = read_bounded(stderr, MAX_STDERR_BYTES, "微信读取错误输出");
            let wait_future = async {
                child
                    .wait()
                    .await
                    .map_err(|_| WechatReaderError::new("reader_failed", "微信读取进程异常退出"))
            };
            let (stdout, stderr, status) =
                tokio::try_join!(stdout_future, stderr_future, wait_future)?;
            Ok::<_, WechatReaderError>((stdout, stderr, status))
        };

        let (stdout, stderr, status) = match tokio::time::timeout(timeout, operation).await {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                let _ = child.kill().await;
                return Err(error);
            }
            Err(_) => {
                let _ = child.kill().await;
                return Err(WechatReaderError::new("query_timeout", "微信本地读取超时"));
            }
        };
        if stdout.len() > MAX_STDOUT_BYTES || stderr.len() > MAX_STDERR_BYTES {
            return Err(WechatReaderError::new(
                "malformed_reader_output",
                "微信读取输出超过安全上限",
            ));
        }
        let stdout = String::from_utf8(stdout).map_err(|_| {
            WechatReaderError::new("malformed_reader_output", "微信读取输出不是 UTF-8")
        })?;
        let envelope: ReaderEnvelope = serde_json::from_str(stdout.trim()).map_err(|_| {
            WechatReaderError::new("malformed_reader_output", "微信读取响应格式无效")
        })?;
        if envelope.version != 1 || envelope.action != request.action.as_str() {
            return Err(WechatReaderError::new(
                "malformed_reader_output",
                "微信读取响应版本或动作不匹配",
            ));
        }
        if !status.success() || !envelope.ok {
            let failure = envelope.error.unwrap_or(ReaderFailure {
                code: "reader_failed".to_string(),
                message: "微信本地读取失败".to_string(),
                next_action: String::new(),
            });
            let message = if failure.next_action.is_empty() {
                failure.message
            } else {
                format!("{} {}", failure.message, failure.next_action)
            };
            return Err(WechatReaderError::new(
                safe_error_code(&failure.code),
                message,
            ));
        }
        Ok(WechatCommandOutput {
            stdout: stdout.trim().to_string(),
        })
    }

    fn verify_identity(&self) -> Result<(), WechatReaderError> {
        require_regular_file(&self.executable_path)?;
        require_regular_file(&self.wcdb_path)?;
        require_regular_file(&self.manifest_path)?;
        let manifest_bytes = std::fs::read(&self.manifest_path).map_err(|_| {
            WechatReaderError::new("reader_identity_invalid", "无法读取微信读取器完整性清单")
        })?;
        let manifest: NativeManifest = serde_json::from_slice(&manifest_bytes).map_err(|_| {
            WechatReaderError::new("reader_identity_invalid", "微信读取器完整性清单无效")
        })?;
        if manifest.format_version != 1
            || file_sha256(&self.executable_path)? != manifest.reader.sha256
            || file_sha256(&self.wcdb_path)? != manifest.wcdb.sha256
        {
            return Err(WechatReaderError::new(
                "reader_identity_invalid",
                "微信读取器完整性校验失败",
            ));
        }
        Ok(())
    }
}

fn configure_environment(command: &mut Command) {
    let home = std::env::var_os("HOME");
    let tmpdir = std::env::var_os("TMPDIR");
    command.env_clear();
    command.env("LANG", "C.UTF-8");
    command.env("LC_ALL", "C.UTF-8");
    if let Some(home) = home {
        command.env("HOME", home);
    }
    if let Some(tmpdir) = tmpdir {
        command.env("TMPDIR", tmpdir);
    }
}

async fn read_bounded(
    mut reader: impl AsyncRead + Unpin,
    maximum: usize,
    label: &str,
) -> Result<Vec<u8>, WechatReaderError> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|_| WechatReaderError::new("reader_failed", format!("无法读取{label}")))?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len().saturating_add(count) > maximum {
            return Err(WechatReaderError::new(
                "malformed_reader_output",
                format!("{label}超过安全上限"),
            ));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}

fn require_regular_file(path: &Path) -> Result<(), WechatReaderError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| {
        WechatReaderError::new("reader_not_bundled", "当前构建未包含完整的微信读取器")
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(WechatReaderError::new(
            "reader_identity_invalid",
            "微信读取器文件类型无效",
        ));
    }
    Ok(())
}

fn file_sha256(path: &Path) -> Result<String, WechatReaderError> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)
        .map_err(|_| WechatReaderError::new("reader_identity_invalid", "无法校验微信读取器"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| WechatReaderError::new("reader_identity_invalid", "无法校验微信读取器"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn safe_error_code(code: &str) -> &str {
    match code {
        "full_disk_access_required"
        | "wechat_not_running"
        | "wechat_not_logged_in"
        | "unsupported_wechat_build"
        | "key_coverage_incomplete"
        | "key_validation_failed"
        | "wcdb_unavailable"
        | "schema_unsupported"
        | "query_timeout" => code,
        _ => "reader_failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::time::Duration;
    use tempfile::TempDir;

    const TEST_PROCESS_TIMEOUT: Duration = Duration::from_secs(10);

    #[test]
    fn request_serialization_keeps_keys_out_of_debug_and_arguments() {
        let mut keys = BTreeMap::new();
        keys.insert(
            "00112233445566778899aabbccddeeff".to_string(),
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff".to_string(),
        );
        let request = WechatReaderRequest::sessions(keys);
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("00112233445566778899aabbccddeeff"));
        assert!(!format!("{request:?}")
            .contains("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"));
        assert_eq!(request.argument_count(), 0);
    }

    #[tokio::test]
    async fn native_runner_sends_request_only_on_stdin_and_clears_environment() {
        let harness = NativeHarness::new(
            r#"{"ok":true,"version":1,"action":"status","data":{"status":{"liveReadOk":false}}}"#,
        );
        let runner = harness.runner();
        let secret = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
        let mut keys = BTreeMap::new();
        keys.insert(
            "00112233445566778899aabbccddeeff".to_string(),
            secret.to_string(),
        );
        std::env::set_var("HUMHUM_PARENT_SECRET", "must-not-reach-reader");
        let result = runner
            .run(&WechatReaderRequest::status(keys), TEST_PROCESS_TIMEOUT)
            .await
            .unwrap();
        std::env::remove_var("HUMHUM_PARENT_SECRET");

        assert!(result.stdout.contains("\"action\":\"status\""));
        let capture = std::fs::read_to_string(harness.capture_path()).unwrap();
        assert!(capture.contains(secret));
        assert!(!capture.contains("must-not-reach-reader"));
        assert!(!capture.contains("HUMHUM_PARENT_SECRET"));
    }

    #[tokio::test]
    async fn native_runner_rejects_tampered_identity_and_oversized_output() {
        let tampered = NativeHarness::new(r#"{"ok":true,"version":1,"action":"status","data":{}}"#);
        std::fs::write(tampered.executable_path(), "#!/bin/sh\nexit 0\n").unwrap();
        let error = tampered
            .runner()
            .run(
                &WechatReaderRequest::status(BTreeMap::new()),
                TEST_PROCESS_TIMEOUT,
            )
            .await
            .unwrap_err();
        assert_eq!(error.code(), "reader_identity_invalid");

        let oversized = NativeHarness::new(&"x".repeat(MAX_STDOUT_BYTES + 1));
        let error = oversized
            .runner()
            .run(
                &WechatReaderRequest::status(BTreeMap::new()),
                TEST_PROCESS_TIMEOUT,
            )
            .await
            .unwrap_err();
        assert_eq!(error.code(), "malformed_reader_output");
    }

    struct NativeHarness {
        directory: TempDir,
    }

    impl NativeHarness {
        fn new(stdout: &str) -> Self {
            let directory = tempfile::tempdir().unwrap();
            let executable = directory.path().join("humhum-wechat-reader");
            let capture = directory.path().join("capture.txt");
            let script = format!(
                "#!/bin/sh\n/usr/bin/env > '{}'\n/bin/cat >> '{}'\n/usr/bin/printf '%s\\n' '{}'\n",
                capture.display(),
                capture.display(),
                shell_single_quote(stdout),
            );
            std::fs::write(&executable, script).unwrap();
            let mut permissions = std::fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o700);
            std::fs::set_permissions(&executable, permissions).unwrap();
            let wcdb = directory.path().join("libWCDB.dylib");
            std::fs::write(&wcdb, b"fixture-wcdb").unwrap();
            let manifest = serde_json::json!({
                "formatVersion": 1,
                "reader": {
                    "file": "humhum-wechat-reader",
                    "sha256": file_sha256(&executable),
                },
                "wcdb": {
                    "file": "libWCDB.dylib",
                    "sha256": file_sha256(&wcdb),
                }
            });
            std::fs::write(
                directory.path().join("native-manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
            Self { directory }
        }

        fn runner(&self) -> WechatNativeRunner {
            WechatNativeRunner::new(
                self.executable_path(),
                self.directory.path().join("libWCDB.dylib"),
                self.directory.path().join("native-manifest.json"),
            )
        }

        fn executable_path(&self) -> std::path::PathBuf {
            self.directory.path().join("humhum-wechat-reader")
        }

        fn capture_path(&self) -> std::path::PathBuf {
            self.directory.path().join("capture.txt")
        }
    }

    fn shell_single_quote(value: &str) -> String {
        value.replace('\'', "'\"'\"'")
    }

    fn file_sha256(path: &Path) -> String {
        let bytes = std::fs::read(path).unwrap();
        hex::encode(Sha256::digest(bytes))
    }
}
