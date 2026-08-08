use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::BufRead;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tokscale_core::sessions::{claudecode::parse_claude_file, codex::parse_codex_file};

use crate::local_api_auth::{protect_owner_only, write_private_file_atomically};

// 4: DaySlice gained a per-day `messages` count so the day view reports real
// message counts instead of session counts; bump forces a rebuild to populate it.
// 5: DaySlice gained a stored per-day `cost` accumulated per-message at parse
// time (each message priced by its own model). Costing a whole session against
// one model mis-priced any session that switched models (e.g. Opus→Sonnet) and
// made the day view disagree with the per-message hourly view; bump rebuilds.
const STATS_PARSER_REVISION: u32 = 5;

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
    pub tool_calls: u64,
    pub tool_names: Vec<String>,
    /// First message time (min). Used for the session's "start day" (tool
    /// calls and session count attribution) and as the day_slices fallback.
    pub timestamp: String,
    /// Last message time (max). Used for 30-day pruning so a long-lived
    /// session that started >30 days ago but is still active is not dropped.
    /// `serde(default)` keeps pre-revision-3 stats.json deserializable.
    #[serde(default)]
    pub last_activity: String,
    /// Per-day token breakdown so a session that crosses midnight charges each
    /// calendar day the tokens actually spent that day, instead of dumping the
    /// whole session onto its first-message day. Sums exactly to the session
    /// totals. `serde(default)` keeps pre-revision-3 stats.json deserializable;
    /// the revision bump forces a rebuild that repopulates it.
    #[serde(default)]
    pub day_slices: Vec<DaySlice>,
}

/// One calendar day's slice of a session's token usage. Cost is accumulated
/// per-message at parse time (each message priced by its own model) and stored,
/// so per-day costs sum to the session-level cost and agree with the hourly
/// view even when a session switched models mid-way.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DaySlice {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub reasoning_tokens: u64,
    /// Number of usage-bearing messages that landed on this day. Lets the day
    /// view report real message counts instead of session counts. `serde
    /// (default)` keeps older stats.json deserializable; the revision bump
    /// repopulates it.
    #[serde(default)]
    pub messages: u64,
    /// Cost accumulated per-message on this day, each message priced by its own
    /// model. Stored rather than derived from the session model so a session
    /// that switched models is costed correctly and the day view agrees with
    /// the per-message hourly view. `serde(default)` keeps older stats.json
    /// deserializable; the revision bump repopulates it.
    #[serde(default)]
    pub cost: f64,
}

impl DaySlice {
    fn total_tokens(&self) -> u64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_creation_tokens
            + self.cache_read_tokens
            + self.reasoning_tokens
    }

    /// Per-day cost. Prefers the stored per-message cost (populated at parse
    /// time, correct for model-switching sessions); falls back to pricing the
    /// slice's tokens against the session model for synthetic/pre-revision
    /// slices that carry no stored cost.
    fn cost(&self, model: &str) -> f64 {
        if self.cost > 0.0 {
            return self.cost;
        }
        cost_from_tokens(
            model,
            self.input_tokens,
            self.output_tokens,
            self.cache_creation_tokens,
            self.cache_read_tokens,
            self.reasoning_tokens,
        )
    }
}

impl SessionStats {
    /// Per-day token slices, synthesizing a single slice from the session
    /// totals when `day_slices` is absent (pre-revision data, or a session
    /// whose messages carried no usable timestamp) so callers can always
    /// iterate uniformly. The synthetic slice lands on the first-message day.
    fn effective_day_slices(&self) -> Vec<DaySlice> {
        if !self.day_slices.is_empty() {
            return self.day_slices.clone();
        }
        let day = self
            .timestamp
            .get(0..10)
            .filter(|s| s.len() == 10)
            .map(str::to_string)
            .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
        vec![DaySlice {
            date: day,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cache_creation_tokens: self.cache_creation_tokens,
            cache_read_tokens: self.cache_read_tokens,
            reasoning_tokens: self.reasoning_tokens,
            // Pre-revision data has no per-message count; the revision bump
            // forces a rebuild that repopulates real counts, so 0 only shows
            // for the transient fallback rather than being persisted.
            messages: 0,
            // 0 makes DaySlice::cost fall back to pricing tokens against the
            // session model, matching the pre-slice-cost behavior for the
            // transient/pre-revision fallback.
            cost: 0.0,
        }]
    }
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
    pub sessions: Vec<SessionStats>,
    pub daily_buckets: Vec<DailyBucket>,
    pub processed_transcripts: HashSet<String>,
}

