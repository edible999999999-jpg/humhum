use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

const MAX_OBSIDIAN_NOTES: usize = 2000;
const MAX_AGENT_ASSETS: usize = 8000;
const MAX_MARKDOWN_BYTES: u64 = 512 * 1024;
const MAX_ASSET_BYTES: u64 = 384 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preference {
    pub id: String,
    pub category: String,
    pub content: String,
    pub source: String,
    pub priority: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRule {
    pub id: String,
    pub agent_id: String,
    pub rule_type: String,
    pub file_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryItem {
    pub id: String,
    pub agent_id: String,
    pub content: String,
    pub temperature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ObsidianVaultConfig {
    pub path: Option<String>,
    pub enabled: bool,
    pub last_indexed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsidianTask {
    pub text: String,
    pub completed: bool,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsidianNote {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub relative_path: String,
    pub source: String,
    pub note_type: String,
    pub memory_temperature: String,
    pub tags: Vec<String>,
    pub frontmatter: Map<String, Value>,
    pub wiki_links: Vec<String>,
    pub tasks: Vec<ObsidianTask>,
    pub excerpt: String,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAsset {
    pub id: String,
    pub asset_type: String,
    pub agent_id: String,
    pub name: String,
    pub file_path: String,
    pub relative_path: String,
    pub source: String,
    pub content: String,
    pub tags: Vec<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAssetRootDiagnostic {
    pub raw_path: String,
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub candidate_count: usize,
    pub skill_count: usize,
    pub sample_paths: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KnowledgeData {
    #[serde(default)]
    pub preferences: Vec<Preference>,
    #[serde(default)]
    pub agent_rules: Vec<AgentRule>,
    #[serde(default)]
    pub memory_items: Vec<MemoryItem>,
    #[serde(default)]
    pub obsidian_vault: ObsidianVaultConfig,
    #[serde(default)]
    pub obsidian_notes: Vec<ObsidianNote>,
    #[serde(default)]
    pub agent_assets: Vec<AgentAsset>,
}

#[derive(Debug)]
pub struct KnowledgeStore {
    data: KnowledgeData,
    file_path: PathBuf,
}

impl KnowledgeStore {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let file_path = home.join(".humhum").join("knowledge.json");
        let data = Self::load_from_file(&file_path);
        Self { data, file_path }
    }

    fn load_from_file(path: &PathBuf) -> KnowledgeData {
        match std::fs::read_to_string(path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => KnowledgeData::default(),
        }
    }

    fn save(&self) {
        if let Some(parent) = self.file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = self.file_path.with_extension("tmp");
        if let Ok(json) = serde_json::to_string_pretty(&self.data) {
            if std::fs::write(&tmp, &json).is_ok() {
                let _ = std::fs::rename(&tmp, &self.file_path);
            }
        }
    }

    pub fn get_all(&self) -> &KnowledgeData {
        &self.data
    }

    pub fn save_preference(&mut self, pref: Preference) {
        if let Some(existing) = self.data.preferences.iter_mut().find(|p| p.id == pref.id) {
            *existing = pref;
        } else {
            self.data.preferences.push(pref);
        }
        self.save();
    }

    pub fn delete_preference(&mut self, id: &str) -> bool {
        let before = self.data.preferences.len();
        self.data.preferences.retain(|p| p.id != id);
        let removed = self.data.preferences.len() < before;
        if removed {
            self.save();
        }
        removed
    }

    pub fn query(&self, keyword: &str) -> KnowledgeData {
        let kw = keyword.to_lowercase();
        KnowledgeData {
            preferences: self
                .data
                .preferences
                .iter()
                .filter(|p| {
                    p.content.to_lowercase().contains(&kw)
                        || p.category.to_lowercase().contains(&kw)
                })
                .cloned()
                .collect(),
            agent_rules: self
                .data
                .agent_rules
                .iter()
                .filter(|r| {
                    r.content.to_lowercase().contains(&kw)
                        || r.agent_id.to_lowercase().contains(&kw)
                })
                .cloned()
                .collect(),
            memory_items: self
                .data
                .memory_items
                .iter()
                .filter(|m| {
                    m.content.to_lowercase().contains(&kw)
                        || m.agent_id.to_lowercase().contains(&kw)
                })
                .cloned()
                .collect(),
            obsidian_vault: self.data.obsidian_vault.clone(),
            obsidian_notes: self
                .data
                .obsidian_notes
                .iter()
                .filter(|note| {
                    note.title.to_lowercase().contains(&kw)
                        || note.relative_path.to_lowercase().contains(&kw)
                        || note.note_type.to_lowercase().contains(&kw)
                        || note.tags.iter().any(|tag| tag.to_lowercase().contains(&kw))
                        || note.excerpt.to_lowercase().contains(&kw)
                })
                .cloned()
                .collect(),
            agent_assets: self
                .data
                .agent_assets
                .iter()
                .filter(|asset| {
                    asset.name.to_lowercase().contains(&kw)
                        || asset.asset_type.to_lowercase().contains(&kw)
                        || asset.agent_id.to_lowercase().contains(&kw)
                        || asset.relative_path.to_lowercase().contains(&kw)
                        || asset.content.to_lowercase().contains(&kw)
                        || asset
                            .tags
                            .iter()
                            .any(|tag| tag.to_lowercase().contains(&kw))
                })
                .cloned()
                .collect(),
        }
    }

    pub fn set_obsidian_vault_path(&mut self, path: String) -> Result<(), String> {
        let normalized = normalize_vault_path(&path)?;
        self.data.obsidian_vault.path = Some(normalized);
        self.data.obsidian_vault.enabled = true;
        self.save();
        Ok(())
    }

    pub fn scan_obsidian_vault(
        &mut self,
        path: Option<String>,
    ) -> Result<Vec<ObsidianNote>, String> {
        if let Some(path) = path {
            self.set_obsidian_vault_path(path)?;
        }

        let vault_path = self
            .data
            .obsidian_vault
            .path
            .clone()
            .ok_or_else(|| "Obsidian vault path is not configured".to_string())?;

        let root = PathBuf::from(&vault_path);
        if !root.exists() || !root.is_dir() {
            return Err(format!(
                "Obsidian vault path is not a directory: {}",
                vault_path
            ));
        }

        let markdown_files = collect_markdown_files(&root, MAX_OBSIDIAN_NOTES)?;
        let mut notes = Vec::new();

        for path in markdown_files {
            if let Ok(metadata) = std::fs::metadata(&path) {
                if metadata.len() > MAX_MARKDOWN_BYTES {
                    continue;
                }
            }

            if let Ok(content) = std::fs::read_to_string(&path) {
                notes.push(parse_obsidian_note(&root, &path, &content));
            }
        }

        notes.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        self.data.obsidian_notes = notes.clone();
        self.data.obsidian_vault.enabled = true;
        self.data.obsidian_vault.path = Some(vault_path);
        self.data.obsidian_vault.last_indexed_at = Some(chrono::Utc::now().to_rfc3339());
        self.save();

        Ok(notes)
    }

    pub fn scan_agent_rules(&mut self) -> Vec<AgentRule> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let mut found: Vec<AgentRule> = Vec::new();

        let scan_paths: Vec<(&str, &str, &str)> = vec![
            ("claude-code", "CLAUDE.md", "CLAUDE.md"),
            ("cursor", ".cursorrules", ".cursorrules"),
            ("codex", "AGENTS.md", "AGENTS.md"),
        ];

        let search_dirs = vec![
            home.join("Desktop"),
            home.join("Documents"),
            home.join("Projects"),
            home.clone(),
        ];

        for dir in &search_dirs {
            for (agent_id, filename, rule_type) in &scan_paths {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let rule_file = path.join(filename);
                        if rule_file.exists() {
                            if let Ok(content) = std::fs::read_to_string(&rule_file) {
                                let id = format!("{}:{}", agent_id, rule_file.to_string_lossy());
                                if !self.data.agent_rules.iter().any(|r| r.id == id) {
                                    let rule = AgentRule {
                                        id: id.clone(),
                                        agent_id: agent_id.to_string(),
                                        rule_type: rule_type.to_string(),
                                        file_path: rule_file.to_string_lossy().to_string(),
                                        content: truncate_content(&content, 2000),
                                    };
                                    found.push(rule.clone());
                                    self.data.agent_rules.push(rule);
                                }
                            }
                        }
                    }
                }
            }
        }

        if !found.is_empty() {
            self.save();
        }
        found
    }

    pub fn scan_agent_assets(
        &mut self,
        roots: Option<Vec<String>>,
    ) -> Result<Vec<AgentAsset>, String> {
        let roots = resolve_agent_asset_roots(roots)?;
        let mut assets = Vec::new();

        for root in roots {
            if !root.exists() || !root.is_dir() {
                continue;
            }

            let files =
                collect_agent_asset_files(&root, MAX_AGENT_ASSETS.saturating_sub(assets.len()))?;
            for path in files {
                if assets.len() >= MAX_AGENT_ASSETS {
                    break;
                }
                if let Ok(metadata) = std::fs::metadata(&path) {
                    if metadata.len() > MAX_ASSET_BYTES {
                        continue;
                    }
                }
                let Ok(content) = std::fs::read_to_string(&path) else {
                    continue;
                };
                assets.push(parse_agent_asset(&root, &path, &content));
            }
        }

        assets.sort_by(|a, b| {
            a.asset_type
                .cmp(&b.asset_type)
                .then(a.agent_id.cmp(&b.agent_id))
                .then(a.relative_path.cmp(&b.relative_path))
        });
        assets.dedup_by(|a, b| a.id == b.id);

        self.data.agent_assets = assets.clone();
        self.save();
        Ok(assets)
    }

    pub fn diagnose_agent_asset_roots(
        &self,
        roots: Option<Vec<String>>,
    ) -> Result<Vec<AgentAssetRootDiagnostic>, String> {
        let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
        let raw_roots = roots.unwrap_or_else(default_agent_asset_root_strings);
        let mut diagnostics = Vec::new();

        for raw in raw_roots {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let path = expand_home(trimmed, &home);
            let exists = path.exists();
            let is_dir = path.is_dir();

            if !exists || !is_dir {
                diagnostics.push(AgentAssetRootDiagnostic {
                    raw_path: trimmed.to_string(),
                    path: path.to_string_lossy().to_string(),
                    exists,
                    is_dir,
                    candidate_count: 0,
                    skill_count: 0,
                    sample_paths: Vec::new(),
                    error: None,
                });
                continue;
            }

            match collect_agent_asset_files(&path, 400) {
                Ok(files) => {
                    let skill_count = files
                        .iter()
                        .filter(|file| {
                            file.file_name()
                                .and_then(|name| name.to_str())
                                .map(|name| name.eq_ignore_ascii_case("SKILL.md"))
                                .unwrap_or(false)
                        })
                        .count();
                    diagnostics.push(AgentAssetRootDiagnostic {
                        raw_path: trimmed.to_string(),
                        path: path.to_string_lossy().to_string(),
                        exists,
                        is_dir,
                        candidate_count: files.len(),
                        skill_count,
                        sample_paths: files
                            .iter()
                            .take(6)
                            .map(|file| file.to_string_lossy().to_string())
                            .collect(),
                        error: None,
                    });
                }
                Err(error) => diagnostics.push(AgentAssetRootDiagnostic {
                    raw_path: trimmed.to_string(),
                    path: path.to_string_lossy().to_string(),
                    exists,
                    is_dir,
                    candidate_count: 0,
                    skill_count: 0,
                    sample_paths: Vec::new(),
                    error: Some(error),
                }),
            }
        }

        Ok(diagnostics)
    }
}

fn resolve_agent_asset_roots(roots: Option<Vec<String>>) -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let raw_roots = roots.unwrap_or_else(default_agent_asset_root_strings);

    let mut paths = Vec::new();
    for raw in raw_roots {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = expand_home(trimmed, &home);
        if !paths.iter().any(|existing| existing == &path) {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn default_agent_asset_root_strings() -> Vec<String> {
    vec![
        "~/.codex/skills".to_string(),
        "~/.codex/plugins/cache".to_string(),
        "~/.codex/vendor_imports/skills".to_string(),
        "~/.claude".to_string(),
        "~/.agents/skills".to_string(),
        "~/.qoder".to_string(),
        "~/Desktop/my_station/devpod-ai-companion".to_string(),
        "~/Documents/数据工作台".to_string(),
    ]
}

fn expand_home(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        home.to_path_buf()
    } else if let Some(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(path)
    }
}

fn collect_agent_asset_files(root: &Path, limit: usize) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut queue = VecDeque::from([root.to_path_buf()]);

    while let Some(dir) = queue.pop_front() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if should_skip_dir(&name) || name == "target" || name == ".git" {
                    continue;
                }
                if is_trusted_agent_asset_root(root) || is_agent_asset_dir(&path) || dir == root {
                    queue.push_back(path);
                }
            } else if is_agent_asset_file(&path) {
                files.push(path);
            }
        }
    }

    files.sort_by(|a, b| {
        agent_asset_file_priority(a)
            .cmp(&agent_asset_file_priority(b))
            .then(a.to_string_lossy().cmp(&b.to_string_lossy()))
    });
    files.truncate(limit);

    Ok(files)
}

fn agent_asset_file_priority(path: &Path) -> u8 {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    let lower = path.to_string_lossy().to_lowercase();

    if filename == "skill.md" {
        0
    } else if filename == "agents.md" || lower.contains("/agents/") || lower.contains("/agent/") {
        1
    } else if lower.contains("memory") || lower.contains("soul") {
        2
    } else if filename == "claude.md" || filename == ".cursorrules" || lower.contains("rules") {
        3
    } else {
        4
    }
}

fn is_agent_asset_dir(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    [
        ".codex", ".claude", ".agents", ".qoder", ".pi", "agent", "agents", "skill", "skills",
        "soul", "memory", "memories", "rules", "hooks",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_trusted_agent_asset_root(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    [".codex", ".claude", ".agents", ".qoder", ".pi"]
        .iter()
        .any(|needle| lower.ends_with(needle) || lower.contains(&format!("{}/", needle)))
}

fn is_agent_asset_file(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    matches!(
        filename.as_str(),
        "agents.md"
            | "claude.md"
            | "skill.md"
            | "memory.md"
            | "memories.md"
            | "soul.md"
            | "rules.md"
            | ".cursorrules"
            | "settings.json"
            | "config.json"
    ) || matches!(ext.as_str(), "md" | "yaml" | "yml" | "json" | "toml")
        && [
            "agent", "skill", "soul", "memory", "rules", ".codex", ".claude", ".agents", ".pi",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn parse_agent_asset(root: &Path, path: &Path, content: &str) -> AgentAsset {
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    let lower = path.to_string_lossy().to_lowercase();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("asset")
        .to_string();
    let (frontmatter, body) = parse_frontmatter(content);
    let mut tags = collect_frontmatter_tags(&frontmatter);
    tags.extend(collect_inline_tags(body));
    tags.push(classify_asset_type(&lower, &filename));
    tags.sort();
    tags.dedup();

    let modified_at = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|dt| dt.to_rfc3339());

    AgentAsset {
        id: format!("asset:{}", path.to_string_lossy()),
        asset_type: classify_asset_type(&lower, &filename),
        agent_id: infer_agent_id(&lower),
        name: infer_asset_name(&frontmatter, path, &filename),
        file_path: path.to_string_lossy().to_string(),
        relative_path,
        source: root.to_string_lossy().to_string(),
        content: truncate_content(content, 2400),
        tags,
        modified_at,
    }
}

fn classify_asset_type(lower_path: &str, filename: &str) -> String {
    let filename = filename.to_lowercase();
    let is_config = filename.ends_with(".yaml")
        || filename.ends_with(".yml")
        || filename.ends_with(".json")
        || filename.ends_with(".toml");
    if filename == "skill.md" {
        "skill".to_string()
    } else if lower_path.contains("soul") {
        "soul".to_string()
    } else if lower_path.contains("memory") || lower_path.contains("memories") {
        "memory".to_string()
    } else if is_config {
        "config".to_string()
    } else if (lower_path.contains("/skills/") || lower_path.contains("/skill/"))
        && filename.ends_with(".md")
    {
        "skill".to_string()
    } else if filename == "agents.md"
        || lower_path.contains("/agents/")
        || lower_path.contains("/agent/")
    {
        "agent".to_string()
    } else if filename == "claude.md" || filename == ".cursorrules" || lower_path.contains("rules")
    {
        "rule".to_string()
    } else {
        "note".to_string()
    }
}

fn infer_agent_id(lower_path: &str) -> String {
    for (needle, agent) in [
        ("claude", "claude-code"),
        ("codex", "codex"),
        ("qoder", "qoder"),
        ("cursor", "cursor"),
        ("pi", "pi"),
        ("gemini", "gemini"),
        ("qwen", "qwen"),
    ] {
        if lower_path.contains(needle) {
            return agent.to_string();
        }
    }
    "personal".to_string()
}

fn infer_asset_name(frontmatter: &Map<String, Value>, path: &Path, filename: &str) -> String {
    frontmatter
        .get("name")
        .or_else(|| frontmatter.get("title"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            if filename.eq_ignore_ascii_case("skill.md") {
                path.parent()
                    .and_then(|parent| parent.file_name())
                    .and_then(|name| name.to_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| filename.to_string())
            } else {
                filename.to_string()
            }
        })
}

fn truncate_content(content: &str, limit: usize) -> String {
    if content.len() <= limit {
        content.to_string()
    } else {
        let end = content.floor_char_boundary(limit);
        let mut truncated = content[..end].to_string();
        truncated.push_str("\n...(truncated)");
        truncated
    }
}

fn normalize_vault_path(path: &str) -> Result<String, String> {
    let expanded = if path == "~" {
        dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?
    } else if let Some(stripped) = path.strip_prefix("~/") {
        dirs::home_dir()
            .ok_or_else(|| "Cannot determine home directory".to_string())?
            .join(stripped)
    } else {
        PathBuf::from(path)
    };

    if !expanded.exists() || !expanded.is_dir() {
        return Err(format!(
            "Obsidian vault path is not a directory: {}",
            expanded.display()
        ));
    }

    Ok(expanded.to_string_lossy().to_string())
}

fn collect_markdown_files(root: &Path, limit: usize) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut queue = VecDeque::from([root.to_path_buf()]);

    while let Some(dir) = queue.pop_front() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if should_skip_dir(&name) {
                    continue;
                }
                queue.push_back(path);
            } else if path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
            {
                files.push(path);
                if files.len() >= limit {
                    return Ok(files);
                }
            }
        }
    }

    Ok(files)
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".obsidian"
            | ".trash"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "sessions"
            | "audit"
            | "browser"
            | "logs"
    )
}

