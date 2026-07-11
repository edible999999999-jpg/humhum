use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use uuid::Uuid;

const MAX_HUSH_MESSAGES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HushInboxMessage {
    pub id: String,
    pub platform: String,
    pub sender: String,
    pub chat: Option<String>,
    pub text: String,
    pub tier: String,
    pub importance: u8,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HushInboundPayload {
    pub platform: Option<String>,
    pub sender: Option<String>,
    pub chat: Option<String>,
    pub text: Option<String>,
    pub tier: Option<String>,
    pub importance: Option<u8>,
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
        let messages = std::fs::read_to_string(&file_path)
            .ok()
            .and_then(|contents| serde_json::from_str::<Vec<HushInboxMessage>>(&contents).ok())
            .unwrap_or_default();
        Self {
            messages,
            file_path,
        }
    }

    pub fn add_from_value(&mut self, raw: Value) -> Result<HushInboxMessage, String> {
        let parsed: HushInboundPayload =
            serde_json::from_value(raw.clone()).unwrap_or_else(|_| HushInboundPayload {
                platform: None,
                sender: None,
                chat: None,
                text: None,
                tier: None,
                importance: None,
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
        let suggested_reply = if parsed.preview_limited {
            None
        } else {
            parsed
                .suggested_reply
                .clone()
                .or_else(|| suggest_reply(&tier, &sender, &text))
        };

        let message = HushInboxMessage {
            id: format!("hush-{}", Uuid::new_v4()),
            platform,
            sender,
            chat,
            text,
            tier,
            importance,
            suggested_reply,
            received_at: parsed
                .received_at
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            source_id: parsed.source_id,
            preview_limited: parsed.preview_limited,
            raw,
        };

        self.messages.insert(0, message.clone());
        if self.messages.len() > MAX_HUSH_MESSAGES {
            self.messages.truncate(MAX_HUSH_MESSAGES);
        }
        self.save()?;
        Ok(message)
    }

    pub fn contains_source_id(&self, source_id: &str) -> bool {
        self.messages
            .iter()
            .any(|message| message.source_id.as_deref() == Some(source_id))
    }

    pub fn summary(&self) -> HushInboxSummary {
        let mut by_tier = BTreeMap::new();
        let mut by_platform = BTreeMap::new();
        for message in &self.messages {
            *by_tier.entry(message.tier.clone()).or_insert(0) += 1;
            *by_platform.entry(message.platform.clone()).or_insert(0) += 1;
        }

        HushInboxSummary {
            total: self.messages.len(),
            unread_priority: self
                .messages
                .iter()
                .filter(|message| message.importance >= 4)
                .count(),
            by_tier,
            by_platform,
            messages: self.messages.clone(),
        }
    }

    pub fn clear(&mut self) -> Result<(), String> {
        self.messages.clear();
        self.save()
    }

    fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create Hush store dir: {}", e))?;
        }
        let json = serde_json::to_string_pretty(&self.messages)
            .map_err(|e| format!("Failed to serialize Hush inbox: {}", e))?;
        std::fs::write(&self.file_path, json)
            .map_err(|e| format!("Failed to write Hush inbox: {}", e))
    }

    #[cfg(test)]
    fn with_file_path(file_path: PathBuf) -> Self {
        Self {
            messages: Vec::new(),
            file_path,
        }
    }
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
    if ["妈妈", "爸爸", "家", "family", "mom", "dad", "parent"]
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

fn suggest_reply(tier: &str, sender: &str, text: &str) -> Option<String> {
    if tier == "family" {
        Some(format!(
            "我看到了，晚点认真回你。{}",
            if text.contains("吃") {
                "我会记得按时吃饭。"
            } else {
                ""
            }
        ))
    } else if tier == "work" {
        Some(format!("收到，我先看一下，稍后同步进展给你。@{}", sender))
    } else {
        Some("看到了，我晚点回你～".to_string())
    }
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
}
