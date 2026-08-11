use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::BufRead;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tokscale_core::sessions::{claudecode::parse_claude_file, codex::parse_codex_file};

use crate::local_api_auth::{protect_owner_only, write_private_file_atomically};

const STATS_PARSER_REVISION: u32 = 4;
const DAILY_USAGE_REVISION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionDailyUsage {
    pub date: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub reasoning_tokens: u64,
    pub messages: u64,
}

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
    #[serde(default)]
    pub reasoning_tokens: u64,
    #[serde(default)]
    pub daily_usage: Vec<SessionDailyUsage>,
    #[serde(default)]
    pub hourly_usage: Vec<SessionDailyUsage>,
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
    #[serde(default)]
    pub reasoning_tokens: u64,
    pub tool_calls: u64,
    pub session_count: u64,
    pub estimated_cost_usd: f64,
    pub clients: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsData {
    #[serde(default)]
    pub parser_revision: u32,
    #[serde(default)]
    pub daily_usage_revision: u32,
    pub sessions: Vec<SessionStats>,
    pub daily_buckets: Vec<DailyBucket>,
    pub processed_transcripts: HashSet<String>,
}

impl Default for StatsData {
    fn default() -> Self {
        Self {
            parser_revision: STATS_PARSER_REVISION,
            daily_usage_revision: DAILY_USAGE_REVISION,
            sessions: Vec::new(),
            daily_buckets: Vec::new(),
            processed_transcripts: HashSet::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AggregatedStats {
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_reasoning_tokens: u64,
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
    pub total_reasoning_tokens: u64,
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
    calculate_token_cost(
        &stats.model,
        stats.input_tokens,
        stats.output_tokens,
        stats.cache_creation_tokens,
        stats.cache_read_tokens,
        stats.reasoning_tokens,
    )
}

fn calculate_token_cost(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    reasoning_tokens: u64,
) -> f64 {
    let p = get_pricing(model);
    (input_tokens as f64 * p.input_per_million
        + output_tokens as f64 * p.output_per_million
        + cache_creation_tokens as f64 * p.cache_write_per_million
        + cache_read_tokens as f64 * p.cache_read_per_million
        + reasoning_tokens as f64 * p.output_per_million)
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
        let mut data = Self::load_from_disk(&file_path);
        if data.parser_revision != STATS_PARSER_REVISION {
            log::info!(
                "[Stats] Rebuilding usage after parser revision {} -> {}",
                data.parser_revision,
                STATS_PARSER_REVISION
            );
            data = StatsData::default();
        }
        for session in &data.sessions {
            if !session.transcript_path.is_empty() {
                data.processed_transcripts
                    .insert(session.transcript_path.clone());
            }
        }
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

    pub fn migrate_daily_usage_cache(&mut self) -> Result<(), String> {
        if self.data.daily_usage_revision >= DAILY_USAGE_REVISION {
            return Ok(());
        }

        let previous = self.data.clone();
        for session in &mut self.data.sessions {
            if session.transcript_path.is_empty() {
                continue;
            }
            let Some(reparsed) = parse_transcript(
                &session.transcript_path,
                &session.session_id,
                &session.client_type,
            ) else {
                continue;
            };
            *session = reparsed;
        }
        self.data.daily_usage_revision = DAILY_USAGE_REVISION;
        self.rebuild_daily_buckets();
        self.prune_old_data();
        if let Err(error) = self.save() {
            self.data = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn refresh_recent_transcripts(&mut self) -> Result<(), String> {
        self.backfill_recent_transcripts()
    }

    fn load_from_disk(path: &PathBuf) -> StatsData {
        if !path.exists() {
            return StatsData::default();
        }
        if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            log::warn!("Refusing to read a symbolic-link stats store");
            return StatsData::default();
        }
        if let Err(error) = protect_owner_only(path) {
            log::warn!("Failed to protect stats store before reading it: {error}");
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
        let content = serde_json::to_string_pretty(&self.data)
            .map_err(|e| format!("Failed to serialize stats: {}", e))?;
        write_private_file_atomically(&self.file_path, content.as_bytes())
            .map_err(|e| format!("Failed to atomically write private stats file: {}", e))
    }

    fn backfill_recent_transcripts(&mut self) -> Result<(), String> {
        let Some(home) = dirs::home_dir() else {
            return Ok(());
        };
        let previous = self.data.clone();

        let roots = [
            (home.join(".codex").join("sessions"), "codex"),
            (home.join(".codex").join("archived_sessions"), "codex"),
            (home.join(".claude").join("projects"), "claude-code"),
            (home.join(".claude").join("transcripts"), "claude-code"),
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
            if let Err(error) = self.save() {
                self.data = previous;
                return Err(error);
            }
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
            let previous = self.data.clone();
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
            if let Err(error) = self.save() {
                self.data = previous;
                return Err(error);
            }
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
        self.update_daily_bucket_values(
            &bucket_date,
            &stats.client_type,
            stats.input_tokens,
            stats.output_tokens,
            stats.cache_creation_tokens,
            stats.cache_read_tokens,
            stats.reasoning_tokens,
            stats.tool_calls,
            calculate_cost(stats),
            true,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn update_daily_bucket_values(
        &mut self,
        bucket_date: &str,
        client_type: &str,
        input_tokens: u64,
        output_tokens: u64,
        cache_creation_tokens: u64,
        cache_read_tokens: u64,
        reasoning_tokens: u64,
        tool_calls: u64,
        cost: f64,
        count_session: bool,
    ) {
        let all_tokens = input_tokens
            + output_tokens
            + cache_creation_tokens
            + cache_read_tokens
            + reasoning_tokens;
        if let Some(bucket) = self
            .data
            .daily_buckets
            .iter_mut()
            .find(|b| b.date == bucket_date)
        {
            bucket.total_tokens += all_tokens;
            bucket.input_tokens += input_tokens;
            bucket.output_tokens += output_tokens;
            bucket.cache_creation_tokens += cache_creation_tokens;
            bucket.cache_read_tokens += cache_read_tokens;
            bucket.reasoning_tokens += reasoning_tokens;
            bucket.tool_calls += tool_calls;
            if count_session {
                bucket.session_count += 1;
                *bucket.clients.entry(client_type.to_string()).or_insert(0) += 1;
            }
            bucket.estimated_cost_usd += cost;
        } else {
            let mut clients = HashMap::new();
            if count_session {
                clients.insert(client_type.to_string(), 1);
            }
            self.data.daily_buckets.push(DailyBucket {
                date: bucket_date.to_string(),
                total_tokens: all_tokens,
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
                reasoning_tokens,
                tool_calls,
                session_count: u64::from(count_session),
                estimated_cost_usd: cost,
                clients,
            });
        }
    }

    fn rebuild_daily_buckets(&mut self) {
        let sessions = self.data.sessions.clone();
        self.data.daily_buckets.clear();
        for stats in sessions {
            if stats.daily_usage.is_empty() {
                self.update_daily_bucket(&stats);
                continue;
            }

            let mut counted_dates = HashSet::new();
            for usage in &stats.daily_usage {
                let count_session = counted_dates.insert(usage.date.clone());
                self.update_daily_bucket_values(
                    &usage.date,
                    &stats.client_type,
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.cache_creation_tokens,
                    usage.cache_read_tokens,
                    usage.reasoning_tokens,
                    if count_session { stats.tool_calls } else { 0 },
                    calculate_token_cost(
                        &usage.model,
                        usage.input_tokens,
                        usage.output_tokens,
                        usage.cache_creation_tokens,
                        usage.cache_read_tokens,
                        usage.reasoning_tokens,
                    ),
                    count_session,
                );
            }
        }
        self.data.daily_buckets.sort_by(|a, b| a.date.cmp(&b.date));
    }

    fn prune_old_data(&mut self) {
        let cutoff = chrono::Local::now() - chrono::Duration::days(30);
        let cutoff_str = cutoff.format("%Y-%m-%d").to_string();

        self.data.daily_buckets.retain(|b| b.date >= cutoff_str);
        for session in &mut self.data.sessions {
            session.daily_usage.retain(|usage| usage.date >= cutoff_str);
            session
                .hourly_usage
                .retain(|usage| usage.date >= cutoff_str);
        }
        self.data.sessions.retain(|session| {
            if session.daily_usage.is_empty() {
                session.timestamp >= cutoff_str
            } else {
                true
            }
        });
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
        let mut total_reasoning = 0u64;
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
            total_reasoning += s.reasoning_tokens;
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
            total_tokens: total_in
                + total_out
                + total_cache_create
                + total_cache_read
                + total_reasoning,
            total_input_tokens: total_in,
            total_output_tokens: total_out,
            total_cache_creation_tokens: total_cache_create,
            total_cache_read_tokens: total_cache_read,
            total_reasoning_tokens: total_reasoning,
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
                let mut total_reasoning = 0u64;
                let mut total_tools = 0u64;
                let mut total_cost = 0.0f64;
                let mut tool_counts: HashMap<String, u64> = HashMap::new();
                let mut model_set: HashSet<String> = HashSet::new();

                for s in &sessions {
                    total_in += s.input_tokens;
                    total_out += s.output_tokens;
                    total_cc += s.cache_creation_tokens;
                    total_cr += s.cache_read_tokens;
                    total_reasoning += s.reasoning_tokens;
                    total_tools += s.tool_calls;
                    total_cost += calculate_cost(s);
                    for t in &s.tool_names {
                        *tool_counts.entry(t.clone()).or_insert(0) += 1;
                    }
                    if !s.model.is_empty() {
                        model_set.insert(s.model.clone());
                    }
                }

                let total_tokens = total_in + total_out + total_cc + total_cr + total_reasoning;
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
                    total_reasoning_tokens: total_reasoning,
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

// ---- Token dashboard payload (camelCase, mirrors the design-qa snapshot shape) ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenDashboard {
    pub generated_at: String,
    pub today: String,
    pub range: DashRange,
    pub summary: DashSummary,
    pub hours: Vec<DashHour>,
    pub days: Vec<DashDay>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashRange {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashSummary {
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_days: u64,
    pub active_days: u64,
    pub clients: Vec<String>,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashHour {
    pub hour: String,
    pub tokens: u64,
    pub cost: f64,
    pub messages: u64,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reasoning: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashDay {
    pub date: String,
    pub tokens: u64,
    pub cost: f64,
    pub messages: u64,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reasoning: u64,
    pub clients: Vec<DashClientSlice>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashClientSlice {
    pub client: String,
    pub model: String,
    pub tokens: u64,
    pub cost: f64,
    pub messages: u64,
}

#[derive(Default, Clone)]
struct TokenAccum {
    tokens: u64,
    cost: f64,
    messages: u64,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    reasoning: u64,
}

impl TokenAccum {
    fn add(&mut self, s: &SessionStats, cost: f64) {
        self.tokens += s.input_tokens
            + s.output_tokens
            + s.cache_creation_tokens
            + s.cache_read_tokens
            + s.reasoning_tokens;
        self.cost += cost;
        self.messages += 1;
        self.input += s.input_tokens;
        self.output += s.output_tokens;
        self.cache_read += s.cache_read_tokens;
        self.cache_write += s.cache_creation_tokens;
        self.reasoning += s.reasoning_tokens;
    }

    /// Add a single parsed transcript message's token breakdown directly, used
    /// by the hourly view where each message carries its own timestamp so the
    /// day's usage spreads across the real hours it happened in.
    #[cfg(test)]
    fn add_breakdown(
        &mut self,
        input: u64,
        output: u64,
        cache_read: u64,
        cache_write: u64,
        reasoning: u64,
        cost: f64,
    ) {
        self.tokens += input + output + cache_read + cache_write + reasoning;
        self.cost += cost;
        self.messages += 1;
        self.input += input;
        self.output += output;
        self.cache_read += cache_read;
        self.cache_write += cache_write;
        self.reasoning += reasoning;
    }

    fn add_daily_usage(&mut self, usage: &SessionDailyUsage, cost: f64) {
        self.tokens += usage.input_tokens
            + usage.output_tokens
            + usage.cache_read_tokens
            + usage.cache_creation_tokens
            + usage.reasoning_tokens;
        self.cost += cost;
        self.messages += usage.messages;
        self.input += usage.input_tokens;
        self.output += usage.output_tokens;
        self.cache_read += usage.cache_read_tokens;
        self.cache_write += usage.cache_creation_tokens;
        self.reasoning += usage.reasoning_tokens;
    }
}

// Pure hour-bucketing: given parsed transcript messages, spread each one into
// the local hour it happened in (today only). Split out so it can be tested
// without touching disk.
#[cfg(test)]
fn bucket_messages_by_hour(
    messages: &[tokscale_core::sessions::UnifiedMessage],
    today: &str,
    hour_acc: &mut HashMap<String, TokenAccum>,
) {
    for m in messages {
        // tokscale timestamps are epoch milliseconds; convert to the viewer's
        // local wall-clock so hour boundaries match the "今日" the user sees.
        let Some(dt) = chrono::DateTime::from_timestamp_millis(m.timestamp) else {
            continue;
        };
        let local = dt.with_timezone(&chrono::Local);
        let date = local.format("%Y-%m-%d").to_string();
        if date != today {
            continue;
        }
        let key = local.format("%Y-%m-%d %H:00").to_string();
        hour_acc.entry(key).or_default().add_breakdown(
            m.tokens.input.max(0) as u64,
            m.tokens.output.max(0) as u64,
            m.tokens.cache_read.max(0) as u64,
            m.tokens.cache_write.max(0) as u64,
            m.tokens.reasoning.max(0) as u64,
            m.cost,
        );
    }
}

// "2026-08-07T13:42:10+08:00" -> ("2026-08-07", "2026-08-07 13:00")
fn split_local_stamp(ts: &str) -> Option<(String, String)> {
    let date = ts.get(0..10)?;
    if date.len() != 10 {
        return None;
    }
    let hour = ts.get(11..13).unwrap_or("00");
    Some((date.to_string(), format!("{date} {hour}:00")))
}

impl StatsStore {
    /// Build the token-usage dashboard payload straight from parsed sessions so
    /// the live Hub view mirrors the standalone snapshot's shape (days + today's
    /// hourly breakdown + per-model / per-client slices).
    pub fn get_token_dashboard(&self) -> TokenDashboard {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        let mut day_acc: HashMap<String, TokenAccum> = HashMap::new();
        // (date, client, model) -> slice
        let mut day_slice: HashMap<(String, String, String), TokenAccum> = HashMap::new();
        let mut hour_acc: HashMap<String, TokenAccum> = HashMap::new();
        let mut client_set: BTreeSet<String> = BTreeSet::new();
        let mut model_set: BTreeSet<String> = BTreeSet::new();
        let mut total = TokenAccum::default();

        for s in &self.data.sessions {
            if !s.daily_usage.is_empty() {
                for usage in &s.daily_usage {
                    let cost = calculate_token_cost(
                        &usage.model,
                        usage.input_tokens,
                        usage.output_tokens,
                        usage.cache_creation_tokens,
                        usage.cache_read_tokens,
                        usage.reasoning_tokens,
                    );
                    client_set.insert(s.client_type.clone());
                    model_set.insert(usage.model.clone());
                    total.add_daily_usage(usage, cost);
                    day_acc
                        .entry(usage.date.clone())
                        .or_default()
                        .add_daily_usage(usage, cost);
                    day_slice
                        .entry((
                            usage.date.clone(),
                            s.client_type.clone(),
                            usage.model.clone(),
                        ))
                        .or_default()
                        .add_daily_usage(usage, cost);
                }

                for usage in &s.hourly_usage {
                    if usage.date.starts_with(&today) {
                        let cost = calculate_token_cost(
                            &usage.model,
                            usage.input_tokens,
                            usage.output_tokens,
                            usage.cache_creation_tokens,
                            usage.cache_read_tokens,
                            usage.reasoning_tokens,
                        );
                        hour_acc
                            .entry(usage.date.clone())
                            .or_default()
                            .add_daily_usage(usage, cost);
                    }
                }
                continue;
            }

            let Some((date, _hour)) = split_local_stamp(&s.timestamp) else {
                continue;
            };
            let cost = calculate_cost(s);
            let model = if s.model.trim().is_empty() {
                "unknown".to_string()
            } else {
                s.model.clone()
            };
            client_set.insert(s.client_type.clone());
            model_set.insert(model.clone());
            total.add(s, cost);
            day_acc.entry(date.clone()).or_default().add(s, cost);
            day_slice
                .entry((date.clone(), s.client_type.clone(), model))
                .or_default()
                .add(s, cost);
        }

        let mut days: Vec<DashDay> = day_acc
            .into_iter()
            .map(|(date, a)| {
                let mut clients: Vec<DashClientSlice> = day_slice
                    .iter()
                    .filter(|((d, _, _), _)| *d == date)
                    .map(|((_, client, model), sl)| DashClientSlice {
                        client: client.clone(),
                        model: model.clone(),
                        tokens: sl.tokens,
                        cost: sl.cost,
                        messages: sl.messages,
                    })
                    .collect();
                clients.sort_by_key(|client| std::cmp::Reverse(client.tokens));
                DashDay {
                    date,
                    tokens: a.tokens,
                    cost: a.cost,
                    messages: a.messages,
                    input: a.input,
                    output: a.output,
                    cache_read: a.cache_read,
                    cache_write: a.cache_write,
                    reasoning: a.reasoning,
                    clients,
                }
            })
            .collect();
        days.sort_by(|a, b| a.date.cmp(&b.date));

        // Always emit a full 24-hour axis for today so the view reads as one
        // complete day: hours with usage get a bar, quiet hours stay as gaps.
        // Without this, a user who only ran once shows a single lonely column
        // that looks broken rather than "today, one busy hour".
        let hours: Vec<DashHour> = (0..24)
            .map(|h| {
                let key = format!("{today} {h:02}:00");
                let a = hour_acc.get(&key).cloned().unwrap_or_default();
                DashHour {
                    hour: key,
                    tokens: a.tokens,
                    cost: a.cost,
                    messages: a.messages,
                    input: a.input,
                    output: a.output,
                    cache_read: a.cache_read,
                    cache_write: a.cache_write,
                    reasoning: a.reasoning,
                }
            })
            .collect();

        let active_days = days.iter().filter(|d| d.tokens > 0).count() as u64;
        let start = days
            .first()
            .map(|d| d.date.clone())
            .unwrap_or_else(|| today.clone());
        let end = days
            .last()
            .map(|d| d.date.clone())
            .unwrap_or_else(|| today.clone());

        TokenDashboard {
            generated_at: chrono::Local::now().to_rfc3339(),
            today,
            range: DashRange { start, end },
            summary: DashSummary {
                total_tokens: total.tokens,
                total_cost: total.cost,
                total_days: days.len() as u64,
                active_days,
                clients: client_set.into_iter().collect(),
                models: model_set.into_iter().collect(),
            },
            hours,
            days,
        }
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

    let usage_messages = match client_type {
        "codex" => parse_codex_file(path),
        "claude" | "claude-code" => parse_claude_file(path),
        unsupported => {
            log::warn!("[Stats] Unsupported transcript client: {}", unsupported);
            return None;
        }
    };
    if usage_messages.is_empty() {
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
    let mut fallback_model = String::new();
    let mut fallback_session_id = String::new();
    let mut first_message_timestamp: Option<String> = None;
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
                if fallback_session_id.is_empty() {
                    fallback_session_id = payload
                        .get("session_id")
                        .or_else(|| payload.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                }
                if let Some(m) = payload.get("model").and_then(|v| v.as_str()) {
                    fallback_model = m.to_string();
                } else if let Some(provider) =
                    payload.get("model_provider").and_then(|v| v.as_str())
                {
                    fallback_model = provider.to_string();
                }
            }
        }

        if entry_type == "assistant" {
            if fallback_session_id.is_empty() {
                fallback_session_id = val
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

                if let Some(m) = msg.get("model").and_then(|v| v.as_str()) {
                    fallback_model = m.to_string();
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
                if payload.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                    codex_tool_calls += 1;
                    if let Some(name) = payload.get("name").and_then(|v| v.as_str()) {
                        tool_set.insert(name.to_string());
                    }
                }
            }
        }
    }

    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cache_creation = 0u64;
    let mut cache_read = 0u64;
    let mut reasoning_tokens = 0u64;
    for message in &usage_messages {
        input_tokens = input_tokens.saturating_add(message.tokens.input.max(0) as u64);
        output_tokens = output_tokens.saturating_add(message.tokens.output.max(0) as u64);
        cache_creation = cache_creation.saturating_add(message.tokens.cache_write.max(0) as u64);
        cache_read = cache_read.saturating_add(message.tokens.cache_read.max(0) as u64);
        reasoning_tokens = reasoning_tokens.saturating_add(message.tokens.reasoning.max(0) as u64);
    }
    let mut tool_calls = tool_use_ids.len() as u64;
    if codex_tool_calls > 0 {
        tool_calls = codex_tool_calls;
    }

    if input_tokens == 0
        && output_tokens == 0
        && cache_creation == 0
        && cache_read == 0
        && reasoning_tokens == 0
    {
        return None;
    }

    let mut tool_names: Vec<String> = tool_set.into_iter().collect();
    tool_names.sort();

    let model = usage_messages
        .iter()
        .rev()
        .map(|message| message.model_id.trim())
        .find(|model| !model.is_empty() && *model != "unknown")
        .map(str::to_string)
        .filter(|model| !model.is_empty())
        .unwrap_or(fallback_model);
    let effective_session_id = if session_id.trim().is_empty() {
        usage_messages
            .first()
            .map(|message| message.session_id.clone())
            .filter(|id| !id.trim().is_empty() && id != "unknown")
            .unwrap_or(fallback_session_id)
    } else {
        session_id.to_string()
    };
    let timestamp = usage_messages
        .iter()
        .map(|message| message.timestamp)
        .filter(|timestamp| *timestamp > 0)
        .min()
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis)
        .map(|timestamp| timestamp.with_timezone(&chrono::Local).to_rfc3339())
        .or(first_message_timestamp)
        .unwrap_or_else(|| {
            path.metadata()
                .and_then(|m| m.modified())
                .ok()
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_else(|| chrono::Local::now().to_rfc3339())
        });

    let mut daily_usage_map: HashMap<(String, String), SessionDailyUsage> = HashMap::new();
    let mut hourly_usage_map: HashMap<(String, String), SessionDailyUsage> = HashMap::new();
    for message in &usage_messages {
        let Some(message_timestamp) = chrono::DateTime::from_timestamp_millis(message.timestamp)
        else {
            continue;
        };
        let date = message_timestamp
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string();
        let hour = message_timestamp
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d %H:00")
            .to_string();
        let message_model = if message.model_id.trim().is_empty() || message.model_id == "unknown" {
            model.clone()
        } else {
            message.model_id.clone()
        };
        let usage = daily_usage_map
            .entry((date.clone(), message_model.clone()))
            .or_insert_with(|| SessionDailyUsage {
                date,
                model: message_model.clone(),
                ..SessionDailyUsage::default()
            });
        usage.input_tokens = usage
            .input_tokens
            .saturating_add(message.tokens.input.max(0) as u64);
        usage.output_tokens = usage
            .output_tokens
            .saturating_add(message.tokens.output.max(0) as u64);
        usage.cache_creation_tokens = usage
            .cache_creation_tokens
            .saturating_add(message.tokens.cache_write.max(0) as u64);
        usage.cache_read_tokens = usage
            .cache_read_tokens
            .saturating_add(message.tokens.cache_read.max(0) as u64);
        usage.reasoning_tokens = usage
            .reasoning_tokens
            .saturating_add(message.tokens.reasoning.max(0) as u64);
        usage.messages = usage.messages.saturating_add(1);

        let hourly = hourly_usage_map
            .entry((hour.clone(), message_model.clone()))
            .or_insert_with(|| SessionDailyUsage {
                date: hour,
                model: message_model,
                ..SessionDailyUsage::default()
            });
        hourly.input_tokens = hourly
            .input_tokens
            .saturating_add(message.tokens.input.max(0) as u64);
        hourly.output_tokens = hourly
            .output_tokens
            .saturating_add(message.tokens.output.max(0) as u64);
        hourly.cache_creation_tokens = hourly
            .cache_creation_tokens
            .saturating_add(message.tokens.cache_write.max(0) as u64);
        hourly.cache_read_tokens = hourly
            .cache_read_tokens
            .saturating_add(message.tokens.cache_read.max(0) as u64);
        hourly.reasoning_tokens = hourly
            .reasoning_tokens
            .saturating_add(message.tokens.reasoning.max(0) as u64);
        hourly.messages = hourly.messages.saturating_add(1);
    }
    let mut daily_usage: Vec<SessionDailyUsage> = daily_usage_map.into_values().collect();
    daily_usage.sort_by(|a, b| (&a.date, &a.model).cmp(&(&b.date, &b.model)));
    let mut hourly_usage: Vec<SessionDailyUsage> = hourly_usage_map.into_values().collect();
    hourly_usage.sort_by(|a, b| (&a.date, &a.model).cmp(&(&b.date, &b.model)));

    Some(SessionStats {
        session_id: effective_session_id,
        client_type: client_type.to_string(),
        transcript_path: transcript_path.to_string(),
        model,
        input_tokens,
        output_tokens,
        cache_creation_tokens: cache_creation,
        cache_read_tokens: cache_read,
        reasoning_tokens,
        daily_usage,
        hourly_usage,
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
        assert_eq!(stats.reasoning_tokens, 0);
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
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":105},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":105}}}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":180,"cached_input_tokens":40,"output_tokens":9,"reasoning_output_tokens":2,"total_tokens":189},"last_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":4,"reasoning_output_tokens":1,"total_tokens":84}}}}
{"type":"response_item","payload":{"type":"function_call","name":"exec_command"}}"#,
        );

        let stats = parse_transcript(&path, "s2", "codex").unwrap();
        // Tokscale splits cached input out of the inclusive Codex input total.
        assert_eq!(stats.input_tokens, 140);
        assert_eq!(stats.output_tokens, 9);
        assert_eq!(stats.cache_read_tokens, 40);
        assert_eq!(stats.reasoning_tokens, 2);
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
        assert_eq!(aggregated.total_input_tokens, 7);
        assert_eq!(aggregated.total_output_tokens, 2);
        assert_eq!(aggregated.total_cache_read_tokens, 3);
        assert_eq!(aggregated.total_tokens, 12);
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

    #[test]
    fn invalidates_usage_written_by_the_legacy_parser() {
        let temp = tempfile::tempdir().unwrap();
        let stats_path = temp.path().join("stats.json");
        std::fs::write(
            &stats_path,
            r#"{
                "sessions":[{
                    "session_id":"legacy",
                    "client_type":"codex",
                    "transcript_path":"legacy.jsonl",
                    "model":"openai",
                    "input_tokens":180,
                    "output_tokens":9,
                    "cache_creation_tokens":0,
                    "cache_read_tokens":40,
                    "tool_calls":0,
                    "tool_names":[],
                    "timestamp":"2026-07-31T00:00:00+08:00"
                }],
                "daily_buckets":[],
                "processed_transcripts":["legacy.jsonl"]
            }"#,
        )
        .unwrap();

        let store = StatsStore::new_with_backfill(stats_path, false);

        assert_eq!(store.data.parser_revision, STATS_PARSER_REVISION);
        assert!(store.data.sessions.is_empty());
        assert!(store.data.processed_transcripts.is_empty());
    }

    #[test]
    fn loaded_sessions_restore_their_processed_transcript_index() {
        let temp = tempfile::tempdir().unwrap();
        let stats_path = temp.path().join("stats.json");
        let data = StatsData {
            sessions: vec![SessionStats {
                session_id: "cached".to_string(),
                client_type: "codex".to_string(),
                transcript_path: "/tmp/cached-session.jsonl".to_string(),
                model: "gpt-test".to_string(),
                timestamp: chrono::Local::now().to_rfc3339(),
                ..SessionStats::default()
            }],
            ..StatsData::default()
        };
        std::fs::write(&stats_path, serde_json::to_vec(&data).unwrap()).unwrap();

        let store = StatsStore::new_with_backfill(stats_path, false);

        assert!(store
            .data
            .processed_transcripts
            .contains("/tmp/cached-session.jsonl"));
    }

    // The dashboard payload derives hours (today) + days (30d window), and the
    // browser script folds days into week/month buckets. Guard that the shape
    // holds for a multi-day, multi-client fixture so all four views have data.
    #[test]
    fn dashboard_covers_hour_day_week_month_views() {
        let temp = tempfile::tempdir().unwrap();
        let stats_path = temp.path().join("stats.json");
        let mut store = StatsStore::new_with_backfill(stats_path, false);

        let today = chrono::Local::now();
        let stamp = |offset_days: i64, hour: u32| {
            (today - chrono::Duration::days(offset_days))
                .date_naive()
                .and_hms_opt(hour, 0, 0)
                .unwrap()
                .format("%Y-%m-%dT%H:00:00+00:00")
                .to_string()
        };
        // spread across today (2 hours) + prior days spanning >1 week and 2 months
        let samples = [
            (stamp(0, 9), "claude"),
            (stamp(0, 14), "claude"),
            (stamp(3, 10), "codex"),
            (stamp(9, 11), "claude"),
            (stamp(35, 12), "codex"),
        ];
        for (i, (ts, client)) in samples.iter().enumerate() {
            store.data.sessions.push(SessionStats {
                session_id: format!("s{i}"),
                client_type: (*client).to_string(),
                transcript_path: format!("t{i}.jsonl"),
                model: "claude-opus-4".to_string(),
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_tokens: 10,
                cache_read_tokens: 20,
                reasoning_tokens: 5,
                daily_usage: vec![],
                hourly_usage: vec![],
                tool_calls: 1,
                tool_names: vec![],
                timestamp: ts.clone(),
            });
        }

        let dash = store.get_token_dashboard();
        // today's hour axis is always a full 24 slots so a light day still reads
        // as one complete day rather than a lonely single bar
        assert_eq!(dash.hours.len(), 24, "expected a full 24-hour axis");
        // hourly usage is now sourced from per-message transcript timestamps; the
        // synthetic sessions here point at nonexistent transcripts, so hours stay
        // empty — that path is covered end-to-end by
        // `hourly_view_spreads_messages_across_real_hours` below.
        // days window keeps the last 30 days: today + d3 + d9 (d35 falls outside)
        assert!(dash.days.len() >= 3, "expected a multi-day series");
        // week/month derive client-side, but every day carries its client slices
        assert!(dash.days.iter().all(|d| !d.clients.is_empty()));
        assert!(dash.summary.total_tokens > 0);
    }

    // A single session spanning several hours must land its tokens in each of
    // those hours, not all in the session's start hour. This is the whole point
    // of the hourly view: "每小时都应该不一样".
    #[test]
    fn hourly_view_spreads_messages_across_real_hours() {
        use tokscale_core::sessions::UnifiedMessage;
        use tokscale_core::TokenBreakdown;

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // three messages today at 09:00, 09:30 and 14:00 local, plus one yesterday
        let at = |h: u32, m: u32| {
            chrono::Local::now()
                .date_naive()
                .and_hms_opt(h, m, 0)
                .unwrap()
                .and_local_timezone(chrono::Local)
                .unwrap()
                .timestamp_millis()
        };
        let yesterday = chrono::Local::now()
            .date_naive()
            .pred_opt()
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap()
            .timestamp_millis();
        let msg = |ts: i64, input: i64| UnifiedMessage {
            client: "claude-code".to_string(),
            model_id: "claude-opus-4".to_string(),
            provider_id: "anthropic".to_string(),
            session_id: "s".to_string(),
            workspace_key: None,
            workspace_label: None,
            timestamp: ts,
            date: String::new(),
            tokens: TokenBreakdown {
                input,
                output: 10,
                cache_read: 0,
                cache_write: 0,
                reasoning: 0,
            },
            cost: 0.01,
            cost_source: Default::default(),
            duration_ms: None,
            message_count: 1,
            agent: None,
            dedup_key: None,
            session_title: None,
            is_turn_start: false,
        };
        let messages = vec![
            msg(at(9, 0), 100),
            msg(at(9, 30), 200),
            msg(at(14, 0), 300),
            msg(yesterday, 999),
        ];

        let mut hour_acc: HashMap<String, TokenAccum> = HashMap::new();
        bucket_messages_by_hour(&messages, &today, &mut hour_acc);

        // yesterday's message must be excluded; today splits into two hours (09, 14)
        assert_eq!(hour_acc.len(), 2, "two distinct active hours today");
        let h09 = hour_acc.get(&format!("{today} 09:00")).unwrap();
        let h14 = hour_acc.get(&format!("{today} 14:00")).unwrap();
        // 09:00 merges both morning messages (100+10 + 200+10)
        assert_eq!(h09.input, 300);
        assert_eq!(h09.messages, 2);
        assert_eq!(h14.input, 300);
        assert_eq!(h14.messages, 1);
    }

    #[test]
    fn dashboard_spreads_one_session_across_message_days() {
        let path = write_temp_jsonl(
            "cross-day-dashboard",
            r#"{"timestamp":"2026-08-08T15:59:58Z","type":"session_meta","payload":{"id":"cross-day","model_provider":"openai"}}
{"timestamp":"2026-08-08T15:59:59Z","type":"turn_context","payload":{"model":"gpt-test"}}
{"timestamp":"2026-08-08T15:59:59Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":1},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":1}}}}
{"timestamp":"2026-08-08T16:00:01Z","type":"turn_context","payload":{"model":"gpt-test"}}
{"timestamp":"2026-08-08T16:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":180,"cached_input_tokens":40,"output_tokens":9,"reasoning_output_tokens":2},"last_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":4,"reasoning_output_tokens":1}}}}"#,
        );
        let session = parse_transcript(&path, "cross-day", "codex").unwrap();
        let mut store = StatsStore::new_with_backfill(
            std::env::temp_dir().join(format!("humhum-cross-day-{}.json", uuid::Uuid::new_v4())),
            false,
        );
        store.data.sessions.push(session);

        let dashboard = store.get_token_dashboard();
        let aug_8 = dashboard
            .days
            .iter()
            .find(|day| day.date == "2026-08-08")
            .expect("first message should remain on August 8 in Asia/Shanghai");
        let aug_9 = dashboard
            .days
            .iter()
            .find(|day| day.date == "2026-08-09")
            .expect("post-midnight message should move to August 9 in Asia/Shanghai");

        assert_eq!(aug_8.tokens, 106);
        assert_eq!(aug_9.tokens, 85);
    }

    #[test]
    fn dashboard_uses_cached_daily_usage_without_reparsing_transcript() {
        let path = write_temp_jsonl(
            "cached-cross-day-dashboard",
            r#"{"timestamp":"2026-08-08T15:59:58Z","type":"session_meta","payload":{"id":"cached-cross-day","model_provider":"openai"}}
{"timestamp":"2026-08-08T15:59:59Z","type":"turn_context","payload":{"model":"gpt-test"}}
{"timestamp":"2026-08-08T15:59:59Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":1},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5,"reasoning_output_tokens":1}}}}
{"timestamp":"2026-08-08T16:00:01Z","type":"turn_context","payload":{"model":"gpt-test"}}
{"timestamp":"2026-08-08T16:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":180,"cached_input_tokens":40,"output_tokens":9,"reasoning_output_tokens":2},"last_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":4,"reasoning_output_tokens":1}}}}"#,
        );
        let session = parse_transcript(&path, "cached-cross-day", "codex").unwrap();
        std::fs::remove_file(&path).unwrap();
        let mut store = StatsStore::new_with_backfill(
            std::env::temp_dir().join(format!("humhum-cached-day-{}.json", uuid::Uuid::new_v4())),
            false,
        );
        store.data.sessions.push(session);
        store.rebuild_daily_buckets();

        let dashboard = store.get_token_dashboard();

        assert_eq!(store.data.daily_buckets.len(), 2);
        assert_eq!(dashboard.days.len(), 2);
        assert_eq!(dashboard.days[0].date, "2026-08-08");
        assert_eq!(dashboard.days[0].tokens, 106);
        assert_eq!(dashboard.days[1].date, "2026-08-09");
        assert_eq!(dashboard.days[1].tokens, 85);
    }

    #[test]
    fn migration_backfills_daily_usage_without_discarding_existing_sessions() {
        let path = write_temp_jsonl(
            "daily-usage-migration",
            r#"{"timestamp":"2026-08-08T15:59:58Z","type":"session_meta","payload":{"id":"migration","model_provider":"openai"}}
{"timestamp":"2026-08-08T15:59:59Z","type":"turn_context","payload":{"model":"gpt-test"}}
{"timestamp":"2026-08-08T15:59:59Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":5}}}}"#,
        );
        let mut session = parse_transcript(&path, "migration", "codex").unwrap();
        session.daily_usage.clear();
        let stats_path =
            std::env::temp_dir().join(format!("humhum-migration-{}.json", uuid::Uuid::new_v4()));
        let mut store = StatsStore {
            data: StatsData {
                parser_revision: STATS_PARSER_REVISION,
                daily_usage_revision: 0,
                sessions: vec![session],
                daily_buckets: vec![],
                processed_transcripts: HashSet::new(),
            },
            file_path: stats_path,
        };

        store.migrate_daily_usage_cache().unwrap();

        assert_eq!(store.data.sessions.len(), 1);
        assert_eq!(store.data.daily_usage_revision, DAILY_USAGE_REVISION);
        assert_eq!(store.data.sessions[0].daily_usage.len(), 1);
        assert_eq!(store.data.daily_buckets[0].total_tokens, 105);
    }

    #[test]
    fn pruning_keeps_long_session_with_recent_daily_usage() {
        let mut store = StatsStore::new_with_backfill(
            std::env::temp_dir().join(format!("humhum-prune-{}.json", uuid::Uuid::new_v4())),
            false,
        );
        let recent_date = chrono::Local::now().format("%Y-%m-%d").to_string();
        store.data.sessions.push(SessionStats {
            session_id: "long-running".to_string(),
            client_type: "codex".to_string(),
            transcript_path: "long-running.jsonl".to_string(),
            model: "gpt-test".to_string(),
            input_tokens: 100,
            output_tokens: 5,
            cache_creation_tokens: 0,
            cache_read_tokens: 20,
            reasoning_tokens: 0,
            daily_usage: vec![SessionDailyUsage {
                date: recent_date,
                model: "gpt-test".to_string(),
                input_tokens: 100,
                output_tokens: 5,
                cache_read_tokens: 20,
                messages: 1,
                ..SessionDailyUsage::default()
            }],
            hourly_usage: vec![],
            tool_calls: 0,
            tool_names: vec![],
            timestamp: "2020-01-01T00:00:00+08:00".to_string(),
        });

        store.prune_old_data();

        assert_eq!(store.data.sessions.len(), 1);
        assert_eq!(store.data.sessions[0].daily_usage.len(), 1);
    }
}
