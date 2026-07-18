use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const MAX_TAIL_BYTES: u64 = 1024 * 1024;
const MAX_RECORDS: usize = 500;
const USER_LIMIT: usize = 10;
const ASSISTANT_LIMIT: usize = 6;
const TOOL_LIMIT: usize = 12;
const MESSAGE_LIMIT: usize = 12;
const SUMMARY_MAX_TEXT_CHARS: usize = 220;
const MESSAGE_MAX_TEXT_CHARS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TranscriptRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TranscriptMessage {
    pub(crate) role: TranscriptRole,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TranscriptSignals {
    pub(crate) user_messages: Vec<String>,
    pub(crate) assistant_messages: Vec<String>,
    pub(crate) tool_names: Vec<String>,
    pub(crate) messages: Vec<TranscriptMessage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CodexPlanStep {
    pub(crate) title: String,
    pub(crate) status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CodexPlanSnapshot {
    pub(crate) timestamp: Option<String>,
    pub(crate) explanation: Option<String>,
    pub(crate) steps: Vec<CodexPlanStep>,
    pub(crate) turn_completed_after_plan: bool,
}

pub(crate) fn parse_transcript_signals(path: &Path) -> Result<TranscriptSignals, String> {
    let recent_lines = read_recent_lines(path)?;
    let mut signals = TranscriptSignals::default();

    for line in recent_lines {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        let role = if is_user_entry(&value) {
            Some(TranscriptRole::User)
        } else if is_assistant_entry(&value) {
            Some(TranscriptRole::Assistant)
        } else {
            None
        };

        match role {
            Some(TranscriptRole::User) => {
                if let Some(text) = extract_text(&value) {
                    push_limited(&mut signals.user_messages, text, USER_LIMIT);
                }
            }
            Some(TranscriptRole::Assistant) => {
                if let Some(text) = extract_text(&value) {
                    push_limited(&mut signals.assistant_messages, text, ASSISTANT_LIMIT);
                }
            }
            None => {}
        }

        if let Some(role) = role {
            if let Some(text) = extract_message_text(&value) {
                push_limited(
                    &mut signals.messages,
                    TranscriptMessage { role, text },
                    MESSAGE_LIMIT,
                );
            }
        }

        for tool in extract_tool_names(&value) {
            push_limited(&mut signals.tool_names, tool, TOOL_LIMIT);
        }
    }

    Ok(signals)
}

pub(crate) fn parse_latest_codex_plan(path: &Path) -> Result<Option<CodexPlanSnapshot>, String> {
    let recent_lines = read_recent_lines(path)?;
    let mut latest: Option<CodexPlanSnapshot> = None;

    for line in recent_lines {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let payload = value.get("payload").unwrap_or(&Value::Null);
        if payload.get("type").and_then(Value::as_str) != Some("function_call")
            || payload.get("name").and_then(Value::as_str) != Some("update_plan")
        {
            if let Some(plan) = latest.as_mut() {
                if let Some(completed) = codex_turn_completed(payload) {
                    plan.turn_completed_after_plan = completed;
                }
            }
            continue;
        }
        let arguments = match payload.get("arguments") {
            Some(Value::String(raw)) => serde_json::from_str::<Value>(raw).ok(),
            Some(Value::Object(_)) => payload.get("arguments").cloned(),
            _ => None,
        };
        let Some(arguments) = arguments else {
            continue;
        };
        let Some(plan) = arguments.get("plan").and_then(Value::as_array) else {
            continue;
        };
        let steps = plan
            .iter()
            .filter_map(|step| {
                let title = step
                    .get("step")
                    .and_then(Value::as_str)
                    .and_then(clean_text)?;
                let status = step
                    .get("status")
                    .and_then(Value::as_str)
                    .and_then(clean_text)?;
                Some(CodexPlanStep { title, status })
            })
            .collect::<Vec<_>>();
        if steps.len() != plan.len() {
            continue;
        }
        latest = Some(CodexPlanSnapshot {
            timestamp: value
                .get("timestamp")
                .and_then(Value::as_str)
                .map(String::from),
            explanation: arguments
                .get("explanation")
                .and_then(Value::as_str)
                .and_then(clean_text),
            steps,
            turn_completed_after_plan: false,
        });
    }

    Ok(latest)
}

pub(crate) fn latest_codex_turn_completed(path: &Path) -> Result<bool, String> {
    let recent_lines = read_recent_lines(path)?;
    let mut completed = false;

    for line in recent_lines {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(turn_completed) = value.get("payload").and_then(codex_turn_completed) {
            completed = turn_completed;
        }
    }

    Ok(completed)
}

fn codex_turn_completed(payload: &Value) -> Option<bool> {
    match payload.get("type").and_then(Value::as_str) {
        Some("task_started" | "turn_aborted") => Some(false),
        Some("task_complete") => Some(payload.get("error").map(Value::is_null).unwrap_or(true)),
        _ => None,
    }
}

fn read_recent_lines(path: &Path) -> Result<Vec<String>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let file_len = file.metadata().map_err(|error| error.to_string())?.len();
    read_recent_lines_from_snapshot(&mut file, file_len)
}

fn read_recent_lines_from_snapshot(file: &mut File, file_len: u64) -> Result<Vec<String>, String> {
    let start = file_len.saturating_sub(MAX_TAIL_BYTES);
    let mut skip_partial_first_record = false;
    if start > 0 {
        file.seek(SeekFrom::Start(start - 1))
            .map_err(|error| error.to_string())?;
        let mut previous = [0_u8; 1];
        file.read_exact(&mut previous)
            .map_err(|error| error.to_string())?;
        skip_partial_first_record = previous[0] != b'\n';
    }
    file.seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;

    let mut bytes = Vec::with_capacity((file_len - start) as usize);
    file.take(file_len - start)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;

    let slice = if skip_partial_first_record {
        match bytes.iter().position(|byte| *byte == b'\n') {
            Some(index) => &bytes[index + 1..],
            None => &[][..],
        }
    } else {
        &bytes[..]
    };

    let content = String::from_utf8_lossy(slice);
    let mut lines = content
        .lines()
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    if lines.len() > MAX_RECORDS {
        lines.drain(..lines.len() - MAX_RECORDS);
    }
    Ok(lines)
}

fn is_user_entry(value: &Value) -> bool {
    value.get("type").and_then(|v| v.as_str()) == Some("user")
        || value
            .get("message")
            .and_then(|message| message.get("role"))
            .and_then(|role| role.as_str())
            == Some("user")
        || value.get("role").and_then(|role| role.as_str()) == Some("user")
        || (value
            .pointer("/payload/type")
            .and_then(|kind| kind.as_str())
            == Some("message")
            && value
                .pointer("/payload/role")
                .and_then(|role| role.as_str())
                == Some("user"))
}

fn is_assistant_entry(value: &Value) -> bool {
    value.get("type").and_then(|v| v.as_str()) == Some("assistant")
        || value
            .get("message")
            .and_then(|message| message.get("role"))
            .and_then(|role| role.as_str())
            == Some("assistant")
        || value.get("role").and_then(|role| role.as_str()) == Some("assistant")
        || (value
            .pointer("/payload/type")
            .and_then(|kind| kind.as_str())
            == Some("message")
            && value
                .pointer("/payload/role")
                .and_then(|role| role.as_str())
                == Some("assistant"))
}

fn extract_text(value: &Value) -> Option<String> {
    let candidates = [
        value.pointer("/message/content"),
        value.pointer("/content"),
        value.pointer("/payload/message"),
        value.pointer("/payload/content"),
    ];

    for candidate in candidates.into_iter().flatten() {
        if let Some(text) = text_from_value(candidate) {
            return Some(truncate_text(&text, SUMMARY_MAX_TEXT_CHARS));
        }
    }
    None
}

fn extract_message_text(value: &Value) -> Option<String> {
    let candidates = [
        value.pointer("/message/content"),
        value.pointer("/content"),
        value.pointer("/payload/message"),
        value.pointer("/payload/content"),
    ];

    for candidate in candidates.into_iter().flatten() {
        if let Some(text) = visible_text_from_value(candidate) {
            return Some(truncate_text(&text, MESSAGE_MAX_TEXT_CHARS));
        }
    }
    None
}

fn text_from_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return clean_text(text);
    }

    if let Some(array) = value.as_array() {
        let parts = array
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(|value| value.as_str())
                    .or_else(|| item.get("content").and_then(|value| value.as_str()))
            })
            .filter_map(clean_text)
            .collect::<Vec<_>>();
        if !parts.is_empty() {
            return Some(parts.join(" "));
        }
    }

    None
}

