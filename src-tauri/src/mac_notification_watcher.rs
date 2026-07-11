use chrono::{DateTime, Utc};
use plist::{Dictionary, Value};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;

const APPLE_UNIX_EPOCH_OFFSET_SECONDS: f64 = 978_307_200.0;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
struct NotificationCursor {
    delivered_date: f64,
    record_id: i64,
}

#[derive(Debug)]
enum SourceError {
    PermissionDenied(String),
    Missing(String),
    Database(String),
}

#[derive(Debug)]
struct NotificationBatch {
    notifications: Vec<DecodedNotification>,
    skipped_records: usize,
    cursor: NotificationCursor,
}

#[derive(Debug, Clone, PartialEq)]
struct DecodedNotification {
    platform: String,
    sender: String,
    chat: Option<String>,
    text: String,
    source_id: String,
    received_at: String,
    preview_limited: bool,
}

fn initial_cursor(path: &Path) -> Result<NotificationCursor, SourceError> {
    let connection = open_read_only(path)?;
    connection
        .query_row(
            "SELECT r.delivered_date, r.rec_id
             FROM record r
             JOIN app a ON a.app_id = r.app_id
             WHERE lower(a.identifier) IN ('com.tencent.xinwechat', 'com.alibaba.dingtalkmac')
             ORDER BY r.delivered_date DESC, r.rec_id DESC
             LIMIT 1",
            [],
            |row| {
                Ok(NotificationCursor {
                    delivered_date: row.get(0)?,
                    record_id: row.get(1)?,
                })
            },
        )
        .optional()
        .map(|cursor| cursor.unwrap_or_default())
        .map_err(|error| SourceError::Database(error.to_string()))
}

fn fetch_new_notifications(
    path: &Path,
    cursor: &NotificationCursor,
) -> Result<NotificationBatch, SourceError> {
    let connection = open_read_only(path)?;
    let mut statement = connection
        .prepare(
            "SELECT r.rec_id, lower(a.identifier), r.uuid, r.data, r.delivered_date
             FROM record r
             JOIN app a ON a.app_id = r.app_id
             WHERE lower(a.identifier) IN ('com.tencent.xinwechat', 'com.alibaba.dingtalkmac')
               AND (r.delivered_date > ?1 OR (r.delivered_date = ?1 AND r.rec_id > ?2))
             ORDER BY r.delivered_date ASC, r.rec_id ASC
             LIMIT 100",
        )
        .map_err(|error| SourceError::Database(error.to_string()))?;
    let rows = statement
        .query_map([cursor.delivered_date, cursor.record_id as f64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, f64>(4)?,
            ))
        })
        .map_err(|error| SourceError::Database(error.to_string()))?;

    let mut notifications = Vec::new();
    let mut skipped_records = 0;
    let mut next_cursor = cursor.clone();
    for row in rows {
        let (record_id, bundle_id, uuid, data, delivered_date) =
            row.map_err(|error| SourceError::Database(error.to_string()))?;
        next_cursor = NotificationCursor {
            delivered_date,
            record_id,
        };
        match decode_payload(record_id, &bundle_id, &uuid, &data, delivered_date) {
            Ok(notification) => notifications.push(notification),
            Err(_) => skipped_records += 1,
        }
    }

    Ok(NotificationBatch {
        notifications,
        skipped_records,
        cursor: next_cursor,
    })
}

fn open_read_only(path: &Path) -> Result<Connection, SourceError> {
    if !path.exists() {
        return Err(SourceError::Missing(path.display().to_string()));
    }
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| SourceError::PermissionDenied(error.to_string()))
}

