use crate::skill_index::{
    chinese_skill_presentation, discover_skill_sources, is_personal_skill_path, SkillSource,
    SkillUsageEvidence,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashSet, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_OBSIDIAN_NOTES: usize = 2000;
const MAX_AGENT_ASSETS: usize = 8000;
const MAX_AGENT_RULE_FILES: usize = 2000;
const MAX_AGENT_RULE_DEPTH: usize = 4;
const MAX_MARKDOWN_BYTES: u64 = 512 * 1024;
const MAX_ASSET_BYTES: u64 = 384 * 1024;
const AGENT_RULE_SCAN_PATHS: [(&str, &str, &str); 3] = [
    ("claude-code", "CLAUDE.md", "CLAUDE.md"),
    ("cursor", ".cursorrules", ".cursorrules"),
    ("codex", "AGENTS.md", "AGENTS.md"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preference {
    pub id: String,
    pub category: String,
    pub content: String,
    pub source: String,
    pub priority: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRule {
    pub id: String,
    pub agent_id: String,
    pub rule_type: String,
    pub file_path: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryItem {
    pub id: String,
    pub agent_id: String,
    pub content: String,
    pub temperature: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub usage_evidence: Vec<SkillUsageEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ownership: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name_zh: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_zh: Option<String>,
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
    vault_dir: PathBuf,
}

fn read_private_text(path: &Path) -> Option<String> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() {
        log::warn!(
            "Refusing to read symbolic-link HUMHUM private data: {}",
            path.display()
        );
        return None;
    }
    if !metadata.is_file() {
        return None;
    }
    if let Err(error) = crate::local_api_auth::protect_owner_only(path) {
        log::warn!(
            "Failed to protect HUMHUM private data before reading {}: {error}",
            path.display()
        );
    }
    std::fs::read_to_string(path).ok()
}

fn file_modified_at(path: &Path) -> Option<String> {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|modified_at| modified_at.to_rfc3339())
}

impl KnowledgeStore {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let base = home.join(".humhum");
        Self::with_paths(base.join("knowledge.json"), base.join("vault"))
    }

    /// Construct a store rooted at explicit paths. Used by `new()` and tests.
    fn with_paths(file_path: PathBuf, vault_dir: PathBuf) -> Self {
        let data = Self::load_from_file(&file_path);
        let mut store = Self {
            data,
            file_path,
            vault_dir,
        };
        store.migrate_json_to_vault();
        store.load_vault();
        store
    }

    fn load_from_file(path: &PathBuf) -> KnowledgeData {
        match read_private_text(path) {
            Some(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            None => KnowledgeData::default(),
        }
    }

    fn preferences_dir(&self) -> PathBuf {
        self.vault_dir.join("preferences")
    }

    fn memory_dir(&self) -> PathBuf {
        self.vault_dir.join("memory")
    }

    /// One-time, idempotent migration: if the vault has never been created but
    /// knowledge.json already carries preferences/memory, materialize them as
    /// Markdown files. Skips entirely once the vault directory exists, so it
    /// never clobbers user edits made through Obsidian.
    fn migrate_json_to_vault(&mut self) {
        if self.vault_dir.exists() {
            return;
        }
        for pref in self.data.preferences.clone() {
            self.write_preference_file(&pref);
        }
        for item in self.data.memory_items.clone() {
            self.write_memory_file(&item);
        }
    }

    /// Load preferences and memory from the Markdown vault, making the vault
    /// authoritative once it exists. Legacy JSON is migrated before this call;
    /// keeping JSON-only records here would resurrect files the user deleted.
    fn load_vault(&mut self) {
        self.data.preferences = self.read_preferences_from_vault();
        self.data.memory_items = self.read_memory_from_vault();
    }

    fn read_preferences_from_vault(&self) -> Vec<Preference> {
        let dir = self.preferences_dir();
        let files = collect_markdown_files(&dir, MAX_OBSIDIAN_NOTES).unwrap_or_default();
        let mut prefs = Vec::new();
        for path in files {
            if let Some(content) = read_private_text(&path) {
                if let Some(pref) = preference_from_markdown(&path, &content) {
                    prefs.push(pref);
                }
            }
        }
        prefs.sort_by(|a, b| a.id.cmp(&b.id));
        prefs
    }

    fn read_memory_from_vault(&self) -> Vec<MemoryItem> {
        let dir = self.memory_dir();
        let files = collect_markdown_files(&dir, MAX_OBSIDIAN_NOTES).unwrap_or_default();
        let mut items = Vec::new();
        for path in files {
            if let Some(content) = read_private_text(&path) {
                if let Some(item) = memory_from_markdown(&path, &content) {
                    items.push(item);
                }
            }
        }
        items.sort_by(|a, b| a.id.cmp(&b.id));
        items
    }

    fn write_preference_file(&self, pref: &Preference) {
        let mut frontmatter = Map::new();
        frontmatter.insert("id".into(), Value::String(pref.id.clone()));
        frontmatter.insert("type".into(), Value::String("preference".into()));
        frontmatter.insert("category".into(), Value::String(pref.category.clone()));
        frontmatter.insert("source".into(), Value::String(pref.source.clone()));
        frontmatter.insert("priority".into(), Value::Number(pref.priority.into()));
        let contents = serialize_note(&frontmatter, &pref.content);
        let path = self
            .preferences_dir()
            .join(format!("{}.md", slugify(&pref.id)));
        if let Err(error) =
            crate::local_api_auth::write_private_file_atomically(&path, contents.as_bytes())
        {
            log::warn!("Failed to write private HUMHUM preference: {error}");
        }
    }

    fn write_memory_file(&self, item: &MemoryItem) {
        let mut frontmatter = Map::new();
        frontmatter.insert("id".into(), Value::String(item.id.clone()));
        frontmatter.insert("type".into(), Value::String("memory".into()));
        frontmatter.insert("agent_id".into(), Value::String(item.agent_id.clone()));
        frontmatter.insert(
            "temperature".into(),
            Value::String(item.temperature.clone()),
        );
        let contents = serialize_note(&frontmatter, &item.content);
        let path = self.memory_dir().join(format!("{}.md", slugify(&item.id)));
        if let Err(error) =
            crate::local_api_auth::write_private_file_atomically(&path, contents.as_bytes())
        {
            log::warn!("Failed to write private HUMHUM memory: {error}");
        }
    }

    fn save(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&self.data) {
            if let Err(error) = crate::local_api_auth::write_private_file_atomically(
                &self.file_path,
                json.as_bytes(),
            ) {
                log::warn!("Failed to write private HUMHUM knowledge store: {error}");
            }
        }
    }

    pub fn get_all(&self) -> &KnowledgeData {
        &self.data
    }

    pub fn save_preference(&mut self, mut pref: Preference) {
        pref.modified_at = Some(chrono::Utc::now().to_rfc3339());
        self.write_preference_file(&pref);
        if let Some(existing) = self.data.preferences.iter_mut().find(|p| p.id == pref.id) {
            *existing = pref;
        } else {
            self.data.preferences.push(pref);
        }
        self.save();
    }

    pub fn save_memory(&mut self, mut item: MemoryItem) {
        item.modified_at = Some(chrono::Utc::now().to_rfc3339());
        self.write_memory_file(&item);
        if let Some(existing) = self.data.memory_items.iter_mut().find(|m| m.id == item.id) {
            *existing = item;
        } else {
            self.data.memory_items.push(item);
        }
        self.save();
    }

    pub fn delete_preference(&mut self, id: &str) -> bool {
        let before = self.data.preferences.len();
        self.data.preferences.retain(|p| p.id != id);
        let removed = self.data.preferences.len() < before;
        if removed {
            let path = self.preferences_dir().join(format!("{}.md", slugify(id)));
            let _ = std::fs::remove_file(path);
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
                            .display_name_zh
                            .as_deref()
                            .unwrap_or_default()
                            .to_lowercase()
                            .contains(&kw)
                        || asset
                            .summary_zh
                            .as_deref()
                            .unwrap_or_default()
                            .to_lowercase()
                            .contains(&kw)
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
        let search_dirs = agent_rule_search_dirs(&home, dirs::desktop_dir(), dirs::document_dir());
        self.scan_agent_rules_in(&search_dirs)
    }

    fn scan_agent_rules_in(&mut self, search_dirs: &[PathBuf]) -> Vec<AgentRule> {
        let mut found = Vec::new();
        let mut scanned_roots = Vec::new();

        for dir in search_dirs {
            if std::fs::read_dir(dir).is_err() {
                continue;
            }
            scanned_roots.push(dir.clone());

            for rule_file in collect_agent_rule_files(dir, agent_rule_scan_depth(dir, search_dirs))
            {
                let Some((agent_id, _, rule_type)) =
                    AGENT_RULE_SCAN_PATHS.iter().find(|(_, filename, _)| {
                        rule_file.file_name().is_some_and(|name| name == *filename)
                    })
                else {
                    continue;
                };
                if let Ok(content) = std::fs::read_to_string(&rule_file) {
                    let id = format!("{}:{}", agent_id, rule_file.to_string_lossy());
                    if !found.iter().any(|rule: &AgentRule| rule.id == id) {
                        found.push(AgentRule {
                            id,
                            agent_id: agent_id.to_string(),
                            rule_type: rule_type.to_string(),
                            file_path: rule_file.to_string_lossy().to_string(),
                            content: truncate_content(&content, 2000),
                            modified_at: file_modified_at(&rule_file),
                        });
                    }
                }
            }
        }

        let mut changed = Vec::new();
        let mut reconciled = Vec::with_capacity(self.data.agent_rules.len() + found.len());

        for existing in std::mem::take(&mut self.data.agent_rules) {
            // A refresh only owns legacy scan-shaped rules beneath roots it could read.
            if is_scanned_agent_rule_in_roots(&existing, &scanned_roots) {
                if let Some(current) = found.iter().find(|rule| rule.id == existing.id) {
                    if current != &existing {
                        changed.push(current.clone());
                    }
                    reconciled.push(current.clone());
                    continue;
                }

                if matches!(Path::new(&existing.file_path).try_exists(), Ok(false)) {
                    changed.push(existing);
                    continue;
                }
            }

            reconciled.push(existing);
        }

        for rule in found {
            if !reconciled.iter().any(|existing| existing.id == rule.id) {
                changed.push(rule.clone());
                reconciled.push(rule);
            }
        }

        self.data.agent_rules = reconciled;
        if !changed.is_empty() {
            self.save();
        }
        changed
    }

    pub fn scan_agent_assets(
        &mut self,
        roots: Option<Vec<String>>,
    ) -> Result<Vec<AgentAsset>, String> {
        let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
        self.scan_agent_assets_with_home(roots, &home)
    }

    fn scan_agent_assets_with_home(
        &mut self,
        roots: Option<Vec<String>>,
        home: &Path,
    ) -> Result<Vec<AgentAsset>, String> {
        let roots = resolve_agent_asset_roots_with_home(roots, home);
        let skill_sources = discover_skill_sources(home);
        let mut scan_roots = roots
            .into_iter()
            .map(|path| (path, None))
            .collect::<Vec<(PathBuf, Option<SkillSource>)>>();

        for source in &skill_sources {
            if !scan_roots.iter().any(|(path, _)| path == &source.root) {
                scan_roots.push((source.root.clone(), Some(source.clone())));
            }
        }

        let mut assets = Vec::new();

        for (root, root_skill_source) in scan_roots {
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
                let mut asset = parse_agent_asset(&root, &path, &content);
                if root_skill_source.is_some() && asset.asset_type != "skill" {
                    continue;
                }
                if asset.asset_type == "skill" {
                    if !is_personal_skill_path(&path) {
                        continue;
                    }
                    let matched_source = skill_sources
                        .iter()
                        .filter(|source| path.starts_with(&source.root))
                        .max_by_key(|source| source.root.components().count())
                        .or(root_skill_source.as_ref());
                    if matched_source.is_some_and(|source| {
                        source
                            .excluded_prefixes
                            .iter()
                            .any(|prefix| path.starts_with(prefix))
                    }) || is_unapproved_skill_cache(&path, matched_source)
                    {
                        continue;
                    }

                    let description = skill_description(&content);
                    let (display_name_zh, summary_zh) =
                        chinese_skill_presentation(&asset.name, &description);
                    asset.ownership = Some(
                        matched_source
                            .map(|source| source.ownership.clone())
                            .unwrap_or_else(|| "created".to_string()),
                    );
                    asset.display_name_zh = display_name_zh;
                    asset.summary_zh = Some(summary_zh);
                    if let Some(source) = matched_source {
                        asset.source = source.source.clone();
                        asset.last_used_at = source.last_used_at.clone();
                        asset.usage_evidence = source.usage_evidence.clone();
                        if let Some(plugin) = &source.plugin {
                            asset.tags.push(format!("plugin:{}", plugin));
                            asset.tags.sort();
                            asset.tags.dedup();
                        }
                    }
                }
                assets.push(asset);
            }
        }

        assets.sort_by(|a, b| {
            a.asset_type
                .cmp(&b.asset_type)
                .then(a.agent_id.cmp(&b.agent_id))
                .then(a.relative_path.cmp(&b.relative_path))
        });
        let mut seen_ids = HashSet::new();
        assets.retain(|asset| seen_ids.insert(asset.id.clone()));

        self.backup_before_asset_replace()?;
        self.data.agent_assets = assets.clone();
        self.save();
        Ok(assets)
    }

    fn backup_before_asset_replace(&self) -> Result<(), String> {
        if !self.file_path.exists() {
            return Ok(());
        }
        let contents = read_private_text(&self.file_path)
            .ok_or_else(|| "Failed to read existing knowledge index for backup".to_string())?;
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ");
        let backup = self
            .file_path
            .with_file_name(format!("knowledge.json.{}.bak", timestamp));
        crate::local_api_auth::write_private_file_atomically(&backup, contents.as_bytes())
            .map_err(|error| format!("Failed to back up knowledge index: {}", error))
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

pub(crate) fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::rename(source, destination)
    }

    #[cfg(target_os = "windows")]
    {
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr::{null, null_mut};

        const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
        const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

        #[link(name = "kernel32")]
        extern "system" {
            fn ReplaceFileW(
                replaced_file_name: *const u16,
                replacement_file_name: *const u16,
                backup_file_name: *const u16,
                replace_flags: u32,
                exclude: *mut std::ffi::c_void,
                reserved: *mut std::ffi::c_void,
            ) -> i32;
            fn MoveFileExW(
                existing_file_name: *const u16,
                new_file_name: *const u16,
                flags: u32,
            ) -> i32;
        }

        let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(once(0)).collect();
        let destination_wide: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(once(0))
            .collect();

        // ReplaceFileW provides true replacement semantics when the destination exists.
        // MoveFileExW also handles a destination that disappeared (or did not exist yet)
        // without introducing a delete-then-rename data-loss window.
        unsafe {
            if destination.exists()
                && ReplaceFileW(
                    destination_wide.as_ptr(),
                    source_wide.as_ptr(),
                    null(),
                    0,
                    null_mut(),
                    null_mut(),
                ) != 0
            {
                return Ok(());
            }

            if MoveFileExW(
                source_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            ) != 0
            {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        }
    }
}

/// Persist a complete file without exposing readers to a partially-written
/// destination. The temporary file lives beside the destination so Windows'
/// ReplaceFileW/MoveFileExW replacement remains on the same volume.
pub(crate) fn write_file_atomically(destination: &Path, contents: &[u8]) -> std::io::Result<()> {
    write_file_atomically_with(destination, contents, |_| Ok(()))
}

/// Variant used by private stores that must finish applying permissions to the
/// temporary file before its contents become visible at the destination.
pub(crate) fn write_file_atomically_with(
    destination: &Path,
    contents: &[u8],
    before_replace: impl FnOnce(&Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut temporary_name = destination.as_os_str().to_os_string();
    temporary_name.push(format!(".{}.tmp", uuid::Uuid::new_v4().simple()));
    let temporary = PathBuf::from(temporary_name);

    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        // Private callers apply the destination ACL while this file is still
        // empty, before any token, message, or key bytes can become visible.
        before_replace(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        #[cfg(unix)]
        if let Ok(metadata) = destination.metadata() {
            file.set_permissions(metadata.permissions())?;
        }
        drop(file);
        replace_file_atomically(&temporary, destination)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn agent_rule_search_dirs(
    home: &Path,
    desktop_dir: Option<PathBuf>,
    document_dir: Option<PathBuf>,
) -> Vec<PathBuf> {
    let candidates = [
        desktop_dir.unwrap_or_else(|| home.join("Desktop")),
        document_dir.unwrap_or_else(|| home.join("Documents")),
        home.join("Projects"),
        home.to_path_buf(),
    ];

    let mut search_dirs = Vec::new();
    for path in candidates {
        if !search_dirs.iter().any(|existing| existing == &path) {
            search_dirs.push(path);
        }
    }
    search_dirs
}

fn is_scanned_agent_rule_in_roots(rule: &AgentRule, scanned_roots: &[PathBuf]) -> bool {
    let path = Path::new(&rule.file_path);
    let Some((agent_id, _, rule_type)) = AGENT_RULE_SCAN_PATHS
        .iter()
        .find(|(_, filename, _)| path.file_name().is_some_and(|name| name == *filename))
    else {
        return false;
    };

    if rule.agent_id != *agent_id
        || rule.rule_type != *rule_type
        || rule.id != format!("{}:{}", agent_id, rule.file_path)
    {
        return false;
    }

    scanned_roots.iter().any(|root| path.starts_with(root))
}

fn agent_rule_scan_depth(root: &Path, search_dirs: &[PathBuf]) -> usize {
    if search_dirs
        .iter()
        .any(|candidate| candidate != root && candidate.starts_with(root))
    {
        1
    } else {
        MAX_AGENT_RULE_DEPTH
    }
}

fn collect_agent_rule_files(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);

    while let Some((dir, depth)) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if depth < max_depth && !name.starts_with('.') && !should_skip_agent_rule_dir(&name)
                {
                    queue.push_back((path, depth + 1));
                }
                continue;
            }

            if AGENT_RULE_SCAN_PATHS
                .iter()
                .any(|(_, filename, _)| path.file_name().is_some_and(|name| name == *filename))
            {
                files.push(path);
                if files.len() >= MAX_AGENT_RULE_FILES {
                    return files;
                }
            }
        }
    }

    files
}

fn should_skip_agent_rule_dir(name: &str) -> bool {
    should_skip_dir(name)
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "applications" | "library" | "movies" | "music" | "pictures" | "public"
        )
}

fn resolve_agent_asset_roots_with_home(roots: Option<Vec<String>>, home: &Path) -> Vec<PathBuf> {
    let raw_roots = roots.unwrap_or_else(default_agent_asset_root_strings);

    let mut paths = Vec::new();
    for raw in raw_roots {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = expand_home(trimmed, home);
        if !paths.iter().any(|existing| existing == &path) {
            paths.push(path);
        }
    }
    paths
}

fn default_agent_asset_root_strings() -> Vec<String> {
    vec![
        "~/.qoder".to_string(),
        "~/.qoderwork".to_string(),
        "~/.gemini".to_string(),
        "~/.qwen".to_string(),
        "~/.kimi".to_string(),
        "~/.pi".to_string(),
    ]
}

fn expand_home(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        home.to_path_buf()
    } else if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
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

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn agent_asset_file_priority(path: &Path) -> u8 {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    let lower = normalized_path(path);

    if filename == "skill.md" {
        0
    } else if matches!(filename.as_str(), "agent.md" | "agents.md")
        || lower.contains("/agents/")
        || lower.contains("/agent/")
    {
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
    let lower = normalized_path(path);
    [
        ".codex", ".claude", ".agents", ".qoder", ".pi", "agent", "agents", "skill", "skills",
        "soul", "memory", "memories", "rules", "hooks",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_trusted_agent_asset_root(path: &Path) -> bool {
    let lower = normalized_path(path);
    [".codex", ".claude", ".agents", ".qoder", ".pi"]
        .iter()
        .any(|needle| lower.ends_with(needle) || lower.contains(&format!("{}/", needle)))
}

fn is_agent_asset_file(path: &Path) -> bool {
    let lower = normalized_path(path);
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(
        filename.as_str(),
        "agent.md"
            | "agents.md"
            | "claude.md"
            | "skill.md"
            | "memory.md"
            | "memories.md"
            | "soul.md"
            | "rules.md"
            | ".cursorrules"
            | "preference.md"
            | "preferences.md"
            | "user.md"
    ) {
        return true;
    }

    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        && [
            "/agent/",
            "/agents/",
            "/memory/",
            "/memories/",
            "/preference/",
            "/preferences/",
            "/rules/",
            "/soul/",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn parse_agent_asset(root: &Path, path: &Path, content: &str) -> AgentAsset {
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let lower = normalized_path(path);
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
        last_used_at: None,
        usage_evidence: Vec::new(),
        ownership: None,
        display_name_zh: None,
        summary_zh: None,
    }
}

fn is_unapproved_skill_cache(path: &Path, source: Option<&SkillSource>) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let is_cache = normalized.contains("/.codex/plugins/cache/")
        || normalized.contains("/.codex/vendor_imports/skills/");
    is_cache
        && !matches!(
            source.map(|item| item.ownership.as_str()),
            Some("installed" | "used")
        )
}

fn skill_description(content: &str) -> String {
    let (frontmatter, body) = parse_frontmatter(content);
    frontmatter
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            body.lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with('#'))
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn classify_asset_type(lower_path: &str, filename: &str) -> String {
    let filename = filename.to_lowercase();
    let is_config = filename.ends_with(".yaml")
        || filename.ends_with(".yml")
        || filename.ends_with(".json")
        || filename.ends_with(".toml");
    if filename == "skill.md" {
        "skill".to_string()
    } else if filename == "agents.md" || filename == "agent.md" {
        "agent".to_string()
    } else if filename == "preference.md"
        || filename == "preferences.md"
        || filename == "user.md"
        || filename.starts_with("feedback_")
        || filename.starts_with("feedback-")
        || lower_path.contains("/preference/")
        || lower_path.contains("/preferences/")
    {
        "preference".to_string()
    } else if lower_path.contains("soul") {
        "soul".to_string()
    } else if lower_path.contains("memory") || lower_path.contains("memories") {
        "memory".to_string()
    } else if is_config {
        "config".to_string()
    } else if matches!(filename.as_str(), "agent.md" | "agents.md")
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
        let mut truncated = crate::user_safe_text::utf8_prefix(content, limit).to_string();
        truncated.push_str("\n...(truncated)");
        truncated
    }
}

fn normalize_vault_path(path: &str) -> Result<String, String> {
    let expanded = if path == "~" {
        dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?
    } else if let Some(stripped) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
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
        .replace('\\', "/");
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

    let path = relative_path.replace('\\', "/").to_lowercase();
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

/// Turn an id into a filesystem-safe filename stem. Keeps ASCII alphanumerics,
/// `-` and `_`; everything else becomes `-`. Empty results fall back to "note".
fn slugify(id: &str) -> String {
    let mut slug = String::with_capacity(id.len());
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            slug.push(ch);
        } else {
            slug.push('-');
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "note".to_string()
    } else {
        trimmed
    }
}

/// Serialize a frontmatter map + body into a Markdown note whose frontmatter is
/// round-trip compatible with `parse_simple_yaml`. Scalars render as
/// `key: value`; arrays render as an empty key followed by `- item` lines.
fn serialize_note(frontmatter: &Map<String, Value>, body: &str) -> String {
    let mut out = String::from("---\n");
    for (key, value) in frontmatter {
        match value {
            Value::Array(items) => {
                out.push_str(key);
                out.push_str(":\n");
                for item in items {
                    out.push_str("- ");
                    out.push_str(&scalar_to_yaml(item));
                    out.push('\n');
                }
            }
            _ => {
                out.push_str(key);
                out.push_str(": ");
                out.push_str(&scalar_to_yaml(value));
                out.push('\n');
            }
        }
    }
    out.push_str("---\n");
    out.push_str(body);
    if !body.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn scalar_to_yaml(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Rebuild a `Preference` from a vault Markdown file. The frontmatter `id`
/// wins; the filename stem is a fallback. Returns None only if no id can be
/// determined.
fn preference_from_markdown(path: &Path, content: &str) -> Option<Preference> {
    let (frontmatter, body) = parse_frontmatter(content);
    let id = frontmatter_string(&frontmatter, "id")
        .or_else(|| file_stem(path))
        .filter(|id| !id.is_empty())?;
    Some(Preference {
        id,
        category: frontmatter_string(&frontmatter, "category").unwrap_or_default(),
        content: body.trim().to_string(),
        source: frontmatter_string(&frontmatter, "source").unwrap_or_default(),
        priority: frontmatter_u8(&frontmatter, "priority"),
        modified_at: file_modified_at(path),
    })
}

/// Rebuild a `MemoryItem` from a vault Markdown file.
fn memory_from_markdown(path: &Path, content: &str) -> Option<MemoryItem> {
    let (frontmatter, body) = parse_frontmatter(content);
    let id = frontmatter_string(&frontmatter, "id")
        .or_else(|| file_stem(path))
        .filter(|id| !id.is_empty())?;
    let note_type = frontmatter_string(&frontmatter, "type").unwrap_or_else(|| "memory".into());
    let tags = collect_frontmatter_tags(&frontmatter);
    let temperature = frontmatter_string(&frontmatter, "temperature")
        .unwrap_or_else(|| classify_temperature(&tags, &frontmatter, &note_type));
    Some(MemoryItem {
        id,
        agent_id: frontmatter_string(&frontmatter, "agent_id").unwrap_or_default(),
        content: body.trim().to_string(),
        temperature,
        modified_at: file_modified_at(path),
    })
}

fn frontmatter_string(frontmatter: &Map<String, Value>, key: &str) -> Option<String> {
    frontmatter.get(key).and_then(|value| match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

fn frontmatter_u8(frontmatter: &Map<String, Value>, key: &str) -> u8 {
    frontmatter
        .get(key)
        .and_then(|value| match value {
            Value::Number(n) => n.as_u64(),
            Value::String(s) => s.trim().parse::<u64>().ok(),
            _ => None,
        })
        .map(|n| n.min(u8::MAX as u64) as u8)
        .unwrap_or(0)
}

fn file_stem(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let unique = format!(
            "humhum-knowledge-test-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
    }

    fn store_at(root: &Path) -> KnowledgeStore {
        KnowledgeStore::with_paths(root.join("knowledge.json"), root.join("vault"))
    }

    #[test]
    fn serialize_note_round_trips_through_frontmatter_parser() {
        let mut frontmatter = Map::new();
        frontmatter.insert("id".into(), Value::String("pref-1".into()));
        frontmatter.insert("category".into(), Value::String("风格".into()));
        frontmatter.insert("priority".into(), Value::Number(3.into()));
        frontmatter.insert(
            "tags".into(),
            Value::Array(vec![
                Value::String("hot".into()),
                Value::String("style".into()),
            ]),
        );

        let body = "用户偏好简洁、直接的中文表达。";
        let serialized = serialize_note(&frontmatter, body);
        let (parsed, parsed_body) = parse_frontmatter(&serialized);

        assert_eq!(parsed.get("id").and_then(Value::as_str), Some("pref-1"));
        assert_eq!(parsed.get("category").and_then(Value::as_str), Some("风格"));
        assert_eq!(parsed.get("priority").and_then(Value::as_i64), Some(3));
        assert_eq!(
            parsed
                .get("tags")
                .and_then(Value::as_array)
                .map(|a| a.len()),
            Some(2)
        );
        assert_eq!(parsed_body.trim(), body);
    }

    #[test]
    fn agent_asset_without_usage_evidence_deserializes_to_empty_vec() {
        let asset: AgentAsset = serde_json::from_str(
            r#"{
                "id": "asset:legacy",
                "asset_type": "skill",
                "agent_id": "codex",
                "name": "legacy",
                "file_path": "/tmp/legacy/SKILL.md",
                "relative_path": "legacy/SKILL.md",
                "source": "codex",
                "content": "legacy skill",
                "tags": [],
                "modified_at": null
            }"#,
        )
        .unwrap();

        assert!(asset.usage_evidence.is_empty());
    }

    #[test]
    fn save_preference_writes_and_reloads_from_vault() {
        let root = temp_root("save-pref");
        let mut store = store_at(&root);
        store.save_preference(Preference {
            id: "pref-42".into(),
            category: "style".into(),
            content: "简洁优先".into(),
            source: "humi".into(),
            priority: 4,
            modified_at: None,
        });

        let md = root.join("vault").join("preferences").join("pref-42.md");
        assert!(md.exists(), "preference markdown file should exist");
        let persisted: KnowledgeData =
            serde_json::from_str(&std::fs::read_to_string(root.join("knowledge.json")).unwrap())
                .unwrap();
        assert_eq!(persisted.preferences.len(), 1);

        // A fresh store reads the vault as source of truth.
        let reloaded = store_at(&root);
        let prefs = &reloaded.get_all().preferences;
        assert_eq!(prefs.len(), 1);
        assert_eq!(prefs[0].id, "pref-42");
        assert_eq!(prefs[0].content, "简洁优先");
        assert_eq!(prefs[0].priority, 4);
        assert!(prefs[0].modified_at.is_some());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_preference_removes_vault_file() {
        let root = temp_root("delete-pref");
        let mut store = store_at(&root);
        store.save_preference(Preference {
            id: "pref-del".into(),
            category: "style".into(),
            content: "临时".into(),
            source: "humi".into(),
            priority: 1,
            modified_at: None,
        });
        let md = root.join("vault").join("preferences").join("pref-del.md");
        assert!(md.exists());

        assert!(store.delete_preference("pref-del"));
        assert!(!md.exists(), "markdown file should be deleted");
        assert!(store.get_all().preferences.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn save_memory_populates_memory_items() {
        // Regression: memory_items used to have no writer at all.
        let root = temp_root("save-memory");
        let mut store = store_at(&root);
        store.save_memory(MemoryItem {
            id: "mem-1".into(),
            agent_id: "claude-code".into(),
            content: "用户在做本地 Agent 中枢".into(),
            temperature: "hot".into(),
            modified_at: None,
        });

        let md = root.join("vault").join("memory").join("mem-1.md");
        assert!(md.exists());
        let persisted: KnowledgeData =
            serde_json::from_str(&std::fs::read_to_string(root.join("knowledge.json")).unwrap())
                .unwrap();
        assert_eq!(persisted.memory_items.len(), 1);

        let reloaded = store_at(&root);
        assert!(reloaded.get_all().memory_items[0].modified_at.is_some());
        let items = &reloaded.get_all().memory_items;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "mem-1");
        assert_eq!(items[0].agent_id, "claude-code");
        assert_eq!(items[0].temperature, "hot");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrates_legacy_json_preferences_into_vault_idempotently() {
        let root = temp_root("migrate");
        std::fs::create_dir_all(&root).unwrap();
        let legacy = KnowledgeData {
            preferences: vec![Preference {
                id: "legacy-1".into(),
                category: "style".into(),
                content: "旧 JSON 里的偏好".into(),
                source: "import".into(),
                priority: 2,
                modified_at: None,
            }],
            ..Default::default()
        };
        std::fs::write(
            root.join("knowledge.json"),
            serde_json::to_string_pretty(&legacy).unwrap(),
        )
        .unwrap();

        // First construction migrates the preference into the vault.
        let store = store_at(&root);
        let md = root.join("vault").join("preferences").join("legacy-1.md");
        assert!(md.exists(), "legacy preference should be materialized");
        assert_eq!(store.get_all().preferences.len(), 1);

        // User edits the file; a second construction must NOT clobber it.
        let edited = serialize_note(
            &{
                let mut m = Map::new();
                m.insert("id".into(), Value::String("legacy-1".into()));
                m.insert("type".into(), Value::String("preference".into()));
                m.insert("category".into(), Value::String("style".into()));
                m.insert("source".into(), Value::String("import".into()));
                m.insert("priority".into(), Value::Number(2.into()));
                m
            },
            "用户手动编辑过的内容",
        );
        std::fs::write(&md, &edited).unwrap();

        let reopened = store_at(&root);
        assert_eq!(reopened.get_all().preferences.len(), 1);
        assert_eq!(
            reopened.get_all().preferences[0].content,
            "用户手动编辑过的内容",
            "migration must be idempotent and not overwrite user edits"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "humhum-knowledge-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn atomic_replace_overwrites_existing_destination() {
        let root = temp_test_dir("replace-existing");
        let source = root.join("knowledge.tmp");
        let destination = root.join("knowledge.json");
        std::fs::write(&source, "new content").unwrap();
        std::fs::write(&destination, "old content").unwrap();

        replace_file_atomically(&source, &destination).unwrap();

        assert_eq!(
            std::fs::read_to_string(&destination).unwrap(),
            "new content"
        );
        assert!(!source.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_replace_creates_missing_destination() {
        let root = temp_test_dir("replace-missing");
        let source = root.join("knowledge.tmp");
        let destination = root.join("knowledge.json");
        std::fs::write(&source, "new content").unwrap();

        replace_file_atomically(&source, &destination).unwrap();

        assert_eq!(
            std::fs::read_to_string(&destination).unwrap(),
            "new content"
        );
        assert!(!source.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_write_replaces_complete_contents_and_cleans_temporary_file() {
        let root = temp_test_dir("write-complete");
        let destination = root.join("knowledge.json");
        std::fs::write(&destination, "old content").unwrap();

        write_file_atomically(&destination, b"complete new content").unwrap();

        assert_eq!(
            std::fs::read_to_string(&destination).unwrap(),
            "complete new content"
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn agent_rule_search_dirs_use_redirected_folders_and_deduplicate() {
        let home = PathBuf::from("test-home");
        let redirected = home.join("OneDrive").join("Workspace");

        let search_dirs =
            agent_rule_search_dirs(&home, Some(redirected.clone()), Some(redirected.clone()));

        assert_eq!(
            search_dirs,
            vec![redirected, home.join("Projects"), home.clone()]
        );
        assert!(!search_dirs.contains(&home.join("Desktop")));
        assert!(!search_dirs.contains(&home.join("Documents")));
    }

    #[test]
    fn agent_rule_search_dirs_fall_back_to_home_folders() {
        let home = PathBuf::from("test-home");

        assert_eq!(
            agent_rule_search_dirs(&home, None, None),
            vec![
                home.join("Desktop"),
                home.join("Documents"),
                home.join("Projects"),
                home,
            ]
        );
    }

    #[test]
    fn personal_skill_scan_excludes_system_and_marketplace_caches() {
        let root = temp_root("personal-skills");
        let home = root.join("home");
        let created = home.join(".agents/skills/my-helper/SKILL.md");
        let system = home.join(".codex/skills/.system/imagegen/SKILL.md");
        let marketplace =
            home.join(".claude/plugins/marketplaces/official/plugins/noise/skills/noise/SKILL.md");
        let installed = home.join(
            ".codex/plugins/cache/openai-primary-runtime/documents/1.0.0/skills/documents/SKILL.md",
        );
        let used = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        );
        let agent_file = home.join(".claude/agent.md");

        for (path, contents) in [
            (
                &created,
                "---\nname: my-helper\ndescription: 帮我整理个人工作流\n---\n",
            ),
            (&system, "---\nname: imagegen\ndescription: built in\n---\n"),
            (
                &marketplace,
                "---\nname: noise\ndescription: cached only\n---\n",
            ),
            (
                &installed,
                "---\nname: documents\ndescription: Create Word documents\n---\n",
            ),
            (
                &used,
                "---\nname: using-superpowers\ndescription: Apply Superpowers workflows\n---\n",
            ),
            (&agent_file, "# Personal agent instructions\n"),
        ] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }
        let installed_reference = installed.parent().unwrap().join("tasks/create-edit.md");
        std::fs::create_dir_all(installed_reference.parent().unwrap()).unwrap();
        std::fs::write(&installed_reference, "# Supporting reference, not a skill").unwrap();
        let created_reference = created.parent().unwrap().join("examples/usage.md");
        std::fs::create_dir_all(created_reference.parent().unwrap()).unwrap();
        std::fs::write(&created_reference, "# Supporting reference, not a skill").unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(
            home.join(".codex/config.toml"),
            "[plugins.\"documents@openai-primary-runtime\"]\nenabled = true\n",
        )
        .unwrap();
        let session = home.join(".codex/sessions/2026/07/17/session.jsonl");
        std::fs::create_dir_all(session.parent().unwrap()).unwrap();
        std::fs::write(
            &session,
            format!(
                "{{\"timestamp\":\"2026-07-19T09:30:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                used.display()
            ),
        )
        .unwrap();

        let mut store = store_at(&root);
        let assets = store
            .scan_agent_assets_with_home(
                Some(vec![home.join(".claude").to_string_lossy().to_string()]),
                &home,
            )
            .unwrap();
        let skills = assets
            .iter()
            .filter(|asset| asset.asset_type == "skill")
            .collect::<Vec<_>>();

        assert_eq!(skills.len(), 3);
        assert!(skills.iter().any(|asset| {
            asset.name == "my-helper"
                && asset.ownership.as_deref() == Some("created")
                && asset.summary_zh.as_deref() == Some("帮我整理个人工作流")
        }));
        assert!(skills.iter().any(|asset| {
            asset.name == "documents"
                && asset.ownership.as_deref() == Some("installed")
                && asset.display_name_zh.as_deref() == Some("Word 文档处理")
        }));
        assert!(skills.iter().any(|asset| {
            asset.name == "using-superpowers"
                && asset.ownership.as_deref() == Some("used")
                && asset.last_used_at.as_deref() == Some("2026-07-19T09:30:00+00:00")
                && asset.tags.iter().any(|tag| tag == "plugin:superpowers")
        }));
        assert!(assets
            .iter()
            .any(|asset| asset.file_path == agent_file.to_string_lossy()
                && asset.asset_type == "agent"));
        assert!(!skills.iter().any(|asset| {
            asset.file_path.contains("/.system/") || asset.file_path.contains("/marketplaces/")
        }));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn asset_scan_backs_up_existing_knowledge_file() {
        let root = temp_root("asset-backup");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("knowledge.json"),
            r#"{"agent_skills":[{"id":"old"}]}"#,
        )
        .unwrap();

        let mut store = store_at(&root);
        store
            .scan_agent_assets_with_home(Some(Vec::new()), &root.join("home"))
            .unwrap();

        let backups = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("knowledge.json.")
                    && entry.file_name().to_string_lossy().ends_with(".bak")
            })
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            std::fs::read_to_string(&backups[0]).unwrap(),
            r#"{"agent_skills":[{"id":"old"}]}"#
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&backups[0]).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_agent_rules_reconciles_added_modified_and_deleted_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let scan_root = root.join("scan-root");
        let other_scan_root = root.join("other-scan-root");
        let unavailable_scan_root = root.join("unavailable-scan-root");
        let project = scan_root.join("project");
        let other_project = other_scan_root.join("other-project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&other_project).unwrap();

        let rule_path = project.join("AGENTS.md");
        let other_rule_path = other_project.join("CLAUDE.md");
        std::fs::write(&rule_path, "initial rule").unwrap();
        std::fs::write(&other_rule_path, "other root rule").unwrap();

        let rule_id = format!("codex:{}", rule_path.to_string_lossy());
        let other_rule_id = format!("claude-code:{}", other_rule_path.to_string_lossy());
        let unavailable_rule_path = unavailable_scan_root.join("project").join("AGENTS.md");
        let unavailable_rule_id = format!("codex:{}", unavailable_rule_path.to_string_lossy());
        let manual_rule_id = "manual-rule".to_string();

        let mut store = store_at(root);
        store.save_preference(Preference {
            id: "pref-1".into(),
            category: "style".into(),
            content: "keep preference".into(),
            source: "manual".into(),
            priority: 3,
            modified_at: None,
        });
        store.save_memory(MemoryItem {
            id: "memory-1".into(),
            agent_id: "codex".into(),
            content: "keep memory".into(),
            temperature: "warm".into(),
            modified_at: None,
        });
        store.data.agent_rules.push(AgentRule {
            id: manual_rule_id.clone(),
            agent_id: "custom".into(),
            rule_type: "manual".into(),
            file_path: rule_path.to_string_lossy().into_owned(),
            content: "keep manual rule".into(),
            modified_at: None,
        });
        store.data.agent_rules.push(AgentRule {
            id: unavailable_rule_id.clone(),
            agent_id: "codex".into(),
            rule_type: "AGENTS.md".into(),
            file_path: unavailable_rule_path.to_string_lossy().into_owned(),
            content: "keep rule from unavailable root".into(),
            modified_at: None,
        });

        let scan_roots = vec![scan_root, other_scan_root, unavailable_scan_root];
        let added = store.scan_agent_rules_in(&scan_roots);
        let added_content = store
            .get_all()
            .agent_rules
            .iter()
            .find(|rule| rule.id == rule_id)
            .map(|rule| rule.content.clone());

        std::fs::write(&rule_path, "updated rule").unwrap();
        let modified = store.scan_agent_rules_in(&scan_roots);
        let modified_content = store
            .get_all()
            .agent_rules
            .iter()
            .find(|rule| rule.id == rule_id)
            .map(|rule| rule.content.clone());

        std::fs::remove_file(&rule_path).unwrap();
        let deleted = store.scan_agent_rules_in(&scan_roots);
        let deleted_rule_remains = store
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == rule_id);

        assert_eq!(added_content.as_deref(), Some("initial rule"));
        assert_eq!(
            (modified_content.as_deref(), deleted_rule_remains),
            (Some("updated rule"), false)
        );
        assert!(added.iter().any(|rule| rule.id == rule_id));
        assert!(modified.iter().any(|rule| rule.id == rule_id));
        assert!(deleted.iter().any(|rule| rule.id == rule_id));
        assert!(store
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == manual_rule_id));
        assert!(store
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == other_rule_id));
        assert!(store
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == unavailable_rule_id));

        let reloaded = store_at(root);
        assert_eq!(reloaded.get_all().preferences.len(), 1);
        assert_eq!(reloaded.get_all().preferences[0].content, "keep preference");
        assert_eq!(reloaded.get_all().memory_items.len(), 1);
        assert_eq!(reloaded.get_all().memory_items[0].content, "keep memory");
        assert!(reloaded
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == manual_rule_id));
        assert!(reloaded
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == other_rule_id));
        assert!(reloaded
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == unavailable_rule_id));
        assert!(!reloaded
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.id == rule_id));
    }

    #[test]
    fn agents_md_remains_an_agent_inside_a_skills_tree() {
        assert_eq!(
            classify_asset_type(
                "/Users/test/.agents/skills/custom-helper/AGENTS.md",
                "AGENTS.md",
            ),
            "agent",
        );
    }

    #[test]
    fn only_skill_md_is_classified_as_a_skill() {
        assert_eq!(
            classify_asset_type(
                "/Users/test/.agents/skills/custom-helper/SKILL.md",
                "SKILL.md",
            ),
            "skill",
        );
        assert_ne!(
            classify_asset_type(
                "/Users/test/.agents/skills/custom-helper/references/usage.md",
                "usage.md",
            ),
            "skill",
        );
        assert_ne!(
            classify_asset_type(
                "/Users/test/.agents/skills/custom-helper/package.json",
                "package.json",
            ),
            "skill",
        );
    }

    #[test]
    fn asset_collection_rejects_json_session_and_config_files() {
        assert!(!is_agent_asset_file(Path::new(
            "/Users/test/.qoder/projects/session/task.json"
        )));
        assert!(!is_agent_asset_file(Path::new(
            "/Users/test/.agents/skills/custom-helper/package.json"
        )));
        assert!(is_agent_asset_file(Path::new(
            "/Users/test/.agents/skills/custom-helper/SKILL.md"
        )));
        assert!(is_agent_asset_file(Path::new(
            "/Users/test/.qoder/memories/project/decision.md"
        )));
        assert!(is_agent_asset_file(Path::new(
            "/Users/test/.qoderwork/awareness/main/USER.md"
        )));
    }

    #[test]
    fn learned_user_feedback_is_classified_as_preference() {
        assert_eq!(
            classify_asset_type(
                "/Users/test/.claude/projects/project/memory/feedback_chinese_response.md",
                "feedback_chinese_response.md",
            ),
            "preference",
        );
        assert_eq!(
            classify_asset_type("/Users/test/.qoderwork/awareness/main/USER.md", "USER.md",),
            "preference",
        );
    }

    #[test]
    fn scan_agent_rules_finds_rules_in_nested_projects() {
        let temp = tempfile::tempdir().unwrap();
        let scan_root = temp.path().join("Desktop");
        let project = scan_root.join("workspace").join("nested-project");
        std::fs::create_dir_all(&project).unwrap();
        let rule_path = project.join("AGENTS.md");
        std::fs::write(&rule_path, "nested rule").unwrap();

        let mut store = store_at(temp.path());
        store.scan_agent_rules_in(&[scan_root]);

        assert!(store
            .get_all()
            .agent_rules
            .iter()
            .any(|rule| rule.file_path == rule_path.to_string_lossy()));
    }

    #[test]
    fn parent_rule_root_uses_a_shallow_scan_when_child_roots_are_explicit() {
        let home = PathBuf::from("/Users/test");
        let search_dirs = vec![
            home.join("Desktop"),
            home.join("Documents"),
            home.join("Projects"),
            home.clone(),
        ];

        assert_eq!(agent_rule_scan_depth(&home, &search_dirs), 1);
        assert_eq!(
            agent_rule_scan_depth(&home.join("Desktop"), &search_dirs),
            MAX_AGENT_RULE_DEPTH,
        );
    }

    #[test]
    fn deleted_vault_records_do_not_return_from_the_json_snapshot() {
        let root = temp_root("vault-deletion");
        std::fs::create_dir_all(root.join("vault")).unwrap();
        let legacy = KnowledgeData {
            preferences: vec![Preference {
                id: "pref-existing".into(),
                category: "communication".into(),
                content: "请使用中文".into(),
                source: "legacy".into(),
                priority: 4,
                modified_at: None,
            }],
            memory_items: vec![MemoryItem {
                id: "memory-existing".into(),
                agent_id: "codex".into(),
                content: "正在构建 HUMHUM".into(),
                temperature: "hot".into(),
                modified_at: None,
            }],
            ..Default::default()
        };
        std::fs::write(
            root.join("knowledge.json"),
            serde_json::to_string_pretty(&legacy).unwrap(),
        )
        .unwrap();

        let store = store_at(&root);

        assert!(
            store.get_all().preferences.is_empty(),
            "an existing empty vault is authoritative for preferences"
        );
        assert!(
            store.get_all().memory_items.is_empty(),
            "an existing empty vault is authoritative for memories"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
