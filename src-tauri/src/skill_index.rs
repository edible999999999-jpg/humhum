use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

const MAX_RECENT_SESSION_FILES: usize = 80;
const MAX_SESSION_HEADER_BYTES: u64 = 64 * 1024;
const MAX_SESSION_TAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnabledPlugin {
    pub name: String,
    pub marketplace: String,
}

#[derive(Debug, Clone)]
pub struct SkillSource {
    pub root: PathBuf,
    pub source: String,
    pub plugin: Option<String>,
    pub ownership: String,
    pub last_used_at: Option<String>,
    pub usage_evidence: Vec<SkillUsageEvidence>,
    pub excluded_prefixes: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillUsageEvidence {
    pub session_id: String,
    pub agent_id: String,
    pub session_path: String,
    pub workspace: Option<String>,
    pub used_at: Option<String>,
}

pub fn parse_enabled_codex_plugins(config: &str) -> Vec<EnabledPlugin> {
    let mut current = None;
    let mut enabled = Vec::new();

    for line in config.lines().map(str::trim) {
        if let Some(id) = line
            .strip_prefix("[plugins.\"")
            .and_then(|value| value.strip_suffix("\"]"))
        {
            current = id.split_once('@').map(|(name, marketplace)| EnabledPlugin {
                name: name.to_string(),
                marketplace: marketplace.to_string(),
            });
        } else if line == "enabled = true" {
            if let Some(plugin) = current.take() {
                enabled.push(plugin);
            }
        }
    }

    enabled
}

pub fn is_personal_skill_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    !normalized.contains("/.claude/plugins/marketplaces/")
        && !normalized.contains("/.codex/skills/.system/")
        && !normalized.contains("/.qoder/plugins/cache/")
}

pub fn discover_skill_sources_with_roots(
    home: &Path,
    additional_roots: &[PathBuf],
) -> Vec<SkillSource> {
    let mut sources = vec![
        SkillSource {
            root: home.join(".claude/skills"),
            source: "claude".into(),
            plugin: None,
            ownership: "created".into(),
            last_used_at: None,
            usage_evidence: Vec::new(),
            excluded_prefixes: Vec::new(),
        },
        SkillSource {
            root: home.join(".agents/skills"),
            source: "agents".into(),
            plugin: None,
            ownership: "created".into(),
            last_used_at: None,
            usage_evidence: Vec::new(),
            excluded_prefixes: Vec::new(),
        },
        SkillSource {
            root: home.join(".codex/skills"),
            source: "codex".into(),
            plugin: None,
            ownership: "created".into(),
            last_used_at: None,
            usage_evidence: Vec::new(),
            excluded_prefixes: vec![home.join(".codex/skills/.system")],
        },
        SkillSource {
            root: home.join(".qoder/skills"),
            source: "qoder".into(),
            plugin: None,
            ownership: "installed".into(),
            last_used_at: None,
            usage_evidence: Vec::new(),
            excluded_prefixes: Vec::new(),
        },
    ];

    let claude_plugins = home.join(".claude/plugins");
    if let Ok(entries) = std::fs::read_dir(&claude_plugins) {
        for entry in entries.flatten() {
            let root = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if root.is_dir() && name != "marketplaces" {
                sources.push(SkillSource {
                    root,
                    source: "claude-plugin".into(),
                    plugin: Some(name),
                    ownership: "installed".into(),
                    last_used_at: None,
                    usage_evidence: Vec::new(),
                    excluded_prefixes: Vec::new(),
                });
            }
        }
    }

    if let Ok(config) = std::fs::read_to_string(home.join(".codex/config.toml")) {
        for plugin in parse_enabled_codex_plugins(&config) {
            let plugin_root = home
                .join(".codex/plugins/cache")
                .join(&plugin.marketplace)
                .join(&plugin.name);
            if let Some(root) = newest_child_directory(&plugin_root) {
                sources.push(SkillSource {
                    root,
                    source: "codex-plugin".into(),
                    plugin: Some(plugin.name),
                    ownership: "installed".into(),
                    last_used_at: None,
                    usage_evidence: Vec::new(),
                    excluded_prefixes: Vec::new(),
                });
            }
        }
    }

    let session_files = collect_recent_codex_session_files(home);
    sources.extend(discover_session_skill_sources_from_files_with_roots(
        home,
        &session_files,
        additional_roots,
    ));

    sources
}