fn parse_obsidian_note(root: &Path, path: &Path, content: &str) -> ObsidianNote {
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    let (frontmatter, body) = parse_frontmatter(content);
    let mut tags = collect_frontmatter_tags(&frontmatter);
    tags.extend(collect_inline_tags(body));
    tags.sort();
    tags.dedup();

    let title = frontmatter
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("Untitled")
                .to_string()
        });

    let wiki_links = collect_wiki_links(body);
    let tasks = collect_tasks(body);
    let note_type = classify_note(&relative_path, &tags, &frontmatter);
    let memory_temperature = classify_temperature(&tags, &frontmatter, &note_type);
    let modified_at = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|dt| dt.to_rfc3339());

    ObsidianNote {
        id: format!("obsidian:{}", path.to_string_lossy()),
        title,
        file_path: path.to_string_lossy().to_string(),
        relative_path,
        source: "obsidian".to_string(),
        note_type,
        memory_temperature,
        tags,
        frontmatter,
        wiki_links,
        tasks,
        excerpt: build_excerpt(body, 360),
        modified_at,
    }
}

fn parse_frontmatter(content: &str) -> (Map<String, Value>, &str) {
    let normalized = content.strip_prefix('\u{feff}').unwrap_or(content);
    if !normalized.starts_with("---\n") && !normalized.starts_with("---\r\n") {
        return (Map::new(), normalized);
    }

    let mut frontmatter_lines = Vec::new();
    let mut body_start = 0;
    let mut offset = 0;

    for (index, line) in normalized.split_inclusive('\n').enumerate() {
        offset += line.len();
        if index == 0 {
            continue;
        }
        if line.trim() == "---" {
            body_start = offset;
            break;
        }
        frontmatter_lines.push(line.trim_end_matches(&['\r', '\n'][..]));
    }

    if body_start == 0 {
        return (Map::new(), normalized);
    }

    (
        parse_simple_yaml(&frontmatter_lines),
        &normalized[body_start..],
    )
}

