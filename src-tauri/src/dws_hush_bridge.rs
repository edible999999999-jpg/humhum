use crate::hush_store::HushStore;
use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

const PAGE_SIZE: usize = 50;
const MAX_SYNC_PAGES: usize = 40;
const MAX_SYNC_MESSAGES: usize = 2_000;
const INITIAL_SYNC_HOURS: i64 = 24;
const INCREMENTAL_OVERLAP_MINUTES: i64 = 2;
const DWS_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DwsExecutableSource {
    Standalone,
    Wukong,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DwsExecutable {
    pub path: PathBuf,
    pub source: DwsExecutableSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DwsPendingSync {
    pub start_at: String,
    pub end_at: String,
    pub next_cursor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DwsHushConfig {
    pub auto_sync_enabled: bool,
    pub sync_interval_minutes: u64,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub pending_sync: Option<DwsPendingSync>,
}

impl Default for DwsHushConfig {
    fn default() -> Self {
        Self {
            auto_sync_enabled: false,
            sync_interval_minutes: 5,
            last_success_at: None,
            last_attempt_at: None,
            pending_sync: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DwsSyncReport {
    pub conversations: usize,
    pub examined_messages: usize,
    pub imported_messages: usize,
    pub duplicate_messages: usize,
    pub pages: usize,
    pub partial: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DwsHushState {
    NotInstalled,
    AuthenticationRequired,
    Ready,
    Syncing,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct DwsHushStatus {
    pub state: DwsHushState,
    pub message: String,
    pub executable_source: Option<DwsExecutableSource>,
    pub executable_path: Option<String>,
    pub authenticated: bool,
    pub auto_sync_enabled: bool,
    pub sync_interval_minutes: u64,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub syncing: bool,
    pub pending_sync: bool,
}

#[derive(Debug, Clone)]
struct DwsCommandOutput {
    stdout: String,
}

trait DwsRunner: Send + Sync {
    fn run<'a>(
        &'a self,
        executable: &'a Path,
        args: &'a [String],
        timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<DwsCommandOutput, String>> + Send + 'a>>;
}

struct SystemDwsRunner;

impl DwsRunner for SystemDwsRunner {
    fn run<'a>(
        &'a self,
        executable: &'a Path,
        args: &'a [String],
        timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<DwsCommandOutput, String>> + Send + 'a>> {
        Box::pin(async move {
            validate_dws_args(args)?;
            let mut command = Command::new(executable);
            command
                .args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true);
            let output = tokio::time::timeout(timeout, command.output())
                .await
                .map_err(|_| "钉钉 DWS 命令超时，请稍后重试".to_string())?
                .map_err(|error| format!("无法启动钉钉 DWS：{error}"))?;
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !output.status.success() {
                let detail = if stderr.is_empty() { &stdout } else { &stderr };
                return Err(format!(
                    "钉钉 DWS 执行失败：{}",
                    truncate_error_detail(detail)
                ));
            }
            Ok(DwsCommandOutput { stdout })
        })
    }
}

pub struct DwsHushBridge {
    home_dir: PathBuf,
    config_path: PathBuf,
    config: AsyncMutex<DwsHushConfig>,
    last_error: AsyncMutex<Option<String>>,
    syncing: AtomicBool,
    runner: Arc<dyn DwsRunner>,
    fixed_executable: Option<DwsExecutable>,
    fixed_now: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DwsConversation {
    #[serde(default)]
    open_conversation_id: String,
    #[serde(default)]
    single_chat: bool,
    #[serde(default)]
    title: String,
    #[serde(default)]
    messages: Vec<DwsMessage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DwsMessage {
    #[serde(default)]
    content: String,
    #[serde(default)]
    create_time: String,
    #[serde(default)]
    open_message_id: String,
    #[serde(default)]
    sender: String,
    #[serde(default)]
    sender_open_ding_talk_id: String,
    #[serde(default)]
    quoted_message: Option<Value>,
    #[serde(default)]
    emotion_reply_list: Vec<Value>,
}

#[derive(Debug, Clone)]
struct DwsPage {
    conversations: Vec<DwsConversation>,
    has_more: bool,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DwsEnvelope {
    success: bool,
    #[serde(default)]
    result: Option<DwsResult>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DwsResult {
    #[serde(default)]
    conversation_messages_list: Vec<DwsConversation>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    next_cursor: Option<String>,
}

fn discover_dws_with(standalone: Option<PathBuf>, home: &Path) -> Option<DwsExecutable> {
    if let Some(path) = standalone.filter(|path| path.is_file()) {
        return Some(DwsExecutable {
            path,
            source: DwsExecutableSource::Standalone,
        });
    }

    let executable_name = if cfg!(target_os = "windows") {
        "dws.exe"
    } else {
        "dws"
    };
    for relative in [
        PathBuf::from(".qoderwork/bin").join(executable_name),
        PathBuf::from(".local/bin").join(executable_name),
    ] {
        let path = home.join(relative);
        if path.is_file() {
            return Some(DwsExecutable {
                path,
                source: DwsExecutableSource::Standalone,
            });
        }
    }

    #[cfg(target_os = "windows")]
    let bundled = home.join(".real/.bin/dws/bin/dws.exe");
    #[cfg(not(target_os = "windows"))]
    let bundled = home.join(".real/.bin/dws/bin/dws");

    bundled.is_file().then_some(DwsExecutable {
        path: bundled,
        source: DwsExecutableSource::Wukong,
    })
}

fn parse_page(output: &str) -> Result<DwsPage, String> {
    let envelope: DwsEnvelope =
        serde_json::from_str(output).map_err(|error| format!("无法解析钉钉 DWS 响应：{error}"))?;
    if !envelope.success {
        return Err(envelope
            .message
            .unwrap_or_else(|| "钉钉 DWS 命令执行未成功".to_string()));
    }
    let result = envelope
        .result
        .ok_or_else(|| "钉钉 DWS 响应缺少 result".to_string())?;
    if result.has_more && result.next_cursor.as_deref().unwrap_or("").is_empty() {
        return Err("钉钉 DWS 响应缺少下一页游标".to_string());
    }
    Ok(DwsPage {
        conversations: result.conversation_messages_list,
        has_more: result.has_more,
        next_cursor: result.next_cursor.filter(|cursor| !cursor.is_empty()),
    })
}

fn validate_dws_args(args: &[String]) -> Result<(), String> {
    if args == ["auth", "status"] || args == ["auth", "login"] {
        return Ok(());
    }
    if args.get(0..3)
        != Some(&[
            "chat".to_string(),
            "message".to_string(),
            "list-all".to_string(),
        ])
    {
        return Err("钉钉 DWS 命令不在只读白名单中".to_string());
    }

    let mut seen = HashSet::new();
    let mut index = 3;
    while index < args.len() {
        let flag = args[index].as_str();
        if flag == "-y" {
            if !seen.insert("-y") {
                return Err("钉钉 DWS 参数 -y 重复".to_string());
            }
            index += 1;
            continue;
        }
        if !["--start", "--end", "--limit", "--cursor", "--format"].contains(&flag) {
            return Err(format!("钉钉 DWS 参数不在只读白名单中：{flag}"));
        }
        if !seen.insert(flag) {
            return Err(format!("钉钉 DWS 参数重复：{flag}"));
        }
        let value = args
            .get(index + 1)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("钉钉 DWS 参数缺少值：{flag}"))?;
        if flag == "--limit" && value != "50" {
            return Err("钉钉 DWS 每页数量必须为 50".to_string());
        }
        if flag == "--format" && value != "json" {
            return Err("钉钉 DWS 输出格式必须为 JSON".to_string());
        }
        index += 2;
    }

    for required in ["--start", "--end", "--limit", "--cursor", "--format", "-y"] {
        if !seen.contains(required) {
            return Err(format!("钉钉 DWS 缺少必要参数：{required}"));
        }
    }
    Ok(())
}

impl DwsHushBridge {
    pub fn load_or_create(home: &Path) -> Result<Self, String> {
        Self::from_parts(
            home.to_path_buf(),
            home.join(".humhum").join("hush-dws.json"),
            Arc::new(SystemDwsRunner),
            None,
            None,
        )
    }

    fn from_parts(
        home_dir: PathBuf,
        config_path: PathBuf,
        runner: Arc<dyn DwsRunner>,
        fixed_executable: Option<DwsExecutable>,
        fixed_now: Option<DateTime<Utc>>,
    ) -> Result<Self, String> {
        let config = if config_path.is_file() {
            let contents = std::fs::read_to_string(&config_path)
                .map_err(|error| format!("无法读取钉钉同步设置：{error}"))?;
            serde_json::from_str(&contents)
                .map_err(|error| format!("无法解析钉钉同步设置：{error}"))?
        } else {
            DwsHushConfig::default()
        };
        Ok(Self {
            home_dir,
            config_path,
            config: AsyncMutex::new(config),
            last_error: AsyncMutex::new(None),
            syncing: AtomicBool::new(false),
            runner,
            fixed_executable,
            fixed_now,
        })
    }

    #[cfg(test)]
    fn with_test_parts(
        config_dir: &Path,
        executable: DwsExecutable,
        runner: Arc<dyn DwsRunner>,
        now: DateTime<Utc>,
    ) -> Result<Self, String> {
        Self::from_parts(
            config_dir.to_path_buf(),
            config_dir.join("hush-dws.json"),
            runner,
            Some(executable),
            Some(now),
        )
    }

    pub async fn sync(&self, hush_store: Arc<Mutex<HushStore>>) -> Result<DwsSyncReport, String> {
        if self
            .syncing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("钉钉消息同步正在进行中".to_string());
        }
        let _sync_guard = SyncFlagGuard(&self.syncing);
        let result = self.sync_inner(hush_store).await;
        let mut last_error = self.last_error.lock().await;
        *last_error = result.as_ref().err().cloned();
        result
    }

    pub async fn status(&self) -> DwsHushStatus {
        let config = self.config_snapshot().await;
        let executable = self.resolve_executable();
        let syncing = self.is_syncing();
        let (state, message, authenticated) = match executable.as_ref() {
            None => (
                DwsHushState::NotInstalled,
                "未找到钉钉 DWS，请先安装 DWS 或安装并登录悟空".to_string(),
                false,
            ),
            Some(_) if syncing => (
                DwsHushState::Syncing,
                "正在从钉钉同步消息".to_string(),
                true,
            ),
            Some(executable) => match self.check_authenticated(executable).await {
                Ok(false) => (
                    DwsHushState::AuthenticationRequired,
                    match executable.source {
                        DwsExecutableSource::Standalone => {
                            "钉钉 DWS 尚未登录，请先完成登录".to_string()
                        }
                        DwsExecutableSource::Wukong => {
                            "钉钉 DWS 尚未登录，请打开悟空完成登录".to_string()
                        }
                    },
                    false,
                ),
                Ok(true) => {
                    if let Some(error) = self.last_error().await {
                        (DwsHushState::Error, error, true)
                    } else {
                        (DwsHushState::Ready, "钉钉消息同步已就绪".to_string(), true)
                    }
                }
                Err(error) => (DwsHushState::Error, error, false),
            },
        };
        DwsHushStatus {
            state,
            message,
            executable_source: executable.as_ref().map(|value| value.source),
            executable_path: executable
                .as_ref()
                .map(|value| value.path.to_string_lossy().to_string()),
            authenticated,
            auto_sync_enabled: config.auto_sync_enabled,
            sync_interval_minutes: config.sync_interval_minutes,
            last_success_at: config.last_success_at,
            last_attempt_at: config.last_attempt_at,
            syncing,
            pending_sync: config.pending_sync.is_some(),
        }
    }

    pub async fn set_auto_sync(&self, enabled: bool) -> Result<DwsHushStatus, String> {
        {
            let mut config = self.config.lock().await;
            config.auto_sync_enabled = enabled;
            config.sync_interval_minutes = 5;
            write_config(&self.config_path, &config)?;
        }
        Ok(self.status().await)
    }

    pub async fn open_login(&self) -> Result<(), String> {
        let executable = self
            .resolve_executable()
            .ok_or_else(|| "未找到钉钉 DWS，请先完成安装".to_string())?;
        match executable.source {
            DwsExecutableSource::Standalone => {
                let args = vec!["auth".to_string(), "login".to_string()];
                self.runner
                    .run(&executable.path, &args, Duration::from_secs(120))
                    .await?;
                Ok(())
            }
            DwsExecutableSource::Wukong => open_wukong_for_login(),
        }
    }

    async fn sync_inner(&self, hush_store: Arc<Mutex<HushStore>>) -> Result<DwsSyncReport, String> {
        let now = self.now();
        {
            let mut config = self.config.lock().await;
            config.last_attempt_at = Some(now.to_rfc3339());
            write_config(&self.config_path, &config)?;
        }

        let executable = self
            .resolve_executable()
            .ok_or_else(|| "未找到钉钉 DWS，请先安装 DWS 或安装并登录悟空".to_string())?;
        if !self.check_authenticated(&executable).await? {
            return Err("钉钉 DWS 尚未登录，请先完成登录".to_string());
        }

        let (start_at, end_at, mut cursor) = self.sync_window(now).await?;
        let mut conversation_ids = HashSet::new();
        let mut report = DwsSyncReport {
            conversations: 0,
            examined_messages: 0,
            imported_messages: 0,
            duplicate_messages: 0,
            pages: 0,
            partial: false,
            next_cursor: None,
        };

        loop {
            let args = list_all_args(start_at, end_at, &cursor);
            let output = self
                .runner
                .run(&executable.path, &args, DWS_COMMAND_TIMEOUT)
                .await?;
            let page = parse_page(&output.stdout)?;
            report.pages += 1;

            let mut payloads = Vec::new();
            for conversation in &page.conversations {
                let conversation_key = if conversation.open_conversation_id.is_empty() {
                    conversation.title.clone()
                } else {
                    conversation.open_conversation_id.clone()
                };
                conversation_ids.insert(conversation_key);
                for message in &conversation.messages {
                    report.examined_messages += 1;
                    if message.open_message_id.trim().is_empty()
                        || message.content.trim().is_empty()
                    {
                        continue;
                    }
                    payloads.push(normalize_message(conversation, message)?);
                }
            }

            if !payloads.is_empty() {
                let batch = hush_store
                    .lock()
                    .map_err(|error| format!("无法锁定 Hush 消息库：{error}"))?
                    .add_many_from_values(payloads, now)?;
                report.imported_messages += batch.imported;
                report.duplicate_messages += batch.duplicates;
            }

            if !page.has_more {
                {
                    let mut config = self.config.lock().await;
                    config.pending_sync = None;
                    config.last_success_at = Some(end_at.to_rfc3339());
                    write_config(&self.config_path, &config)?;
                }
                break;
            }

            let next_cursor = page
                .next_cursor
                .ok_or_else(|| "钉钉 DWS 返回了无效的分页游标".to_string())?;
            self.persist_pending(start_at, end_at, &next_cursor).await?;
            let reached_bound =
                report.pages >= MAX_SYNC_PAGES || report.examined_messages >= MAX_SYNC_MESSAGES;
            if reached_bound {
                report.partial = true;
                report.next_cursor = Some(next_cursor);
                break;
            }
            cursor = next_cursor;
        }

        hush_store
            .lock()
            .map_err(|error| format!("无法锁定 Hush 消息库：{error}"))?
            .prune_and_save(now)?;
        report.conversations = conversation_ids.len();
        Ok(report)
    }

    async fn sync_window(
        &self,
        now: DateTime<Utc>,
    ) -> Result<(DateTime<Utc>, DateTime<Utc>, String), String> {
        let config = self.config.lock().await;
        if let Some(pending) = &config.pending_sync {
            return Ok((
                parse_config_timestamp(&pending.start_at)?,
                parse_config_timestamp(&pending.end_at)?,
                pending.next_cursor.clone(),
            ));
        }
        let start_at = if let Some(last_success_at) = &config.last_success_at {
            parse_config_timestamp(last_success_at)?
                - chrono::Duration::minutes(INCREMENTAL_OVERLAP_MINUTES)
        } else {
            now - chrono::Duration::hours(INITIAL_SYNC_HOURS)
        };
        Ok((start_at, now, "0".to_string()))
    }

    async fn persist_pending(
        &self,
        start_at: DateTime<Utc>,
        end_at: DateTime<Utc>,
        next_cursor: &str,
    ) -> Result<(), String> {
        let mut config = self.config.lock().await;
        config.pending_sync = Some(DwsPendingSync {
            start_at: start_at.to_rfc3339(),
            end_at: end_at.to_rfc3339(),
            next_cursor: next_cursor.to_string(),
        });
        write_config(&self.config_path, &config)
    }

    async fn check_authenticated(&self, executable: &DwsExecutable) -> Result<bool, String> {
        let args = vec!["auth".to_string(), "status".to_string()];
        let output = self
            .runner
            .run(&executable.path, &args, DWS_COMMAND_TIMEOUT)
            .await?;
        parse_authenticated(&output.stdout)
    }

    fn resolve_executable(&self) -> Option<DwsExecutable> {
        self.fixed_executable
            .clone()
            .or_else(|| discover_dws(&self.home_dir))
    }

    fn now(&self) -> DateTime<Utc> {
        self.fixed_now.unwrap_or_else(Utc::now)
    }

    pub async fn config_snapshot(&self) -> DwsHushConfig {
        self.config.lock().await.clone()
    }

    pub fn is_syncing(&self) -> bool {
        self.syncing.load(Ordering::Acquire)
    }

    pub async fn last_error(&self) -> Option<String> {
        self.last_error.lock().await.clone()
    }
}

struct SyncFlagGuard<'a>(&'a AtomicBool);

impl Drop for SyncFlagGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub(crate) async fn run_immediately_then_interval<F, Fut>(period: Duration, mut task: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    let mut interval = tokio::time::interval(period);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await;
    loop {
        task().await;
        interval.tick().await;
    }
}

fn discover_dws(home: &Path) -> Option<DwsExecutable> {
    discover_dws_with(find_dws_on_path(), home)
}

fn find_dws_on_path() -> Option<PathBuf> {
    let executable_name = if cfg!(target_os = "windows") {
        "dws.exe"
    } else {
        "dws"
    };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .map(|directory| directory.join(executable_name))
        .find(|candidate| candidate.is_file())
}

fn parse_authenticated(output: &str) -> Result<bool, String> {
    if let Ok(value) = serde_json::from_str::<Value>(output) {
        if value.get("success").and_then(Value::as_bool) == Some(false) {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("钉钉 DWS 认证状态查询失败");
            return Err(message.to_string());
        }
        return Ok(value
            .get("authenticated")
            .and_then(Value::as_bool)
            .or_else(|| {
                value
                    .pointer("/result/authenticated")
                    .and_then(Value::as_bool)
            })
            .or_else(|| value.get("token_valid").and_then(Value::as_bool))
            .unwrap_or(false));
    }
    let normalized = output.to_lowercase();
    Ok(output.contains("已登录")
        || normalized.contains("authenticated: true")
        || normalized.contains("logged in"))
}

fn list_all_args(start_at: DateTime<Utc>, end_at: DateTime<Utc>, cursor: &str) -> Vec<String> {
    vec![
        "chat".to_string(),
        "message".to_string(),
        "list-all".to_string(),
        "--start".to_string(),
        format_dws_datetime(start_at),
        "--end".to_string(),
        format_dws_datetime(end_at),
        "--limit".to_string(),
        PAGE_SIZE.to_string(),
        "--cursor".to_string(),
        cursor.to_string(),
        "--format".to_string(),
        "json".to_string(),
        "-y".to_string(),
    ]
}

fn format_dws_datetime(timestamp: DateTime<Utc>) -> String {
    timestamp
        .with_timezone(&Local)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

fn normalize_message(
    conversation: &DwsConversation,
    message: &DwsMessage,
) -> Result<Value, String> {
    let sender = if message.sender.trim().is_empty() {
        "钉钉用户"
    } else {
        message.sender.trim()
    };
    let chat = if conversation.title.trim().is_empty() {
        sender
    } else {
        conversation.title.trim()
    };
    Ok(json!({
        "platform": "dingtalk",
        "sender": sender,
        "chat": chat,
        "text": message.content,
        "received_at": dws_timestamp_to_rfc3339(&message.create_time)?,
        "source_id": format!("dws:{}", message.open_message_id),
        "preview_limited": false,
        "source": "dws",
        "conversation_id": conversation.open_conversation_id,
        "single_chat": conversation.single_chat,
        "sender_open_dingtalk_id": message.sender_open_ding_talk_id,
        "quoted_message": message.quoted_message,
        "emotion_reply_list": message.emotion_reply_list,
    }))
}

fn dws_timestamp_to_rfc3339(value: &str) -> Result<String, String> {
    let naive = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map_err(|error| format!("无法解析钉钉消息时间：{error}"))?;
    Local
        .from_local_datetime(&naive)
        .earliest()
        .ok_or_else(|| format!("无法确定钉钉消息时间：{value}"))
        .map(|timestamp| timestamp.with_timezone(&Utc).to_rfc3339())
}

fn parse_config_timestamp(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .map_err(|error| format!("无法解析钉钉同步时间：{error}"))
}

fn write_config(path: &Path, config: &DwsHushConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "钉钉同步设置路径无效".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建钉钉同步设置目录：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("无法序列化钉钉同步设置：{error}"))?;
    std::fs::write(&temporary, contents)
        .map_err(|error| format!("无法写入钉钉同步设置：{error}"))?;
    std::fs::rename(&temporary, path).map_err(|error| format!("无法保存钉钉同步设置：{error}"))
}

fn truncate_error_detail(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "未提供错误详情".to_string();
    }
    let mut detail: String = trimmed.chars().take(800).collect();
    for sensitive_key in ["access_token", "refresh_token", "client_secret"] {
        if detail.to_lowercase().contains(sensitive_key) {
            detail = "认证信息无效或已过期，请重新登录".to_string();
            break;
        }
    }
    detail
}

#[cfg(target_os = "macos")]
fn open_wukong_for_login() -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-a", "Wukong"])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开悟空：{error}"))
}

#[cfg(target_os = "windows")]
fn open_wukong_for_login() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", "Wukong"])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开悟空：{error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_wukong_for_login() -> Result<(), String> {
    Err("当前系统需要手动打开悟空完成钉钉登录".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hush_store::HushStore;
    use chrono::{TimeZone, Utc};
    use serde_json::json;
    use std::collections::VecDeque;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    fn fixture_dws_name() -> &'static str {
        if cfg!(target_os = "windows") {
            "dws.exe"
        } else {
            "dws"
        }
    }

    #[tokio::test]
    async fn periodic_task_runs_immediately_then_waits_for_the_interval() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = calls.clone();
        let task = tokio::spawn(run_immediately_then_interval(
            Duration::from_millis(100),
            move || {
                observed.fetch_add(1, Ordering::SeqCst);
                std::future::ready(())
            },
        ));

        tokio::time::timeout(Duration::from_millis(100), async {
            while calls.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("periodic task did not run immediately");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        tokio::time::timeout(Duration::from_millis(300), async {
            while calls.load(Ordering::SeqCst) < 2 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("periodic task did not run after its interval");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        task.abort();
    }

    #[test]
    fn standalone_dws_takes_precedence_over_wukong_bundle() {
        let temp = tempfile::tempdir().unwrap();
        let standalone = temp.path().join("bin/dws");
        let bundled = temp.path().join(".real/.bin/dws/bin/dws");
        std::fs::create_dir_all(standalone.parent().unwrap()).unwrap();
        std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        std::fs::write(&standalone, "").unwrap();
        std::fs::write(&bundled, "").unwrap();

        let executable = discover_dws_with(Some(standalone.clone()), temp.path()).unwrap();

        assert_eq!(executable.path, standalone);
        assert_eq!(executable.source, DwsExecutableSource::Standalone);
    }

    #[test]
    fn wukong_bundle_is_used_when_standalone_dws_is_missing() {
        let temp = tempfile::tempdir().unwrap();
        let bundled = temp
            .path()
            .join(".real/.bin/dws/bin")
            .join(fixture_dws_name());
        std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        std::fs::write(&bundled, "").unwrap();

        let executable = discover_dws_with(None, temp.path()).unwrap();

        assert_eq!(executable.path, bundled);
        assert_eq!(executable.source, DwsExecutableSource::Wukong);
    }

    #[test]
    fn returns_none_when_no_dws_executable_exists() {
        let temp = tempfile::tempdir().unwrap();
        assert!(discover_dws_with(None, temp.path()).is_none());
    }

    #[test]
    fn discovers_qoder_installed_dws_without_gui_path_inheritance() {
        let temp = tempfile::tempdir().unwrap();
        let qoder_dws = temp.path().join(".qoderwork/bin").join(fixture_dws_name());
        std::fs::create_dir_all(qoder_dws.parent().unwrap()).unwrap();
        std::fs::write(&qoder_dws, "").unwrap();

        let executable = discover_dws_with(None, temp.path()).unwrap();

        assert_eq!(executable.path, qoder_dws);
        assert_eq!(executable.source, DwsExecutableSource::Standalone);
    }

    #[test]
    fn parses_group_and_direct_messages() {
        let page = parse_page(
            r#"{
              "success": true,
              "result": {
                "conversationMessagesList": [
                  {
                    "openConversationId": "cid-group",
                    "singleChat": false,
                    "title": "项目群",
                    "messages": [{
                      "content": "群消息",
                      "createTime": "2026-07-17 11:53:52",
                      "openMessageId": "mid-group",
                      "sender": "小明",
                      "senderOpenDingTalkId": "u1"
                    }]
                  },
                  {
                    "openConversationId": "cid-direct",
                    "singleChat": true,
                    "title": "小红",
                    "messages": [{
                      "content": "私聊",
                      "createTime": "2026-07-17 11:54:52",
                      "openMessageId": "mid-direct",
                      "sender": "小红",
                      "senderOpenDingTalkId": "u2"
                    }]
                  }
                ],
                "hasMore": true,
                "nextCursor": "opaque-next"
              }
            }"#,
        )
        .unwrap();

        assert_eq!(page.conversations.len(), 2);
        assert!(!page.conversations[0].single_chat);
        assert!(page.conversations[1].single_chat);
        assert_eq!(
            page.conversations[0].messages[0].open_message_id,
            "mid-group"
        );
        assert!(page.has_more);
        assert_eq!(page.next_cursor.as_deref(), Some("opaque-next"));
    }

    #[test]
    fn rejects_write_capable_dws_commands() {
        let read_args = string_args(&[
            "chat",
            "message",
            "list-all",
            "--start",
            "2026-07-16 12:00:00",
            "--end",
            "2026-07-17 12:00:00",
            "--limit",
            "50",
            "--cursor",
            "0",
            "--format",
            "json",
            "-y",
        ]);
        assert!(validate_dws_args(&read_args).is_ok());
        assert!(validate_dws_args(&string_args(&["auth", "status"])).is_ok());
        assert!(validate_dws_args(&string_args(&["auth", "login"])).is_ok());
        assert!(validate_dws_args(&string_args(&["chat", "message", "send"])).is_err());
        assert!(validate_dws_args(&string_args(&["chat", "message", "recall"])).is_err());
    }

    #[tokio::test]
    async fn paginates_all_conversations_and_deduplicates_messages() {
        let temp = tempfile::tempdir().unwrap();
        let runner = Arc::new(FakeRunner::new(vec![
            ok_output(r#"{"success":true,"authenticated":true}"#),
            ok_output(&page_output(
                "群聊",
                &[("mid-1", "第一条")],
                true,
                Some("cursor-2"),
            )),
            ok_output(&page_output(
                "私聊",
                &[("mid-1", "重复"), ("mid-2", "第二条")],
                false,
                None,
            )),
        ]));
        let bridge = test_bridge(temp.path(), runner.clone());
        let hush = Arc::new(Mutex::new(HushStore::with_file_path(
            temp.path().join("hush-inbox.json"),
        )));

        let report = bridge.sync(hush.clone()).await.unwrap();

        assert_eq!(report.conversations, 2);
        assert_eq!(report.examined_messages, 3);
        assert_eq!(report.imported_messages, 2);
        assert_eq!(report.duplicate_messages, 1);
        assert_eq!(report.pages, 2);
        assert!(!report.partial);
        assert_eq!(hush.lock().unwrap().summary().total, 2);
        let calls = runner.calls();
        assert_eq!(argument_value(&calls[1], "--cursor"), Some("0"));
        assert_eq!(argument_value(&calls[2], "--cursor"), Some("cursor-2"));
    }

    #[tokio::test]
    async fn persists_partial_cursor_and_resumes_the_same_interval() {
        let temp = tempfile::tempdir().unwrap();
        let mut first_outputs = vec![ok_output(r#"{"success":true,"authenticated":true}"#)];
        for page in 1..=MAX_SYNC_PAGES {
            first_outputs.push(ok_output(&page_output(
                "项目群",
                &[(Box::leak(format!("mid-{page}").into_boxed_str()), "消息")],
                true,
                Some(&format!("cursor-{page}")),
            )));
        }
        let first_runner = Arc::new(FakeRunner::new(first_outputs));
        let first_bridge = test_bridge(temp.path(), first_runner);
        let hush = Arc::new(Mutex::new(HushStore::with_file_path(
            temp.path().join("hush-inbox.json"),
        )));

        let first_report = first_bridge.sync(hush.clone()).await.unwrap();
        assert!(first_report.partial);
        assert_eq!(first_report.pages, MAX_SYNC_PAGES);
        assert_eq!(
            first_bridge
                .config_snapshot()
                .await
                .pending_sync
                .as_ref()
                .unwrap()
                .next_cursor,
            format!("cursor-{MAX_SYNC_PAGES}")
        );

        let second_runner = Arc::new(FakeRunner::new(vec![
            ok_output(r#"{"success":true,"authenticated":true}"#),
            ok_output(&page_output(
                "项目群",
                &[("mid-final", "最后一条")],
                false,
                None,
            )),
        ]));
        let second_bridge = test_bridge(temp.path(), second_runner.clone());
        let second_report = second_bridge.sync(hush).await.unwrap();

        assert!(!second_report.partial);
        assert!(second_bridge.config_snapshot().await.pending_sync.is_none());
        assert_eq!(
            argument_value(&second_runner.calls()[1], "--cursor"),
            Some("cursor-40")
        );
    }

    #[tokio::test]
    async fn incremental_sync_overlaps_last_success_by_two_minutes() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("hush-dws.json"),
            serde_json::to_vec_pretty(&json!({
                "auto_sync_enabled": false,
                "sync_interval_minutes": 5,
                "last_success_at": "2026-07-17T11:00:00Z",
                "last_attempt_at": null,
                "pending_sync": null
            }))
            .unwrap(),
        )
        .unwrap();
        let runner = Arc::new(FakeRunner::new(vec![
            ok_output(r#"{"success":true,"authenticated":true}"#),
            ok_output(&page_output("项目群", &[], false, None)),
        ]));
        let bridge = test_bridge(temp.path(), runner.clone());
        let hush = Arc::new(Mutex::new(HushStore::with_file_path(
            temp.path().join("hush-inbox.json"),
        )));

        bridge.sync(hush).await.unwrap();

        let expected_start = Utc
            .with_ymd_and_hms(2026, 7, 17, 10, 58, 0)
            .single()
            .unwrap()
            .with_timezone(&Local)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        assert_eq!(
            argument_value(&runner.calls()[1], "--start"),
            Some(expected_start.as_str())
        );
    }

    #[tokio::test]
    async fn authentication_failure_does_not_move_last_success_boundary() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("hush-dws.json"),
            serde_json::to_vec_pretty(&json!({
                "auto_sync_enabled": false,
                "sync_interval_minutes": 5,
                "last_success_at": "2026-07-17T11:00:00Z",
                "last_attempt_at": null,
                "pending_sync": null
            }))
            .unwrap(),
        )
        .unwrap();
        let runner = Arc::new(FakeRunner::new(vec![ok_output(
            r#"{"success":true,"authenticated":false}"#,
        )]));
        let bridge = test_bridge(temp.path(), runner);
        let hush = Arc::new(Mutex::new(HushStore::with_file_path(
            temp.path().join("hush-inbox.json"),
        )));

        let error = bridge.sync(hush).await.unwrap_err();

        assert!(error.contains("登录"));
        assert_eq!(
            bridge.config_snapshot().await.last_success_at.as_deref(),
            Some("2026-07-17T11:00:00Z")
        );
    }

    #[tokio::test]
    async fn reports_ready_status_for_authenticated_dws() {
        let temp = tempfile::tempdir().unwrap();
        let runner = Arc::new(FakeRunner::new(vec![ok_output(
            r#"{"success":true,"authenticated":true}"#,
        )]));
        let bridge = test_bridge(temp.path(), runner);

        let status = bridge.status().await;

        assert_eq!(status.state, DwsHushState::Ready);
        assert!(status.authenticated);
        assert_eq!(
            status.executable_source,
            Some(DwsExecutableSource::Standalone)
        );
        assert!(!status.auto_sync_enabled);
    }

    #[tokio::test]
    async fn persists_explicit_auto_sync_opt_in() {
        let temp = tempfile::tempdir().unwrap();
        let runner = Arc::new(FakeRunner::new(vec![ok_output(
            r#"{"success":true,"authenticated":true}"#,
        )]));
        let bridge = test_bridge(temp.path(), runner);

        let status = bridge.set_auto_sync(true).await.unwrap();

        assert!(status.auto_sync_enabled);
        let persisted: DwsHushConfig =
            serde_json::from_slice(&std::fs::read(temp.path().join("hush-dws.json")).unwrap())
                .unwrap();
        assert!(persisted.auto_sync_enabled);
        assert_eq!(persisted.sync_interval_minutes, 5);
    }

    #[tokio::test]
    async fn standalone_login_uses_only_the_allowlisted_auth_command() {
        let temp = tempfile::tempdir().unwrap();
        let runner = Arc::new(FakeRunner::new(vec![ok_output("")]));
        let bridge = test_bridge(temp.path(), runner.clone());

        bridge.open_login().await.unwrap();

        assert_eq!(runner.calls(), vec![string_args(&["auth", "login"])]);
    }

    fn string_args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn test_bridge(home: &Path, runner: Arc<FakeRunner>) -> DwsHushBridge {
        let executable_path = home.join("dws");
        std::fs::write(&executable_path, "").unwrap();
        DwsHushBridge::with_test_parts(
            home,
            DwsExecutable {
                path: executable_path,
                source: DwsExecutableSource::Standalone,
            },
            runner,
            Utc.with_ymd_and_hms(2026, 7, 17, 12, 0, 0)
                .single()
                .unwrap(),
        )
        .unwrap()
    }

    fn page_output(
        title: &str,
        messages: &[(&str, &str)],
        has_more: bool,
        next_cursor: Option<&str>,
    ) -> String {
        json!({
            "success": true,
            "result": {
                "conversationMessagesList": [{
                    "openConversationId": format!("cid-{title}"),
                    "singleChat": title == "私聊",
                    "title": title,
                    "messages": messages.iter().map(|(id, content)| json!({
                        "content": content,
                        "createTime": "2026-07-17 11:53:52",
                        "openMessageId": id,
                        "sender": "发送者",
                        "senderOpenDingTalkId": "sender-id"
                    })).collect::<Vec<_>>()
                }],
                "hasMore": has_more,
                "nextCursor": next_cursor
            }
        })
        .to_string()
    }

    fn ok_output(stdout: &str) -> Result<DwsCommandOutput, String> {
        Ok(DwsCommandOutput {
            stdout: stdout.to_string(),
        })
    }

    fn argument_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let index = args.iter().position(|value| value == flag)?;
        args.get(index + 1).map(String::as_str)
    }

    struct FakeRunner {
        outputs: Mutex<VecDeque<Result<DwsCommandOutput, String>>>,
        calls: Mutex<Vec<Vec<String>>>,
    }

    impl FakeRunner {
        fn new(outputs: Vec<Result<DwsCommandOutput, String>>) -> Self {
            Self {
                outputs: Mutex::new(outputs.into()),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<Vec<String>> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl DwsRunner for FakeRunner {
        fn run<'a>(
            &'a self,
            _executable: &'a Path,
            args: &'a [String],
            _timeout: Duration,
        ) -> Pin<Box<dyn Future<Output = Result<DwsCommandOutput, String>> + Send + 'a>> {
            Box::pin(async move {
                self.calls.lock().unwrap().push(args.to_vec());
                self.outputs
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or_else(|| Err("Fake runner has no output".to_string()))
            })
        }
    }
}