impl Default for StatsData {
    fn default() -> Self {
        Self {
            parser_revision: STATS_PARSER_REVISION,
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

fn cost_from_tokens(
    model: &str,
    input: u64,
    output: u64,
    cache_creation: u64,
    cache_read: u64,
    reasoning: u64,
) -> f64 {
    let p = get_pricing(model);
    (input as f64 * p.input_per_million
        + output as f64 * p.output_per_million
        + cache_creation as f64 * p.cache_write_per_million
        + cache_read as f64 * p.cache_read_per_million
        + reasoning as f64 * p.output_per_million)
        / 1_000_000.0
}

/// A session's total cost: the sum of its per-day slice costs, each of which
/// prefers the stored per-message cost. This keeps a model-switching session
/// priced correctly and consistent with the day and hourly views. Falls back
/// to whole-session model pricing only when a session has no slices (pre-
/// revision data), via `effective_day_slices` synthesizing one.
fn calculate_cost(stats: &SessionStats) -> f64 {
    stats
        .effective_day_slices()
        .iter()
        .map(|slice| slice.cost(&stats.model))
        .sum()
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
                    // Dedup strictly by transcript_path: one logical session spans many
                    // files (Codex resume reuses session_id across files; Claude subagent
                    // files share the parent's id). Folding by session_id undercounts.
                    self.data
                        .sessions
                        .retain(|s| s.transcript_path != transcript_path);
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
            // Dedup strictly by transcript_path (see backfill_recent_transcripts).
            self.data
                .sessions
                .retain(|s| s.transcript_path != transcript_path);
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

    /// Return a mutable handle to the bucket for `date`, creating an empty one
    /// if needed. Split out so token spreading and the start-day counters can
    /// both target the right day without duplicating the find-or-insert dance.
    fn bucket_for_date(&mut self, date: &str) -> &mut DailyBucket {
        if let Some(idx) = self.data.daily_buckets.iter().position(|b| b.date == date) {
            return &mut self.data.daily_buckets[idx];
        }
        self.data.daily_buckets.push(DailyBucket {
            date: date.to_string(),
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            reasoning_tokens: 0,
            tool_calls: 0,
            session_count: 0,
            estimated_cost_usd: 0.0,
            clients: HashMap::new(),
        });
        self.data.daily_buckets.last_mut().expect("just pushed")
    }

    fn update_daily_bucket(&mut self, stats: &SessionStats) {
        // Tokens and cost spread across the real days they happened on, so a
        // session that runs past midnight charges each day its own usage
        // instead of dumping everything on the first-message day.
        let model = stats.model.clone();
        for slice in stats.effective_day_slices() {
            let slice_cost = slice.cost(&model);
            let bucket = self.bucket_for_date(&slice.date);
            bucket.total_tokens += slice.total_tokens();
            bucket.input_tokens += slice.input_tokens;
            bucket.output_tokens += slice.output_tokens;
            bucket.cache_creation_tokens += slice.cache_creation_tokens;
            bucket.cache_read_tokens += slice.cache_read_tokens;
            bucket.reasoning_tokens += slice.reasoning_tokens;
            bucket.estimated_cost_usd += slice_cost;
        }

        // Session-level counters (session_count, tool_calls, per-client count)
        // stay whole on the start day: a session is one session, and tool calls
        // carry no per-message timestamp to spread by. Keeping them undivided
        // preserves `sum(session_count) == number of sessions`.
        let start_day = stats
            .timestamp
            .get(0..10)
            .filter(|s| s.len() == 10)
            .map(str::to_string)
            .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
        let client_type = stats.client_type.clone();
        let tool_calls = stats.tool_calls;
        let bucket = self.bucket_for_date(&start_day);
        bucket.tool_calls += tool_calls;
        bucket.session_count += 1;
        *bucket.clients.entry(client_type).or_insert(0) += 1;
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
        // Prune by last activity, not first message: a session that started
        // >30 days ago but is still being written must be kept. Old rows
        // (pre-revision-3) have an empty last_activity, so fall back to timestamp.
        self.data.sessions.retain(|s| {
            let activity = if s.last_activity.is_empty() {
                &s.timestamp
            } else {
                &s.last_activity
            };
            activity.as_str() >= cutoff_str.as_str()
        });

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

    /// Add one calendar-day slice of a session, costed against `model`. Used by
    /// the day view so a midnight-crossing session lands on each real day.
    fn add_slice(&mut self, slice: &DaySlice, model: &str) {
        self.tokens += slice.total_tokens();
        self.cost += slice.cost(model);
        // Real message count for the day, not +1-per-session — otherwise the
        // day view's "messages" silently counted sessions.
        self.messages += slice.messages;
        self.input += slice.input_tokens;
        self.output += slice.output_tokens;
        self.cache_read += slice.cache_read_tokens;
        self.cache_write += slice.cache_creation_tokens;
        self.reasoning += slice.reasoning_tokens;
    }

    /// Add a single parsed transcript message's token breakdown directly, used
    /// by the hourly view where each message carries its own timestamp so the
    /// day's usage spreads across the real hours it happened in.
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
}

// Re-parse today's transcripts and bucket every message by the local hour it
// actually happened in. A single session can span many hours, so charging its
// whole token total to the session's start hour (as the day/week/month views do)
// collapses the hourly chart into one lonely bar. Here we read each message's
// own millisecond timestamp instead.
fn accumulate_today_hours(
    sessions: &[SessionStats],
    today: &str,
    hour_acc: &mut HashMap<String, TokenAccum>,
) {
    use tokscale_core::sessions::{claudecode::parse_claude_file, codex::parse_codex_file};

    for s in sessions {
        if s.transcript_path.is_empty() {
            continue;
        }
        let path = std::path::Path::new(&s.transcript_path);
        if !path.exists() {
            continue;
        }
        let messages = match s.client_type.as_str() {
            "codex" => parse_codex_file(path),
            "claude" | "claude-code" => parse_claude_file(path),
            _ => continue,
        };
        bucket_messages_by_hour(&messages, today, hour_acc);
    }
}

// Pure hour-bucketing: given parsed transcript messages, spread each one into
// the local hour it happened in (today only). Split out so it can be tested
// without touching disk.
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
        let input = m.tokens.input.max(0) as u64;
        let output = m.tokens.output.max(0) as u64;
        let cache_read = m.tokens.cache_read.max(0) as u64;
        let cache_write = m.tokens.cache_write.max(0) as u64;
        let reasoning = m.tokens.reasoning.max(0) as u64;
        // tokscale's claude parser leaves per-message `cost` at 0.0 (cost is
        // derived later, in bulk, from token totals) — so trusting `m.cost`
        // here left the hourly view reading $0.00 while the day showed the
        // real spend. Re-price each message from its own tokens + model, the
        // same path calculate_cost/DaySlice::cost use, so the hourly costs sum
        // to the day's cost.
        let cost = cost_from_tokens(
            &m.model_id,
            input,
            output,
            cache_write,
            cache_read,
            reasoning,
        );
        hour_acc.entry(key).or_default().add_breakdown(
            input,
            output,
            cache_read,
            cache_write,
            reasoning,
            cost,
        );
    }
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
            let cost = calculate_cost(s);
            let model = if s.model.trim().is_empty() {
                "unknown".to_string()
            } else {
                s.model.clone()
            };
            client_set.insert(s.client_type.clone());
            model_set.insert(model.clone());
            total.add(s, cost);
            // Spread each day's tokens onto the day it actually happened so a
            // session crossing midnight shows up on both days, matching the
            // persisted daily_buckets and the hourly view.
            for slice in s.effective_day_slices() {
                day_acc
                    .entry(slice.date.clone())
                    .or_default()
                    .add_slice(&slice, &s.model);
                day_slice
                    .entry((slice.date.clone(), s.client_type.clone(), model.clone()))
                    .or_default()
                    .add_slice(&slice, &s.model);
            }
        }

        // Hourly view needs per-message timestamps, not per-session, so re-parse
        // today's transcripts and spread each message into its real local hour.
        accumulate_today_hours(&self.data.sessions, &today, &mut hour_acc);

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
                clients.sort_by_key(|c| std::cmp::Reverse(c.tokens));
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
    // Per-day accumulation so a session spanning midnight charges each day the
    // tokens spent that day. Messages whose timestamp is missing/unparseable
    // fold into `undated` and are re-attributed to the session's start day
    // below, so the slices always sum to the session totals.
    let mut per_day: HashMap<String, DaySlice> = HashMap::new();
    let mut undated = DaySlice::default();
    for message in &usage_messages {
        let m_input = message.tokens.input.max(0) as u64;
        let m_output = message.tokens.output.max(0) as u64;
        let m_cache_write = message.tokens.cache_write.max(0) as u64;
        let m_cache_read = message.tokens.cache_read.max(0) as u64;
        let m_reasoning = message.tokens.reasoning.max(0) as u64;

        input_tokens = input_tokens.saturating_add(m_input);
        output_tokens = output_tokens.saturating_add(m_output);
        cache_creation = cache_creation.saturating_add(m_cache_write);
        cache_read = cache_read.saturating_add(m_cache_read);
        reasoning_tokens = reasoning_tokens.saturating_add(m_reasoning);

        // Price each message by its own model, so a session that switched
        // models (e.g. Opus→Sonnet) is costed correctly and the stored per-day
        // cost matches the per-message hourly view.
        let m_cost = cost_from_tokens(
            &message.model_id,
            m_input,
            m_output,
            m_cache_write,
            m_cache_read,
            m_reasoning,
        );

        let slot = chrono::DateTime::from_timestamp_millis(message.timestamp)
            .filter(|_| message.timestamp > 0)
            .map(|dt| {
                let date = dt
                    .with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string();
                per_day.entry(date).or_default()
            })
            .unwrap_or(&mut undated);
        slot.input_tokens = slot.input_tokens.saturating_add(m_input);
        slot.output_tokens = slot.output_tokens.saturating_add(m_output);
        slot.cache_creation_tokens = slot.cache_creation_tokens.saturating_add(m_cache_write);
        slot.cache_read_tokens = slot.cache_read_tokens.saturating_add(m_cache_read);
        slot.reasoning_tokens = slot.reasoning_tokens.saturating_add(m_reasoning);
        slot.messages = slot.messages.saturating_add(1);
        slot.cost += m_cost;
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
    let last_activity = usage_messages
        .iter()
        .map(|message| message.timestamp)
        .filter(|timestamp| *timestamp > 0)
        .max()
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis)
        .map(|timestamp| timestamp.with_timezone(&chrono::Local).to_rfc3339())
        .unwrap_or_else(|| timestamp.clone());

    // Fold any timestamp-less tokens onto the session's start day so the
    // per-day slices still sum to the session totals.
    if undated.total_tokens() > 0 {
        let start_day = timestamp
            .get(0..10)
            .filter(|s| s.len() == 10)
            .unwrap_or("")
            .to_string();
        let slot = per_day.entry(start_day).or_default();
        slot.input_tokens = slot.input_tokens.saturating_add(undated.input_tokens);
        slot.output_tokens = slot.output_tokens.saturating_add(undated.output_tokens);
        slot.cache_creation_tokens = slot
            .cache_creation_tokens
            .saturating_add(undated.cache_creation_tokens);
        slot.cache_read_tokens = slot
            .cache_read_tokens
            .saturating_add(undated.cache_read_tokens);
        slot.reasoning_tokens = slot
            .reasoning_tokens
            .saturating_add(undated.reasoning_tokens);
        slot.messages = slot.messages.saturating_add(undated.messages);
        slot.cost += undated.cost;
    }
    let mut day_slices: Vec<DaySlice> = per_day
        .into_iter()
        .map(|(date, mut slice)| {
            slice.date = date;
            slice
        })
        .filter(|slice| slice.total_tokens() > 0)
        .collect();
    day_slices.sort_by(|a, b| a.date.cmp(&b.date));

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
        tool_calls,
        tool_names,
        timestamp,
        last_activity,
        day_slices,
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
                tool_calls: 1,
                tool_names: vec![],
                timestamp: ts.clone(),
                last_activity: ts.clone(),
                // Empty on purpose: exercises the effective_day_slices() fallback
                // that migrates pre-revision-3 rows onto their start day.
                day_slices: vec![],
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

        // Cost must be re-priced from each message's own tokens + model, NOT
        // read from UnifiedMessage.cost (which tokscale leaves at 0 for claude,
        // and here is a deliberately-wrong 0.01). Opus: input $15/M, output
        // $75/M → 09:00 = (300*15 + 20*75)/1e6 = 0.006.
        let expected_h09 = (300.0 * 15.0 + 20.0 * 75.0) / 1_000_000.0;
        assert!(
            (h09.cost - expected_h09).abs() < 1e-9,
            "hourly cost re-priced from tokens, got {} want {expected_h09}",
            h09.cost
        );
        assert!(
            h09.cost > 0.0,
            "hourly cost must not be $0 when tokens exist"
        );
    }

