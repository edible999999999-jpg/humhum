use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;

use crate::hush_store::HushStore;
use crate::wechat_native_runner::{WechatCommandOutput, WechatNativeRunner, WechatReaderRequest};

const INITIAL_SYNC_HOURS: i64 = 24;
const INCREMENTAL_OVERLAP_MINUTES: i64 = 2;
const SYNC_INTERVAL_MINUTES: u64 = 5;
const SESSION_LIMIT: usize = 100;
const WECHAT_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);

struct WechatNativeRuntime {
    executable: PathBuf,
    wcdb: PathBuf,
    manifest: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WechatExecutable {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WechatHushConfig {
    pub auto_sync_enabled: bool,
    pub sync_interval_minutes: u64,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
}

impl Default for WechatHushConfig {
    fn default() -> Self {
        Self {
            auto_sync_enabled: false,
            sync_interval_minutes: SYNC_INTERVAL_MINUTES,
            last_success_at: None,
            last_attempt_at: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WechatHushState {
    NotInstalled,
    SetupRequired,
    Ready,
    Syncing,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct WechatHushStatus {
    pub state: WechatHushState,
    pub message: String,
    pub executable_path: Option<String>,
    pub readiness: Option<String>,
    pub live_read_ok: bool,
    pub blocked_by: Option<String>,
    pub next_action: Option<String>,
    pub warnings: Vec<String>,
    pub auto_sync_enabled: bool,
    pub sync_interval_minutes: u64,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub syncing: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WechatSyncReport {
    pub conversations: usize,
    pub examined_messages: usize,
    pub imported_messages: usize,
    pub duplicate_messages: usize,
    pub skipped_sent_messages: usize,
    pub failed_conversations: usize,
    pub partial: bool,
    pub warnings: Vec<String>,
}

trait WechatRunner: Send + Sync {
    fn run<'a>(
        &'a self,
        request: &'a WechatReaderRequest,
        timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<WechatCommandOutput, String>> + Send + 'a>>;
}

impl WechatRunner for WechatNativeRunner {
    fn run<'a>(
        &'a self,
        request: &'a WechatReaderRequest,
        timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<WechatCommandOutput, String>> + Send + 'a>> {
        Box::pin(async move {
            WechatNativeRunner::run(self, request, timeout)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

struct MissingWechatRunner;

impl WechatRunner for MissingWechatRunner {
    fn run<'a>(
        &'a self,
        _request: &'a WechatReaderRequest,
        _timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<WechatCommandOutput, String>> + Send + 'a>> {
        Box::pin(async {
            Err("reader_not_bundled: 当前构建未包含完整的微信读取器".to_string())
        })
    }
}

pub struct WechatHushBridge {
    config_path: PathBuf,
    config: AsyncMutex<WechatHushConfig>,
    last_error: AsyncMutex<Option<String>>,
    syncing: AtomicBool,
    status_checking: AtomicBool,
    last_readiness: AsyncMutex<Option<Result<WechatReadiness, String>>>,
    runner: Arc<dyn WechatRunner>,
    fixed_executable: Option<WechatExecutable>,
    fixed_now: Option<chrono::DateTime<chrono::Utc>>,
}

impl WechatHushBridge {
    pub fn load_or_create(home: &Path) -> Result<Self, String> {
        let (runner, executable) = match discover_native_reader() {
            Some(runtime) => {
                let executable = WechatExecutable {
                    path: runtime.executable.clone(),
                };
                (
                    Arc::new(WechatNativeRunner::new(
                        runtime.executable,
                        runtime.wcdb,
                        runtime.manifest,
                    )) as Arc<dyn WechatRunner>,
                    Some(executable),
                )
            }
            None => (Arc::new(MissingWechatRunner) as Arc<dyn WechatRunner>, None),
        };
        Self::from_parts(
            home.to_path_buf(),
            home.join(".humhum").join("hush-wechat.json"),
            runner,
            executable,
            None,
        )
    }

    fn from_parts(
        _home_dir: PathBuf,
        config_path: PathBuf,
        runner: Arc<dyn WechatRunner>,
        fixed_executable: Option<WechatExecutable>,
        fixed_now: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Self, String> {
        let config = if config_path.is_file() {
            let contents = std::fs::read_to_string(&config_path)
                .map_err(|error| format!("无法读取微信同步设置：{error}"))?;
            serde_json::from_str(&contents)
                .map_err(|error| format!("无法解析微信同步设置：{error}"))?
        } else {
            WechatHushConfig::default()
        };
        Ok(Self {
            config_path,
            config: AsyncMutex::new(config),
            last_error: AsyncMutex::new(None),
            syncing: AtomicBool::new(false),
            status_checking: AtomicBool::new(false),
            last_readiness: AsyncMutex::new(None),
            runner,
            fixed_executable,
            fixed_now,
        })
    }

    #[cfg(test)]
    fn with_test_parts(
        config_dir: &Path,
        executable: WechatExecutable,
        runner: Arc<dyn WechatRunner>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<Self, String> {
        Self::from_parts(
            config_dir.to_path_buf(),
            config_dir.join("hush-wechat.json"),
            runner,
            Some(executable),
            Some(now),
        )
    }

    pub async fn status(&self) -> WechatHushStatus {
        let config = self.config_snapshot().await;
        let executable = self.resolve_executable();
        let syncing = self.is_syncing();
        if executable.is_none() {
            return WechatHushStatus {
                state: WechatHushState::NotInstalled,
                message: "当前版本未包含完整的微信本地读取组件".to_string(),
                executable_path: None,
                readiness: None,
                live_read_ok: false,
                blocked_by: None,
                next_action: Some("请安装包含原生微信读取器的 HUMHUM 正式版本".to_string()),
                warnings: Vec::new(),
                auto_sync_enabled: config.auto_sync_enabled,
                sync_interval_minutes: config.sync_interval_minutes,
                last_success_at: config.last_success_at,
                last_attempt_at: config.last_attempt_at,
                syncing,
            };
        }
        let executable = executable.expect("checked above");
        if syncing {
            return self.status_from_readiness(
                &config,
                &executable,
                WechatReadiness {
                    readiness: "ready".to_string(),
                    live_read_ok: true,
                    blocked_by: None,
                    next_action: None,
                    warnings: Vec::new(),
                },
                Some(WechatHushState::Syncing),
                "正在从本机微信读取新消息".to_string(),
            );
        }
        if self
            .status_checking
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            if let Some(result) = self.last_readiness.lock().await.clone() {
                return self.status_from_probe_result(&config, &executable, result);
            }
            return WechatHushStatus {
                state: WechatHushState::SetupRequired,
                message: "正在检查微信本地读取能力".to_string(),
                executable_path: Some(executable.path.to_string_lossy().to_string()),
                readiness: None,
                live_read_ok: false,
                blocked_by: None,
                next_action: None,
                warnings: Vec::new(),
                auto_sync_enabled: config.auto_sync_enabled,
                sync_interval_minutes: config.sync_interval_minutes,
                last_success_at: config.last_success_at,
                last_attempt_at: config.last_attempt_at,
                syncing: false,
            };
        }
        let _status_guard = WechatStatusFlagGuard(&self.status_checking);
        let result = self.check_readiness().await;
        *self.last_readiness.lock().await = Some(result.clone());
        self.status_from_probe_result(&config, &executable, result)
    }

    fn status_from_probe_result(
        &self,
        config: &WechatHushConfig,
        executable: &WechatExecutable,
        result: Result<WechatReadiness, String>,
    ) -> WechatHushStatus {
        match result {
            Ok(readiness) => {
                let state = if readiness.live_read_ok {
                    WechatHushState::Ready
                } else {
                    WechatHushState::SetupRequired
                };
                let message = if readiness.live_read_ok {
                    "微信真实消息读取已就绪".to_string()
                } else {
                    "微信本地读取需要完成一次准备".to_string()
                };
                self.status_from_readiness(&config, &executable, readiness, Some(state), message)
            }
            Err(error) => WechatHushStatus {
                state: WechatHushState::Error,
                message: error,
                executable_path: Some(executable.path.to_string_lossy().to_string()),
                readiness: None,
                live_read_ok: false,
                blocked_by: None,
                next_action: None,
                warnings: Vec::new(),
                auto_sync_enabled: config.auto_sync_enabled,
                sync_interval_minutes: config.sync_interval_minutes,
                last_success_at: config.last_success_at.clone(),
                last_attempt_at: config.last_attempt_at.clone(),
                syncing: self.is_syncing(),
            },
        }
    }

    fn status_from_readiness(
        &self,
        config: &WechatHushConfig,
        executable: &WechatExecutable,
        mut readiness: WechatReadiness,
        state: Option<WechatHushState>,
        message: String,
    ) -> WechatHushStatus {
        readiness.next_action = user_facing_next_action(
            readiness.blocked_by.as_deref(),
            readiness.next_action.as_deref(),
        );
        WechatHushStatus {
            state: state.unwrap_or(WechatHushState::Error),
            message,
            executable_path: Some(executable.path.to_string_lossy().to_string()),
            readiness: Some(readiness.readiness),
            live_read_ok: readiness.live_read_ok,
            blocked_by: readiness.blocked_by,
            next_action: readiness.next_action,
            warnings: readiness.warnings,
            auto_sync_enabled: config.auto_sync_enabled,
            sync_interval_minutes: config.sync_interval_minutes,
            last_success_at: config.last_success_at.clone(),
            last_attempt_at: config.last_attempt_at.clone(),
            syncing: self.is_syncing(),
        }
    }

    pub async fn sync(
        &self,
        hush_store: Arc<Mutex<HushStore>>,
    ) -> Result<WechatSyncReport, String> {
        if self
            .syncing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("微信消息同步正在进行中".to_string());
        }
        let _sync_guard = WechatSyncFlagGuard(&self.syncing);
        let result = self.sync_inner(hush_store).await;
        *self.last_error.lock().await = result.as_ref().err().cloned();
        result
    }

    async fn sync_inner(
        &self,
        hush_store: Arc<Mutex<HushStore>>,
    ) -> Result<WechatSyncReport, String> {
        let now = self.now();
        {
            let mut config = self.config.lock().await;
            config.last_attempt_at = Some(now.to_rfc3339());
            write_config(&self.config_path, &config)?;
        }
        if self.resolve_executable().is_none() {
            return Err("当前版本未包含完整的微信本地读取组件".to_string());
        }
        let readiness = self.check_readiness().await?;
        if !readiness.live_read_ok {
            return Err(readiness
                .next_action
                .unwrap_or_else(|| "请先完成微信本地读取准备".to_string()));
        }
        let start_at = self.sync_start(now).await?;
        let sessions_output = self
            .runner
            .run(
                &WechatReaderRequest::sessions(BTreeMap::new()),
                WECHAT_COMMAND_TIMEOUT,
            )
            .await?;
        let all_sessions = parse_sessions_output(&sessions_output.stdout)?;
        let session_count = all_sessions.len();
        let sessions: Vec<_> = all_sessions
            .into_iter()
            .filter(|session| {
                session.last_timestamp == 0 || session.last_timestamp >= start_at.timestamp()
            })
            .collect();
        let mut report = WechatSyncReport {
            conversations: 0,
            examined_messages: 0,
            imported_messages: 0,
            duplicate_messages: 0,
            skipped_sent_messages: 0,
            failed_conversations: 0,
            partial: session_count >= SESSION_LIMIT,
            warnings: Vec::new(),
        };

        for session in sessions {
            if session.username.trim().is_empty() {
                continue;
            }
            let output = match self
                .runner
                .run(
                    &WechatReaderRequest::timeline(
                        session.username.clone(),
                        start_at.timestamp(),
                        BTreeMap::new(),
                    )
                    .map_err(|error| error.to_string())?,
                    WECHAT_COMMAND_TIMEOUT,
                )
                .await
            {
                Ok(output) => output,
                Err(error) => {
                    report.failed_conversations += 1;
                    report.warnings.push(format!(
                        "{}：{}",
                        display_session_name(&session),
                        truncate_error_detail(&error)
                    ));
                    continue;
                }
            };
            let timeline = match parse_timeline_output(&output.stdout) {
                Ok(timeline) => timeline,
                Err(error) => {
                    report.failed_conversations += 1;
                    report.warnings.push(format!(
                        "{}：{}",
                        display_session_name(&session),
                        truncate_error_detail(&error)
                    ));
                    continue;
                }
            };
            report.conversations += 1;
            report.examined_messages += timeline.messages.len();
            report.skipped_sent_messages += timeline
                .messages
                .iter()
                .filter(|message| message.is_from_me)
                .count();
            let payloads = normalize_incoming_messages(&session, timeline)?;
            if payloads.is_empty() {
                continue;
            }
            let batch = hush_store
                .lock()
                .map_err(|error| format!("无法锁定 Hush 消息库：{error}"))?
                .add_many_from_values(payloads, now)?;
            report.imported_messages += batch.imported;
            report.duplicate_messages += batch.duplicates;
        }

        report.partial |= report.failed_conversations > 0;
        if report.failed_conversations == 0 {
            let mut config = self.config.lock().await;
            config.last_success_at = Some(now.to_rfc3339());
            write_config(&self.config_path, &config)?;
        }
        Ok(report)
    }

    async fn check_readiness(&self) -> Result<WechatReadiness, String> {
        let output = self
            .runner
            .run(
                &WechatReaderRequest::status(BTreeMap::new()),
                WECHAT_COMMAND_TIMEOUT,
            )
            .await?;
        parse_status_output(&output.stdout)
    }

    async fn sync_start(
        &self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<chrono::DateTime<chrono::Utc>, String> {
        let config = self.config.lock().await;
        match config.last_success_at.as_deref() {
            Some(value) => chrono::DateTime::parse_from_rfc3339(value)
                .map(|timestamp| {
                    timestamp.with_timezone(&chrono::Utc)
                        - chrono::Duration::minutes(INCREMENTAL_OVERLAP_MINUTES)
                })
                .map_err(|error| format!("无法解析微信上次同步时间：{error}")),
            None => Ok(now - chrono::Duration::hours(INITIAL_SYNC_HOURS)),
        }
    }

    pub async fn set_auto_sync(&self, enabled: bool) -> Result<WechatHushStatus, String> {
        {
            let mut config = self.config.lock().await;
            config.auto_sync_enabled = enabled;
            config.sync_interval_minutes = SYNC_INTERVAL_MINUTES;
            write_config(&self.config_path, &config)?;
        }
        Ok(self.status().await)
    }

    pub async fn open_setup_terminal(&self) -> Result<(), String> {
        Err("安全提钥将在签名预览版开放；当前版本不会启动提权脚本".to_string())
    }

    pub async fn open_install_page() -> Result<(), String> {
        Err("微信读取器随 HUMHUM 一起安装，不再跳转第三方下载".to_string())
    }

    pub async fn config_snapshot(&self) -> WechatHushConfig {
        self.config.lock().await.clone()
    }

    pub fn is_syncing(&self) -> bool {
        self.syncing.load(Ordering::Acquire)
    }

    fn resolve_executable(&self) -> Option<WechatExecutable> {
        self.fixed_executable.clone()
    }

    fn now(&self) -> chrono::DateTime<chrono::Utc> {
        self.fixed_now.unwrap_or_else(chrono::Utc::now)
    }
}

struct WechatSyncFlagGuard<'a>(&'a AtomicBool);

impl Drop for WechatSyncFlagGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct WechatStatusFlagGuard<'a>(&'a AtomicBool);

impl Drop for WechatStatusFlagGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn discover_native_reader() -> Option<WechatNativeRuntime> {
    #[cfg(debug_assertions)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let development = WechatNativeRuntime {
            executable: manifest_dir
                .join("binaries")
                .join("humhum-wechat-reader-aarch64-apple-darwin"),
            wcdb: manifest_dir
                .join("resources")
                .join("wechat")
                .join("libWCDB.dylib"),
            manifest: manifest_dir
                .join("resources")
                .join("wechat")
                .join("native-manifest.json"),
        };
        if native_runtime_exists(&development) {
            return Some(development);
        }
    }

    let current_executable = std::env::current_exe().ok()?;
    let macos_dir = current_executable.parent()?;
    let resources_dir = macos_dir.parent()?.join("Resources").join("wechat");
    [
        macos_dir.join("humhum-wechat-reader"),
        macos_dir.join("humhum-wechat-reader-aarch64-apple-darwin"),
    ]
    .into_iter()
    .map(|executable| WechatNativeRuntime {
        executable,
        wcdb: resources_dir.join("libWCDB.dylib"),
        manifest: resources_dir.join("native-manifest.json"),
    })
    .find(native_runtime_exists)
}

fn native_runtime_exists(runtime: &WechatNativeRuntime) -> bool {
    [&runtime.executable, &runtime.wcdb, &runtime.manifest]
        .into_iter()
        .all(|path| path.is_file())
}

fn user_facing_next_action(blocked_by: Option<&str>, fallback: Option<&str>) -> Option<String> {
    let message = match blocked_by {
        Some("key_coverage_incomplete") | Some("key_validation_failed") => {
            "当前只读内核已就绪；安全提钥将在签名预览版开放"
        }
        Some("unsupported_wechat_build") => "当前微信版本尚未通过兼容验证，请等待 HUMHUM 更新",
        Some("wechat_not_running") => "请先打开这台 Mac 上的微信",
        Some("wechat_not_logged_in") => "请先在这台 Mac 上登录微信",
        Some("full_disk_access_required") => "请在系统设置中授予 HUMHUM 完全磁盘访问权限",
        Some("wcdb_unavailable") => "内置微信数据库组件不可用，请重新安装 HUMHUM",
        Some("schema_unsupported") => "本机微信数据结构尚未通过兼容验证，请等待 HUMHUM 更新",
        _ => fallback.unwrap_or_default(),
    };
    (!message.trim().is_empty()).then(|| message.to_string())
}

fn display_session_name(session: &WechatSession) -> &str {
    if session.display_name.trim().is_empty() {
        &session.username
    } else {
        &session.display_name
    }
}

fn write_config(path: &Path, config: &WechatHushConfig) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("无法序列化微信同步设置：{error}"))?;
    crate::local_api_auth::write_private_file_atomically(path, &json)
        .map_err(|error| format!("无法保存微信同步设置：{error}"))
}

fn truncate_error_detail(value: &str) -> String {
    const MAX_CHARS: usize = 280;
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let prefix: String = chars.by_ref().take(MAX_CHARS).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else if prefix.is_empty() {
        "未知错误".to_string()
    } else {
        prefix
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct WechatReadiness {
    #[serde(default)]
    readiness: String,
    #[serde(default, alias = "liveReadOk")]
    live_read_ok: bool,
    #[serde(default, alias = "blockedBy")]
    blocked_by: Option<String>,
    #[serde(default, alias = "nextAction")]
    next_action: Option<String>,
    #[serde(default)]
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct WechatSession {
    #[serde(default)]
    username: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    chat_type: String,
    #[serde(default)]
    last_timestamp: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct WechatTimeline {
    talker: String,
    display_name: String,
    messages: Vec<WechatTimelineMessage>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct WechatTimelineMessage {
    id: WechatMessageId,
    #[serde(default)]
    time_iso: String,
    #[serde(default)]
    sender: String,
    #[serde(default)]
    sender_wxid: Option<String>,
    #[serde(default)]
    is_from_me: bool,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(flatten)]
    raw: Value,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct WechatMessageId {
    #[serde(default)]
    talker: String,
    #[serde(default)]
    local_id: i64,
    #[serde(default)]
    server_id_str: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CliEnvelope {
    ok: bool,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<CliError>,
}

#[derive(Debug, Deserialize)]
struct CliError {
    #[serde(default)]
    message: String,
    #[serde(default, alias = "nextAction")]
    next_action: String,
}

#[derive(Debug, Deserialize)]
struct TimelineData {
    #[serde(default)]
    query: TimelineQuery,
    #[serde(default)]
    messages: Vec<WechatTimelineMessage>,
}

#[derive(Debug, Default, Deserialize)]
struct TimelineQuery {
    #[serde(default)]
    talker: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    chat: String,
}

fn parse_envelope(output: &str, label: &str) -> Result<Value, String> {
    let envelope: CliEnvelope = serde_json::from_str(output)
        .map_err(|error| format!("无法解析微信 {label} 响应：{error}"))?;
    if !envelope.ok {
        let error = envelope.error.unwrap_or(CliError {
            message: format!("微信 {label} 命令执行失败"),
            next_action: String::new(),
        });
        let detail = if error.next_action.trim().is_empty() {
            error.message
        } else {
            format!("{} {}", error.message, error.next_action)
        };
        return Err(detail.trim().to_string());
    }
    envelope
        .data
        .ok_or_else(|| format!("微信 {label} 响应缺少 data"))
}

fn parse_status_output(output: &str) -> Result<WechatReadiness, String> {
    let data = parse_envelope(output, "状态")?;
    let status = data
        .get("status")
        .cloned()
        .ok_or_else(|| "微信状态响应缺少 status".to_string())?;
    let mut readiness: WechatReadiness =
        serde_json::from_value(status).map_err(|error| format!("无法解析微信读取状态：{error}"))?;
    if readiness.readiness.trim().is_empty() {
        readiness.readiness = if readiness.live_read_ok {
            "ready".to_string()
        } else {
            "blocked".to_string()
        };
    }
    Ok(readiness)
}

fn parse_sessions_output(output: &str) -> Result<Vec<WechatSession>, String> {
    let data = parse_envelope(output, "会话")?;
    serde_json::from_value(
        data.get("sessions")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    )
    .map_err(|error| format!("无法解析微信会话列表：{error}"))
}

fn parse_timeline_output(output: &str) -> Result<WechatTimeline, String> {
    let data: TimelineData = serde_json::from_value(parse_envelope(output, "消息")?)
        .map_err(|error| format!("无法解析微信消息时间线：{error}"))?;
    let talker = if data.query.talker.trim().is_empty() {
        data.messages
            .first()
            .map(|message| message.id.talker.clone())
            .unwrap_or_default()
    } else {
        data.query.talker
    };
    let display_name = if data.query.display_name.trim().is_empty() {
        data.query.chat
    } else {
        data.query.display_name
    };
    Ok(WechatTimeline {
        talker,
        display_name,
        messages: data.messages,
    })
}

fn normalize_incoming_messages(
    session: &WechatSession,
    timeline: WechatTimeline,
) -> Result<Vec<Value>, String> {
    let talker = if timeline.talker.trim().is_empty() {
        session.username.trim()
    } else {
        timeline.talker.trim()
    };
    if talker.is_empty() {
        return Err("微信消息缺少会话标识".to_string());
    }
    let chat = if timeline.display_name.trim().is_empty() {
        if session.display_name.trim().is_empty() {
            talker
        } else {
            session.display_name.trim()
        }
    } else {
        timeline.display_name.trim()
    };
    let is_group = session.chat_type == "group" || talker.ends_with("@chatroom");
    let conversation_kind = if is_group { "group" } else { "direct" };
    let mut payloads = Vec::new();

    for message in timeline.messages {
        if message.is_from_me {
            continue;
        }
        let received_at = chrono::DateTime::parse_from_rfc3339(&message.time_iso)
            .map_err(|error| format!("无法解析微信消息时间：{error}"))?
            .with_timezone(&chrono::Utc)
            .to_rfc3339();
        let sender = if message.sender.trim().is_empty() {
            chat
        } else {
            message.sender.trim()
        };
        let message_key = message
            .id
            .server_id_str
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("local-{}", message.id.local_id));
        let text = if message.text.trim().is_empty() {
            non_text_summary(&message.kind)
        } else {
            message.text.trim().to_string()
        };
        payloads.push(json!({
            "platform": "wechat",
            "sender": sender,
            "chat": chat,
            "text": text,
            "received_at": received_at,
            "source_id": format!("wechat-native:{talker}:{message_key}"),
            "preview_limited": false,
            "source": "wechat_native",
            "conversation_kind": conversation_kind,
            "single_chat": !is_group,
            "talker": talker,
            "sender_wxid": message.sender_wxid,
            "message_kind": message.kind,
            "wechat_native": message.raw,
        }));
    }
    Ok(payloads)
}

fn non_text_summary(kind: &str) -> String {
    match kind.trim().to_lowercase().as_str() {
        "image" => "[图片]",
        "voice" => "[语音]",
        "video" => "[视频]",
        "file" => "[文件]",
        "link" => "[链接]",
        "sticker" => "[表情]",
        "location" => "[位置]",
        "card" => "[名片]",
        "transfer" => "[转账]",
        "red_packet" => "[红包]",
        "miniprogram" => "[小程序]",
        "forward_chat" => "[聊天记录]",
        "system" => "[系统消息]",
        _ => "[非文本消息]",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hush_store::HushStore;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use uuid::Uuid;

    struct FakeRunner {
        outputs: Mutex<VecDeque<Result<WechatCommandOutput, String>>>,
        calls: Mutex<Vec<(String, Option<String>)>>,
    }

    impl FakeRunner {
        fn new(outputs: Vec<Result<&str, &str>>) -> Self {
            Self {
                outputs: Mutex::new(
                    outputs
                        .into_iter()
                        .map(|output| {
                            output
                                .map(|stdout| WechatCommandOutput {
                                    stdout: stdout.to_string(),
                                })
                                .map_err(str::to_string)
                        })
                        .collect(),
                ),
                calls: Mutex::new(Vec::new()),
            }
        }
    }

    struct SlowStatusRunner {
        calls: AtomicUsize,
        output: String,
    }

    impl WechatRunner for SlowStatusRunner {
        fn run<'a>(
            &'a self,
            _request: &'a WechatReaderRequest,
            _timeout: Duration,
        ) -> Pin<Box<dyn Future<Output = Result<WechatCommandOutput, String>> + Send + 'a>>
        {
            Box::pin(async move {
                self.calls.fetch_add(1, AtomicOrdering::SeqCst);
                tokio::time::sleep(Duration::from_millis(150)).await;
                Ok(WechatCommandOutput {
                    stdout: self.output.clone(),
                })
            })
        }
    }

    impl WechatRunner for FakeRunner {
        fn run<'a>(
            &'a self,
            request: &'a WechatReaderRequest,
            _timeout: Duration,
        ) -> Pin<Box<dyn Future<Output = Result<WechatCommandOutput, String>> + Send + 'a>>
        {
            Box::pin(async move {
                self.calls.lock().unwrap().push((
                    request.action_name().to_string(),
                    request.talker().map(str::to_string),
                ));
                self.outputs
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("missing fake output")
            })
        }
    }

    fn test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("humhum-wechat-{label}-{}", Uuid::new_v4()))
    }

    #[test]
    fn constructs_only_typed_read_only_wechat_requests() {
        let status = WechatReaderRequest::status(BTreeMap::new());
        let sessions = WechatReaderRequest::sessions(BTreeMap::new());
        let timeline =
            WechatReaderRequest::timeline("项目群".to_string(), 1_784_385_600, BTreeMap::new())
                .unwrap();

        assert_eq!(status.action_name(), "status");
        assert_eq!(sessions.action_name(), "sessions");
        assert_eq!(timeline.action_name(), "timeline");
        assert_eq!(timeline.talker(), Some("项目群"));
        assert!(
            WechatReaderRequest::timeline("-x".to_string(), 1_784_385_600, BTreeMap::new())
                .is_err()
        );
        assert!(WechatReaderRequest::timeline("项目群".to_string(), -1, BTreeMap::new()).is_err());
    }

    #[test]
    fn parses_ready_and_setup_required_statuses() {
        let ready = parse_status_output(
            &json!({
                "ok": true,
                "data": {
                    "status": {
                        "liveReadOk": true
                    }
                }
            })
            .to_string(),
        )
        .unwrap();
        assert!(ready.live_read_ok);
        assert_eq!(ready.readiness, "ready");

        let blocked = parse_status_output(
            &json!({
                "ok": true,
                "data": {
                    "status": {
                        "liveReadOk": false,
                        "blockedBy": "key_coverage_incomplete",
                        "nextAction": "Prepare local WeChat DB keys."
                    }
                }
            })
            .to_string(),
        )
        .unwrap();
        assert!(!blocked.live_read_ok);
        assert_eq!(blocked.readiness, "blocked");
        assert_eq!(
            blocked.blocked_by.as_deref(),
            Some("key_coverage_incomplete")
        );
        assert_eq!(
            blocked.next_action.as_deref(),
            Some("Prepare local WeChat DB keys.")
        );
    }

    #[test]
    fn parses_sessions_and_real_timeline_messages() {
        let sessions = parse_sessions_output(
            &json!({
                "ok": true,
                "data": {
                    "sessions": [{
                        "username": "43122059806@chatroom",
                        "display_name": "HUMHUM 项目群",
                        "chat_type": "group",
                        "last_timestamp": 1784471400
                    }]
                }
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].display_name, "HUMHUM 项目群");

        let timeline = parse_timeline_output(
            &json!({
                "ok": true,
                "data": {
                    "query": {
                        "talker": "43122059806@chatroom",
                        "display_name": "HUMHUM 项目群"
                    },
                    "messages": [{
                        "id": {
                            "talker": "43122059806@chatroom",
                            "local_id": 15,
                            "server_id_str": "987654321"
                        },
                        "time_iso": "2026-07-19T21:10:00+08:00",
                        "sender": "小明",
                        "sender_wxid": "wxid_ming",
                        "is_from_me": false,
                        "kind": "text",
                        "text": "真实微信正文"
                    }, {
                        "id": {
                            "talker": "43122059806@chatroom",
                            "local_id": 16
                        },
                        "time_iso": "2026-07-19T21:11:00+08:00",
                        "sender": "我",
                        "is_from_me": true,
                        "kind": "text",
                        "text": "自己发出的内容"
                    }]
                }
            })
            .to_string(),
        )
        .unwrap();

        let payloads = normalize_incoming_messages(&sessions[0], timeline).unwrap();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0]["platform"], "wechat");
        assert_eq!(payloads[0]["sender"], "小明");
        assert_eq!(payloads[0]["chat"], "HUMHUM 项目群");
        assert_eq!(payloads[0]["text"], "真实微信正文");
        assert_eq!(payloads[0]["conversation_kind"], "group");
        assert_eq!(
            payloads[0]["source_id"],
            "wechat-native:43122059806@chatroom:987654321"
        );
        assert_eq!(payloads[0]["preview_limited"], false);
    }

    #[test]
    fn gives_non_text_messages_a_readable_summary() {
        let session = WechatSession {
            username: "wxid_alice".to_string(),
            display_name: "Alice".to_string(),
            chat_type: "private".to_string(),
            last_timestamp: 1_784_471_400,
        };
        let timeline = WechatTimeline {
            talker: "wxid_alice".to_string(),
            display_name: "Alice".to_string(),
            messages: vec![WechatTimelineMessage {
                id: WechatMessageId {
                    talker: "wxid_alice".to_string(),
                    local_id: 22,
                    server_id_str: None,
                },
                time_iso: "2026-07-19T21:12:00+08:00".to_string(),
                sender: "Alice".to_string(),
                sender_wxid: Some("wxid_alice".to_string()),
                is_from_me: false,
                kind: "image".to_string(),
                text: String::new(),
                raw: json!({"images": [{"name": "photo.jpg"}]}),
            }],
        };

        let payloads = normalize_incoming_messages(&session, timeline).unwrap();
        assert_eq!(payloads[0]["text"], "[图片]");
        assert_eq!(
            payloads[0]["source_id"],
            "wechat-native:wxid_alice:local-22"
        );
        assert_eq!(payloads[0]["conversation_kind"], "direct");
    }

    #[tokio::test]
    async fn concurrent_status_requests_share_one_cli_probe() {
        let blocked = json!({
            "ok": true,
            "data": {
                "status": {
                    "readiness": "blocked",
                    "live_read_ok": false,
                    "blocked_by": "key_config_missing"
                }
            }
        })
        .to_string();
        let runner = Arc::new(SlowStatusRunner {
            calls: AtomicUsize::new(0),
            output: blocked,
        });
        let dir = test_dir("single-status-probe");
        std::fs::create_dir_all(&dir).unwrap();
        let bridge = Arc::new(
            WechatHushBridge::with_test_parts(
                &dir,
                WechatExecutable {
                    path: dir.join("humhum-wechat-reader"),
                },
                runner.clone(),
                chrono::Utc::now(),
            )
            .unwrap(),
        );

        let first_bridge = bridge.clone();
        let first = tokio::spawn(async move { first_bridge.status().await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        let second = tokio::time::timeout(Duration::from_millis(50), bridge.status()).await;

        assert!(
            second.is_ok(),
            "a repeated status request should not queue another CLI process"
        );
        assert_eq!(runner.calls.load(AtomicOrdering::SeqCst), 1);
        assert_eq!(first.await.unwrap().state, WechatHushState::SetupRequired);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn sync_imports_only_incoming_messages_and_advances_cursor() {
        let ready = json!({
            "ok": true,
            "data": { "status": { "readiness": "ready", "live_read_ok": true } }
        })
        .to_string();
        let sessions = json!({
            "ok": true,
            "data": {
                "sessions": [{
                    "username": "wxid_alice",
                    "display_name": "Alice",
                    "chat_type": "private",
                    "last_timestamp": 1784471400
                }]
            }
        })
        .to_string();
        let timeline = json!({
            "ok": true,
            "data": {
                "query": { "talker": "wxid_alice", "display_name": "Alice" },
                "messages": [{
                    "id": { "talker": "wxid_alice", "local_id": 7 },
                    "time_iso": "2026-07-19T12:10:00Z",
                    "sender": "Alice",
                    "is_from_me": false,
                    "kind": "text",
                    "text": "今晚吃饭吗？"
                }, {
                    "id": { "talker": "wxid_alice", "local_id": 8 },
                    "time_iso": "2026-07-19T12:11:00Z",
                    "sender": "我",
                    "is_from_me": true,
                    "kind": "text",
                    "text": "好"
                }]
            }
        })
        .to_string();
        let runner = Arc::new(FakeRunner::new(vec![
            Ok(ready.as_str()),
            Ok(sessions.as_str()),
            Ok(timeline.as_str()),
        ]));
        let dir = test_dir("sync");
        std::fs::create_dir_all(&dir).unwrap();
        let executable = WechatExecutable {
            path: dir.join("humhum-wechat-reader"),
        };
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-19T12:30:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let bridge =
            WechatHushBridge::with_test_parts(&dir, executable, runner.clone(), now).unwrap();
        let inbox_path = dir.join("hush-inbox.json");
        let store = Arc::new(Mutex::new(HushStore::with_file_path(inbox_path)));

        let report = bridge.sync(store.clone()).await.unwrap();

        assert_eq!(report.conversations, 1);
        assert_eq!(report.examined_messages, 2);
        assert_eq!(report.skipped_sent_messages, 1);
        assert_eq!(report.imported_messages, 1);
        let summary = store.lock().unwrap().summary();
        assert_eq!(summary.total, 1);
        assert_eq!(summary.messages[0].text, "今晚吃饭吗？");
        assert_eq!(summary.messages[0].conversation_kind, "direct");
        let config = bridge.config_snapshot().await;
        assert_eq!(
            config.last_success_at.as_deref(),
            Some("2026-07-19T12:30:00+00:00")
        );

        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0], ("status".to_string(), None));
        assert_eq!(calls[1], ("sessions".to_string(), None));
        assert_eq!(
            calls[2],
            ("timeline".to_string(), Some("wxid_alice".to_string()))
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn status_truthfully_reports_missing_and_blocked_connectors() {
        let missing_dir = test_dir("missing");
        let missing = WechatHushBridge::from_parts(
            missing_dir.clone(),
            missing_dir.join("hush-wechat.json"),
            Arc::new(MissingWechatRunner),
            None,
            None,
        )
        .unwrap();
        let missing_status = missing.status().await;
        assert_eq!(missing_status.state, WechatHushState::NotInstalled);
        assert!(!missing_status.live_read_ok);

        let blocked = json!({
            "ok": true,
            "data": {
                "status": {
                    "readiness": "blocked",
                    "live_read_ok": false,
                    "blocked_by": "key_coverage_incomplete",
                    "next_action": "Prepare local keys."
                }
            }
        })
        .to_string();
        let runner = Arc::new(FakeRunner::new(vec![Ok(blocked.as_str())]));
        let dir = test_dir("blocked");
        std::fs::create_dir_all(&dir).unwrap();
        let bridge = WechatHushBridge::with_test_parts(
            &dir,
            WechatExecutable {
                path: dir.join("humhum-wechat-reader"),
            },
            runner,
            chrono::Utc::now(),
        )
        .unwrap();

        let status = bridge.status().await;
        assert_eq!(status.state, WechatHushState::SetupRequired);
        assert_eq!(
            status.blocked_by.as_deref(),
            Some("key_coverage_incomplete")
        );
        assert_eq!(
            status.next_action.as_deref(),
            Some("当前只读内核已就绪；安全提钥将在签名预览版开放")
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
