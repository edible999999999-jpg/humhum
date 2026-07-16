use crate::event_bus::{self, HookEvent};
use crate::session_store::SessionStore;
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

const QODER_LOG_DIR: &str = ".qoderwork/logs/sessions";
const QODER_SETTINGS_FILE: &str = ".qoderwork/settings.json";
const POLL_INTERVAL_SECS: u64 = 2;
const STALE_FILE_THRESHOLD_SECS: u64 = 300; // 5 minutes without updates = stale
const CURSOR_RETENTION_SECS: u64 = 900;
const CURSOR_CLEANUP_INTERVAL_SECS: u64 = 60;
const FILE_PREFIX_BYTES: usize = 256;

#[derive(Clone, Debug)]
struct FileCheckpoint {
    offset: u64,
    created_at: Option<SystemTime>,
    prefix: Vec<u8>,
}

#[derive(Debug)]
struct FileCursor {
    offset: u64,
    created_at: Option<SystemTime>,
    prefix: Vec<u8>,
    last_seen: Instant,
    processed_events: HashSet<String>,
}

impl FileCursor {
    fn from_start(path: &Path, now: Instant) -> std::io::Result<Self> {
        let metadata = fs::metadata(path)?;
        Ok(Self {
            offset: 0,
            created_at: metadata.created().ok(),
            prefix: read_file_prefix(path, FILE_PREFIX_BYTES)?,
            last_seen: now,
            processed_events: HashSet::new(),
        })
    }

    fn from_end(path: &Path, now: Instant) -> std::io::Result<Self> {
        let metadata = fs::metadata(path)?;
        Ok(Self {
            offset: safe_tail_offset(path, metadata.len())?,
            created_at: metadata.created().ok(),
            prefix: read_file_prefix(path, FILE_PREFIX_BYTES)?,
            last_seen: now,
            processed_events: HashSet::new(),
        })
    }

    fn from_checkpoint(checkpoint: &FileCheckpoint, now: Instant) -> Self {
        Self {
            offset: checkpoint.offset,
            created_at: checkpoint.created_at,
            prefix: checkpoint.prefix.clone(),
            last_seen: now,
            processed_events: HashSet::new(),
        }
    }

    fn checkpoint(&self) -> FileCheckpoint {
        FileCheckpoint {
            offset: self.offset,
            created_at: self.created_at,
            prefix: self.prefix.clone(),
        }
    }
}

/// Start watching QoderWork session logs for events
pub fn start_watcher(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        log::info!("QoderWork log watcher started");
        run_watcher(app_handle);
    });
}