    // A single session whose messages straddle midnight must charge each
    // calendar day the tokens spent that day, not dump the whole session onto
    // the first-message day. Uses two fixed local days so the assertion is
    // stable regardless of when the test runs.
    #[test]
    fn parse_transcript_splits_tokens_across_midnight() {
        use chrono::TimeZone;
        // 23:30 on day one and 00:30 on the next day, in the viewer's local zone.
        let day1 = chrono::Local
            .with_ymd_and_hms(2026, 3, 10, 23, 30, 0)
            .unwrap();
        let day2 = chrono::Local
            .with_ymd_and_hms(2026, 3, 11, 0, 30, 0)
            .unwrap();
        let d1 = day1.format("%Y-%m-%d").to_string();
        let d2 = day2.format("%Y-%m-%d").to_string();
        let line1 = format!(
            r#"{{"type":"assistant","timestamp":"{}","message":{{"id":"m1","model":"claude-opus-4","usage":{{"input_tokens":100,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"content":[]}}}}"#,
            day1.to_rfc3339()
        );
        let line2 = format!(
            r#"{{"type":"assistant","timestamp":"{}","message":{{"id":"m2","model":"claude-opus-4","usage":{{"input_tokens":400,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"content":[]}}}}"#,
            day2.to_rfc3339()
        );
        let body = format!("{line1}\n{line2}\n");
        let path = write_temp_jsonl("midnight", &body);

        let stats =
            parse_transcript(&path, "sess-mid", "claude-code").expect("transcript should parse");

        // Two day slices, one per calendar day, summing to the session totals.
        assert_eq!(stats.day_slices.len(), 2, "one slice per day");
        let s1 = stats.day_slices.iter().find(|s| s.date == d1).unwrap();
        let s2 = stats.day_slices.iter().find(|s| s.date == d2).unwrap();
        assert_eq!(s1.input_tokens, 100);
        assert_eq!(s1.output_tokens, 10);
        assert_eq!(s2.input_tokens, 400);
        assert_eq!(s2.output_tokens, 20);
        // Each day recorded its own message, so the day view reports real
        // message counts (1 + 1) rather than a per-session +1.
        assert_eq!(s1.messages, 1, "day one saw one message");
        assert_eq!(s2.messages, 1, "day two saw one message");
        let slice_sum: u64 = stats.day_slices.iter().map(|s| s.total_tokens()).sum();
        assert_eq!(
            slice_sum,
            stats.input_tokens + stats.output_tokens,
            "slices must sum to session totals"
        );

        // Daily buckets built from this session must land the tokens on both
        // days, with the whole session counted once on its start day.
        let dir = std::env::temp_dir().join(format!("humhum-mid-{}", uuid::Uuid::new_v4()));
        let mut store = StatsStore::new_with_backfill(dir.join("stats.json"), false);
        store.data.sessions.push(stats);
        store.rebuild_daily_buckets();
        let b1 = store
            .data
            .daily_buckets
            .iter()
            .find(|b| b.date == d1)
            .unwrap();
        let b2 = store
            .data
            .daily_buckets
            .iter()
            .find(|b| b.date == d2)
            .unwrap();
        assert_eq!(b1.total_tokens, 110, "day one keeps only its own tokens");
        assert_eq!(b2.total_tokens, 420, "day two keeps only its own tokens");
        assert_eq!(
            b1.session_count, 1,
            "session counted once, on its start day"
        );
        assert_eq!(b2.session_count, 0, "no double-count on the second day");

        let _ = std::fs::remove_file(&path);
    }