fn visible_text_from_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return clean_text(text);
    }

    if let Some(array) = value.as_array() {
        let parts = array
            .iter()
            .filter_map(visible_text_from_item)
            .collect::<Vec<_>>();
        if !parts.is_empty() {
            return Some(parts.join(" "));
        }
    }

    None
}

fn visible_text_from_item(value: &Value) -> Option<String> {
    let item_type = value.get("type").and_then(|kind| kind.as_str());
    if matches!(item_type, Some(kind) if !kind.contains("text")) {
        return None;
    }

    value
        .get("text")
        .and_then(|text| text.as_str())
        .or_else(|| value.get("content").and_then(|text| text.as_str()))
        .and_then(clean_text)
}

fn extract_tool_names(value: &Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(name) = value
        .pointer("/payload/name")
        .and_then(|value| value.as_str())
    {
        names.push(name.to_string());
    }
    if let Some(name) = value.get("tool_name").and_then(|value| value.as_str()) {
        names.push(name.to_string());
    }
    if let Some(content) = value
        .pointer("/message/content")
        .and_then(|value| value.as_array())
    {
        for item in content {
            if item.get("type").and_then(|value| value.as_str()) == Some("tool_use") {
                if let Some(name) = item.get("name").and_then(|value| value.as_str()) {
                    names.push(name.to_string());
                }
            }
        }
    }
    names
}