fn run_watcher(app_handle: tauri::AppHandle) {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let log_dir = home.join(QODER_LOG_DIR);
    let settings_path = home.join(QODER_SETTINGS_FILE);
    let watcher_started_at = SystemTime::now();
    let mut cursors: HashMap<PathBuf, FileCursor> = HashMap::new();
    let mut checkpoints: HashMap<PathBuf, FileCheckpoint> = HashMap::new();
    let mut initialized = false;
    let mut logged_missing = false;
    let mut last_hook_state = None;
    let mut last_cleanup = Instant::now();

    loop {
        let now = Instant::now();
        if !log_dir.exists() {
            if !logged_missing {
                log::info!(
                    "QoderWork log directory is not available yet: {:?}",
                    log_dir
                );
                logged_missing = true;
            }
            maybe_cleanup_stale_cursors(&mut cursors, now, &mut last_cleanup);
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
            continue;
        }
        if logged_missing {
            log::info!("QoderWork log directory is now available");
            logged_missing = false;
        }

        let hooks_installed = qoder_hooks_installed(&settings_path);
        if last_hook_state != Some(hooks_installed) {
            if hooks_installed {
                log::info!(
                    "QoderWork native HumHum hooks detected; log watcher is now cursor-only"
                );
            } else if last_hook_state == Some(true) {
                log::info!("QoderWork native hooks removed; log watcher fallback resumed");
            }
            last_hook_state = Some(hooks_installed);
        }

        if !initialized {
            match seed_initial_checkpoints(&log_dir, now, watcher_started_at, &mut checkpoints) {
                Ok(count) => {
                    log::debug!("Checkpointed {} existing QoderWork logs", count);
                    initialized = true;
                }
                Err(error) => {
                    log::warn!("Failed to checkpoint QoderWork logs: {}", error);
                    maybe_cleanup_stale_cursors(&mut cursors, now, &mut last_cleanup);
                    std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
                    continue;
                }
            }
        }

        let files = match find_recent_jsonl_files(&log_dir, SystemTime::now()) {
            Ok(files) => files,
            Err(error) => {
                log::warn!("Failed to scan QoderWork log directory: {}", error);
                maybe_cleanup_stale_cursors(&mut cursors, now, &mut last_cleanup);
                std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
                continue;
            }
        };

        for path in files {
            if !cursors.contains_key(&path) {
                let cursor = if let Some(checkpoint) = checkpoints.get(&path) {
                    log::debug!("Resuming checkpointed QoderWork log: {:?}", path);
                    FileCursor::from_checkpoint(checkpoint, now)
                } else {
                    match cursor_for_discovered_file(&path, now, watcher_started_at) {
                        Ok((cursor, created_after_start)) => {
                            log::debug!(
                                "Attached to {} QoderWork log: {:?}",
                                if created_after_start {
                                    "new"
                                } else {
                                    "existing"
                                },
                                path
                            );
                            cursor
                        }
                        Err(error) => {
                            log::debug!("Could not attach to QoderWork log {:?}: {}", path, error);
                            continue;
                        }
                    }
                };
                cursors.insert(path.clone(), cursor);
            }

            let Some(cursor) = cursors.get_mut(&path) else {
                continue;
            };
            match read_appended_lines(&path, cursor, now) {
                Ok(lines) if hooks_installed => {
                    if !lines.is_empty() {
                        log::debug!(
                            "Suppressed {} QoderWork log events already covered by hooks",
                            lines.len()
                        );
                    }
                }
                Ok(lines) => {
                    for line in lines {
                        process_log_line(&line, &app_handle, &mut cursor.processed_events);
                    }
                }
                Err(error) => {
                    log::debug!("Failed to read QoderWork log {:?}: {}", path, error)
                }
            }
            checkpoints.insert(path, cursor.checkpoint());
        }

        maybe_cleanup_stale_cursors(&mut cursors, now, &mut last_cleanup);
        std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
    }
}

fn cursor_for_discovered_file(
    path: &Path,
    now: Instant,
    watcher_started_at: SystemTime,
) -> std::io::Result<(FileCursor, bool)> {
    let metadata = fs::metadata(path)?;
    let created_after_start = metadata
        .created()
        // Some Unix filesystems do not expose birth time. Modification time is
        // the best available fallback; Windows exposes creation time here.
        .or_else(|_| metadata.modified())
        .map(|created| created >= watcher_started_at)
        // Prefer processing over silently missing a genuinely new session if
        // neither timestamp is available.
        .unwrap_or(true);
    let cursor = if created_after_start {
        FileCursor::from_start(path, now)?
    } else {
        FileCursor::from_end(path, now)?
    };
    Ok((cursor, created_after_start))
}

fn seed_initial_checkpoints(
    log_dir: &Path,
    now: Instant,
    watcher_started_at: SystemTime,
    checkpoints: &mut HashMap<PathBuf, FileCheckpoint>,
) -> std::io::Result<usize> {
    let mut added = 0;
    for path in find_jsonl_files(log_dir)? {
        if checkpoints.contains_key(&path) {
            continue;
        }
        match cursor_for_discovered_file(&path, now, watcher_started_at) {
            Ok((cursor, _)) => {
                checkpoints.insert(path, cursor.checkpoint());
                added += 1;
            }
            Err(error) => {
                log::debug!(
                    "Could not create initial QoderWork checkpoint {:?}: {}",
                    path,
                    error
                );
            }
        }
    }
    Ok(added)
}

fn maybe_cleanup_stale_cursors(
    cursors: &mut HashMap<PathBuf, FileCursor>,
    now: Instant,
    last_cleanup: &mut Instant,
) {
    if now.duration_since(*last_cleanup) < Duration::from_secs(CURSOR_CLEANUP_INTERVAL_SECS) {
        return;
    }
    let removed = cleanup_stale_cursors(cursors, now, Duration::from_secs(CURSOR_RETENTION_SECS));
    if removed > 0 {
        log::debug!("Cleaned up {} stale QoderWork log cursors", removed);
    }
    *last_cleanup = now;
}

