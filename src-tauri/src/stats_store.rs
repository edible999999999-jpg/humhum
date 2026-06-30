use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionStats {
    pub session_id: String,
    pub client_type: String,
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
    pub fn new(file_path: PathBuf) -> Self {
        let data = Self::load_from_disk(&file_path);
        Self { data, file_path }
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
        std::fs::write(&tmp, content)
            .map_err(|e| format!("Failed to write stats: {}", e))?;
        std::fs::rename(&tmp, &self.file_path)
            .map_err(|e| format!("Failed to rename stats file: {}", e))?;
        Ok(())
    }

    pub fn record_session_end(
        &mut self,
        transcript_path: &str,
        session_id: &str,
        client_type: &str,
    ) -> Result<(), String> {
        if self.data.processed_transcripts.contains(transcript_path) {
            return Ok(());
        }

        if let Some(stats) = parse_transcript(transcript_path, session_id, client_type) {
            self.update_daily_bucket(&stats);
            self.data.sessions.push(stats);
            self.data
                .processed_transcripts
                .insert(transcript_path.to_string());
            self.prune_old_data();
            self.save()?;
        }
        Ok(())
    }

    fn update_daily_bucket(&mut self, stats: &SessionStats) {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let cost = calculate_cost(stats);

        if let Some(bucket) = self.data.daily_buckets.iter_mut().find(|b| b.date == today) {
            bucket.total_tokens += stats.input_tokens + stats.output_tokens;
            bucket.input_tokens += stats.input_tokens;
            bucket.output_tokens += stats.output_tokens;
            bucket.tool_calls += stats.tool_calls;
            bucket.session_count += 1;
            bucket.estimated_cost_usd += cost;
            *bucket
                .clients
                .entry(stats.client_type.clone())
                .or_insert(0) += 1;
        } else {
            let mut clients = HashMap::new();
            clients.insert(stats.client_type.clone(), 1);
            self.data.daily_buckets.push(DailyBucket {
                date: today,
                total_tokens: stats.input_tokens + stats.output_tokens,
                input_tokens: stats.input_tokens,
                output_tokens: stats.output_tokens,
                tool_calls: stats.tool_calls,
                session_count: 1,
                estimated_cost_usd: cost,
                clients,
            });
        }
    }

    fn prune_old_data(&mut self) {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(30);
        let cutoff_str = cutoff.format("%Y-%m-%d").to_string();

        self.data.daily_buckets.retain(|b| b.date >= cutoff_str);
        self.data.sessions.retain(|s| s.timestamp >= cutoff_str);

        if self.data.processed_transcripts.len() > 500 {
            let half = self.data.processed_transcripts.len() / 2;
            let keep: HashSet<String> = self
                .data
                .processed_transcripts
                .iter()
                .skip(half)
                .cloned()
                .collect();
            self.data.processed_transcripts = keep;
        }
    }

    pub fn get_aggregated_stats(&self) -> AggregatedStats {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let d7 = (chrono::Utc::now() - chrono::Duration::days(7))
            .format("%Y-%m-%d")
            .to_string();
        let d30 = (chrono::Utc::now() - chrono::Duration::days(30))
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

        // 24h window for active agents
        let active_cutoff = (chrono::Utc::now() - chrono::Duration::hours(24))
            .to_rfc3339();
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
            total_tokens: total_in + total_out,
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
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cache_creation = 0u64;
    let mut cache_read = 0u64;
    let mut tool_calls = 0u64;
    let mut tool_set: HashSet<String> = HashSet::new();
    let mut model = String::new();

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

        if entry_type == "assistant" {
            if let Some(msg) = val.get("message") {
                // Extract usage
                if let Some(usage) = msg.get("usage") {
                    input_tokens +=
                        usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    output_tokens +=
                        usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    cache_creation += usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    cache_read += usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                }

                // Extract model
                if let Some(m) = msg.get("model").and_then(|v| v.as_str()) {
                    model = m.to_string();
                }

                // Count tool uses
                if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
                    for item in content {
                        if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                            tool_calls += 1;
                            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                                tool_set.insert(name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    if input_tokens == 0 && output_tokens == 0 {
        return None;
    }

    let mut tool_names: Vec<String> = tool_set.into_iter().collect();
    tool_names.sort();

    Some(SessionStats {
        session_id: session_id.to_string(),
        client_type: client_type.to_string(),
        model,
        input_tokens,
        output_tokens,
        cache_creation_tokens: cache_creation,
        cache_read_tokens: cache_read,
        tool_calls,
        tool_names,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}
