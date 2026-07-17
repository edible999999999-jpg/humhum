import { describe, expect, it } from "vitest";
import {
  planningCapabilityCopy,
  watchedSessionAge,
  watchedSessionConnectionLabel,
  watchedSessionIsExpired,
  workItemSourceLabel,
} from "./hexaPlanningCapability";

describe("Hexa planning capability copy", () => {
  it("attributes missing structured plans to the Agent integration", () => {
    expect(planningCapabilityCopy("inferred").detail).toContain("当前 Agent 没有提供结构化工作计划");
    expect(planningCapabilityCopy("unavailable").detail).toContain("当前 Agent 集成没有提供");
  });

  it("marks an active session expired after thirty minutes without an update", () => {
    const now = new Date("2026-07-16T12:00:00Z").getTime();
    expect(watchedSessionIsExpired("working", "2026-07-16T11:29:59Z", now)).toBe(true);
    expect(watchedSessionIsExpired("working", "2026-07-16T11:45:00Z", now)).toBe(false);
    expect(watchedSessionIsExpired("working", "not-a-date", now)).toBe(true);
    expect(watchedSessionIsExpired("completed", "2026-07-15T11:00:00Z", now)).toBe(false);
    expect(watchedSessionConnectionLabel("working", "2026-07-16T11:29:59Z", now)).toBe("已断开");
    expect(watchedSessionConnectionLabel("working", "2026-07-16T11:45:00Z", now)).toBeNull();
    expect(watchedSessionAge("not-a-date", now)).toBe("时间未知");
    expect(watchedSessionAge("2026-07-16T11:45:00Z", now)).toBe("15m");
  });

  it("labels authoritative and explicit sources", () => {
    expect(planningCapabilityCopy("native").label).toBe("Agent 原生计划");
    expect(planningCapabilityCopy("reported").label).toBe("Agent 主动上报");
    expect(workItemSourceLabel("user")).toBe("用户检查点");
    expect(workItemSourceLabel("hexa_inferred")).toBe("Hexa 整理");
  });
});