fn cleanup_stale_cursors(
    cursors: &mut HashMap<PathBuf, FileCursor>,
    now: Instant,
    retention: Duration,
) -> usize {
    let before = cursors.len();
    cursors.retain(|_, cursor| now.duration_since(cursor.last_seen) <= retention);
    before - cursors.len()
}

/// Find every JSONL file below the Qoder session root. Directory traversal uses
/// `Path` throughout, so redirected Windows profile paths and either native
/// path separator work without string parsing.
fn find_jsonl_files(log_dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut directories = VecDeque::from([log_dir.to_path_buf()]);

    while let Some(directory) = directories.pop_front() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if directory == log_dir => return Err(error),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                directories.push_back(path);
                continue;
            }
            let is_jsonl = path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("jsonl"))
                .unwrap_or(false);
            if !is_jsonl {
                continue;
            }
            files.push(path);
        }
    }

    files.sort();
    Ok(files)
}

fn find_recent_jsonl_files(log_dir: &Path, now: SystemTime) -> std::io::Result<Vec<PathBuf>> {
    let mut files = find_jsonl_files(log_dir)?;
    files.retain(|path| {
        fs::metadata(path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(|modified| {
                now.duration_since(modified)
                    .map(|age| age <= Duration::from_secs(STALE_FILE_THRESHOLD_SECS))
                    // A clock adjustment or future timestamp should not make
                    // an active session disappear.
                    .unwrap_or(true)
            })
            .unwrap_or(false)
    });
    Ok(files)
}

fn read_appended_lines(
    path: &Path,
    cursor: &mut FileCursor,
    now: Instant,
) -> std::io::Result<Vec<String>> {
    let metadata = fs::metadata(path)?;
    let created_at = metadata.created().ok();
    let current_prefix = read_file_prefix(path, cursor.prefix.len().max(1))?;
    let replaced =
        cursor.created_at.is_some() && created_at.is_some() && cursor.created_at != created_at;
    let truncated = metadata.len() < cursor.offset;
    let prefix_changed = !cursor.prefix.is_empty()
        && current_prefix.get(..cursor.prefix.len()) != Some(cursor.prefix.as_slice());

    if replaced || truncated || prefix_changed {
        log::debug!("QoderWork log was truncated or rotated: {:?}", path);
        cursor.offset = 0;
        cursor.created_at = created_at;
        cursor.prefix = read_file_prefix(path, FILE_PREFIX_BYTES)?;
        cursor.processed_events.clear();
    } else if cursor.prefix.is_empty() && metadata.len() > 0 {
        cursor.prefix = read_file_prefix(path, FILE_PREFIX_BYTES)?;
    }

    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(cursor.offset))?;
    let mut appended = Vec::new();
    file.read_to_end(&mut appended)?;
    let complete_length = complete_jsonl_prefix_length(&appended);
    let complete = &appended[..complete_length];
    cursor.offset = cursor.offset.saturating_add(complete_length as u64);
    cursor.last_seen = now;

    Ok(complete
        .split(|byte| *byte == b'\n')
        .filter_map(|line| {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if line.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(line).into_owned())
            }
        })
        .collect())
}

fn complete_jsonl_prefix_length(bytes: &[u8]) -> usize {
    if bytes.is_empty() || bytes.ends_with(b"\n") {
        return bytes.len();
    }

    let last_newline = bytes.iter().rposition(|byte| *byte == b'\n');
    let trailing_start = last_newline.map(|index| index + 1).unwrap_or(0);
    let trailing = bytes[trailing_start..]
        .strip_suffix(b"\r")
        .unwrap_or(&bytes[trailing_start..]);
    if serde_json::from_slice::<Value>(trailing).is_ok() {
        bytes.len()
    } else {
        last_newline.map(|index| index + 1).unwrap_or(0)
    }
}

fn read_file_prefix(path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = fs::File::open(path)?;
    let mut prefix = vec![0_u8; limit];
    let read = file.read(&mut prefix)?;
    prefix.truncate(read);
    Ok(prefix)
}

fn qoder_hooks_installed(settings_path: &Path) -> bool {
    fs::read_to_string(settings_path)
        .map(|content| content.to_ascii_lowercase().contains("humhum-hook"))
        .unwrap_or(false)
}

