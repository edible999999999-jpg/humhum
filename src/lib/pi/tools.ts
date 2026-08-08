import { invoke } from "@tauri-apps/api/core";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { t } from "@/lib/i18n";

const contextParameters = Type.Object({
  query: Type.Optional(Type.String({ description: "A short keyword when project context needs narrowing" })),
});

type ContextParameters = Static<typeof contextParameters>;

const contextTool = (
  name: string,
  label: string,
  description: string,
  onProgress?: (label: string, tool: string) => void,
): AgentTool<typeof contextParameters> => ({
  name,
  label,
  description,
  parameters: contextParameters,
  execute: async (_toolCallId, params: ContextParameters) => {
    onProgress?.(label, name);
    const result = await invoke<Record<string, unknown>>("get_humi_context_tool", {
      tool: name,
      query: params.query,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: { tool: name },
    };
  },
});

export function buildHumiTools(onProgress?: (label: string, tool: string) => void): AgentTool[] {
  return [
    contextTool(
      "get_recent_sessions",
      t("pi.progress.recentWork"),
      "Read a concise summary of recent local Agent sessions and activity.",
      onProgress,
    ),
    contextTool(
      "get_agent_skills",
      t("pi.progress.commonSkills"),
      "Read indexed Agent skills and their short descriptions.",
      onProgress,
    ),
    contextTool(
      "get_local_memory",
      t("pi.progress.memories"),
      "Read existing HUMHUM preferences and durable memories.",
      onProgress,
    ),
    contextTool(
      "get_project_context",
      t("pi.progress.projectContext"),
      "Read relevant local project rules and Agent context. Use a short query when useful.",
      onProgress,
    ),
    contextTool(
      "get_user_preferences",
      t("pi.progress.preferences"),
      "Read user presentation and workflow preferences.",
      onProgress,
    ),
  ];
}