#[cfg(test)]
pub fn extract_used_skill_paths_from_session(content: &str) -> Vec<PathBuf> {
    extract_used_skills_from_session(content)
        .into_iter()
        .map(|usage| usage.path)
        .collect()
}

#[derive(Debug)]
struct SkillUsage {
    path: PathBuf,
    last_used_at: Option<String>,
}

struct SessionContext {
    session_id: String,
    workspace: Option<String>,
}

fn extract_used_skills_from_session(content: &str) -> Vec<SkillUsage> {
    let mut usages: Vec<SkillUsage> = Vec::new();

    for line in content.lines() {
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if entry.get("type").and_then(serde_json::Value::as_str) != Some("response_item") {
            continue;
        }

        let Some(payload) = entry.get("payload") else {
            continue;
        };
        let tool_input = match payload.get("type").and_then(serde_json::Value::as_str) {
            Some("custom_tool_call") => payload.get("input"),
            Some("function_call") => payload.get("arguments"),
            _ => None,
        };
        let Some(tool_input) = tool_input else {
            continue;
        };

        let paths = if let Some(input) = tool_input.as_str() {
            extract_absolute_skill_paths(input)
        } else {
            extract_absolute_skill_paths(&tool_input.to_string())
        };
        let timestamp = entry
            .get("timestamp")
            .and_then(serde_json::Value::as_str)
            .and_then(normalize_rfc3339_timestamp);
        for path in paths {
            if let Some(existing) = usages.iter_mut().find(|usage| usage.path == path) {
                existing.last_used_at =
                    newest_timestamp(existing.last_used_at.clone(), timestamp.clone());
            } else {
                usages.push(SkillUsage {
                    path,
                    last_used_at: timestamp.clone(),
                });
            }
        }
    }

    usages
}

#[cfg(test)]
pub fn discover_session_skill_sources_from_files(
    home: &Path,
    session_files: &[PathBuf],
) -> Vec<SkillSource> {
    discover_session_skill_sources_from_files_with_roots(home, session_files, &[])
}

fn discover_session_skill_sources_from_files_with_roots(
    home: &Path,
    session_files: &[PathBuf],
    additional_roots: &[PathBuf],
) -> Vec<SkillSource> {
    let mut sources: Vec<SkillSource> = Vec::new();

    for session_file in session_files {
        let Ok(content) = read_session_tail(session_file) else {
            continue;
        };
        let session_context = read_session_header(session_file)
            .map(|header| extract_session_context(&header, session_file))
            .unwrap_or_else(|_| extract_session_context("", session_file));
        let file_modified_at = std::fs::metadata(session_file)
            .and_then(|metadata| metadata.modified())
            .ok()
            .map(chrono::DateTime::<chrono::Utc>::from)
            .map(|timestamp| timestamp.to_rfc3339());
        for usage in extract_used_skills_from_session(&content) {
            let skill_path = usage.path;
            let Ok(canonical_skill_path) = skill_path.canonicalize() else {
                continue;
            };
            if !canonical_skill_path.is_file()
                || !canonical_skill_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case("SKILL.md"))
                || !is_personal_skill_path(&canonical_skill_path)
            {
                continue;
            }
            let Some((source, ownership, plugin)) =
                recognized_skill_source(home, &canonical_skill_path, additional_roots)
            else {
                continue;
            };
            let Some(root) = canonical_skill_path.parent() else {
                continue;
            };
            let last_used_at = usage.last_used_at.or_else(|| file_modified_at.clone());
            let evidence = SkillUsageEvidence {
                session_id: session_context.session_id.clone(),
                agent_id: "codex".to_string(),
                session_path: session_file.to_string_lossy().to_string(),
                workspace: session_context.workspace.clone(),
                used_at: last_used_at.clone(),
            };
            if let Some(existing) = sources.iter_mut().find(|source| source.root == root) {
                existing.last_used_at =
                    newest_timestamp(existing.last_used_at.clone(), last_used_at);
                merge_usage_evidence(&mut existing.usage_evidence, evidence);
                continue;
            }

            sources.push(SkillSource {
                root: root.to_path_buf(),
                source,
                plugin,
                ownership,
                last_used_at,
                usage_evidence: vec![evidence],
                excluded_prefixes: Vec::new(),
            });
        }
    }

    sources.sort_by(|a, b| a.root.cmp(&b.root));
    sources
}