    // Regression: the day view's "messages" once counted sessions (add_slice
    // did +=1 per session-day), so N sessions on a day with hundreds of real
    // messages reported "N 消息". It must report the summed per-day message
    // counts instead.
    #[test]
    fn day_view_reports_message_count_not_session_count() {
        use chrono::TimeZone;
        let day = chrono::Local
            .with_ymd_and_hms(2026, 5, 1, 12, 0, 0)
            .unwrap();
        let date = day.format("%Y-%m-%d").to_string();

        // Two separate sessions on the same day, one with 3 messages, one with
        // 5 — 8 real messages total across 2 sessions.
        let make = |mtxt: &str| {
            let lines: Vec<String> = (0..mtxt.len())
                .map(|i| {
                    format!(
                        r#"{{"type":"assistant","timestamp":"{}","message":{{"id":"m{i}","model":"claude-opus-4","usage":{{"input_tokens":10,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"content":[]}}}}"#,
                        day.to_rfc3339()
                    )
                })
                .collect();
            lines.join("\n") + "\n"
        };
        let p1 = write_temp_jsonl("daymsg-a", &make("abc")); // 3 messages
        let p2 = write_temp_jsonl("daymsg-b", &make("abcde")); // 5 messages
        let s1 = parse_transcript(&p1, "sess-a", "claude-code").unwrap();
        let s2 = parse_transcript(&p2, "sess-b", "claude-code").unwrap();

        let dir = std::env::temp_dir().join(format!("humhum-daymsg-{}", uuid::Uuid::new_v4()));
        let mut store = StatsStore::new_with_backfill(dir.join("stats.json"), false);
        store.data.sessions.push(s1);
        store.data.sessions.push(s2);

        let dash = store.get_token_dashboard();
        let day = dash.days.iter().find(|d| d.date == date).unwrap();
        assert_eq!(
            day.messages, 8,
            "day view must sum real messages (3+5), not count sessions (would be 2)"
        );

        let _ = std::fs::remove_file(&p1);
        let _ = std::fs::remove_file(&p2);
    }