fn parse_simple_yaml(lines: &[&str]) -> Map<String, Value> {
    let mut map = Map::new();
    let mut current_list_key: Option<String> = None;

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(key) = &current_list_key {
                let value = parse_scalar(item);
                if let Some(Value::Array(items)) = map.get_mut(key) {
                    items.push(value);
                }
            }
            continue;
        }

        if let Some((key, raw_value)) = trimmed.split_once(':') {
            let key = key.trim().to_string();
            let raw_value = raw_value.trim();
            if raw_value.is_empty() {
                map.insert(key.clone(), Value::Array(Vec::new()));
                current_list_key = Some(key);
            } else {
                map.insert(key, parse_scalar_or_array(raw_value));
                current_list_key = None;
            }
        }
    }

    map
}

fn parse_scalar_or_array(raw: &str) -> Value {
    let unquoted = trim_quotes(raw.trim());
    if unquoted.starts_with('[') && unquoted.ends_with(']') {
        let inner = &unquoted[1..unquoted.len().saturating_sub(1)];
        return Value::Array(
            inner
                .split(',')
                .map(|item| parse_scalar(item.trim()))
                .filter(|value| !value.as_str().map(str::is_empty).unwrap_or(false))
                .collect(),
        );
    }
    parse_scalar(unquoted)
}

