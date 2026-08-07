use crate::hush_store::HushInboxMessage;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const CONFIRMATION_TTL_SECONDS: i64 = 120;
const MAX_REPLY_CHARACTERS: usize = 2_000;
const PLATFORM_TIMEOUT: Duration = Duration::from_secs(45);
const WECHAT_AUTOMATION_TIMEOUT: Duration = Duration::from_secs(15);
const WECHAT_CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);

const WECHAT_PREPARE_SCRIPT: &str = r#"
on run argv
  if (count of argv) is not 2 then error "invalid HUMHUM reply arguments"
  set conversationName to item 1 of argv
  set replyBody to item 2 of argv
  set previousClipboard to the clipboard
  try
    tell application id "com.tencent.xinWeChat" to activate
    delay 0.4
    set the clipboard to conversationName
    tell application "System Events"
      tell first process whose bundle identifier is "com.tencent.xinWeChat"
        set frontmost to true
        keystroke "f" using command down
        delay 0.35
        keystroke "v" using command down
        delay 0.8
        key code 36
        delay 0.9
      end tell
    end tell
    set the clipboard to replyBody
    tell application "System Events"
      tell first process whose bundle identifier is "com.tencent.xinWeChat"
        keystroke "v" using command down
      end tell
    end tell
    set the clipboard to previousClipboard
    return "prepared"
  on error errorMessage number errorNumber
    try
      set the clipboard to previousClipboard
    end try
    error errorMessage number errorNumber
  end try
end run
"#;

const WECHAT_CONFIRM_SCRIPT: &str = r#"
on run argv
  if (count of argv) is not 1 then error "invalid HUMHUM confirmation arguments"
  set conversationName to item 1 of argv
  tell application id "com.tencent.xinWeChat" to activate
  delay 0.35
  set resultButton to button returned of (display dialog "请检查微信当前会话确实是「" & conversationName & "」，并确认输入框中的回复内容。" with title "HUMHUM Hush" buttons {"取消", "确认发送"} default button "取消" cancel button "取消")
  if resultButton is not "确认发送" then error number -128
  tell application "System Events"
    tell first process whose bundle identifier is "com.tencent.xinWeChat"
      set frontmost to true
      key code 36
    end tell
  end tell
  return "sent"
end run
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HushReplyTarget {
    WechatConversation(String),
    DingtalkOpenId(String),
}

