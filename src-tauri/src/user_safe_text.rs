pub(crate) fn utf8_prefix(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

pub(crate) fn project_user_safe_text(raw: &str) -> String {
    let without_metadata = strip_transport_metadata(raw);
    let redacted = redact_local_paths(without_metadata);
    redacted.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_transport_metadata(raw: &str) -> &str {
    let mut text = raw.trim();
    if let Some(metadata) = text.strip_prefix("Sender (untrusted metadata):") {
        text = metadata.trim_start();
        let Some(open) = text.find("```") else {
            return "";
        };
        let after_open = &text[open + 3..];
        let Some(close) = after_open.find("```") else {
            return "";
        };
        text = after_open[close + 3..].trim_start();
        if text.starts_with('[') {
            if let Some(close) = text.find(']') {
                text = text[close + 1..].trim_start();
            }
        }
    }
    text
}

fn redact_local_paths(text: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut index = 0;
    let mut previous = None;
    while index < text.len() {
        let remaining = &text[index..];
        let at_boundary = previous.is_none_or(is_path_start_boundary);
        if let Some(length) = local_path_length(remaining, at_boundary) {
            redacted.push_str("[本机路径]");
            index += length;
            continue;
        }
        let ch = remaining
            .chars()
            .next()
            .expect("remaining text is non-empty");
        redacted.push(ch);
        index += ch.len_utf8();
        previous = Some(ch);
    }
    redacted
}

fn local_path_length(candidate: &str, at_boundary: bool) -> Option<usize> {
    if !at_boundary {
        return None;
    }
    if candidate.starts_with("file://")
        || candidate.starts_with("~/")
        || (candidate.starts_with('/')
            && !candidate.starts_with("//")
            && candidate
                .chars()
                .nth(1)
                .is_some_and(|ch| !ch.is_whitespace()))
    {
        return Some(path_token_length(candidate));
    }
    let bytes = candidate.as_bytes();
    if bytes.len() >= 9
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
        && candidate[3..].starts_with("Users")
        && matches!(bytes.get(8).copied(), Some(b'\\' | b'/'))
    {
        return Some(path_token_length(candidate));
    }
    None
}

fn path_token_length(candidate: &str) -> usize {
    candidate
        .char_indices()
        .find_map(|(index, ch)| (index > 0 && is_path_end_boundary(ch)).then_some(index))
        .unwrap_or(candidate.len())
}

fn is_path_start_boundary(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            '"' | '\''
                | '`'
                | '('
                | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '<'
                | '>'
                | ','
                | ';'
                | ':'
                | '='
        )
}

fn is_path_end_boundary(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '"' | '\'' | ')' | ']' | '}' | '<' | '>' | ',' | ';')
}

#[cfg(test)]
mod tests {
    use super::{project_user_safe_text, utf8_prefix};

    #[test]
    fn utf8_prefix_clamps_short_text_and_preserves_character_boundaries() {
        assert_eq!(utf8_prefix("short", 200), "short");
        assert_eq!(utf8_prefix("你好世界", 7), "你好");
        assert_eq!(utf8_prefix("你好", 0), "");
    }

    #[test]
    fn removes_transport_metadata_and_keeps_the_actual_message() {
        let raw = r#"Sender (untrusted metadata): ```json { "label": "control-ui" } ``` [Fri 2026-03-20 19:13 GMT+8] 你好"#;

        assert_eq!(project_user_safe_text(raw), "你好");
    }

    #[test]
    fn drops_malformed_transport_metadata_instead_of_exposing_it() {
        let raw = r#"Sender (untrusted metadata): ```json { "secret": "value" }"#;

        assert_eq!(project_user_safe_text(raw), "");
    }

    #[test]
    fn redacts_common_local_path_forms() {
        let raw = r#"open /Users/me/project/a.rs, ~/todo.md, file:///home/me/note and C:\Users\me\Desktop\x.txt"#;
        let safe = project_user_safe_text(raw);

        assert!(!safe.contains("/Users/me"));
        assert!(!safe.contains("~/todo"));
        assert!(!safe.contains("file:///home"));
        assert!(!safe.contains(r#"C:\Users\me"#));
        assert_eq!(safe.matches("[本机路径]").count(), 4);
    }

    #[test]
    fn redacts_absolute_unix_paths_after_common_punctuation() {
        let raw = "read /tmp/private, (/Volumes/work/a), path:/opt/data, path=/Users/me/a and `/home/me/b`";
        let safe = project_user_safe_text(raw);

        assert!(!safe.contains("/tmp/private"));
        assert!(!safe.contains("/Volumes/work"));
        assert!(!safe.contains("/opt/data"));
        assert!(!safe.contains("/Users/me/a"));
        assert!(!safe.contains("/home/me/b"));
        assert_eq!(safe.matches("[本机路径]").count(), 5);
    }

    #[test]
    fn keeps_public_https_urls_visible() {
        assert_eq!(
            project_user_safe_text("open https://example.com/docs"),
            "open https://example.com/docs"
        );
    }
}