fn safe_tail_offset(path: &Path, file_length: u64) -> std::io::Result<u64> {
    const TAIL_INSPECTION_BYTES: u64 = 64 * 1024;
    if file_length == 0 {
        return Ok(0);
    }

    let start = file_length.saturating_sub(TAIL_INSPECTION_BYTES);
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail)?;
    if tail.ends_with(b"\n") {
        return Ok(file_length);
    }

    let last_newline = tail.iter().rposition(|byte| *byte == b'\n');
    let record_start = last_newline.map(|index| index + 1).unwrap_or(0);
    let trailing = tail[record_start..]
        .strip_suffix(b"\r")
        .unwrap_or(&tail[record_start..]);
    if serde_json::from_slice::<Value>(trailing).is_ok() {
        Ok(file_length)
    } else if let Some(last_newline) = last_newline {
        // Re-read an in-progress final record once the writer completes it.
        Ok(start + last_newline as u64 + 1)
    } else {
        // A record larger than the inspection window cannot be safely replayed
        // from its middle. Tail it rather than emitting malformed history.
        Ok(file_length)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "humhum-qoder-watcher-test-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn discovers_all_recent_session_logs_recursively() {
        let root = TempDir::new();
        let first_dir = root
            .path()
            .join("workspace-a")
            .join("session-a")
            .join("segments");
        let second_dir = root
            .path()
            .join("workspace-b")
            .join("session-b")
            .join("segments");
        fs::create_dir_all(&first_dir).unwrap();
        fs::create_dir_all(&second_dir).unwrap();
        let first = first_dir.join("one.jsonl");
        let second = second_dir.join("two.JSONL");
        fs::write(&first, "{}\n").unwrap();
        fs::write(&second, "{}\n").unwrap();
        fs::write(second_dir.join("ignored.txt"), "{}\n").unwrap();

        let files = find_recent_jsonl_files(root.path(), SystemTime::now()).unwrap();
        assert_eq!(files, vec![first, second]);
    }

    #[test]
    fn existing_files_start_at_eof_and_new_files_start_at_the_beginning() {
        let root = TempDir::new();
        let path = root.path().join("events.jsonl");
        fs::write(&path, "{\"seq\":1}\n").unwrap();
        let now = Instant::now();

        let future_start = SystemTime::now() + Duration::from_secs(60);
        let (mut existing, existing_created_after_start) =
            cursor_for_discovered_file(&path, now, future_start).unwrap();
        assert!(!existing_created_after_start);
        let mut append = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(append, "{{\"seq\":2}}").unwrap();
        assert_eq!(
            read_appended_lines(&path, &mut existing, Instant::now()).unwrap(),
            vec!["{\"seq\":2}"]
        );

        let (mut new_file, new_file_created_after_start) =
            cursor_for_discovered_file(&path, now, SystemTime::UNIX_EPOCH).unwrap();
        assert!(new_file_created_after_start);
        assert_eq!(
            read_appended_lines(&path, &mut new_file, Instant::now()).unwrap(),
            vec!["{\"seq\":1}", "{\"seq\":2}"]
        );
    }

    #[test]
    fn truncation_resets_the_cursor_and_incomplete_json_waits_for_completion() {
        let root = TempDir::new();
        let path = root.path().join("events.jsonl");
        fs::write(&path, "{\"old\":\"a long existing record\"}\n").unwrap();
        let mut cursor = FileCursor::from_end(&path, Instant::now()).unwrap();

        fs::write(&path, "{\"seq\":3").unwrap();
        assert!(read_appended_lines(&path, &mut cursor, Instant::now())
            .unwrap()
            .is_empty());
        let mut append = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(append, "}}").unwrap();
        assert_eq!(
            read_appended_lines(&path, &mut cursor, Instant::now()).unwrap(),
            vec!["{\"seq\":3}"]
        );
    }

    #[test]
    fn stale_cursors_are_removed() {
        let root = TempDir::new();
        let stale_path = root.path().join("stale.jsonl");
        let active_path = root.path().join("active.jsonl");
        fs::write(&stale_path, "").unwrap();
        fs::write(&active_path, "").unwrap();
        let now = Instant::now();
        let mut stale = FileCursor::from_start(&stale_path, now).unwrap();
        stale.last_seen = now - Duration::from_secs(20);
        let active = FileCursor::from_start(&active_path, now).unwrap();
        let mut cursors = HashMap::from([(stale_path, stale), (active_path.clone(), active)]);

        assert_eq!(
            cleanup_stale_cursors(&mut cursors, now, Duration::from_secs(10)),
            1
        );
        assert!(cursors.contains_key(&active_path));
    }

    #[test]
    fn checkpoints_preserve_first_resume_append_across_cursor_cleanup() {
        let root = TempDir::new();
        let path = root.path().join("resumed-session.jsonl");
        fs::write(&path, "{\"seq\":1}\n").unwrap();
        let now = Instant::now();
        let mut checkpoints = HashMap::new();

        // Treat this as a pre-existing, inactive session. Its history is
        // checkpointed at EOF even though no active cursor is created for it.
        let watcher_started_at = SystemTime::now() + Duration::from_secs(60);
        assert_eq!(
            seed_initial_checkpoints(root.path(), now, watcher_started_at, &mut checkpoints)
                .unwrap(),
            1
        );

        let mut append = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(append, "{{\"seq\":2}}").unwrap();
        drop(append);
        let mut cursor = FileCursor::from_checkpoint(checkpoints.get(&path).unwrap(), now);
        assert_eq!(
            read_appended_lines(&path, &mut cursor, now).unwrap(),
            vec!["{\"seq\":2}"]
        );
        checkpoints.insert(path.clone(), cursor.checkpoint());

        // Retiring the heavyweight cursor must not discard its byte position.
        let cleanup_at = now + Duration::from_secs(20);
        let mut cursors = HashMap::from([(path.clone(), cursor)]);
        assert_eq!(
            cleanup_stale_cursors(&mut cursors, cleanup_at, Duration::from_secs(10)),
            1
        );

        let mut append = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(append, "{{\"seq\":3}}").unwrap();
        drop(append);
        let mut resumed = FileCursor::from_checkpoint(checkpoints.get(&path).unwrap(), cleanup_at);
        assert_eq!(
            read_appended_lines(&path, &mut resumed, cleanup_at).unwrap(),
            vec!["{\"seq\":3}"]
        );
    }

    #[test]
    fn sequence_less_event_keys_only_dedupe_identical_lines() {
        let first = r#"{"type":"tool.requested","data":{"tool_name":"Read"}}"#;
        let second = r#"{"type":"tool.requested","data":{"tool_name":"Write"}}"#;
        let first_value: Value = serde_json::from_str(first).unwrap();
        let second_value: Value = serde_json::from_str(second).unwrap();
        let first_key = log_event_key(&first_value, "tool.requested", first);
        let second_key = log_event_key(&second_value, "tool.requested", second);

        assert_eq!(
            first_key,
            log_event_key(&first_value, "tool.requested", first)
        );
        assert_ne!(first_key, second_key);
        let mut processed = HashSet::new();
        assert!(processed.insert(first_key.clone()));
        assert!(processed.insert(second_key));
        assert!(!processed.insert(first_key));

        let non_numeric = r#"{"seq":"7","type":"tool.requested"}"#;
        let non_numeric_value: Value = serde_json::from_str(non_numeric).unwrap();
        assert!(
            log_event_key(&non_numeric_value, "tool.requested", non_numeric).starts_with("line-")
        );
    }

    #[test]
    fn native_hook_detection_controls_fallback_mode() {
        let root = TempDir::new();
        let settings = root.path().join("settings.json");
        assert!(!qoder_hooks_installed(&settings));
        fs::write(
            &settings,
            r#"{"hooks":{"Stop":[{"command":"C:\\HumHum\\humhum-hook.ps1"}]}}"#,
        )
        .unwrap();
        assert!(qoder_hooks_installed(&settings));
        fs::write(&settings, r#"{"hooks":{"Stop":[]}}"#).unwrap();
        assert!(!qoder_hooks_installed(&settings));
    }
}