    // Regression: a session that switched models was costed entirely against
    // its LAST model, so 1M Opus + 1M Sonnet input tokens priced as if all 2M
    // were Sonnet ($6) instead of $15 (Opus) + $3 (Sonnet) = $18. Cost is now
    // accumulated per-message by each message's own model.
    #[test]
    fn mixed_model_session_is_priced_per_message() {
        use chrono::TimeZone;
        let day = chrono::Local
            .with_ymd_and_hms(2026, 5, 2, 12, 0, 0)
            .unwrap();
        let date = day.format("%Y-%m-%d").to_string();

        // One Opus message then one Sonnet message, each 1,000,000 input tokens.
        let body = format!(
            "{}\n{}\n",
            format!(
                r#"{{"type":"assistant","timestamp":"{ts}","message":{{"id":"m0","model":"claude-opus-4","usage":{{"input_tokens":1000000,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"content":[]}}}}"#,
                ts = day.to_rfc3339()
            ),
            format!(
                r#"{{"type":"assistant","timestamp":"{ts}","message":{{"id":"m1","model":"claude-sonnet-4","usage":{{"input_tokens":1000000,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"content":[]}}}}"#,
                ts = day.to_rfc3339()
            ),
        );
        let path = write_temp_jsonl("mixed-model", &body);
        let session = parse_transcript(&path, "sess-mixed", "claude-code").unwrap();

        // Session cost sums per-message: $15 (Opus) + $3 (Sonnet) = $18.
        let cost = calculate_cost(&session);
        assert!(
            (cost - 18.0).abs() < 1e-6,
            "per-model cost should be $18 (Opus $15 + Sonnet $3), got {cost}"
        );

        let dir = std::env::temp_dir().join(format!("humhum-mixed-{}", uuid::Uuid::new_v4()));
        let mut store = StatsStore::new_with_backfill(dir.join("stats.json"), false);
        store.data.sessions.push(session);

        let dash = store.get_token_dashboard();
        let day_row = dash.days.iter().find(|d| d.date == date).unwrap();
        assert!(
            (day_row.cost - 18.0).abs() < 1e-6,
            "day view cost must match per-model pricing ($18), got {}",
            day_row.cost
        );

        let _ = std::fs::remove_file(&path);
    }
}