fn push_limited<T>(items: &mut Vec<T>, value: T, limit: usize) {
    items.push(value);
    if items.len() > limit {
        items.remove(0);
    }
}

fn clean_text(text: &str) -> Option<String> {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            output.push('…');
            return output;
        }
        output.push(ch);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{
        latest_codex_turn_completed, parse_latest_codex_plan, parse_transcript_signals,
        read_recent_lines_from_snapshot, TranscriptMessage, TranscriptRole, MAX_TAIL_BYTES,
    };
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::path::Path;

    fn write_lines(path: &Path, lines: &[String]) {
        let body = lines.join("\n");
        std::fs::write(path, format!("{body}\n")).unwrap();
    }

    fn write_content(path: &Path, content: &str) {
        std::fs::write(path, content).unwrap();
    }

    fn json_line(role: &str, text: &str) -> String {
        format!(r#"{{"role":"{role}","content":"{text}"}}"#)
    }

    fn parse(path: &Path) -> super::TranscriptSignals {
        parse_transcript_signals(path).unwrap()
    }

    #[test]
    fn recovers_the_latest_structured_codex_plan_from_the_bounded_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");
        write_lines(
            &path,
            &[
                r#"{"timestamp":"2026-07-17T03:15:05Z","type":"response_item","payload":{"type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"first\",\"plan\":[{\"step\":\"Inspect\",\"status\":\"in_progress\"},{\"step\":\"Fix\",\"status\":\"pending\"}]}"}}"#.to_string(),
                r#"{"timestamp":"2026-07-17T06:59:22Z","type":"response_item","payload":{"type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"latest\",\"plan\":[{\"step\":\"Inspect\",\"status\":\"completed\"},{\"step\":\"Fix\",\"status\":\"in_progress\"}]}"}}"#.to_string(),
                r#"{"timestamp":"2026-07-17T07:10:00Z","type":"event_msg","payload":{"type":"task_complete"}}"#.to_string(),
            ],
        );

        let plan = parse_latest_codex_plan(&path).unwrap().unwrap();

        assert_eq!(plan.timestamp.as_deref(), Some("2026-07-17T06:59:22Z"));
        assert_eq!(plan.explanation.as_deref(), Some("latest"));
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.steps[0].title, "Inspect");
        assert_eq!(plan.steps[0].status, "completed");
        assert_eq!(plan.steps[1].title, "Fix");
        assert_eq!(plan.steps[1].status, "in_progress");
        assert!(plan.turn_completed_after_plan);
    }

    #[test]
    fn latest_codex_turn_completion_is_cleared_by_a_newer_started_turn() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");
        write_lines(
            &path,
            &[
                r#"{"timestamp":"2026-07-18T04:19:14Z","type":"event_msg","payload":{"type":"task_complete"}}"#.to_string(),
                r#"{"timestamp":"2026-07-18T04:20:00Z","type":"event_msg","payload":{"type":"task_started"}}"#.to_string(),
            ],
        );

        assert!(!latest_codex_turn_completed(&path).unwrap());
    }

    #[test]
    fn parses_claude_and_codex_jsonl_forms_into_signals() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("transcript.jsonl");
        write_lines(
            &path,
            &[
                r#"{"type":"user","message":{"role":"user","content":[{"type":"input_text","text":"  make reader shared  "}]}}"#.to_string(),
                r#"{"message":{"role":"assistant","content":[{"type":"text","text":"I will refactor it."},{"type":"tool_use","name":"Read"}]}}"#.to_string(),
                r#"{"role":"assistant","content":"Done shipping."}"#.to_string(),
                r#"{"payload":{"name":"Bash"}}"#.to_string(),
                r#"{"tool_name":"Edit"}"#.to_string(),
            ],
        );

        let signals = parse(&path);

        assert_eq!(
            signals.user_messages,
            vec!["make reader shared".to_string()]
        );
        assert_eq!(
            signals.assistant_messages,
            vec![
                "I will refactor it.".to_string(),
                "Done shipping.".to_string()
            ]
        );
        assert_eq!(
            signals.tool_names,
            vec!["Read".to_string(), "Bash".to_string(), "Edit".to_string()]
        );
        assert_eq!(
            signals.messages,
            vec![
                TranscriptMessage {
                    role: TranscriptRole::User,
                    text: "make reader shared".to_string(),
                },
                TranscriptMessage {
                    role: TranscriptRole::Assistant,
                    text: "I will refactor it.".to_string(),
                },
                TranscriptMessage {
                    role: TranscriptRole::Assistant,
                    text: "Done shipping.".to_string(),
                },
            ]
        );
    }

    #[test]
    fn parses_real_codex_response_item_message_envelopes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("codex.jsonl");
        write_lines(
            &path,
            &[
                r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"真实问题"}]}}"#.to_string(),
                r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"真实回答"}]}}"#.to_string(),
            ],
        );

        let signals = parse(&path);

        assert_eq!(signals.user_messages, vec!["真实问题".to_string()]);
        assert_eq!(signals.assistant_messages, vec!["真实回答".to_string()]);
        assert_eq!(
            signals.messages,
            vec![
                TranscriptMessage {
                    role: TranscriptRole::User,
                    text: "真实问题".to_string(),
                },
                TranscriptMessage {
                    role: TranscriptRole::Assistant,
                    text: "真实回答".to_string(),
                },
            ]
        );
    }

    #[test]
    fn snapshot_reader_ignores_bytes_appended_after_metadata_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("growing.jsonl");
        write_content(&path, &json_line("user", "before-snapshot"));

        let mut reader = OpenOptions::new().read(true).open(&path).unwrap();
        let snapshot_len = reader.metadata().unwrap().len();
        let mut writer = OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(writer, "\n{}", json_line("assistant", "after-snapshot")).unwrap();

        let lines = read_recent_lines_from_snapshot(&mut reader, snapshot_len).unwrap();

        assert_eq!(lines, vec![json_line("user", "before-snapshot")]);
    }

    #[test]
    fn keeps_recent_messages_in_chronological_interleaving_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chronological.jsonl");
        let mut lines = Vec::new();
        for idx in 0..16 {
            let role = if idx % 2 == 0 { "user" } else { "assistant" };
            lines.push(format!(r#"{{"role":"{role}","content":"turn-{idx}"}}"#));
        }
        write_lines(&path, &lines);

        let signals = parse(&path);

        assert_eq!(signals.messages.len(), 12);
        assert_eq!(signals.messages.first().unwrap().text, "turn-4");
        assert_eq!(signals.messages.last().unwrap().text, "turn-15");
        assert_eq!(
            signals
                .messages
                .iter()
                .map(|message| message.text.clone())
                .collect::<Vec<_>>(),
            (4..16).map(|idx| format!("turn-{idx}")).collect::<Vec<_>>()
        );
    }

    #[test]
    fn skips_partial_first_record_when_tail_read_starts_mid_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tail.jsonl");
        let huge = "中".repeat(600_000);
        write_lines(
            &path,
            &[
                format!(r#"{{"role":"user","content":"{huge}"}}"#),
                r#"{"role":"assistant","content":"recent assistant"}"#.to_string(),
                r#"{"role":"user","content":"recent user"}"#.to_string(),
            ],
        );

        let signals = parse(&path);

        assert_eq!(
            signals.messages,
            vec![
                TranscriptMessage {
                    role: TranscriptRole::Assistant,
                    text: "recent assistant".to_string(),
                },
                TranscriptMessage {
                    role: TranscriptRole::User,
                    text: "recent user".to_string(),
                },
            ]
        );
    }

    #[test]
    fn preserves_exact_boundary_record_when_tail_starts_on_a_record_edge() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("exact-boundary.jsonl");
        let prefix = json_line("user", "older context");
        let tail_overhead = json_line("assistant", "").len();
        let tail_text_len = MAX_TAIL_BYTES as usize - tail_overhead;
        let tail_text = format!(
            "keep-boundary{}",
            "x".repeat(tail_text_len - "keep-boundary".len())
        );
        let tail = json_line("assistant", &tail_text);
        assert_eq!(tail.len(), MAX_TAIL_BYTES as usize);
        write_content(&path, &format!("{prefix}\n{tail}"));

        let signals = parse(&path);

        assert_eq!(signals.assistant_messages.len(), 1);
        assert!(signals.assistant_messages[0].starts_with("keep-boundary"));
        assert_eq!(signals.messages.len(), 1);
        assert_eq!(signals.messages[0].role, TranscriptRole::Assistant);
        assert!(signals.messages[0].text.starts_with("keep-boundary"));
        assert_eq!(signals.messages[0].text.chars().count(), 501);
        assert!(signals.messages[0].text.ends_with('…'));
    }

    #[test]
    fn handles_crlf_line_endings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("crlf.jsonl");
        write_content(
            &path,
            concat!(
                r#"{"role":"user","content":"hello"}"#,
                "\r\n",
                r#"{"message":{"role":"assistant","content":"world"}}"#,
                "\r\n",
            ),
        );

        let signals = parse(&path);

        assert_eq!(signals.user_messages, vec!["hello".to_string()]);
        assert_eq!(signals.assistant_messages, vec!["world".to_string()]);
        assert_eq!(
            signals.messages,
            vec![
                TranscriptMessage {
                    role: TranscriptRole::User,
                    text: "hello".to_string(),
                },
                TranscriptMessage {
                    role: TranscriptRole::Assistant,
                    text: "world".to_string(),
                },
            ]
        );
    }

    #[test]
    fn handles_final_record_without_trailing_newline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("no-final-newline.jsonl");
        write_content(
            &path,
            &format!(
                "{}\n{}",
                json_line("user", "alpha"),
                json_line("assistant", "omega")
            ),
        );

        let signals = parse(&path);

        assert_eq!(signals.user_messages, vec!["alpha".to_string()]);
        assert_eq!(signals.assistant_messages, vec!["omega".to_string()]);
        assert_eq!(
            signals.messages,
            vec![
                TranscriptMessage {
                    role: TranscriptRole::User,
                    text: "alpha".to_string(),
                },
                TranscriptMessage {
                    role: TranscriptRole::Assistant,
                    text: "omega".to_string(),
                },
            ]
        );
    }

    #[test]
    fn ignores_malformed_tool_only_reasoning_and_non_text_records_in_messages() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("filtered.jsonl");
        write_lines(
            &path,
            &[
                "{not json".to_string(),
                r#"{"message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash"},{"type":"thinking","text":"internal reasoning"},{"type":"image","source":"x"},{"type":"text","text":"visible answer"}]}}"#.to_string(),
                r#"{"role":"user","content":[{"type":"input_image","source":"x"},{"type":"input_text","text":"real question"}]}"#.to_string(),
                r#"{"role":"assistant","content":[{"type":"thinking","text":"still hidden"}]}"#.to_string(),
            ],
        );

        let signals = parse(&path);

        assert_eq!(signals.tool_names, vec!["Bash".to_string()]);
        assert_eq!(
            signals.messages,
            vec![
                TranscriptMessage {
                    role: TranscriptRole::Assistant,
                    text: "visible answer".to_string(),
                },
                TranscriptMessage {
                    role: TranscriptRole::User,
                    text: "real question".to_string(),
                },
            ]
        );
    }

    #[test]
    fn truncates_text_on_unicode_scalar_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("unicode.jsonl");
        let long = format!("{}尾巴", "你".repeat(221));
        write_lines(
            &path,
            &[format!(r#"{{"role":"assistant","content":"{long}"}}"#)],
        );

        let signals = parse(&path);
        let text = &signals.assistant_messages[0];

        assert_eq!(text.chars().count(), 221);
        assert!(text.ends_with('…'));
        assert_eq!(text.chars().next().unwrap(), '你');
        assert_eq!(signals.messages[0].text, long);
    }

    #[test]
    fn enforces_fixed_signal_limits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("limits.jsonl");
        let mut lines = Vec::new();
        for idx in 0..20 {
            lines.push(format!(
                r#"{{"role":"user","content":"user-{idx}","tool_name":"tool-{idx}"}}"#
            ));
            lines.push(format!(
                r#"{{"role":"assistant","content":"assistant-{idx}"}}"#
            ));
        }
        write_lines(&path, &lines);

        let signals = parse(&path);

        assert_eq!(
            signals.user_messages,
            (10..20)
                .map(|idx| format!("user-{idx}"))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            signals.assistant_messages,
            (14..20)
                .map(|idx| format!("assistant-{idx}"))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            signals.tool_names,
            (8..20).map(|idx| format!("tool-{idx}")).collect::<Vec<_>>()
        );
        assert_eq!(
            signals
                .messages
                .iter()
                .map(|message| message.text.clone())
                .collect::<Vec<_>>(),
            (14..20)
                .flat_map(|idx| [format!("user-{idx}"), format!("assistant-{idx}")])
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn only_considers_last_five_hundred_records() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("records.jsonl");
        let mut lines = vec![json_line("user", "outside-window")];
        lines.extend((1..20).map(|idx| format!(r#"{{"sequence":{idx}}}"#)));
        lines.extend((20..519).map(|idx| format!(r#"{{"sequence":{idx}}}"#)));
        lines.push(json_line("user", "recent"));
        write_lines(&path, &lines);

        let signals = parse(&path);

        assert_eq!(signals.user_messages, vec!["recent".to_string()]);
        assert_eq!(signals.tool_names, Vec::<String>::new());
        assert_eq!(
            signals.messages,
            vec![TranscriptMessage {
                role: TranscriptRole::User,
                text: "recent".to_string(),
            }]
        );
    }

    #[test]
    fn only_reads_the_last_mebibyte_of_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mebibyte.jsonl");
        let old = r#"{"role":"user","content":"too-old"}"#.to_string();
        let filler = format!(
            r#"{{"role":"assistant","content":[{{"type":"thinking","text":"{}"}}]}}"#,
            "a".repeat(70_000)
        );
        write_lines(&path, &[old, filler.repeat(18)]);

        let signals = parse(&path);

        assert!(signals.user_messages.is_empty());
        assert!(signals.messages.is_empty());
    }
}