fn decode_payload(
    record_id: i64,
    bundle_id: &str,
    uuid: &[u8],
    data: &[u8],
    delivered_date: f64,
) -> Result<DecodedNotification, String> {
    let root = Value::from_reader(Cursor::new(data))
        .map_err(|error| format!("Invalid notification plist: {error}"))?;
    let root = root
        .as_dictionary()
        .ok_or_else(|| "Notification plist root is not a dictionary".to_string())?;
    let request = root
        .get("req")
        .and_then(Value::as_dictionary)
        .ok_or_else(|| "Notification plist is missing request data".to_string())?;

    let bundle_id = bundle_id.to_lowercase();
    let (platform, app_name) = match bundle_id.as_str() {
        "com.tencent.xinwechat" => ("wechat", "WeChat"),
        "com.alibaba.dingtalkmac" => ("dingtalk", "DingTalk"),
        _ => return Err(format!("Unsupported notification app: {bundle_id}")),
    };
    let title = string_for_keys(request, &["titl", "title"]);
    let subtitle = string_for_keys(request, &["subt", "subtitle"]);
    let body = string_for_keys(request, &["body"]);
    let text = body
        .clone()
        .or_else(|| subtitle.clone())
        .or_else(|| title.clone())
        .ok_or_else(|| "Notification has no visible text".to_string())?;
    let sender = title.or(subtitle).unwrap_or_else(|| app_name.to_string());
    let preview_limited = is_limited_preview(&text);
    let source_key = if uuid.is_empty() {
        record_id.to_string()
    } else {
        uuid.iter().map(|byte| format!("{byte:02x}")).collect()
    };

    Ok(DecodedNotification {
        platform: platform.to_string(),
        sender,
        chat: string_for_keys(request, &["iden", "threadIdentifier"]),
        text,
        source_id: format!("{bundle_id}:{source_key}"),
        received_at: apple_date_to_rfc3339(delivered_date)?,
        preview_limited,
    })
}