fn recognized_skill_source(
    home: &Path,
    skill_path: &Path,
    additional_roots: &[PathBuf],
) -> Option<(String, String, Option<String>)> {
    let standard_roots = [
        (home.join(".claude/skills"), "claude", "created"),
        (home.join(".agents/skills"), "agents", "created"),
        (home.join(".codex/skills"), "codex", "created"),
        (home.join(".qoder/skills"), "qoder", "installed"),
        (home.join(".codex/plugins/cache"), "codex-session", "used"),
        (home.join(".claude/plugins"), "claude-plugin", "installed"),
    ];
    let mut matches = standard_roots
        .into_iter()
        .filter_map(|(root, source, ownership)| {
            root.canonicalize()
                .ok()
                .filter(|root| skill_path.starts_with(root))
                .map(|root| (root, source.to_string(), ownership.to_string()))
        })
        .collect::<Vec<_>>();
    matches.extend(additional_roots.iter().filter_map(|root| {
        root.canonicalize()
            .ok()
            .filter(|root| skill_path.starts_with(root))
            .map(|root| {
                let source = root.to_string_lossy().to_string();
                (root, source, "created".to_string())
            })
    }));
    let (recognized_root, source, ownership) = matches
        .into_iter()
        .max_by_key(|(root, _, _)| root.components().count())?;
    let plugin = if source == "codex-session" {
        skill_path
            .strip_prefix(recognized_root)
            .ok()
            .and_then(|relative| relative.components().nth(1))
            .and_then(|component| component.as_os_str().to_str())
            .map(str::to_string)
    } else if source == "claude-plugin" {
        skill_path
            .strip_prefix(recognized_root)
            .ok()
            .and_then(|relative| relative.components().next())
            .and_then(|component| component.as_os_str().to_str())
            .map(str::to_string)
    } else {
        None
    };

    Some((source, ownership, plugin))
}

fn extract_session_context(content: &str, session_file: &Path) -> SessionContext {
    let fallback_session_id = session_file
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();

    for line in content.lines() {
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if entry.get("type").and_then(serde_json::Value::as_str) != Some("session_meta") {
            continue;
        }

        let payload = entry.get("payload");
        return SessionContext {
            session_id: payload
                .and_then(|value| value.get("id"))
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or(fallback_session_id),
            workspace: payload
                .and_then(|value| value.get("cwd"))
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        };
    }

    SessionContext {
        session_id: fallback_session_id,
        workspace: None,
    }
}

fn merge_usage_evidence(evidence: &mut Vec<SkillUsageEvidence>, incoming: SkillUsageEvidence) {
    if let Some(existing) = evidence.iter_mut().find(|existing| {
        existing.agent_id == incoming.agent_id && existing.session_id == incoming.session_id
    }) {
        if evidence_is_newer(&incoming, existing) {
            *existing = incoming;
        }
    } else {
        evidence.push(incoming);
    }

    evidence.sort_by(compare_usage_evidence);
}

fn evidence_is_newer(incoming: &SkillUsageEvidence, existing: &SkillUsageEvidence) -> bool {
    match (&incoming.used_at, &existing.used_at) {
        (Some(incoming), Some(existing)) => {
            let incoming = chrono::DateTime::parse_from_rfc3339(incoming).ok();
            let existing = chrono::DateTime::parse_from_rfc3339(existing).ok();
            matches!((incoming, existing), (Some(incoming), Some(existing)) if incoming > existing)
        }
        (Some(_), None) => true,
        _ => false,
    }
}

fn compare_usage_evidence(
    left: &SkillUsageEvidence,
    right: &SkillUsageEvidence,
) -> std::cmp::Ordering {
    let recency = match (&left.used_at, &right.used_at) {
        (Some(left), Some(right)) => match (
            chrono::DateTime::parse_from_rfc3339(left).ok(),
            chrono::DateTime::parse_from_rfc3339(right).ok(),
        ) {
            (Some(left), Some(right)) => right.cmp(&left),
            _ => right.cmp(left),
        },
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    };

    recency
        .then_with(|| left.agent_id.cmp(&right.agent_id))
        .then_with(|| left.session_id.cmp(&right.session_id))
}

fn normalize_rfc3339_timestamp(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&chrono::Utc).to_rfc3339())
}

