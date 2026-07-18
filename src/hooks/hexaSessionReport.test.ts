import { describe, expect, it } from "vitest";
import type {
  HexaSessionAudit,
  HexaWatchedSession,
  HexaWorkItem,
} from "./useHexaData";
import {
  buildHexaSessionReport,
  createWorkItemId,
  groupWatchedSessions,
  orderWorkflow,
  resolveSelectedSession,
  reviewLabel,
  selectVisibleMilestones,
  tabCounts,
  workItemDisplayStatus,
  workItemRemovalBlocker,
} from "./hexaSessionReport";

function emptyAudit(): HexaSessionAudit {
  return {
    goal_revisions: [],
    success_criteria: [],
    work_items: [],
    milestones: [],
    important_outputs: [],
    interventions: [],
    hexa_review: null,
    user_review: null,
  };
}

function run(
  id: string,
  workspace = "/workspace/humhum",
  overrides: Partial<HexaWatchedSession> = {},
): HexaWatchedSession {
  return {
    session_id: id,
    agent: "codex",
    name: `Session ${id}`,
    provider: "openai",
    workspace,
    goal: "Build an accurate Hexa report",
    status: "working",
    current_step: "Implementing report selectors",
    blocked_reason: null,
    need_user: false,
    confidence: "agent-bound",
    started_at: "2026-07-15T01:00:00Z",
    updated_at: "2026-07-15T01:00:00Z",
    audit: emptyAudit(),
    ...overrides,
  };
}

function item(
  id: string,
  status: HexaWorkItem["status"],
  dependsOn: string[] = [],
): HexaWorkItem {
  return {
    id,
    title: `Work ${id}`,
    description: null,
    acceptance_criteria: null,
    status,
    depends_on: dependsOn,
    evidence: [],
    started_at: status === "pending" ? null : "2026-07-15T01:00:00Z",
    updated_at: "2026-07-15T01:00:00Z",
    completed_at: status === "completed" ? "2026-07-15T01:10:00Z" : null,
  };
}