fn parse_scalar(raw: &str) -> Value {
    let value = trim_quotes(raw.trim());
    match value {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        _ => value
            .parse::<i64>()
            .map(|number| Value::Number(number.into()))
            .unwrap_or_else(|_| Value::String(value.to_string())),
    }
}

fn trim_quotes(value: &str) -> &str {
    value.trim().trim_matches('"').trim_matches('\'').trim()
}

fn collect_frontmatter_tags(frontmatter: &Map<String, Value>) -> Vec<String> {
    ["tags", "tag"]
        .iter()
        .filter_map(|key| frontmatter.get(*key))
        .flat_map(value_to_strings)
        .map(|tag| clean_tag(&tag))
        .filter(|tag| !tag.is_empty())
        .collect()
}

fn value_to_strings(value: &Value) -> Vec<String> {
    match value {
        Value::String(raw) => raw
            .split(&[',', ' '][..])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

fn collect_inline_tags(content: &str) -> Vec<String> {
    content
        .split_whitespace()
        .filter_map(|word| word.strip_prefix('#'))
        .map(clean_tag)
        .filter(|tag| !tag.is_empty())
        .collect()
}

fn clean_tag(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('#')
        .trim_matches(|c: char| {
            matches!(
                c,
                ',' | '.' | ';' | ':' | ')' | '(' | '[' | ']' | '{' | '}' | '"' | '\''
            )
        })
        .to_lowercase()
}

fn collect_wiki_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut rest = content;

    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        if let Some(end) = rest.find("]]") {
            let mut link = rest[..end].trim();
            if let Some((target, _alias)) = link.split_once('|') {
                link = target.trim();
            }
            if let Some((target, _heading)) = link.split_once('#') {
                link = target.trim();
            }
            if !link.is_empty() {
                links.push(link.to_string());
            }
            rest = &rest[end + 2..];
        } else {
            break;
        }
    }

    links.sort();
    links.dedup();
    links
}

