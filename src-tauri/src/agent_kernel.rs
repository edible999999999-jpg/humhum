use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AgentKernelStatus {
    pub version: String,
    pub loop_model: Vec<AgentKernelStage>,
    pub roles: Vec<AgentKernelRole>,
    pub memory_layers: Vec<String>,
    pub active_bridges: Vec<String>,
    pub next_kernel_step: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentKernelStage {
    pub phase: String,
    pub contract: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentKernelRole {
    pub name: String,
    pub job: String,
    pub reads: Vec<String>,
    pub writes: Vec<String>,
}

pub fn build_agent_kernel_status(
    knowledge_assets: usize,
    hush_messages: usize,
    pi_available: bool,
    qoder_available: bool,
) -> AgentKernelStatus {
    let mut active_bridges = Vec::new();
    if knowledge_assets > 0 {
        active_bridges.push(format!(
            "Hype knowledge index: {} local assets",
            knowledge_assets
        ));
    }
    if hush_messages > 0 {
        active_bridges.push(format!("Hush inbox: {} imported messages", hush_messages));
    }
    if pi_available {
        active_bridges.push("Pi sidecar: available for active agent loops".to_string());
    }
    if qoder_available {
        active_bridges.push("Qoder watcher: available for engineering sessions".to_string());
    }
    if active_bridges.is_empty() {
        active_bridges.push(
            "No active bridge yet; start with local knowledge scan or DingTalk import.".to_string(),
        );
    }

    AgentKernelStatus {
        version: "humhum-local-agent-kernel-v0.2".to_string(),
        loop_model: vec![
            AgentKernelStage {
                phase: "observe".to_string(),
                contract: "Read local evidence quietly: agent assets, sessions, message imports, and user-approved files.".to_string(),
            },
            AgentKernelStage {
                phase: "filter".to_string(),
                contract: "Separate personal signals from raw tools, noisy logs, built-in operations, and private data that has not been approved.".to_string(),
            },
            AgentKernelStage {
                phase: "assess".to_string(),
                contract: "Turn evidence into user-facing preferences, work direction, relationship priorities, risks, and confidence.".to_string(),
            },
            AgentKernelStage {
                phase: "act".to_string(),
                contract: "Write only durable memories, summaries, and next steps. HUMHUM does not reply or mutate external apps without the user.".to_string(),
            },
        ],
        roles: vec![
            AgentKernelRole {
                name: "Humi".to_string(),
                job: "Warm conversational surface for the user's personal agent context.".to_string(),
                reads: vec![
                    "Hype knowledge profile".to_string(),
                    "Hush relationship summaries".to_string(),
                    "Hexa session state".to_string(),
                ],
                writes: vec!["User-facing memory candidates".to_string()],
            },
            AgentKernelRole {
                name: "Hype".to_string(),
                job: "Builds the skill, agent, soul, rule, and memory knowledge base.".to_string(),
                reads: vec![
                    "SKILL.md".to_string(),
                    "agent rules".to_string(),
                    "memory/soul/config".to_string(),
                    "Obsidian notes".to_string(),
                ],
                writes: vec!["~/.humhum/knowledge.json".to_string()],
            },
            AgentKernelRole {
                name: "Hush".to_string(),
                job: "Classifies user-approved messages into family, friends, work, and daily signals.".to_string(),
                reads: vec!["DingTalk/WeChat/X/Meta imports".to_string()],
                writes: vec!["~/.humhum/hush-inbox.json".to_string()],
            },
            AgentKernelRole {
                name: "Hexa".to_string(),
                job: "Supervises engineering agent sessions without becoming another orchestrator.".to_string(),
                reads: vec!["Codex/Claude/Qoder/Pi session events".to_string()],
                writes: vec!["Progress notes and drift warnings".to_string()],
            },
        ],
        memory_layers: vec![
            "ephemeral: current question and local session".to_string(),
            "working: current project, active messages, agent progress".to_string(),
            "durable: user preferences, skills, rules, relationship priorities".to_string(),
        ],
        active_bridges,
        next_kernel_step: "Route Humi questions through this contract first, then attach Pi/LLM only after evidence is filtered.".to_string(),
    }
}
