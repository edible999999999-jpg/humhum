import { describe, expect, it } from "vitest";
import { planningCapabilityCopy, workItemSourceLabel } from "./hexaPlanningCapability";

describe("Hexa planning capability copy", () => {
  it("attributes missing structured plans to the Agent integration", () => {
    expect(planningCapabilityCopy("inferred").detail).toContain("当前 Agent 没有提供结构化工作计划");
    expect(planningCapabilityCopy("unavailable").detail).toContain("当前 Agent 集成没有提供");
  });

  it("labels authoritative and explicit sources", () => {
    expect(planningCapabilityCopy("native").label).toBe("Agent 原生计划");
    expect(planningCapabilityCopy("reported").label).toBe("Agent 主动上报");
    expect(workItemSourceLabel("user")).toBe("用户检查点");
    expect(workItemSourceLabel("hexa_inferred")).toBe("Hexa 整理");
  });
});