fn collect_tasks(content: &str) -> Vec<ObsidianTask> {
    content
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let trimmed = line.trim_start();
            let (completed, text) = if let Some(text) = trimmed
                .strip_prefix("- [ ] ")
                .or_else(|| trimmed.strip_prefix("* [ ] "))
            {
                (false, text)
            } else if let Some(text) = trimmed
                .strip_prefix("- [x] ")
                .or_else(|| trimmed.strip_prefix("- [X] "))
                .or_else(|| trimmed.strip_prefix("* [x] "))
                .or_else(|| trimmed.strip_prefix("* [X] "))
            {
                (true, text)
            } else {
                return None;
            };
            Some(ObsidianTask {
                text: text.trim().to_string(),
                completed,
                line: index + 1,
            })
        })
        .collect()
}

fn classify_note(relative_path: &str, tags: &[String], frontmatter: &Map<String, Value>) -> String {
    let explicit_type = ["type", "kind", "category"]
        .iter()
        .find_map(|key| frontmatter.get(*key).and_then(Value::as_str))
        .map(|value| value.to_lowercase());

    let path = relative_path.to_lowercase();
    let candidates = [
        "preference",
        "memory",
        "rule",
        "skill",
        "daily",
        "project_context",
    ];

    for candidate in candidates {
        if explicit_type.as_deref() == Some(candidate)
            || tags
                .iter()
                .any(|tag| tag == candidate || tag.ends_with(&format!("/{}", candidate)))
            || path.contains(candidate)
        {
            return candidate.to_string();
        }
    }

    if looks_like_daily_note(&path) {
        "daily".to_string()
    } else if path.contains("project") || tags.iter().any(|tag| tag == "project") {
        "project_context".to_string()
    } else {
        "note".to_string()
    }
}