fn log_event_key(value: &Value, event_type: &str, line: &str) -> String {
    if let Some(sequence) = value.get("seq").and_then(Value::as_u64) {
        return format!("{}-{}", sequence, event_type);
    }

    // Qoder logs do not always include a numeric sequence. A deterministic
    // fingerprint keeps exact duplicate lines idempotent without collapsing
    // every sequence-less event of the same type into `0-type`.
    let mut fingerprint = 0xcbf29ce484222325_u64;
    for byte in line.as_bytes() {
        fingerprint ^= u64::from(*byte);
        fingerprint = fingerprint.wrapping_mul(0x100000001b3);
    }
    format!("line-{:016x}-{}", fingerprint, event_type)
}

/// Process a single log line and emit events if needed
fn process_log_line(line: &str, app_handle: &tauri::AppHandle, processed: &mut HashSet<String>) {
    // Parse JSON
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return, // Not valid JSON, skip
    };

    let event_type = match value.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return,
    };

    // Generate a unique key for this event to avoid duplicates.
    let event_key = log_event_key(&value, event_type, line);

    if processed.contains(&event_key) {
        return;
    }
    processed.insert(event_key);

    let timestamp = value
        .get("ts")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    match event_type {
        // Skip permission events — these are handled by hooks (bidirectional)
        // via hook_server.rs when QoderWork hooks are installed.
        // The log watcher is one-way and cannot relay responses back.
        "permission.requested" => {}

        "tool.requested" => {
            let tool_name = value
                .get("data")
                .and_then(|d| d.get("tool_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            let tool_input = value
                .get("data")
                .and_then(|d| d.get("args"))
                .cloned()
                .unwrap_or_else(|| value.get("data").cloned().unwrap_or(serde_json::json!({})));

            let event = HookEvent {
                id: uuid::Uuid::new_v4().to_string(),
                hook_event_name: "PreToolUse".to_string(),
                session_id: value
                    .get("turn_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                transcript_path: None,
                cwd: None,
                client_type: "qoderwork".to_string(),
                payload: serde_json::json!({
                    "source": "qoderwork",
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                    "timestamp": timestamp,
                }),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };

            log::info!("QoderWork PreToolUse: {}", tool_name);
            event_bus::emit_hook_event(app_handle, &event);
            update_session(app_handle, &event);
        }

        "session.phase.finished" => {
            // Session phase completed — only emit for meaningful agent phases
            let phase = value
                .get("data")
                .and_then(|d| d.get("phase"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Skip internal/attachment phases, only emit for agent response phases
            let is_meaningful = phase.contains("agent")
                || phase.contains("response")
                || phase == "turn"
                || phase.contains("execution")
                || (phase.contains("finished") && !phase.contains("attachments"));

            if is_meaningful {
                let event = HookEvent {
                    id: uuid::Uuid::new_v4().to_string(),
                    hook_event_name: "TaskCompleted".to_string(),
                    session_id: value
                        .get("turn_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    transcript_path: None,
                    cwd: None,
                    client_type: "qoderwork".to_string(),
                    payload: serde_json::json!({
                        "source": "qoderwork",
                        "phase": phase,
                        "timestamp": timestamp,
                    }),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                };

                log::info!("QoderWork task completed: phase={}", phase);
                event_bus::emit_hook_event(app_handle, &event);
                update_session(app_handle, &event);
            } else {
                log::debug!("QoderWork phase finished (skipped): {}", phase);
            }
        }

        "tool.shell.started" => {
            // Shell command started
            let command = value
                .get("data")
                .and_then(|d| d.get("command"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let event = HookEvent {
                id: uuid::Uuid::new_v4().to_string(),
                hook_event_name: "ToolExecution".to_string(),
                session_id: value
                    .get("turn_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                transcript_path: None,
                cwd: None,
                client_type: "qoderwork".to_string(),
                payload: serde_json::json!({
                    "source": "qoderwork",
                    "tool_name": "Bash",
                    "command": command,
                    "timestamp": timestamp,
                }),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };

            let command_preview = command.chars().take(50).collect::<String>();
            log::info!("QoderWork shell started: {}", command_preview);
            event_bus::emit_hook_event(app_handle, &event);
            update_session(app_handle, &event);
        }

        "model.response.completed" => {
            // Model response completed
            let event = HookEvent {
                id: uuid::Uuid::new_v4().to_string(),
                hook_event_name: "ResponseCompleted".to_string(),
                session_id: value
                    .get("turn_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                transcript_path: None,
                cwd: None,
                client_type: "qoderwork".to_string(),
                payload: serde_json::json!({
                    "source": "qoderwork",
                    "timestamp": timestamp,
                }),
                timestamp: chrono::Utc::now().to_rfc3339(),
            };

            log::info!("QoderWork response completed");
            event_bus::emit_hook_event(app_handle, &event);
            update_session(app_handle, &event);
        }

        _ => {
            // Other events — ignore for now
        }
    }
}

fn update_session(app_handle: &tauri::AppHandle, event: &HookEvent) {
    use tauri::Manager;
    if let Some(store) = app_handle.try_state::<Arc<std::sync::Mutex<SessionStore>>>() {
        if let Ok(mut store) = store.lock() {
            store.update_from_event(event);
        }
    }
}