fn newest_timestamp(left: Option<String>, right: Option<String>) -> Option<String> {
    match (left, right) {
        (Some(left), Some(right)) => {
            let left_time = chrono::DateTime::parse_from_rfc3339(&left).ok();
            let right_time = chrono::DateTime::parse_from_rfc3339(&right).ok();
            match (left_time, right_time) {
                (Some(left_time), Some(right_time)) if right_time > left_time => Some(right),
                (Some(_), _) => Some(left),
                (None, Some(_)) => Some(right),
                (None, None) => None,
            }
        }
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn extract_absolute_skill_paths(input: &str) -> Vec<PathBuf> {
    const SKILL_FILENAME: &str = "SKILL.md";

    let mut paths = Vec::new();
    let mut cursor = 0;
    while let Some(filename_offset) = input[cursor..].find(SKILL_FILENAME) {
        let filename = cursor + filename_offset;
        let end = filename + SKILL_FILENAME.len();
        let start = input[..filename]
            .char_indices()
            .rev()
            .find(|(_, character)| is_path_boundary(*character))
            .map(|(index, character)| index + character.len_utf8())
            .unwrap_or(0);
        let candidate = &input[start..end];
        if candidate.starts_with('/') {
            paths.push(PathBuf::from(candidate));
        }
        cursor = end;
    }
    paths
}

fn is_path_boundary(character: char) -> bool {
    character.is_whitespace()
        || matches!(
            character,
            '\'' | '"'
                | '`'
                | '='
                | '('
                | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | ','
                | ';'
                | '<'
                | '>'
                | '|'
        )
}

fn collect_recent_codex_session_files(home: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in [
        home.join(".codex/sessions"),
        home.join(".codex/archived_sessions"),
    ] {
        collect_jsonl_files(&root, &mut files);
    }
    files.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| std::cmp::Reverse(duration.as_millis()))
    });
    files.truncate(MAX_RECENT_SESSION_FILES);
    files
}

fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn read_session_tail(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(MAX_SESSION_TAIL_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    if start > 0 {
        if let Some(first_newline) = bytes.iter().position(|byte| *byte == b'\n') {
            bytes.drain(..=first_newline);
        }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn read_session_header(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(MAX_SESSION_HEADER_BYTES as usize);
    file.by_ref()
        .take(MAX_SESSION_HEADER_BYTES)
        .read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn newest_child_directory(root: &Path) -> Option<PathBuf> {
    let mut directories = std::fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    directories.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    directories.into_iter().next()
}

pub fn chinese_skill_presentation(name: &str, description: &str) -> (Option<String>, String) {
    let normalized = name.to_lowercase();
    let name_zh = match normalized.as_str() {
        "a1" => Some("a1 研发助手"),
        "documents" => Some("Word 文档处理"),
        "pdf" => Some("PDF 处理"),
        "spreadsheets" => Some("电子表格处理"),
        "excel-live-control" => Some("Excel 实时控制"),
        "presentations" => Some("演示文稿处理"),
        "control-in-app-browser" | "browser" => Some("应用内浏览器控制"),
        "sites-building" => Some("网站构建"),
        "sites-hosting" => Some("网站托管"),
        "visualize" => Some("交互式可视化"),
        "template-creator" => Some("文档模板创建"),
        "code-rubrics-generate" => Some("代码能力评分规则生成"),
        "dogfooding" => Some("Dogfooding 模型配置"),
        "data-agent-skill" => Some("DataWorks 数据助手"),
        "fbi-dev-assistant" => Some("FBI 报表助手"),
        "gexp-ae-logistics-order-query" => Some("AE 物流订单查询"),
        "verify" => Some("项目验证"),
        "agent-browser" => Some("浏览器操作"),
        "docx" => Some("Word 文档处理"),
        "find-skills" => Some("技能查找"),
        "frontend-design" => Some("前端设计"),
        "gexp-data-getdataclient-skill" => Some("数据客户端查询"),
        "notion-infographic" => Some("Notion 信息图制作"),
        "pptx" => Some("演示文稿处理"),
        "remotion-best-practices" => Some("Remotion 视频制作规范"),
        "xlsx" => Some("电子表格处理"),
        "brainstorming" => Some("需求梳理与方案设计"),
        "dispatching-parallel-agents" => Some("并行任务调度"),
        "executing-plans" => Some("执行实施计划"),
        "finishing-a-development-branch" => Some("完成开发分支"),
        "receiving-code-review" => Some("处理代码评审反馈"),
        "requesting-code-review" => Some("请求代码评审"),
        "subagent-driven-development" => Some("子任务驱动开发"),
        "systematic-debugging" => Some("系统化调试"),
        "test-driven-development" => Some("测试驱动开发"),
        "using-git-worktrees" => Some("Git 工作树开发"),
        "using-superpowers" => Some("Superpowers 使用指南"),
        "verification-before-completion" => Some("完成前验证"),
        "writing-plans" => Some("编写实施计划"),
        "writing-skills" => Some("编写 Agent 技能"),
        _ => None,
    }
    .map(str::to_string);

    if contains_cjk(description) {
        return (name_zh, description.trim().to_string());
    }

    let summary = match normalized.as_str() {
        "documents" => "创建、编辑和检查 Word 文档，包括修订、批注与版式验证。",
        "pdf" => "读取、生成和检查 PDF 文件，并验证页面布局与内容。",
        "spreadsheets" => "创建、编辑和分析 Excel、CSV 等电子表格文件。",
        "excel-live-control" => "控制当前打开的 Excel 工作簿，读取或修改实时表格内容。",
        "presentations" => "创建、编辑和检查 PowerPoint 或 Google Slides 演示文稿。",
        "control-in-app-browser" | "browser" => "控制应用内浏览器，用于打开、操作和验证网页。",
        "sites-building" => "构建网站、仪表盘、门户和其他可交互网页。",
        "sites-hosting" => "发布并管理网站托管。",
        "visualize" => "创建图表、模拟器和可交互的数据可视化。",
        "template-creator" => "从 Word、PowerPoint 或 Excel 文件创建可复用的个人模板。",
        "verify" => "运行项目约定的检查流程，确认代码、格式和构建结果是否可交付。",
        "agent-browser" => "通过浏览器自动完成网页打开、点击、输入和结果检查。",
        "docx" => "创建、编辑和检查 Word 文档，包括内容与版式。",
        "find-skills" => "查找适合当前任务的可安装 Agent 技能。",
        "frontend-design" => "设计并实现清晰、可用的前端界面。",
        "gexp-data-getdataclient-skill" => "通过数据客户端查询和整理业务数据。",
        "notion-infographic" => "把 Notion 内容整理成易读的信息图。",
        "pptx" => "创建、编辑和检查 PowerPoint 演示文稿。",
        "remotion-best-practices" => "按推荐实践制作和维护 Remotion 视频项目。",
        "xlsx" => "创建、编辑和分析 Excel 电子表格。",
        "brainstorming" => "在动手开发前梳理目标、约束和方案，形成可确认的设计方向。",
        "dispatching-parallel-agents" => "把彼此独立的任务并行分派，汇总多个开发结果。",
        "executing-plans" => "按既定实施计划分阶段执行，并在检查点核对进度。",
        "finishing-a-development-branch" => "在开发完成后检查测试，并选择合并、提 PR 或清理分支。",
        "receiving-code-review" => "核实代码评审意见并谨慎实施合理修改。",
        "requesting-code-review" => "在重要改动完成后组织代码评审，检查需求和实现质量。",
        "subagent-driven-development" => "把实施计划拆成独立子任务，在当前会话中逐项完成和复核。",
        "systematic-debugging" => "先定位根因和复现路径，再实施并验证修复。",
        "test-driven-development" => "先编写失败测试，再完成最小实现并持续重构验证。",
        "using-git-worktrees" => "使用 Git worktree 隔离功能开发，避免干扰当前工作区。",
        "using-superpowers" => "识别当前任务应使用的 Superpowers 工作流，并按技能说明执行。",
        "verification-before-completion" => "在宣布完成前运行实际验证命令，用结果确认交付状态。",
        "writing-plans" => "把多步骤需求整理成可执行、可验证的实施计划。",
        "writing-skills" => "创建、修改并验证可复用的 Agent 技能说明。",
        _ if normalized.contains("github") || normalized.starts_with("gh-") => {
            "处理 GitHub 仓库、Issue、Pull Request 或检查任务。"
        }
        _ if normalized.contains("design") => "辅助产品设计、界面实现或体验检查。",
        _ if normalized.contains("data") || normalized.contains("analytics") => {
            "辅助数据查询、分析、质量检查或报告制作。"
        }
        _ => return (name_zh, format!("用于辅助处理「{}」相关任务。", name)),
    };

    (name_zh, summary.to_string())
}

fn contains_cjk(value: &str) -> bool {
    value
        .chars()
        .any(|character| ('\u{4e00}'..='\u{9fff}').contains(&character))
}

#[cfg(test)]
mod tests {
    use super::{
        chinese_skill_presentation, discover_session_skill_sources_from_files,
        discover_skill_sources_with_roots, extract_used_skill_paths_from_session,
        is_personal_skill_path, parse_enabled_codex_plugins, EnabledPlugin,
    };
    use std::io::Write;
    use std::path::{Path, PathBuf};

    fn temp_root(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "humhum-skill-index-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn parses_only_enabled_codex_plugins() {
        let config = r#"
[plugins."documents@openai-primary-runtime"]
enabled = true
[plugins."github@openai-curated-remote"]
enabled = false
"#;

        assert_eq!(
            parse_enabled_codex_plugins(config),
            vec![EnabledPlugin {
                name: "documents".into(),
                marketplace: "openai-primary-runtime".into(),
            }]
        );
    }

    #[test]
    fn rejects_system_and_marketplace_skills() {
        assert!(!is_personal_skill_path(Path::new(
            "/Users/me/.codex/skills/.system/imagegen/SKILL.md"
        )));
        assert!(!is_personal_skill_path(Path::new(
            "/Users/me/.claude/plugins/marketplaces/official/x/SKILL.md"
        )));
        assert!(!is_personal_skill_path(Path::new(
            "/Users/me/.qoder/plugins/cache/bundled/skills/noise/SKILL.md"
        )));
        assert!(is_personal_skill_path(Path::new(
            "/Users/me/.agents/skills/a1/SKILL.md"
        )));
    }

    #[test]
    fn discovers_created_roots_with_system_exclusion() {
        let sources = discover_skill_sources_with_roots(Path::new("/Users/me"), &[]);
        let codex = sources
            .iter()
            .find(|source| source.root == Path::new("/Users/me/.codex/skills"))
            .expect("codex created root");

        assert_eq!(codex.ownership, "created");
        assert!(codex
            .excluded_prefixes
            .iter()
            .any(|path| path == Path::new("/Users/me/.codex/skills/.system")));
        let qoder = sources
            .iter()
            .find(|source| source.root == Path::new("/Users/me/.qoder/skills"))
            .expect("qoder installed root");
        assert_eq!(qoder.ownership, "installed");
    }

    #[test]
    fn preserves_chinese_descriptions_and_explains_common_skills() {
        let (a1_name, a1_summary) = chinese_skill_presentation("a1", "查询代码评审和构建状态");
        let (documents_name, documents_summary) = chinese_skill_presentation(
            "documents",
            "Create, edit, redline, and comment on Word documents",
        );

        assert_eq!(a1_name.as_deref(), Some("a1 研发助手"));
        assert_eq!(a1_summary, "查询代码评审和构建状态");
        assert_eq!(documents_name.as_deref(), Some("Word 文档处理"));
        assert!(documents_summary.contains("创建、编辑和检查 Word 文档"));
        for (name, expected) in [
            ("verify", "项目验证"),
            ("agent-browser", "浏览器操作"),
            ("find-skills", "技能查找"),
            ("frontend-design", "前端设计"),
            ("remotion-best-practices", "Remotion 视频制作规范"),
            ("using-superpowers", "Superpowers 使用指南"),
            ("systematic-debugging", "系统化调试"),
        ] {
            assert_eq!(
                chinese_skill_presentation(name, "English description")
                    .0
                    .as_deref(),
                Some(expected)
            );
        }
    }

    #[test]
    fn skill_catalog_is_not_usage_but_real_tool_calls_are() {
        let skill = "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md";
        let other = "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/systematic-debugging/SKILL.md";
        let session = format!(
            "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"developer\",\"content\":[{{\"type\":\"input_text\",\"text\":\"Available skill: {skill}\"}}]}}}}\n\
             {{\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {skill}\"}}}}\n\
             {{\"type\":\"response_item\",\"payload\":{{\"type\":\"function_call\",\"name\":\"exec_command\",\"arguments\":\"{{\\\"cmd\\\":\\\"cat {other}\\\"}}\"}}}}\n\
             {{\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call_output\",\"output\":\"{skill}\"}}}}"
        );

        assert_eq!(
            extract_used_skill_paths_from_session(&session),
            vec![PathBuf::from(skill), PathBuf::from(other)]
        );
    }

    #[test]
    fn extracts_absolute_skill_paths_outside_plugin_cache_from_tool_calls() {
        let paths = [
            "/Users/me/.codex/skills/personal/SKILL.md",
            "/Users/me/.agents/skills/shared/SKILL.md",
            "/Users/me/.claude/skills/writing/SKILL.md",
            "/Users/me/.qoder/skills/review/SKILL.md",
            "/Users/me/Projects/humhum/.agents/skills/release/SKILL.md",
        ];
        let session = paths
            .iter()
            .map(|path| {
                format!(
                    "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {path}\"}}}}"
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(
            extract_used_skill_paths_from_session(&session),
            paths.into_iter().map(PathBuf::from).collect::<Vec<_>>()
        );
    }

    #[test]
    fn session_evidence_discovers_personal_skill_without_plugin_cache() {
        let root = temp_root("session-personal-no-cache");
        let home = root.join("home");
        let skill = home.join(".codex/skills/personal/SKILL.md");
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(&skill, "---\nname: personal\ndescription: test\n---\n").unwrap();
        let session_path = root.join("personal-session.jsonl");
        std::fs::write(
            &session_path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"personal-session\"}}}}\n\
                 {{\"timestamp\":\"2026-07-20T12:00:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                skill.display(),
            ),
        )
        .unwrap();

        let sources = discover_session_skill_sources_from_files(&home, &[session_path]);

        assert_eq!(sources.len(), 1);
        assert_eq!(
            sources[0].root,
            skill.parent().unwrap().canonicalize().unwrap()
        );
        assert_eq!(sources[0].source, "codex");
        assert_eq!(sources[0].ownership, "created");
        assert_eq!(sources[0].usage_evidence[0].session_id, "personal-session");
        assert!(!home.join(".codex/plugins/cache").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_evidence_rejects_skill_outside_recognized_roots() {
        let root = temp_root("session-unrecognized");
        let home = root.join("home");
        let skill = root.join("unrecognized/random/SKILL.md");
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(&skill, "---\nname: random\ndescription: test\n---\n").unwrap();
        let session_path = root.join("unrecognized-session.jsonl");
        std::fs::write(
            &session_path,
            format!(
                "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                skill.display(),
            ),
        )
        .unwrap();

        let sources = discover_session_skill_sources_from_files(&home, &[session_path]);

        assert!(sources.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_tool_call_discovers_only_the_used_plugin_skill() {
        let root = temp_root("session-used");
        let home = root.join("home");
        let used_skill = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        );
        let unused_skill = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
        );
        for path in [&used_skill, &unused_skill] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "---\nname: test\ndescription: test\n---\n").unwrap();
        }
        let session_path = root.join("session.jsonl");
        std::fs::write(
            &session_path,
            format!(
                "{{\"timestamp\":\"2026-07-18T08:00:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n\
                 {{\"timestamp\":\"2026-07-19T09:30:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                used_skill.display(),
                used_skill.display()
            ),
        )
        .unwrap();

        let sources = discover_session_skill_sources_from_files(&home, &[session_path]);

        assert_eq!(sources.len(), 1);
        assert_eq!(
            sources[0].root,
            used_skill.parent().unwrap().canonicalize().unwrap()
        );
        assert_eq!(sources[0].plugin.as_deref(), Some("superpowers"));
        assert_eq!(sources[0].ownership, "used");
        assert_eq!(
            sources[0].last_used_at.as_deref(),
            Some("2026-07-19T09:30:00+00:00")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_evidence_uses_meta_identity_and_deduplicates_calls() {
        let root = temp_root("session-evidence-dedup");
        let home = root.join("home");
        let skill = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        );
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(&skill, "---\nname: test\ndescription: test\n---\n").unwrap();
        let session_path = root.join("session-fallback.jsonl");
        std::fs::write(
            &session_path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"session-new\",\"cwd\":\"/Users/me/project\"}}}}\n\\
                 {{\"timestamp\":\"2026-07-20T09:00:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n\\
                 {{\"timestamp\":\"2026-07-20T09:30:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                skill.display(),
                skill.display(),
            ),
        )
        .unwrap();

        let sources = discover_session_skill_sources_from_files(&home, &[session_path]);

        assert_eq!(sources[0].usage_evidence.len(), 1);
        assert_eq!(sources[0].usage_evidence[0].session_id, "session-new");
        assert_eq!(
            sources[0].usage_evidence[0].workspace.as_deref(),
            Some("/Users/me/project")
        );
        assert_eq!(
            sources[0].usage_evidence[0].used_at.as_deref(),
            Some("2026-07-20T09:30:00+00:00")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_evidence_sorts_transcripts_newest_first() {
        let root = temp_root("session-evidence-order");
        let home = root.join("home");
        let skill = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        );
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(&skill, "---\nname: test\ndescription: test\n---\n").unwrap();
        let older_session = root.join("session-older.jsonl");
        let newer_session = root.join("session-newer.jsonl");
        for (path, session_id, timestamp) in [
            (&older_session, "session-older", "2026-07-20T08:30:00Z"),
            (&newer_session, "session-newer", "2026-07-20T10:30:00Z"),
        ] {
            std::fs::write(
                path,
                format!(
                    "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\"}}}}\n\\
                     {{\"timestamp\":\"{timestamp}\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                    skill.display(),
                ),
            )
            .unwrap();
        }

        let sources =
            discover_session_skill_sources_from_files(&home, &[older_session, newer_session]);

        assert_eq!(sources[0].usage_evidence.len(), 2);
        assert_eq!(sources[0].usage_evidence[0].session_id, "session-newer");
        assert_eq!(sources[0].usage_evidence[1].session_id, "session-older");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_evidence_reads_meta_from_bounded_header_for_large_transcript() {
        let root = temp_root("session-evidence-header");
        let home = root.join("home");
        let skill = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        );
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(&skill, "---\nname: test\ndescription: test\n---\n").unwrap();
        let session_path = root.join("oversized-session.jsonl");
        let mut session = std::fs::File::create(&session_path).unwrap();
        writeln!(
            session,
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"session-header\",\"cwd\":\"/Users/me/header-project\"}}}}"
        )
        .unwrap();
        session
            .write_all(&vec![b'x'; (super::MAX_SESSION_TAIL_BYTES + 1) as usize])
            .unwrap();
        writeln!(
            session,
            "\n{{\"timestamp\":\"2026-07-20T11:30:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}",
            skill.display(),
        )
        .unwrap();

        let sources = discover_session_skill_sources_from_files(&home, &[session_path]);

        assert_eq!(sources[0].usage_evidence[0].session_id, "session-header");
        assert_eq!(
            sources[0].usage_evidence[0].workspace.as_deref(),
            Some("/Users/me/header-project")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_evidence_deduplicates_same_meta_id_across_transcripts() {
        let root = temp_root("session-evidence-shared-id");
        let home = root.join("home");
        let skill = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        );
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(&skill, "---\nname: test\ndescription: test\n---\n").unwrap();
        let older_session = root.join("shared-id-older.jsonl");
        let newer_session = root.join("shared-id-newer.jsonl");
        for (path, timestamp) in [
            (&older_session, "2026-07-20T08:30:00Z"),
            (&newer_session, "2026-07-20T10:30:00Z"),
        ] {
            std::fs::write(
                path,
                format!(
                    "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"session-shared\"}}}}\n\\
                     {{\"timestamp\":\"{timestamp}\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                    skill.display(),
                ),
            )
            .unwrap();
        }

        let sources =
            discover_session_skill_sources_from_files(&home, &[older_session, newer_session]);

        assert_eq!(sources[0].usage_evidence.len(), 1);
        assert_eq!(sources[0].usage_evidence[0].session_id, "session-shared");
        assert_eq!(
            sources[0].usage_evidence[0].used_at.as_deref(),
            Some("2026-07-20T10:30:00+00:00")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_evidence_falls_back_to_transcript_stem_without_meta() {
        let root = temp_root("session-evidence-fallback");
        let home = root.join("home");
        let skill = home.join(
            ".codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/using-superpowers/SKILL.md",
        );
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(&skill, "---\nname: test\ndescription: test\n---\n").unwrap();
        let session_path = root.join("session-without-meta.jsonl");
        std::fs::write(
            &session_path,
            format!(
                "{{\"timestamp\":\"2026-07-20T11:30:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"custom_tool_call\",\"name\":\"exec\",\"input\":\"cat {}\"}}}}\n",
                skill.display(),
            ),
        )
        .unwrap();

        let sources = discover_session_skill_sources_from_files(&home, &[session_path]);

        assert_eq!(
            sources[0].usage_evidence[0].session_id,
            "session-without-meta"
        );
        assert_eq!(sources[0].usage_evidence[0].workspace, None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
