use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use uuid::Uuid;

const MAX_HUSH_MESSAGES: usize = 2_000;
const DWS_RETENTION_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HushInboxMessage {
    pub id: String,
    pub platform: String,
    pub sender: String,
    pub chat: Option<String>,
    pub text: String,
    pub tier: String,
    pub importance: u8,
    #[serde(default = "default_conversation_kind")]
    pub conversation_kind: String,
    pub suggested_reply: Option<String>,
    pub received_at: String,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub preview_limited: bool,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HushInboxSummary {
    pub total: usize,
    pub unread_priority: usize,
    pub by_tier: BTreeMap<String, usize>,
    pub by_platform: BTreeMap<String, usize>,
    pub messages: Vec<HushInboxMessage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HushBatchImportResult {
    pub imported: usize,
    pub duplicates: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HushInboundPayload {
    pub platform: Option<String>,
    pub sender: Option<String>,
    pub chat: Option<String>,
    pub text: Option<String>,
    pub tier: Option<String>,
    pub importance: Option<u8>,
    pub conversation_kind: Option<String>,
    pub suggested_reply: Option<String>,
    pub received_at: Option<String>,
    pub source_id: Option<String>,
    #[serde(default)]
    pub preview_limited: bool,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug)]
pub struct HushStore {
    messages: Vec<HushInboxMessage>,
    file_path: PathBuf,
}

impl HushStore {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let file_path = home.join(".humhum").join("hush-inbox.json");
        let messages = if std::fs::symlink_metadata(&file_path)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            log::warn!("Refusing to read a symbolic-link Hush inbox");
            Vec::new()
        } else {
            if file_path.exists() {
                if let Err(error) = crate::local_api_auth::protect_owner_only(&file_path) {
                    log::warn!("Failed to protect Hush inbox before reading it: {error}");
                }
            }
            std::fs::read_to_string(&file_path)
                .ok()
                .and_then(|contents| serde_json::from_str::<Vec<HushInboxMessage>>(&contents).ok())
                .unwrap_or_default()
        };
        Self {
            messages,
            file_path,
        }
    }

    pub fn add_from_value(&mut self, raw: Value) -> Result<HushInboxMessage, String> {
        let message = self.build_message(raw)?;
        let previous = self.messages.clone();
        self.messages.push(message.clone());
        self.sort_and_limit();
        if let Err(error) = self.save() {
            self.messages = previous;
            return Err(error);
        }
        Ok(message)
    }

    pub fn add_many_from_values(
        &mut self,
        values: Vec<Value>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<HushBatchImportResult, String> {
        let previous = self.messages.clone();
        let mut imported = 0;
        let mut duplicates = 0;
        for raw in values {
            let source_id = raw
                .get("source_id")
                .and_then(Value::as_str)
                .map(str::to_string);
            if source_id
                .as_deref()
                .is_some_and(|source_id| self.contains_source_id(source_id))
            {
                duplicates += 1;
                continue;
            }
            let message = self.build_message(raw)?;
            self.messages.push(message);
            imported += 1;
        }
        if let Err(error) = self.prune_and_save(now) {
            self.messages = previous;
            return Err(error);
        }
        Ok(HushBatchImportResult {
            imported,
            duplicates,
        })
    }

    fn build_message(&self, raw: Value) -> Result<HushInboxMessage, String> {
        let parsed: HushInboundPayload =
            serde_json::from_value(raw.clone()).unwrap_or_else(|_| HushInboundPayload {
                platform: None,
                sender: None,
                chat: None,
                text: None,
                tier: None,
                importance: None,
                conversation_kind: None,
                suggested_reply: None,
                received_at: None,
                source_id: None,
                preview_limited: false,
                extra: BTreeMap::new(),
            });

        if let Some(source_id) = parsed.source_id.as_deref() {
            if self.contains_source_id(source_id) {
                return Err(format!("Duplicate source message: {source_id}"));
            }
        }

        let text = parsed
            .text
            .clone()
            .or_else(|| extract_text_from_dingtalk(&raw))
            .or_else(|| {
                raw.get("content")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .ok_or_else(|| {
                "Missing message text. Send text or DingTalk text.content.".to_string()
            })?;

        let sender = parsed
            .sender
            .clone()
            .or_else(|| {
                raw.get("senderNick")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| {
                raw.get("sender")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Unknown sender".to_string());

        let chat = parsed
            .chat
            .clone()
            .or_else(|| {
                raw.get("conversationTitle")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| raw.get("chat").and_then(Value::as_str).map(str::to_string));

        let platform = parsed
            .platform
            .clone()
            .or_else(|| infer_platform(&raw))
            .unwrap_or_else(|| "dingtalk".to_string());

        let tier = parsed
            .tier
            .clone()
            .unwrap_or_else(|| infer_tier(&sender, chat.as_deref(), &text));
        let importance = parsed
            .importance
            .unwrap_or_else(|| infer_importance(&tier, &text));
        let conversation_kind =
            infer_conversation_kind(parsed.conversation_kind.as_deref(), &raw);
        let suggested_reply = if parsed.preview_limited || conversation_kind != "direct" {
            None
        } else {
            parsed
                .suggested_reply
                .clone()
                .or_else(|| suggest_reply(&tier, &text))
        };

        let message = HushInboxMessage {
            id: format!("hush-{}", Uuid::new_v4()),
            platform,
            sender,
            chat,
            text,
            tier,
            importance,
            conversation_kind,
            suggested_reply,
            received_at: parsed
                .received_at
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            source_id: parsed.source_id,
            preview_limited: parsed.preview_limited,
            raw,
        };

        Ok(message)
    }

    pub fn contains_source_id(&self, source_id: &str) -> bool {
        self.messages
            .iter()
            .any(|message| message.source_id.as_deref() == Some(source_id))
    }

    pub fn summary(&self) -> HushInboxSummary {
        let messages: Vec<_> = self
            .messages
            .iter()
            .map(normalize_dws_priority_metadata)
            .collect();
        let mut by_tier = BTreeMap::new();
        let mut by_platform = BTreeMap::new();
        for message in &messages {
            *by_tier.entry(message.tier.clone()).or_insert(0) += 1;
            *by_platform.entry(message.platform.clone()).or_insert(0) += 1;
        }

        HushInboxSummary {
            total: messages.len(),
            unread_priority: messages
                .iter()
                .filter(|message| message.importance >= 4)
                .count(),
            by_tier,
            by_platform,
            messages,
        }
    }

    pub fn clear(&mut self) -> Result<(), String> {
        let previous = std::mem::take(&mut self.messages);
        if let Err(error) = self.save() {
            self.messages = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn prune_and_save(&mut self, now: chrono::DateTime<chrono::Utc>) -> Result<(), String> {
        let previous = self.messages.clone();
        let cutoff = now - chrono::Duration::days(DWS_RETENTION_DAYS);
        self.messages.retain(|message| {
            if !is_dws_message(message) {
                return true;
            }
            parse_received_at(&message.received_at)
                .map(|received_at| received_at >= cutoff)
                .unwrap_or(true)
        });
        self.sort_and_limit();
        if let Err(error) = self.save() {
            self.messages = previous;
            return Err(error);
        }
        Ok(())
    }

    fn sort_and_limit(&mut self) {
        self.messages.sort_by(|left, right| {
            parse_received_at(&right.received_at)
                .cmp(&parse_received_at(&left.received_at))
                .then_with(|| right.received_at.cmp(&left.received_at))
        });
        self.messages.truncate(MAX_HUSH_MESSAGES);
    }

    fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create Hush inbox directory: {}", e))?;
        }
        let json = serde_json::to_string_pretty(&self.messages)
            .map_err(|e| format!("Failed to serialize Hush inbox: {}", e))?;
        crate::local_api_auth::write_private_file_atomically(&self.file_path, json.as_bytes())
            .map_err(|e| format!("Failed to atomically write private Hush inbox: {}", e))
    }

    #[cfg(test)]
    pub(crate) fn with_file_path(file_path: PathBuf) -> Self {
        Self {
            messages: Vec::new(),
            file_path,
        }
    }
}

fn parse_received_at(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&chrono::Utc))
}

fn is_dws_message(message: &HushInboxMessage) -> bool {
    message
        .source_id
        .as_deref()
        .is_some_and(|source_id| source_id.starts_with("dws:"))
        || message.raw.get("source").and_then(Value::as_str) == Some("dws")
}

fn normalize_dws_priority_metadata(message: &HushInboxMessage) -> HushInboxMessage {
    let mut normalized = message.clone();
    if is_dws_message(message) {
        normalized.tier = infer_tier(&message.sender, message.chat.as_deref(), &message.text);
        normalized.importance = infer_importance(&normalized.tier, &message.text);
    }
    normalized
}

fn extract_text_from_dingtalk(raw: &Value) -> Option<String> {
    raw.pointer("/text/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            raw.pointer("/markdown/text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn infer_platform(raw: &Value) -> Option<String> {
    if raw.get("conversationTitle").is_some() || raw.get("senderNick").is_some() {
        Some("dingtalk".to_string())
    } else {
        raw.get("platform")
            .and_then(Value::as_str)
            .map(str::to_string)
    }
}

fn infer_tier(sender: &str, chat: Option<&str>, text: &str) -> String {
    let combined = format!(
        "{} {} {}",
        sender.to_lowercase(),
        chat.unwrap_or("").to_lowercase(),
        text.to_lowercase()
    );
    if [
        "妈妈", "爸爸", "家里", "家人", "家庭", "family", "mom", "dad", "parent",
    ]
    .iter()
    .any(|needle| combined.contains(needle))
    {
        "family".to_string()
    } else if [
        "项目", "需求", "周报", "prd", "bug", "review", "deploy", "工作", "会议", "deadline",
    ]
    .iter()
    .any(|needle| combined.contains(needle))
    {
        "work".to_string()
    } else {
        "friends".to_string()
    }
}

fn infer_importance(tier: &str, text: &str) -> u8 {
    let urgent = [
        "紧急", "马上", "尽快", "urgent", "asap", "deadline", "blocked",
    ]
    .iter()
    .any(|needle| text.to_lowercase().contains(needle));
    if urgent {
        5
    } else if tier == "family" {
        4
    } else if tier == "work" {
        3
    } else {
        2
    }
}

fn default_conversation_kind() -> String {
    "unknown".to_string()
}

fn infer_conversation_kind(explicit: Option<&str>, raw: &Value) -> String {
    let normalized = explicit
        .or_else(|| raw.get("conversation_kind").and_then(Value::as_str))
        .map(str::trim)
        .map(str::to_lowercase);
    match normalized.as_deref() {
        Some("direct" | "single" | "single_chat") => return "direct".to_string(),
        Some("group" | "group_chat") => return "group".to_string(),
        _ => {}
    }

    match raw.get("single_chat").and_then(Value::as_bool) {
        Some(true) => "direct".to_string(),
        Some(false) => "group".to_string(),
        None => default_conversation_kind(),
    }
}

fn suggest_reply(tier: &str, text: &str) -> Option<String> {
    let normalized = text.to_lowercase();
    if normalized.contains("图片消息") {
        Some("图片收到了，我看一下内容，确认后回复你。".to_string())
    } else if ["查到吗", "有结果吗", "进展呢", "怎么样了"]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        Some("我正在确认，查到明确结果后马上回复你。".to_string())
    } else if let Some(schedule) = meeting_schedule_prefix(text) {
        Some(format!(
            "可以，我先确认一下{}的安排，稍后明确回复你。",
            schedule
        ))
    } else if ["紧急", "马上", "尽快", "urgent", "asap", "blocked"]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        Some("收到，我会优先处理，并尽快同步明确进展。".to_string())
    } else if ["看一下", "确认一下", "review", "检查", "评审"]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        Some("收到，我先看一下，整理好结论后明确回复你。".to_string())
    } else if ["帮忙", "麻烦", "请你", "能否"]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        Some("可以，我先处理这件事，完成后把结果回复你。".to_string())
    } else if normalized.contains('？') || normalized.contains('?') || normalized.contains("可以吗")
    {
        Some("可以，我先确认一下具体情况，稍后明确回复你。".to_string())
    } else if tier == "family" && text.contains('吃') {
        Some("好，我会记得按时吃饭，也会认真回复你。".to_string())
    } else if tier == "work" {
        Some("收到，我会按这条信息推进，有结果后回复你。".to_string())
    } else {
        Some("好，我知道了，我确认后回复你。".to_string())
    }
}

fn meeting_schedule_prefix(text: &str) -> Option<String> {
    ["开会", "会议"].iter().find_map(|marker| {
        let prefix = text.split_once(marker)?.0.trim().trim_matches([
            '，', ',', '。', '.', '？', '?', '！', '!',
        ]);
        let length = prefix.chars().count();
        (length > 0 && length <= 20).then(|| prefix.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_file(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("humhum-hush-{label}-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn legacy_messages_default_notification_fields() {
        let message: HushInboxMessage = serde_json::from_value(json!({
            "id": "legacy",
            "platform": "wechat",
            "sender": "WeChat",
            "chat": null,
            "text": "hello",
            "tier": "friends",
            "importance": 2,
            "suggested_reply": null,
            "received_at": "2026-07-11T00:00:00Z",
            "raw": {}
        }))
        .unwrap();

        assert_eq!(message.source_id, None);
        assert!(!message.preview_limited);
        assert_eq!(message.conversation_kind, "unknown");
    }

    #[test]
    fn group_messages_never_receive_suggested_replies() {
        let path = temp_file("group-no-reply");
        let mut store = HushStore::with_file_path(path.clone());
        let message = store
            .add_from_value(json!({
                "platform": "dingtalk",
                "sender": "成员甲",
                "chat": "项目群",
                "text": "大家下午三点一起评审",
                "single_chat": false,
                "suggested_reply": "看到了，我晚点回你",
                "source_id": "dws:group-message",
                "source": "dws"
            }))
            .unwrap();

        assert_eq!(message.conversation_kind, "group");
        assert!(message.suggested_reply.is_none());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn direct_messages_receive_content_aware_suggested_replies() {
        let path = temp_file("direct-reply");
        let mut store = HushStore::with_file_path(path.clone());
        let message = store
            .add_from_value(json!({
                "platform": "dingtalk",
                "sender": "成员甲",
                "chat": "成员甲",
                "text": "明天下午三点开会可以吗？",
                "single_chat": true,
                "source_id": "dws:direct-message",
                "source": "dws"
            }))
            .unwrap();

        assert_eq!(message.conversation_kind, "direct");
        assert_eq!(
            message.suggested_reply.as_deref(),
            Some("可以，我先确认一下明天下午三点的安排，稍后明确回复你。")
        );
        assert_ne!(
            message.suggested_reply.as_deref(),
            Some("看到了，我晚点回你～")
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn direct_reply_templates_cover_progress_questions_and_images() {
        assert_eq!(
            suggest_reply("friends", "怎么样郭师，有查到吗").as_deref(),
            Some("我正在确认，查到明确结果后马上回复你。")
        );
        assert_eq!(
            suggest_reply(
                "friends",
                "图片消息 注意：如需下载使用 dws chat message download-media"
            )
            .as_deref(),
            Some("图片收到了，我看一下内容，确认后回复你。")
        );
    }

    #[test]
    fn expert_team_wording_does_not_turn_work_groups_into_family_messages() {
        let tier = infer_tier("陶里", Some("Qoder项目群"), "专家团需要评审方案");

        assert_eq!(tier, "work");
        assert_eq!(infer_importance(&tier, "专家团需要评审方案"), 3);
    }

    #[test]
    fn summary_repairs_legacy_dws_priority_metadata_without_changing_content() {
        let path = temp_file("legacy-dws-priority");
        let mut store = HushStore::with_file_path(path.clone());
        store.messages.push(HushInboxMessage {
            id: "legacy-message".to_string(),
            platform: "dingtalk".to_string(),
            sender: "陶里".to_string(),
            chat: Some("Qoder项目群".to_string()),
            text: "专家团需要评审方案".to_string(),
            tier: "family".to_string(),
            importance: 4,
            conversation_kind: "group".to_string(),
            suggested_reply: None,
            received_at: "2026-07-18T01:00:00Z".to_string(),
            source_id: Some("dws:legacy-message".to_string()),
            preview_limited: false,
            raw: json!({ "source": "dws", "single_chat": false }),
        });

        let message = store.summary().messages.into_iter().next().unwrap();

        assert_eq!(message.text, "专家团需要评审方案");
        assert_eq!(message.tier, "work");
        assert_eq!(message.importance, 3);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unknown_conversation_types_do_not_receive_suggested_replies() {
        let path = temp_file("unknown-no-reply");
        let mut store = HushStore::with_file_path(path.clone());
        let message = store
            .add_from_value(json!({
                "platform": "wechat",
                "sender": "微信",
                "text": "请确认一下"
            }))
            .unwrap();

        assert_eq!(message.conversation_kind, "unknown");
        assert!(message.suggested_reply.is_none());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_duplicate_source_id() {
        let path = temp_file("dedupe");
        let mut store = HushStore::with_file_path(path.clone());
        let payload = json!({
            "platform": "wechat",
            "sender": "WeChat",
            "text": "你收到了一条消息",
            "source_id": "wechat:abc",
            "preview_limited": true,
            "received_at": "2026-07-11T01:02:03Z"
        });

        let first = store.add_from_value(payload.clone()).unwrap();
        assert_eq!(first.received_at, "2026-07-11T01:02:03Z");
        assert!(first.preview_limited);
        assert!(first.suggested_reply.is_none());

        let error = store.add_from_value(payload).unwrap_err();
        assert!(error.contains("Duplicate source message"));
        assert_eq!(store.summary().total, 1);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn failed_private_persistence_rolls_back_hush_memory() {
        let temp = tempfile::tempdir().unwrap();
        let blocker = temp.path().join("not-a-directory");
        std::fs::write(&blocker, b"block child creation").unwrap();
        let mut store = HushStore::with_file_path(blocker.join("hush-inbox.json"));

        let error = store
            .add_from_value(json!({
                "platform": "wechat",
                "sender": "WeChat",
                "text": "private message"
            }))
            .unwrap_err();

        assert!(error.contains("Hush"));
        assert_eq!(store.summary().total, 0);
    }

    #[test]
    fn prunes_expired_dws_messages_without_removing_other_sources() {
        let path = temp_file("retention");
        let mut store = HushStore::with_file_path(path.clone());
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);

        for (source_id, platform, received_at) in [
            ("dws:expired", "dingtalk", "2026-07-09T11:59:59Z"),
            ("dws:recent", "dingtalk", "2026-07-17T11:00:00Z"),
            ("wechat:old", "wechat", "2026-06-01T00:00:00Z"),
        ] {
            store
                .add_from_value(json!({
                    "platform": platform,
                    "sender": "sender",
                    "text": source_id,
                    "source_id": source_id,
                    "received_at": received_at,
                    "source": if source_id.starts_with("dws:") { "dws" } else { "notification" }
                }))
                .unwrap();
        }

        store.prune_and_save(now).unwrap();

        let source_ids: Vec<_> = store
            .summary()
            .messages
            .into_iter()
            .filter_map(|message| message.source_id)
            .collect();
        assert_eq!(source_ids, vec!["dws:recent", "wechat:old"]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn dws_sync_capacity_is_two_thousand_messages() {
        assert_eq!(MAX_HUSH_MESSAGES, 2_000);
    }

    #[test]
    fn batch_import_counts_duplicates_without_failing_the_page() {
        let path = temp_file("batch");
        let mut store = HushStore::with_file_path(path.clone());
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let payload = |source_id: &str, text: &str| {
            json!({
                "platform": "dingtalk",
                "sender": "sender",
                "text": text,
                "source_id": source_id,
                "received_at": "2026-07-17T11:00:00Z",
                "source": "dws"
            })
        };

        let first = store
            .add_many_from_values(vec![payload("dws:1", "one"), payload("dws:2", "two")], now)
            .unwrap();
        let second = store
            .add_many_from_values(
                vec![payload("dws:2", "two again"), payload("dws:3", "three")],
                now,
            )
            .unwrap();

        assert_eq!(first.imported, 2);
        assert_eq!(first.duplicates, 0);
        assert_eq!(second.imported, 1);
        assert_eq!(second.duplicates, 1);
        assert_eq!(store.summary().total, 3);
        let _ = std::fs::remove_file(path);
    }
}