fn looks_like_daily_note(path: &str) -> bool {
    let filename = path.rsplit('/').next().unwrap_or(path);
    let bytes = filename.as_bytes();
    bytes.len() >= 10
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
}

fn classify_temperature(
    tags: &[String],
    frontmatter: &Map<String, Value>,
    note_type: &str,
) -> String {
    let explicit = ["temperature", "memory_temperature", "memory"]
        .iter()
        .find_map(|key| frontmatter.get(*key).and_then(Value::as_str))
        .map(|value| value.to_lowercase());

    if explicit.as_deref() == Some("hot")
        || tags.iter().any(|tag| tag == "hot" || tag == "memory/hot")
    {
        "hot".to_string()
    } else if explicit.as_deref() == Some("cold")
        || tags
            .iter()
            .any(|tag| tag == "cold" || tag == "memory/cold" || tag == "archive")
    {
        "cold".to_string()
    } else if matches!(
        note_type,
        "preference" | "memory" | "daily" | "project_context"
    ) {
        "hot".to_string()
    } else {
        "cold".to_string()
    }
}

fn build_excerpt(content: &str, limit: usize) -> String {
    let mut excerpt = String::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with("```")
            || trimmed.starts_with("---")
        {
            continue;
        }

        if !excerpt.is_empty() {
            excerpt.push(' ');
        }
        excerpt.push_str(trimmed);
        if excerpt.len() >= limit {
            break;
        }
    }

    if excerpt.len() > limit {
        excerpt.truncate(limit);
        excerpt.push_str("...");
    }
    excerpt
}
