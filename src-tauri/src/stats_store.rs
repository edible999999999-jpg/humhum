use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::BufRead;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionStats {
    pub session_id: String,
    pub client_type: String,
    #[serde(default)]
    pub transcript_path: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub tool_calls: u64,
    pub tool_names: Vec<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyBucket {
    pub date: String,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    pub tool_calls: u64,
    pub session_count: u64,
    pub estimated_cost_usd: f64,
    pub clients: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StatsData {
    pub sessions: Vec<SessionStats>,
    pub daily_buckets: Vec<DailyBucket>,
    pub processed_transcripts: HashSet<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AggregatedStats {
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub active_agents: u64,
    pub total_tool_calls: u64,
    pub unique_tool_names: Vec<String>,
    pub total_sessions: u64,
    pub sessions_by_client: HashMap<String, u64>,
    pub cost_today_usd: f64,
    pub cost_7d_usd: f64,
    pub cost_30d_usd: f64,
    pub daily_buckets: Vec<DailyBucket>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStats {
    pub client_type: String,
    pub total_sessions: u64,
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_tool_calls: u64,
    pub total_cost_usd: f64,
    pub avg_tokens_per_session: f64,
    pub avg_cost_per_session: f64,
    pub top_tools: Vec<(String, u64)>,
    pub models_used: Vec<String>,
    pub daily_data: Vec<DailyAgentData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DailyAgentData {
    pub date: String,
    pub tokens: u64,
    pub cost_usd: f64,
    pub sessions: u64,
}

struct ModelPricing {
    input_per_million: f64,
    output_per_million: f64,
    cache_write_per_million: f64,
    cache_read_per_million: f64,
}

fn get_pricing(model: &str) -> ModelPricing {
    let m = model.to_lowercase();
    if m.contains("opus") {
        ModelPricing {
            input_per_million: 15.0,
            output_per_million: 75.0,
            cache_write_per_million: 18.75,
            cache_read_per_million: 1.50,
        }
    } else if m.contains("haiku") {
        ModelPricing {
            input_per_million: 0.25,
            output_per_million: 1.25,
            cache_write_per_million: 0.30,
            cache_read_per_million: 0.03,
        }
    } else {
        // Sonnet / unknown
        ModelPricing {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_write_per_million: 3.75,
            cache_read_per_million: 0.30,
        }
    }
}

fn calculate_cost(stats: &SessionStats) -> f64 {
    let p = get_pricing(&stats.model);
    (stats.input_tokens as f64 * p.input_per_million
        + stats.output_tokens as f64 * p.output_per_million
        + stats.cache_creation_tokens as f64 * p.cache_write_per_million
        + stats.cache_read_tokens as f64 * p.cache_read_per_million)
        / 1_000_000.0
}

pub struct StatsStore {
    data: StatsData,
    file_path: PathBuf,
}

impl StatsStore {
    #[allow(dead_code)]
    pub fn new(file_path: PathBuf) -> Self {
        Self::new_with_backfill(file_path, true)
    }

    pub fn new_with_backfill(file_path: PathBuf, backfill_enabled: bool) -> Self {
        let data = Self::load_from_disk(&file_path);
        let mut store = Self { data, file_path };
        if backfill_enabled {
            if let Err(e) = store.backfill_recent_transcripts() {
                log::warn!("[Stats] Backfill failed: {}", e);
            }
        }
        store
    }

    pub fn clear(&mut self) -> Result<(), String> {
        if self.file_path.exists() {
            std::fs::remove_file(&self.file_path)
                .map_err(|error| format!("Failed to remove stats file: {error}"))?;
        }
        self.data = StatsData::default();
        Ok(())
    }

    fn load_from_disk(path: &PathBuf) -> StatsData {
        if !path.exists() {
            return StatsData::default();
        }
        match std::fs::read_to_string(path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => StatsData::default(),
        }
    }

    fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create stats dir: {}", e))?;
        }
        let tmp = self.file_path.with_extension("json.tmp");
        let content = serde_json::to_string_pretty(&self.data)
            .map_err(|e| format!("Failed to serialize stats: {}", e))?;
        std::fs::write(&tmp, content).map_err(|e| format!("Failed to write stats: {}", e))?;
        std::fs::rename(&tmp, &self.file_path)
            .map_err(|e| format!("Failed to rename stats file: {}", e))?;
        Ok(())
    }

    fn backfill_recent_transcripts(&mut self) -> Result<(), String> {
        let Some(home) = dirs::home_dir() else {
            return Ok(());
        };

        let roots = [
            (home.join(".codex").join("sessions"), "codex"),
            (home.join(".claude").join("projects"), "claude-code"),
        ];
        let cutoff = SystemTime::now()
            .checked_sub(Duration::from_secs(30 * 24 * 60 * 60))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let mut changed = false;

        for (root, client_type) in roots {
            if !root.exists() {
                continue;
            }

            for path in collect_jsonl_files(&root) {
                let transcript_path = path.to_string_lossy().to_string();
                if self.data.processed_transcripts.contains(&transcript_path) {
                    continue;
                }

                let modified = path
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                if modified < cutoff {
                    continue;
                }

                if let Some(stats) = parse_transcript(&transcript_path, "", client_type) {
                    self.data.sessions.retain(|s| {
                        !(s.transcript_path == transcript_path
                            || (s.session_id == stats.session_id
                                && s.client_type == stats.client_type))
                    });
                    self.data.sessions.push(stats);
                    self.data.processed_transcripts.insert(transcript_path);
                    changed = true;
                }
            }
        }

        if changed {
            self.rebuild_daily_buckets();
            self.prune_old_data();
            self.save()?;
        }

        Ok(())
    }

    pub fn record_session_end(
        &mut self,
        transcript_path: &str,
        session_id: &str,
        client_type: &str,
    ) -> Result<(), String> {
        if let Some(stats) = parse_transcript(transcript_path, session_id, client_type) {
            self.data.sessions.retain(|s| {
                !(s.transcript_path == transcript_path
                    || (s.session_id == session_id && s.client_type == client_type))
            });
            self.data.sessions.push(stats);
            self.data
                .processed_transcripts
                .insert(transcript_path.to_string());
            self.rebuild_daily_buckets();
            self.prune_old_data();
            self.save()?;
        }
        Ok(())
    }

    fn update_daily_bucket(&mut self, stats: &SessionStats) {
        let day = stats
            .timestamp
            .get(0..10)
            .filter(|s| s.len() == 10)
            .unwrap_or("");
        let bucket_date = if day.is_empty() {
            chrono::Local::now().format("%Y-%m-%d").to_string()
        } else {
            day.to_string()
        };
        let cost = calculate_cost(stats);
        let all_tokens = stats.input_tokens
            + stats.output_tokens
            + stats.cache_creation_tokens
            + stats.cache_read_tokens;

        if let Some(bucket) = self
            .data
            .daily_buckets
            .iter_mut()
            .find(|b| b.date == bucket_date)
        {
            bucket.total_tokens += all_tokens;
            bucket.input_tokens += stats.input_tokens;
            bucket.output_tokens += stats.output_tokens;
            bucket.cache_creation_tokens += stats.cache_creation_tokens;
            bucket.cache_read_tokens += stats.cache_read_tokens;
            bucket.tool_calls += stats.tool_calls;
            bucket.session_count += 1;
            bucket.estimated_cost_usd += cost;
            *bucket.clients.entry(stats.client_type.clone()).or_insert(0) += 1;
        } else {
            let mut clients = HashMap::new();
            clients.insert(stats.client_type.clone(), 1);
            self.data.daily_buckets.push(DailyBucket {
                date: bucket_date,
                total_tokens: all_tokens,
                input_tokens: stats.input_tokens,
                output_tokens: stats.output_tokens,
                cache_creation_tokens: stats.cache_creation_tokens,
                cache_read_tokens: stats.cache_read_tokens,
                tool_calls: stats.tool_calls,
                session_count: 1,
                estimated_cost_usd: cost,
                clients,
            });
        }
    }

    fn rebuild_daily_buckets(&mut self) {
        let sessions = self.data.sessions.clone();
        self.data.daily_buckets.clear();
        for stats in sessions {
            self.update_daily_bucket(&stats);
        }
        self.data.daily_buckets.sort_by(|a, b| a.date.cmp(&b.date));
    }

    fn prune_old_data(&mut self) {
        let cutoff = chrono::Local::now() - chrono::Duration::days(30);
        let cutoff_str = cutoff.format("%Y-%m-%d").to_string();

        self.data.daily_buckets.retain(|b| b.date >= cutoff_str);
        self.data.sessions.retain(|s| s.timestamp >= cutoff_str);

        if self.data.processed_transcripts.len() > 500 {
            let sorted: BTreeSet<String> =
                self.data.processed_transcripts.iter().cloned().collect();
            let keep_count = sorted.len() / 2;
            self.data.processed_transcripts = sorted.into_iter().skip(keep_count).collect();
        }
    }

    pub fn get_aggregated_stats(&self) -> AggregatedStats {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let d7 = (chrono::Local::now() - chrono::Duration::days(7))
            .format("%Y-%m-%d")
            .to_string();
        let d30 = (chrono::Local::now() - chrono::Duration::days(30))
            .format("%Y-%m-%d")
            .to_string();

        let mut total_in = 0u64;
        let mut total_out = 0u64;
        let mut total_cache_create = 0u64;
        let mut total_cache_read = 0u64;
        let mut total_tools = 0u64;
        let mut total_sessions = 0u64;
        let mut tool_set: HashSet<String> = HashSet::new();
        let mut client_map: HashMap<String, u64> = HashMap::new();
        let mut cost_today = 0.0f64;
        let mut cost_7d = 0.0f64;
        let mut cost_30d = 0.0f64;

        let active_cutoff = (chrono::Local::now() - chrono::Duration::hours(24)).to_rfc3339();
        let mut active_clients: HashSet<String> = HashSet::new();

        for s in &self.data.sessions {
            total_in += s.input_tokens;
            total_out += s.output_tokens;
            total_cache_create += s.cache_creation_tokens;
            total_cache_read += s.cache_read_tokens;
            total_tools += s.tool_calls;
            total_sessions += 1;
            for t in &s.tool_names {
                tool_set.insert(t.clone());
            }
            *client_map.entry(s.client_type.clone()).or_insert(0) += 1;
            if s.timestamp >= active_cutoff {
                active_clients.insert(s.client_type.clone());
            }
        }

        for b in &self.data.daily_buckets {
            if b.date == today {
                cost_today += b.estimated_cost_usd;
            }
            if b.date >= d7 {
                cost_7d += b.estimated_cost_usd;
            }
            if b.date >= d30 {
                cost_30d += b.estimated_cost_usd;
            }
        }

        let mut tool_names: Vec<String> = tool_set.into_iter().collect();
        tool_names.sort();

        AggregatedStats {
            total_tokens: total_in + total_out + total_cache_create + total_cache_read,
            total_input_tokens: total_in,
            total_output_tokens: total_out,
            total_cache_creation_tokens: total_cache_create,
            total_cache_read_tokens: total_cache_read,
            active_agents: active_clients.len() as u64,
            total_tool_calls: total_tools,
            unique_tool_names: tool_names,
            total_sessions,
            sessions_by_client: client_map,
            cost_today_usd: cost_today,
            cost_7d_usd: cost_7d,
            cost_30d_usd: cost_30d,
            daily_buckets: self.data.daily_buckets.clone(),
        }
    }

    pub fn get_per_agent_stats(&self) -> Vec<AgentStats> {
        let mut by_client: HashMap<String, Vec<&SessionStats>> = HashMap::new();
        for s in &self.data.sessions {
            by_client.entry(s.client_type.clone()).or_default().push(s);
        }

        let mut result: Vec<AgentStats> = by_client
            .into_iter()
            .map(|(client_type, sessions)| {
                let total_sessions = sessions.len() as u64;
                let mut total_in = 0u64;
                let mut total_out = 0u64;
                let mut total_cc = 0u64;
                let mut total_cr = 0u64;
                let mut total_tools = 0u64;
                let mut total_cost = 0.0f64;
                let mut tool_counts: HashMap<String, u64> = HashMap::new();
                let mut model_set: HashSet<String> = HashSet::new();

                for s in &sessions {
                    total_in += s.input_tokens;
                    total_out += s.output_tokens;
                    total_cc += s.cache_creation_tokens;
                    total_cr += s.cache_read_tokens;
                    total_tools += s.tool_calls;
                    total_cost += calculate_cost(s);
                    for t in &s.tool_names {
                        *tool_counts.entry(t.clone()).or_insert(0) += 1;
                    }
                    if !s.model.is_empty() {
                        model_set.insert(s.model.clone());
                    }
                }

                let total_tokens = total_in + total_out + total_cc + total_cr;
                let n = total_sessions.max(1) as f64;

                let mut top_tools: Vec<(String, u64)> = tool_counts.into_iter().collect();
                top_tools.sort_by_key(|entry| std::cmp::Reverse(entry.1));
                top_tools.truncate(5);

                let mut models_used: Vec<String> = model_set.into_iter().collect();
                models_used.sort();

                // Build per-agent daily data from daily_buckets
                let daily_data: Vec<DailyAgentData> = self
                    .data
                    .daily_buckets
                    .iter()
                    .filter_map(|b| {
                        let agent_sessions = b.clients.get(&client_type).copied().unwrap_or(0);
                        if agent_sessions == 0 {
                            return None;
                        }
                        let ratio = agent_sessions as f64 / b.session_count.max(1) as f64;
                        Some(DailyAgentData {
                            date: b.date.clone(),
                            tokens: (b.total_tokens as f64 * ratio) as u64,
                            cost_usd: b.estimated_cost_usd * ratio,
                            sessions: agent_sessions,
                        })
                    })
                    .collect();

                AgentStats {
                    client_type,
                    total_sessions,
                    total_tokens,
                    total_input_tokens: total_in,
                    total_output_tokens: total_out,
                    total_cache_creation_tokens: total_cc,
                    total_cache_read_tokens: total_cr,
                    total_tool_calls: total_tools,
                    total_cost_usd: total_cost,
                    avg_tokens_per_session: total_tokens as f64 / n,
                    avg_cost_per_session: total_cost / n,
                    top_tools,
                    models_used,
                    daily_data,
                }
            })
            .collect();

        result.sort_by(|a, b| {
            b.total_cost_usd
                .partial_cmp(&a.total_cost_usd)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        result
    }
}

fn collect_jsonl_files(root: &std::path::Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return files;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(collect_jsonl_files(&path));
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    files
}

fn parse_transcript(
    transcript_path: &str,
    session_id: &str,
    client_type: &str,
) -> Option<SessionStats> {
    let path = std::path::Path::new(transcript_path);
    if !path.exists() {
        log::warn!("[Stats] Transcript not found: {}", transcript_path);
        return None;
    }

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("[Stats] Failed to open transcript: {}", e);
            return None;
        }
    };

    let reader = std::io::BufReader::new(file);
    let mut tool_set: HashSet<String> = HashSet::new();
    let mut tool_use_ids: HashSet<String> = HashSet::new();
    let mut codex_tool_calls = 0u64;
    let mut model = String::new();
    let mut effective_session_id = session_id.to_string();
    let mut codex_input_tokens: Option<u64> = None;
    let mut codex_output_tokens: Option<u64> = None;
    let mut codex_cache_read_tokens: Option<u64> = None;
    let mut first_message_timestamp: Option<String> = None;

    // Claude Code transcripts log each assistant message multiple times
    // (streaming intermediate states). Deduplicate by message.id,
    // keeping only the last (most complete) usage for each message.
    struct MsgUsage {
        input: u64,
        output: u64,
        cache_create: u64,
        cache_read: u64,
    }
    let mut msg_usages: HashMap<String, MsgUsage> = HashMap::new();
    let mut anonymous_msg_counter = 0u64;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let val: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

        // Extract timestamp from the first entry that has one
        if first_message_timestamp.is_none() {
            if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
                if !ts.is_empty() {
                    first_message_timestamp = Some(ts.to_string());
                }
            }
        }

        if entry_type == "session_meta" {
            if let Some(payload) = val.get("payload") {
                if effective_session_id.is_empty() {
                    effective_session_id = payload
                        .get("session_id")
                        .or_else(|| payload.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                }
                if let Some(m) = payload.get("model").and_then(|v| v.as_str()) {
                    model = m.to_string();
                } else if let Some(provider) =
                    payload.get("model_provider").and_then(|v| v.as_str())
                {
                    model = provider.to_string();
                }
            }
        }

        if entry_type == "assistant" {
            if effective_session_id.is_empty() {
                effective_session_id = val
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
            }

            if let Some(msg) = val.get("message") {
                // Use message.id to deduplicate; fall back to a unique counter
                let msg_id = msg
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        anonymous_msg_counter += 1;
                        format!("__anon_{}", anonymous_msg_counter)
                    });

                if let Some(usage) = msg.get("usage") {
                    let u = MsgUsage {
                        input: usage
                            .get("input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        output: usage
                            .get("output_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        cache_create: usage
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        cache_read: usage
                            .get("cache_read_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                    };
                    // Overwrite: later entries for the same message have the final usage
                    msg_usages.insert(msg_id.clone(), u);
                }

                // Extract model
                if let Some(m) = msg.get("model").and_then(|v| v.as_str()) {
                    model = m.to_string();
                }

                if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
                    for item in content {
                        if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                            let tool_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let dedup_key = if tool_id.is_empty() {
                                format!(
                                    "{}_{}",
                                    msg_id,
                                    item.get("name").and_then(|v| v.as_str()).unwrap_or("")
                                )
                            } else {
                                tool_id.to_string()
                            };
                            tool_use_ids.insert(dedup_key);
                            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                                tool_set.insert(name.to_string());
                            }
                        }
                    }
                }
            }
        }

        if entry_type == "event_msg" || entry_type == "response_item" {
            if let Some(payload) = val.get("payload") {
                if payload.get("type").and_then(|v| v.as_str()) == Some("token_count") {
                    if let Some(usage) =
                        payload.get("info").and_then(|v| v.get("total_token_usage"))
                    {
                        codex_input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64());
                        codex_output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64());
                        codex_cache_read_tokens =
                            usage.get("cached_input_tokens").and_then(|v| v.as_u64());
                    }
                }

                if payload.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                    codex_tool_calls += 1;
                    if let Some(name) = payload.get("name").and_then(|v| v.as_str()) {
                        tool_set.insert(name.to_string());
                    }
                }
            }
        }
    }

    // Sum deduplicated message usages
    let (mut input_tokens, mut output_tokens, cache_creation, mut cache_read) = msg_usages
        .values()
        .fold((0u64, 0u64, 0u64, 0u64), |acc, u| {
            (
                acc.0 + u.input,
                acc.1 + u.output,
                acc.2 + u.cache_create,
                acc.3 + u.cache_read,
            )
        });
    let mut tool_calls = tool_use_ids.len() as u64;

    // Codex uses cumulative token_count events instead of per-message usage
    if let Some(v) = codex_input_tokens {
        input_tokens = v;
    }
    if let Some(v) = codex_output_tokens {
        output_tokens = v;
    }
    if let Some(v) = codex_cache_read_tokens {
        cache_read = v;
    }
    if codex_tool_calls > 0 {
        tool_calls = codex_tool_calls;
    }

    if input_tokens == 0 && output_tokens == 0 {
        return None;
    }

    let mut tool_names: Vec<String> = tool_set.into_iter().collect();
    tool_names.sort();

    // Prefer timestamp from inside the transcript (first message),
    // fall back to file modification time, then current time
    let timestamp = first_message_timestamp.unwrap_or_else(|| {
        path.metadata()
            .and_then(|m| m.modified())
            .ok()
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_else(|| chrono::Local::now().to_rfc3339())
    });

    Some(SessionStats {
        session_id: effective_session_id,
        client_type: client_type.to_string(),
        transcript_path: transcript_path.to_string(),
        model,
        input_tokens,
        output_tokens,
        cache_creation_tokens: cache_creation,
        cache_read_tokens: cache_read,
        tool_calls,
        tool_names,
        timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp_jsonl(name: &str, body: &str) -> String {
        let path = std::env::temp_dir().join(format!(
            "humhum-stats-{}-{}.jsonl",
            name,
            uuid::Uuid::new_v4()
        ));
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(body.as_bytes()).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn parses_claude_usage_from_assistant_messages() {
        let path = write_temp_jsonl(
            "claude",
            r#"{"type":"assistant","message":{"id":"msg_01","model":"claude-sonnet","usage":{"input_tokens":10,"output_tokens":3,"cache_creation_input_tokens":5,"cache_read_input_tokens":7},"content":[{"type":"tool_use","id":"tu_01","name":"Bash"}]}}"#,
        );

        let stats = parse_transcript(&path, "s1", "claude-code").unwrap();
        assert_eq!(stats.input_tokens, 10);
        assert_eq!(stats.output_tokens, 3);
        assert_eq!(stats.cache_creation_tokens, 5);
        assert_eq!(stats.cache_read_tokens, 7);
        assert_eq!(stats.tool_calls, 1);
        assert_eq!(stats.tool_names, vec!["Bash"]);
    }

    #[test]
    fn deduplicates_streaming_assistant_messages() {
        // Claude Code logs each assistant message multiple times during streaming.
        // Only the last occurrence (with final usage) should be counted.
        let path = write_temp_jsonl(
            "dedup",
            &[
                r#"{"type":"assistant","message":{"id":"msg_01","model":"claude-sonnet","usage":{"input_tokens":100,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":50},"content":[]}}"#,
                r#"{"type":"assistant","message":{"id":"msg_01","model":"claude-sonnet","usage":{"input_tokens":100,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":50},"content":[{"type":"tool_use","id":"tu_01","name":"Read"}]}}"#,
                r#"{"type":"assistant","message":{"id":"msg_01","model":"claude-sonnet","usage":{"input_tokens":100,"output_tokens":35,"cache_creation_input_tokens":0,"cache_read_input_tokens":50},"content":[{"type":"tool_use","id":"tu_01","name":"Read"},{"type":"tool_use","id":"tu_02","name":"Bash"}]}}"#,
                r#"{"type":"assistant","message":{"id":"msg_02","model":"claude-sonnet","usage":{"input_tokens":200,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":80},"content":[{"type":"tool_use","id":"tu_03","name":"Bash"}]}}"#,
            ]
            .join("\n"),
        );

        let stats = parse_transcript(&path, "s1", "claude-code").unwrap();
        // msg_01 final: 100 input, 35 output, 50 cache_read
        // msg_02 final: 200 input, 10 output, 80 cache_read
        assert_eq!(stats.input_tokens, 300);
        assert_eq!(stats.output_tokens, 45);
        assert_eq!(stats.cache_read_tokens, 130);
        // 3 unique tool_use ids: tu_01, tu_02, tu_03
        assert_eq!(stats.tool_calls, 3);
        assert_eq!(stats.tool_names, vec!["Bash", "Read"]);
    }

    #[test]
    fn parses_codex_cumulative_token_count_events() {
        let path = write_temp_jsonl(
            "codex",
            r#"{"type":"session_meta","payload":{"session_id":"s2","model_provider":"openai"}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":105},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"total_tokens":105}}}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":180,"cached_input_tokens":40,"output_tokens":9,"reasoning_output_tokens":2,"total_tokens":189},"last_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":4,"total_tokens":84}}}}
{"type":"response_item","payload":{"type":"function_call","name":"exec_command"}}"#,
        );

        let stats = parse_transcript(&path, "s2", "codex").unwrap();
        assert_eq!(stats.input_tokens, 180);
        assert_eq!(stats.output_tokens, 9);
        assert_eq!(stats.cache_read_tokens, 40);
        assert_eq!(stats.tool_calls, 1);
        assert_eq!(stats.tool_names, vec!["exec_command"]);
        assert_eq!(stats.model, "openai");
    }

    #[test]
    fn record_session_end_updates_existing_session_without_double_counting() {
        let stats_path =
            std::env::temp_dir().join(format!("humhum-stats-store-{}.json", uuid::Uuid::new_v4()));
        let transcript = write_temp_jsonl(
            "upsert",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":3,"output_tokens":2,"total_tokens":12}}}}"#,
        );

        let mut store = StatsStore {
            data: StatsData::default(),
            file_path: stats_path,
        };
        store
            .record_session_end(&transcript, "s3", "codex")
            .unwrap();
        store
            .record_session_end(&transcript, "s3", "codex")
            .unwrap();

        let aggregated = store.get_aggregated_stats();
        assert_eq!(aggregated.total_sessions, 1);
        assert_eq!(aggregated.total_input_tokens, 10);
        assert_eq!(aggregated.total_output_tokens, 2);
        assert_eq!(aggregated.daily_buckets.len(), 1);
        assert_eq!(aggregated.daily_buckets[0].session_count, 1);
    }

    #[test]
    fn clear_removes_persisted_and_in_memory_usage() {
        let temp = tempfile::tempdir().unwrap();
        let stats_path = temp.path().join("stats.json");
        std::fs::write(
            &stats_path,
            r#"{"sessions":[],"daily_buckets":[],"processed_transcripts":["private.jsonl"]}"#,
        )
        .unwrap();
        let mut store = StatsStore::new_with_backfill(stats_path.clone(), false);

        store.clear().unwrap();

        assert!(!stats_path.exists());
        assert_eq!(store.get_aggregated_stats().total_sessions, 0);
        assert!(store.data.processed_transcripts.is_empty());
    }
}
