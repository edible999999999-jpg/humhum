export type HexaPlanningCapability = "native" | "reported" | "inferred" | "unavailable";
export type HexaWorkItemSource = "native_plan" | "agent_report" | "hexa_inferred" | "user" | "legacy_migration";

export function planningCapabilityCopy(capability: HexaPlanningCapability = "inferred") {
  switch (capability) {
    case "native":
      return { label: "Agent 原生计划", detail: "当前 Agent 提供了结构化工作计划，Hexa 会同步真实任务状态。", tone: "good" as const };
    case "reported":
      return { label: "Agent 主动上报", detail: "当前 Agent 正在通过 Hexa 通用协议上报工作项。", tone: "good" as const };
    case "inferred":
      return { label: "Hexa 状态整理", detail: "当前 Agent 没有提供结构化工作计划。Hexa 只能根据它上报的当前状态整理进展，无法确认完整任务列表。", tone: "watch" as const };
    case "unavailable":
      return { label: "无计划能力", detail: "当前 Agent 集成没有提供结构化工作计划或可整理的状态。这不是 Hexa 故障；可让 Agent 接入 Hexa 通用计划协议。", tone: "watch" as const };
  }
}

export function workItemSourceLabel(source: HexaWorkItemSource = "agent_report"): string {
  return {
    native_plan: "Agent 计划",
    agent_report: "Agent 上报",
    hexa_inferred: "Hexa 整理",
    user: "用户检查点",
    legacy_migration: "历史迁移",
  }[source];
}
