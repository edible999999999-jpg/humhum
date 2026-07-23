use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::Manager;

const CONTEXT_TTL_HOURS: i64 = 24;
const MAX_TODAY: usize = 5;
const MAX_SUGGESTIONS: usize = 3;
const MAX_PREFERENCES: usize = 8;
const MAX_HABITS: usize = 8;
const MAX_MEMORIES: usize = 6;
const MAX_KNOWLEDGE: usize = 8;
const MAX_AGENTS: usize = 8;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileTodayItem {
    pub id: String,
    pub title: String,
    pub detail: Option<String>,
    pub source: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileSuggestion {
    pub id: String,
    pub title: String,
    pub rationale: String,
    pub source: String,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobilePreference {
    pub id: String,
    pub category: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileHabit {
    pub id: String,
    pub title: String,
    pub cadence: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileMemory {
    pub id: String,
    pub content: String,
    pub temperature: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileKnowledgeItem {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileInboxItem {
    pub id: String,
    pub sender: String,
    pub platform: String,
    pub preview: String,
    pub received_at: String,
    pub importance: u8,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileAgentItem {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub status: String,
    pub current_step: Option<String>,
    pub needs_user: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobilePersonalContext {
    pub version: u8,
    pub generated_at: String,
    pub expires_at: String,
    pub today: Vec<MobileTodayItem>,
    pub suggestions: Vec<MobileSuggestion>,
    pub preferences: Vec<MobilePreference>,
    pub habits: Vec<MobileHabit>,
    pub memories: Vec<MobileMemory>,
    pub knowledge: Vec<MobileKnowledgeItem>,
    pub inbox: Vec<MobileInboxItem>,
    pub agents: Vec<MobileAgentItem>,
}

#[derive(Debug, Clone)]
pub(crate) struct MobileSourceToday {
    pub id: String,
    pub title: String,
    pub detail: Option<String>,
    pub source: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub(crate) struct MobileSourcePreference {
    pub id: String,
    pub category: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub(crate) struct MobileSourceMemory {
    pub id: String,
    pub content: String,
    pub temperature: String,
}

#[derive(Debug, Clone)]
pub(crate) struct MobileSourceKnowledge {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub kind: String,
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct MobileSourceInbox {
    pub id: String,
    pub sender: String,
    pub platform: String,
    pub preview: String,
    pub received_at: String,
    pub importance: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct MobileSourceAgent {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub status: String,
    pub current_step: Option<String>,
    pub needs_user: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct MobileContextSources {
    pub today: Vec<MobileSourceToday>,
    pub suggestions: Vec<MobileSuggestion>,
    pub preferences: Vec<MobileSourcePreference>,
    pub habits: Vec<MobileHabit>,
    pub memories: Vec<MobileSourceMemory>,
    pub knowledge: Vec<MobileSourceKnowledge>,
    #[cfg(test)]
    #[allow(dead_code)]
    pub inbox: Vec<MobileSourceInbox>,
    pub agents: Vec<MobileSourceAgent>,
}

pub fn project_mobile_personal_context(app: &tauri::AppHandle) -> MobilePersonalContext {
    let mut sources = MobileContextSources::default();

    if let Some(store) =
        app.try_state::<Arc<Mutex<crate::knowledge_store::KnowledgeStore>>>()
    {
        let store = store.lock().unwrap_or_else(|error| error.into_inner());
        let knowledge = store.get_all();
        sources.preferences = knowledge
            .preferences
            .iter()
            .map(|preference| MobileSourcePreference {
                id: preference.id.clone(),
                category: preference.category.clone(),
                content: preference.content.clone(),
            })
            .collect();
        sources.memories = knowledge
            .memory_items
            .iter()
            .map(|memory| MobileSourceMemory {
                id: memory.id.clone(),
                content: memory.content.clone(),
                temperature: memory.temperature.clone(),
            })
            .collect();
        for note in &knowledge.obsidian_notes {
            for task in note.tasks.iter().filter(|task| !task.completed) {
                sources.today.push(MobileSourceToday {
                    id: format!("obsidian:{}:{}", note.id, task.line),
                    title: task.text.clone(),
                    detail: Some(note.title.clone()),
                    source: "obsidian_task".into(),
                    status: "active".into(),
                });
            }
            sources.knowledge.push(MobileSourceKnowledge {
                id: note.id.clone(),
                title: note.title.clone(),
                summary: note.excerpt.clone(),
                kind: "note".into(),
            });
        }
        sources.knowledge.extend(
            knowledge
                .agent_assets
                .iter()
                .filter(|asset| asset.asset_type == "skill")
                .map(|asset| MobileSourceKnowledge {
                    id: asset.id.clone(),
                    title: asset
                        .display_name_zh
                        .clone()
                        .unwrap_or_else(|| asset.name.clone()),
                    summary: asset
                        .summary_zh
                        .clone()
                        .unwrap_or_else(|| asset.content.clone()),
                    kind: "skill".into(),
                }),
        );
    }

    if let Some(store) = app.try_state::<Arc<Mutex<crate::hexa_goal_store::HexaGoalStore>>>() {
        let store = store.lock().unwrap_or_else(|error| error.into_inner());
        for goal in store.goals().into_iter().filter(|goal| {
            !matches!(
                goal.status,
                crate::hexa_goal_store::HexaGoalStatus::Completed
            )
        }) {
            let status = match goal.status {
                crate::hexa_goal_store::HexaGoalStatus::Active => "active",
                crate::hexa_goal_store::HexaGoalStatus::Waiting => "waiting",
                crate::hexa_goal_store::HexaGoalStatus::Completed => "completed",
            };
            sources.today.push(MobileSourceToday {
                id: goal.id,
                title: goal.title,
                detail: goal.success_criteria.first().cloned(),
                source: "hexa_goal".into(),
                status: status.into(),
            });
        }
    }

    if let Some(store) =
        app.try_state::<Arc<Mutex<crate::hexa_watch_store::HexaWatchStore>>>()
    {
        let store = store.lock().unwrap_or_else(|error| error.into_inner());
        sources.agents = store
            .sessions()
            .into_iter()
            .map(|session| MobileSourceAgent {
                id: session.session_id,
                name: session.name,
                provider: session.provider,
                status: match session.status {
                    crate::hexa_watch_store::HexaWatchStatus::Starting => "starting",
                    crate::hexa_watch_store::HexaWatchStatus::Working => "working",
                    crate::hexa_watch_store::HexaWatchStatus::Waiting => "waiting",
                    crate::hexa_watch_store::HexaWatchStatus::Idle => "idle",
                    crate::hexa_watch_store::HexaWatchStatus::Completed => "completed",
                    crate::hexa_watch_store::HexaWatchStatus::Blocked => "blocked",
                }
                .into(),
                current_step: session.current_step,
                needs_user: session.need_user,
                updated_at: session.updated_at,
            })
            .collect();
    }

    let generated_at = chrono::Utc::now().to_rfc3339();
    project_mobile_personal_context_from_sources(sources, &generated_at)
}

pub(crate) fn project_mobile_personal_context_from_sources(
    mut sources: MobileContextSources,
    generated_at: &str,
) -> MobilePersonalContext {
    sources
        .today
        .sort_by_key(|item| (item.status != "active", item.id.clone()));
    sources
        .agents
        .sort_by_key(|item| (!item.needs_user, item.updated_at.clone()));

    let generated = chrono::DateTime::parse_from_rfc3339(generated_at)
        .map(|value| value.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now());
    MobilePersonalContext {
        version: 1,
        generated_at: generated.to_rfc3339(),
        expires_at: (generated + chrono::Duration::hours(CONTEXT_TTL_HOURS)).to_rfc3339(),
        today: sources
            .today
            .into_iter()
            .filter_map(project_today)
            .take(MAX_TODAY)
            .collect(),
        suggestions: sources
            .suggestions
            .into_iter()
            .filter_map(project_suggestion)
            .take(MAX_SUGGESTIONS)
            .collect(),
        preferences: sources
            .preferences
            .into_iter()
            .filter_map(project_preference)
            .take(MAX_PREFERENCES)
            .collect(),
        habits: sources
            .habits
            .into_iter()
            .filter_map(project_habit)
            .take(MAX_HABITS)
            .collect(),
        memories: sources
            .memories
            .into_iter()
            .filter_map(project_memory)
            .take(MAX_MEMORIES)
            .collect(),
        knowledge: sources
            .knowledge
            .into_iter()
            .filter_map(project_knowledge)
            .take(MAX_KNOWLEDGE)
            .collect(),
        inbox: Vec::new(),
        agents: sources
            .agents
            .into_iter()
            .filter_map(project_agent)
            .take(MAX_AGENTS)
            .collect(),
    }
}

fn project_today(source: MobileSourceToday) -> Option<MobileTodayItem> {
    Some(MobileTodayItem {
        id: safe_required(&source.id, 160)?,
        title: safe_required(&source.title, 180)?,
        detail: safe_optional(source.detail.as_deref(), 220),
        source: safe_required(&source.source, 40)?,
        status: safe_required(&source.status, 24)?,
    })
}

fn project_suggestion(source: MobileSuggestion) -> Option<MobileSuggestion> {
    Some(MobileSuggestion {
        id: safe_required(&source.id, 160)?,
        title: safe_required(&source.title, 180)?,
        rationale: safe_required(&source.rationale, 240)?,
        source: safe_required(&source.source, 40)?,
        confidence: safe_required(&source.confidence, 24)?,
    })
}

fn project_preference(source: MobileSourcePreference) -> Option<MobilePreference> {
    Some(MobilePreference {
        id: safe_required(&source.id, 160)?,
        category: safe_required(&source.category, 60)?,
        content: safe_required(&source.content, 240)?,
    })
}

fn project_habit(source: MobileHabit) -> Option<MobileHabit> {
    Some(MobileHabit {
        id: safe_required(&source.id, 160)?,
        title: safe_required(&source.title, 180)?,
        cadence: safe_required(&source.cadence, 80)?,
        status: safe_required(&source.status, 24)?,
    })
}

fn project_memory(source: MobileSourceMemory) -> Option<MobileMemory> {
    Some(MobileMemory {
        id: safe_required(&source.id, 160)?,
        content: safe_required(&source.content, 260)?,
        temperature: safe_required(&source.temperature, 24)?,
    })
}

fn project_knowledge(source: MobileSourceKnowledge) -> Option<MobileKnowledgeItem> {
    Some(MobileKnowledgeItem {
        id: safe_required(&source.id, 160)?,
        title: safe_required(&source.title, 180)?,
        summary: safe_required(&source.summary, 260)?,
        kind: safe_required(&source.kind, 24)?,
    })
}

fn project_agent(source: MobileSourceAgent) -> Option<MobileAgentItem> {
    Some(MobileAgentItem {
        id: safe_required(&source.id, 160)?,
        name: safe_required(&source.name, 160)?,
        provider: safe_required(&source.provider, 40)?,
        status: safe_required(&source.status, 24)?,
        current_step: safe_optional(source.current_step.as_deref(), 240),
        needs_user: source.needs_user,
        updated_at: safe_required(&source.updated_at, 64)?,
    })
}

fn safe_required(value: &str, maximum_chars: usize) -> Option<String> {
    let value = crate::user_safe_text::project_user_safe_text(value);
    let bounded: String = value.chars().take(maximum_chars).collect();
    (!bounded.is_empty()).then_some(bounded)
}

fn safe_optional(value: Option<&str>, maximum_chars: usize) -> Option<String> {
    value.and_then(|value| safe_required(value, maximum_chars))
}

#[cfg(test)]
mod tests {
    use super::{
        project_mobile_personal_context_from_sources, MobileContextSources, MobileSourceAgent,
        MobileSourceInbox, MobileSourceKnowledge, MobileSourceMemory, MobileSourcePreference,
        MobileSourceToday,
    };

    #[test]
    fn projection_is_bounded_redacted_and_drops_private_source_fields() {
        let sources = MobileContextSources {
            today: (0..9)
                .map(|index| MobileSourceToday {
                    id: format!("today-{index}"),
                    title: format!("完成 /Users/me/private/{index}"),
                    detail: Some("来自明确任务".into()),
                    source: "hexa_goal".into(),
                    status: "active".into(),
                })
                .collect(),
            suggestions: Vec::new(),
            preferences: (0..12)
                .map(|index| MobileSourcePreference {
                    id: format!("preference-{index}"),
                    category: "workflow".into(),
                    content: format!("偏好 {index}"),
                })
                .collect(),
            habits: Vec::new(),
            memories: (0..10)
                .map(|index| MobileSourceMemory {
                    id: format!("memory-{index}"),
                    content: format!("记忆 {index}"),
                    temperature: "warm".into(),
                })
                .collect(),
            knowledge: vec![MobileSourceKnowledge {
                id: "skill-1".into(),
                title: "数据整理".into(),
                summary: "读取 ~/secret.md".into(),
                kind: "skill".into(),
            }],
            inbox: vec![MobileSourceInbox {
                id: "message-1".into(),
                sender: "private-sender-sentinel".into(),
                platform: "dingtalk".into(),
                preview: "private-body-sentinel /Volumes/team/secret.pdf".into(),
                received_at: "2026-07-19T08:00:00Z".into(),
                importance: 5,
            }],
            agents: vec![MobileSourceAgent {
                id: "session-1".into(),
                name: "Android UI".into(),
                provider: "codex".into(),
                status: "working".into(),
                current_step: Some("检查 /Users/me/project".into()),
                needs_user: false,
                updated_at: "2026-07-19T08:00:00Z".into(),
            }],
        };

        let context =
            project_mobile_personal_context_from_sources(sources, "2026-07-19T09:00:00Z");
        let json = serde_json::to_string(&context).expect("context serializes");

        assert_eq!(context.today.len(), 5);
        assert_eq!(context.preferences.len(), 8);
        assert_eq!(context.memories.len(), 6);
        assert!(
            context.inbox.is_empty(),
            "Hush messages must never enter a mobile personal-context response"
        );
        assert!(!json.contains("private-sender-sentinel"));
        assert!(!json.contains("private-body-sentinel"));
        assert!(!json.contains("/Users/"));
        assert!(!json.contains("/Volumes/"));
        assert!(!json.contains("~/"));
        assert!(!json.contains("\"raw\""));
    }
}