describe("Hexa session report", () => {
  it("groups by workspace without merging sessions and keeps live work first", () => {
    const groups = groupWatchedSessions([
      run("older", "/repo", { updated_at: "2026-07-15T01:00:00Z" }),
      run("completed", "/repo", {
        status: "completed",
        updated_at: "2026-07-15T03:00:00Z",
      }),
      run("newer", "/repo", { updated_at: "2026-07-15T02:00:00Z" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.sessions.map((session) => session.session_id)).toEqual([
      "newer",
      "older",
      "completed",
    ]);
  });

  it("does not invent progress when no work items exist", () => {
    expect(buildHexaSessionReport(run("empty")).progress).toBeNull();
  });

  it("counts only explicit work items and interventions", () => {
    const session = run("metrics");
    session.audit.work_items = [
      item("one", "completed"),
      item("two", "completed"),
      item("three", "failed"),
      item("four", "in_progress"),
    ];
    session.audit.interventions = [
      { id: "i1", kind: "message", summary: "Redirected", evidence: [], created_at: "2026-07-15T01:00:00Z" },
      { id: "i2", kind: "permission", summary: "Allowed", evidence: [], created_at: "2026-07-15T01:01:00Z" },
      { id: "i3", kind: "manual_correction", summary: "Corrected", evidence: [], created_at: "2026-07-15T01:02:00Z" },
    ];

    const report = buildHexaSessionReport(session);

    expect(report.metrics).toEqual({
      total: 4,
      completed: 2,
      failed: 1,
      interventions: 3,
      pendingConfirmations: 0,
    });
    expect(report.progress).toEqual({ completed: 2, total: 4, percent: 50 });
  });

  it("calls an in-progress plan item unclosed after the Agent turn becomes idle", () => {
    const session = run("idle-plan", "/workspace/humhum", { status: "idle" });
    session.audit.work_items = [item("browser-regression", "in_progress")];

    const report = buildHexaSessionReport(session);

    expect(report.nextAction).toBe(
      "Agent 本轮已结束，未确认“Work browser-regression”是否完成",
    );
    expect(workItemDisplayStatus("in_progress", "idle")).toBe("unclosed");
    expect(workItemDisplayStatus("in_progress", "working")).toBe("in_progress");
    expect(workItemDisplayStatus("completed", "idle")).toBe("completed");
  });

  it("does not count inferred or migrated summaries as real work items", () => {
    const session = run("fallback");
    session.audit.work_items = [
      { ...item("legacy", "in_progress"), source: "legacy_migration" },
      { ...item("inferred", "in_progress"), source: "hexa_inferred" },
    ];

    const report = buildHexaSessionReport(session);

    expect(report.metrics.total).toBe(0);
    expect(report.progress).toBeNull();
  });

  it("uses the latest goal revision as the problem being solved", () => {
    const session = run("goal");
    session.audit.goal_revisions = [
      { id: "g1", goal: "Old goal", success_criteria: [], created_at: "2026-07-15T01:00:00Z" },
      { id: "g2", goal: "Current user problem", success_criteria: ["Verified"], created_at: "2026-07-15T02:00:00Z" },
    ];

    expect(buildHexaSessionReport(session).problem).toBe("Current user problem");
  });

  it("downgrades unsupported off-track claims to watch", () => {
    const session = run("drift");
    session.audit.milestones = [{
      id: "m1",
      summary: "Agent changed unrelated code",
      work_item_id: null,
      alignment: "off_track",
      evidence: [],
      created_at: "2026-07-15T02:00:00Z",
    }];

    expect(buildHexaSessionReport(session).alignment).toBe("watch");
  });

  it("shows no more than five important milestones newest first", () => {
    const session = run("timeline");
    session.audit.milestones = Array.from({ length: 8 }, (_, index) => ({
      id: `m${index}`,
      summary: `Milestone ${index}`,
      work_item_id: null,
      alignment: "on_track" as const,
      evidence: [],
      created_at: `2026-07-15T0${index + 1}:00:00Z`,
    }));

    expect(selectVisibleMilestones(session.audit.milestones).map((event) => event.id)).toEqual([
      "m7", "m6", "m5", "m4", "m3",
    ]);
  });

  it("orders workflow dependencies before their dependants", () => {
    const ordered = orderWorkflow([
      item("verify", "pending", ["build"]),
      item("build", "completed"),
      item("ship", "pending", ["verify"]),
    ]);

    expect(ordered.map((workItem) => workItem.id)).toEqual(["build", "verify", "ship"]);
  });

  it("creates readable unique checkpoint ids", () => {
    expect(createWorkItemId("验证构建", [])).toBe("work-item");
    expect(createWorkItemId("Ship release", ["ship-release"])).toBe("ship-release-2");
  });

  it("explains why a depended-on checkpoint cannot be removed", () => {
    const items = [
      item("build", "completed"),
      item("verify", "pending", ["build"]),
    ];

    expect(workItemRemovalBlocker(items, "build")).toBe("“Work verify”仍依赖这个检查点");
    expect(workItemRemovalBlocker(items, "verify")).toBeNull();
  });

  it("selects the latest live session and exposes separate tab counts", () => {
    const watched = [
      run("history", "/repo", { status: "completed", updated_at: "2026-07-15T03:00:00Z" }),
      run("latest-live", "/repo", { updated_at: "2026-07-15T04:00:00Z" }),
    ];
    const groups = groupWatchedSessions(watched);
    const now = new Date("2026-07-15T04:01:00Z").getTime();

    expect(resolveSelectedSession(groups, null, now)?.session_id).toBe("latest-live");
    expect(resolveSelectedSession(groups, "deleted", now)?.session_id).toBe("latest-live");
    expect(tabCounts(watched, [{ source: "hook" }, { source: "codex_bridge" }])).toEqual({
      active: 2,
      scanned: 2,
    });
  });

  it("does not let an expired inferred watch replace a valid default report", () => {
    const stale = run("stale-inferred", "/repo", {
      status: "working",
      updated_at: "2000-01-01T00:00:00Z",
      planning_capability: "inferred",
    });
    const valid = run("valid-history", "/repo", {
      status: "completed",
      updated_at: "2026-07-18T04:00:00Z",
      planning_capability: "native",
    });
    const groups = groupWatchedSessions([stale, valid]);
    const now = new Date("2026-07-18T05:00:00Z").getTime();

    expect(resolveSelectedSession(groups, null, now)?.session_id).toBe("valid-history");
    expect(resolveSelectedSession(groups, "stale-inferred", now)?.session_id).toBe("stale-inferred");
  });

  it("uses the three user-facing review labels", () => {
    expect(reviewLabel("satisfied")).toBe("满意");
    expect(reviewLabel("average")).toBe("一般");
    expect(reviewLabel("unsatisfied")).toBe("不满意");
  });
});