#[derive(Debug, Clone)]
pub(crate) struct PendingHushReply {
    pub platform: String,
    pub conversation: String,
    pub target: HushReplyTarget,
    pub body: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HushReplyPreview {
    pub confirmation_id: String,
    pub platform: String,
    pub conversation: String,
    pub body: String,
    pub expires_at: String,
    pub delivery_mode: String,
    pub notice: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HushReplyReceipt {
    pub platform: String,
    pub conversation: String,
    pub sent_at: String,
    pub status: String,
}

#[derive(Debug, Default)]
pub struct HushReplyState {
    pending: Mutex<HashMap<String, PendingHushReply>>,
}

impl HushReplyState {
    pub fn prepare(
        &self,
        message: &HushInboxMessage,
        body: &str,
        now: DateTime<Utc>,
    ) -> Result<HushReplyPreview, String> {
        if message.conversation_kind != "direct" {
            return Err("Hush 目前只允许回复已确认的单聊".to_string());
        }
        if message.preview_limited {
            return Err("系统通知预览无法可靠确认收件人，请先连接真实消息源".to_string());
        }
        let body = body.trim();
        if body.is_empty() {
            return Err("请先填写回复内容".to_string());
        }
        if body.chars().count() > MAX_REPLY_CHARACTERS || body.contains('\0') {
            return Err("回复内容过长或包含无效字符".to_string());
        }

        let platform = message.platform.trim().to_ascii_lowercase();
        let (conversation, target, delivery_mode, notice) = match platform.as_str() {
            "wechat" | "weixin" => {
                let conversation = message
                    .chat
                    .as_deref()
                    .filter(|value| human_readable_conversation(value))
                    .or_else(|| {
                        human_readable_conversation(&message.sender)
                            .then_some(message.sender.as_str())
                    })
                    .ok_or_else(|| {
                        "微信会话名称仍是内部编号，Hush 不会冒险向不确定的联系人发送".to_string()
                    })?
                    .trim()
                    .to_string();
                (
                    conversation.clone(),
                    HushReplyTarget::WechatConversation(conversation),
                    "wechat_ui".to_string(),
                    "Hush 会先在微信中打开这个单聊并填入草稿；最终发送前还会再次要求你确认。"
                        .to_string(),
                )
            }
            "dingtalk" | "dingding" => {
                let target = message
                    .raw
                    .get("sender_open_dingtalk_id")
                    .and_then(serde_json::Value::as_str)
                    .filter(|value| safe_opaque_id(value))
                    .ok_or_else(|| "这条钉钉消息缺少可验证的单聊收件人标识".to_string())?;
                let conversation = message
                    .chat
                    .as_deref()
                    .filter(|value| human_readable_conversation(value))
                    .unwrap_or(message.sender.as_str())
                    .trim()
                    .to_string();
                (
                    conversation,
                    HushReplyTarget::DingtalkOpenId(target.to_string()),
                    "dingtalk_dws".to_string(),
                    "只有点击“确认发送”后，DWS 才会把这一条回复发送给这个钉钉单聊。".to_string(),
                )
            }
            _ => return Err("这个消息来源暂不支持安全回复".to_string()),
        };

        let confirmation_id = uuid::Uuid::new_v4().to_string();
        let expires_at = now + ChronoDuration::seconds(CONFIRMATION_TTL_SECONDS);
        let pending = PendingHushReply {
            platform: platform.clone(),
            conversation: conversation.clone(),
            target,
            body: body.to_string(),
            expires_at,
        };
        let mut entries = self
            .pending
            .lock()
            .map_err(|_| "无法创建回复确认，请重试".to_string())?;
        entries.retain(|_, reply| reply.expires_at >= now);
        entries.insert(confirmation_id.clone(), pending);

        Ok(HushReplyPreview {
            confirmation_id,
            platform,
            conversation,
            body: body.to_string(),
            expires_at: expires_at.to_rfc3339(),
            delivery_mode,
            notice,
        })
    }

    pub(crate) fn take(
        &self,
        confirmation_id: &str,
        now: DateTime<Utc>,
    ) -> Result<PendingHushReply, String> {
        let mut entries = self
            .pending
            .lock()
            .map_err(|_| "无法读取回复确认，请重试".to_string())?;
        let pending = entries
            .remove(confirmation_id)
            .ok_or_else(|| "这次回复确认已失效，请重新准备".to_string())?;
        if pending.expires_at < now {
            return Err("这次回复确认已过期，请重新准备".to_string());
        }
        Ok(pending)
    }

    pub(crate) fn cancel(&self, confirmation_id: &str) {
        if let Ok(mut entries) = self.pending.lock() {
            entries.remove(confirmation_id);
        }
    }
}

fn human_readable_conversation(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.chars().count() <= 160
        && !value.chars().any(char::is_control)
        && !value.starts_with("wxid_")
        && !value.ends_with("@chatroom")
        && !value.chars().all(|character| character.is_ascii_digit())
}

fn safe_opaque_id(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 256
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_:-.".contains(character))
}

pub(crate) fn dws_direct_send_args(open_dingtalk_id: &str) -> Vec<String> {
    vec![
        "chat".to_string(),
        "message".to_string(),
        "send".to_string(),
        "--open-dingtalk-id".to_string(),
        open_dingtalk_id.to_string(),
        "--text".to_string(),
        "@-".to_string(),
        "--title".to_string(),
        "HUMHUM 回复".to_string(),
        "--format".to_string(),
        "json".to_string(),
        "-y".to_string(),
    ]
}

pub(crate) fn dws_executable(home: &Path) -> Option<PathBuf> {
    let executable_name = if cfg!(target_os = "windows") {
        "dws.exe"
    } else {
        "dws"
    };
    let known = [
        home.join(".qoderwork/bin").join(executable_name),
        home.join(".local/bin").join(executable_name),
        PathBuf::from("/opt/homebrew/bin").join(executable_name),
        PathBuf::from("/usr/local/bin").join(executable_name),
        home.join(".real/.bin/dws/bin").join(executable_name),
    ];
    known.into_iter().find(|path| path.is_file())
}

pub(crate) async fn send_dingtalk_direct(
    home: &Path,
    open_dingtalk_id: &str,
    body: &str,
) -> Result<(), String> {
    let executable = dws_executable(home)
        .ok_or_else(|| "未找到钉钉 DWS，请先在连接与状态中安装并登录".to_string())?;
    let mut command = Command::new(executable);
    command
        .args(dws_direct_send_args(open_dingtalk_id))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动钉钉 DWS".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法安全传递钉钉回复内容".to_string())?;
    stdin
        .write_all(body.as_bytes())
        .await
        .map_err(|_| "无法安全传递钉钉回复内容".to_string())?;
    drop(stdin);
    let status = tokio::time::timeout(PLATFORM_TIMEOUT, child.wait())
        .await
        .map_err(|_| "钉钉回复超时，请检查网络后重试".to_string())?
        .map_err(|_| "钉钉回复执行失败".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("钉钉未接受这条回复，请确认 DWS 已登录且企业已授权".to_string())
    }
}

pub(crate) async fn prepare_wechat_draft(conversation: &str, body: &str) -> Result<(), String> {
    run_wechat_automation(
        WECHAT_PREPARE_SCRIPT,
        &[conversation.to_string(), body.to_string()],
        WECHAT_AUTOMATION_TIMEOUT,
        "无法在微信中准备回复，请确认微信已登录并允许 HUMHUM 使用辅助功能",
    )
    .await
}

pub(crate) async fn confirm_wechat_send(conversation: &str) -> Result<(), String> {
    run_wechat_automation(
        WECHAT_CONFIRM_SCRIPT,
        &[conversation.to_string()],
        WECHAT_CONFIRM_TIMEOUT,
        "微信回复未发送；请重新准备并确认当前会话",
    )
    .await
}

#[cfg(target_os = "macos")]
async fn run_wechat_automation(
    script: &str,
    args: &[String],
    timeout: Duration,
    error_message: &str,
) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/osascript");
    command
        .arg("-e")
        .arg(script)
        .arg("--")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let status = tokio::time::timeout(timeout, command.status())
        .await
        .map_err(|_| error_message.to_string())?
        .map_err(|_| error_message.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(error_message.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
async fn run_wechat_automation(
    _script: &str,
    _args: &[String],
    _timeout: Duration,
    _error_message: &str,
) -> Result<(), String> {
    Err("微信安全回复目前仅支持 macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hush_store::HushInboxMessage;
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    fn direct_dingtalk_message() -> HushInboxMessage {
        HushInboxMessage {
            id: "hush-dingtalk".to_string(),
            platform: "dingtalk".to_string(),
            sender: "成员乙".to_string(),
            chat: Some("成员乙".to_string()),
            text: "在吗？".to_string(),
            tier: "work".to_string(),
            importance: 3,
            conversation_kind: "direct".to_string(),
            received_at: "2026-07-28T04:00:00Z".to_string(),
            source_id: Some("dws:message-1".to_string()),
            preview_limited: false,
            raw: json!({
                "source": "dws",
                "single_chat": true,
                "sender_open_dingtalk_id": "open-dingtalk-user-1"
            }),
        }
    }

    fn direct_wechat_message() -> HushInboxMessage {
        HushInboxMessage {
            id: "hush-wechat".to_string(),
            platform: "wechat".to_string(),
            sender: "小明".to_string(),
            chat: Some("小明".to_string()),
            text: "吃饭了吗？".to_string(),
            tier: "friends".to_string(),
            importance: 2,
            conversation_kind: "direct".to_string(),
            received_at: "2026-07-28T04:00:00Z".to_string(),
            source_id: Some("wechat-native:message-1".to_string()),
            preview_limited: false,
            raw: json!({
                "source": "wechat_native",
                "talker": "wxid_internal_value"
            }),
        }
    }

    #[test]
    fn dingtalk_target_is_derived_from_the_stored_message_and_never_serialized() {
        let now = Utc.with_ymd_and_hms(2026, 7, 28, 8, 0, 0).unwrap();
        let state = HushReplyState::default();

        let preview = state
            .prepare(&direct_dingtalk_message(), "我在，什么事？", now)
            .unwrap();

        let serialized = serde_json::to_string(&preview).unwrap();
        assert!(!serialized.contains("open-dingtalk-user-1"));
        assert_eq!(preview.platform, "dingtalk");
        assert_eq!(preview.conversation, "成员乙");

        let pending = state.take(&preview.confirmation_id, now).unwrap();
        assert_eq!(
            pending.target,
            HushReplyTarget::DingtalkOpenId("open-dingtalk-user-1".to_string())
        );
        assert_eq!(pending.body, "我在，什么事？");
        assert!(state.take(&preview.confirmation_id, now).is_err());
    }

    #[test]
    fn confirmation_tokens_expire_and_are_single_use() {
        let now = Utc.with_ymd_and_hms(2026, 7, 28, 8, 0, 0).unwrap();
        let state = HushReplyState::default();
        let preview = state
            .prepare(&direct_wechat_message(), "刚吃完。", now)
            .unwrap();

        assert!(state
            .take(
                &preview.confirmation_id,
                now + chrono::Duration::seconds(121)
            )
            .is_err());
        assert!(state.take(&preview.confirmation_id, now).is_err());
    }

    #[test]
    fn group_and_notification_preview_messages_cannot_be_replied_to() {
        let now = Utc.with_ymd_and_hms(2026, 7, 28, 8, 0, 0).unwrap();
        let state = HushReplyState::default();
        let mut group = direct_dingtalk_message();
        group.conversation_kind = "group".to_string();
        assert!(state.prepare(&group, "收到", now).is_err());

        let mut preview = direct_wechat_message();
        preview.preview_limited = true;
        assert!(state.prepare(&preview, "收到", now).is_err());
    }

    #[test]
    fn wechat_requires_a_human_readable_conversation_label() {
        let now = Utc.with_ymd_and_hms(2026, 7, 28, 8, 0, 0).unwrap();
        let state = HushReplyState::default();
        let mut message = direct_wechat_message();
        message.chat = Some("wxid_internal_value".to_string());
        message.sender = "123456789".to_string();

        assert!(state.prepare(&message, "收到", now).is_err());
    }

    #[test]
    fn dws_send_uses_stdin_and_a_fixed_allowlisted_command_shape() {
        let args = dws_direct_send_args("open-dingtalk-user-1");

        assert_eq!(
            args,
            vec![
                "chat",
                "message",
                "send",
                "--open-dingtalk-id",
                "open-dingtalk-user-1",
                "--text",
                "@-",
                "--title",
                "HUMHUM 回复",
                "--format",
                "json",
                "-y"
            ]
        );
        assert!(!args.iter().any(|value| value.contains("secret body")));
    }
}