fn string_for_keys(dictionary: &Dictionary, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        dictionary
            .get(*key)
            .and_then(Value::as_string)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn is_limited_preview(text: &str) -> bool {
    let text = text.trim();
    text.is_empty()
        || matches!(
            text,
            "你收到了一条消息" | "You received a message" | "You have a new message"
        )
}

fn apple_date_to_rfc3339(value: f64) -> Result<String, String> {
    let unix_millis = ((value + APPLE_UNIX_EPOCH_OFFSET_SECONDS) * 1000.0).round() as i64;
    DateTime::<Utc>::from_timestamp_millis(unix_millis)
        .map(|date| date.to_rfc3339())
        .ok_or_else(|| format!("Invalid notification delivery date: {value}"))
}

#[cfg(test)]
mod tests {
    use plist::{Dictionary, Value};
    use rusqlite::{params, Connection};
    use std::path::PathBuf;
    use uuid::Uuid;

    fn temp_database(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "humhum-notifications-{label}-{}.db",
            Uuid::new_v4()
        ));
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE app (app_id INTEGER PRIMARY KEY, identifier VARCHAR, badge INTEGER NULL);
                 CREATE TABLE record (
                    rec_id INTEGER PRIMARY KEY,
                    app_id INTEGER,
                    uuid BLOB,
                    data BLOB,
                    request_date REAL,
                    request_last_date REAL,
                    delivered_date REAL,
                    presented Bool,
                    style INTEGER,
                    snooze_fire_date REAL
                 );
                 INSERT INTO app(app_id, identifier) VALUES
                    (1, 'com.tencent.xinwechat'),
                    (2, 'com.alibaba.dingtalkmac'),
                    (3, 'com.example.unrelated');",
            )
            .unwrap();
        path
    }

    fn insert_record(
        path: &PathBuf,
        record_id: i64,
        app_id: i64,
        delivered_date: f64,
        data: &[u8],
    ) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute(
                "INSERT INTO record(rec_id, app_id, uuid, data, delivered_date)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    record_id,
                    app_id,
                    vec![record_id as u8],
                    data,
                    delivered_date
                ],
            )
            .unwrap();
    }

    fn fixture_plist(
        app: &str,
        title: Option<&str>,
        body: &str,
        conversation_id: Option<&str>,
    ) -> Vec<u8> {
        let mut request = Dictionary::new();
        if let Some(title) = title {
            request.insert("titl".to_string(), Value::String(title.to_string()));
        }
        request.insert("body".to_string(), Value::String(body.to_string()));
        if let Some(conversation_id) = conversation_id {
            request.insert(
                "iden".to_string(),
                Value::String(conversation_id.to_string()),
            );
        }

        let mut root = Dictionary::new();
        root.insert("app".to_string(), Value::String(app.to_string()));
        root.insert("req".to_string(), Value::Dictionary(request));

        let mut bytes = Vec::new();
        Value::Dictionary(root)
            .to_writer_binary(&mut bytes)
            .unwrap();
        bytes
    }

    #[test]
    fn decodes_privacy_limited_wechat_notification() {
        let data = fixture_plist(
            "com.tencent.xinWeChat",
            None,
            "你收到了一条消息",
            Some("room_42"),
        );
        let decoded =
            super::decode_payload(7, "com.tencent.xinwechat", &[1, 2, 3], &data, 805_442_595.0)
                .unwrap();

        assert_eq!(decoded.platform, "wechat");
        assert_eq!(decoded.sender, "WeChat");
        assert_eq!(decoded.chat.as_deref(), Some("room_42"));
        assert_eq!(decoded.text, "你收到了一条消息");
        assert!(decoded.preview_limited);
        assert!(decoded.received_at.starts_with("2026-07-11"));
        assert_eq!(decoded.source_id, "com.tencent.xinwechat:010203");
    }

    #[test]
    fn decodes_visible_dingtalk_notification() {
        let data = fixture_plist(
            "com.alibaba.DingTalkMac",
            Some("项目群"),
            "需求文档已更新",
            None,
        );
        let decoded = super::decode_payload(
            8,
            "com.alibaba.dingtalkmac",
            &[4, 5, 6],
            &data,
            805_442_596.0,
        )
        .unwrap();

        assert_eq!(decoded.platform, "dingtalk");
        assert_eq!(decoded.sender, "项目群");
        assert_eq!(decoded.text, "需求文档已更新");
        assert!(!decoded.preview_limited);
        assert_eq!(decoded.source_id, "com.alibaba.dingtalkmac:040506");
    }

    #[test]
    fn initial_cursor_skips_existing_supported_notifications() {
        let path = temp_database("initial-cursor");
        let existing = fixture_plist("com.tencent.xinWeChat", Some("Alice"), "existing", None);
        insert_record(&path, 41, 1, 100.0, &existing);

        let cursor = super::initial_cursor(&path).unwrap();

        assert_eq!(cursor.delivered_date, 100.0);
        assert_eq!(cursor.record_id, 41);
        let batch = super::fetch_new_notifications(&path, &cursor).unwrap();
        assert!(batch.notifications.is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn fetches_new_supported_records_and_skips_malformed_payloads() {
        let path = temp_database("fetch-new");
        let existing = fixture_plist("com.tencent.xinWeChat", Some("Alice"), "existing", None);
        insert_record(&path, 41, 1, 100.0, &existing);
        let cursor = super::initial_cursor(&path).unwrap();

        let new_message = fixture_plist(
            "com.alibaba.DingTalkMac",
            Some("项目群"),
            "new message",
            None,
        );
        insert_record(&path, 42, 2, 101.0, &new_message);
        insert_record(&path, 43, 1, 102.0, b"not a plist");
        insert_record(&path, 44, 3, 103.0, &new_message);

        let batch = super::fetch_new_notifications(&path, &cursor).unwrap();

        assert_eq!(batch.notifications.len(), 1);
        assert_eq!(
            batch.notifications[0].source_id,
            "com.alibaba.dingtalkmac:2a"
        );
        assert_eq!(batch.skipped_records, 1);
        assert_eq!(batch.cursor.delivered_date, 102.0);
        assert_eq!(batch.cursor.record_id, 43);
        let _ = std::fs::remove_file(path);
    }
}
