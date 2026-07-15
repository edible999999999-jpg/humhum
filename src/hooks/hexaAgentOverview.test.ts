import { describe, expect, it } from "vitest";
import type { HexaWatchedSession } from "./useHexaData";
import { buildHexaAgentOverview } from "./hexaAgentOverview";

function watchedRun(overrides: Partial<HexaWatchedSession>): HexaWatchedSession {
  return {
    session_id: "run-1",
    agent: "codex",
    name: "Checkout redesign",
    provider: "openai",
    workspace: "/workspace/checkout",
    goal: "Ship the checkout redesign",
    status: "working",
    current_step: "Implement the summary panel",
    blocked_reason: null,
    need_user: false,
    confidence: "agent-bound",
    started_at: "2026-07-14T08:00:00.000Z",
    updated_at: "2026-07-14T08:05:00.000Z",
    ...overrides,
  };
}

describe("buildHexaAgentOverview", () => {
  it("groups runs by durable provider and workspace with total, completed, blocked, and success metrics", () => {
    const agents = buildHexaAgentOverview([
      watchedRun({ session_id: "run-active" }),
      watchedRun({ session_id: "run-complete", status: "completed", updated_at: "2026-07-13T08:05:00.000Z" }),
      watchedRun({ session_id: "run-blocked", status: "blocked", updated_at: "2026-07-12T08:05:00.000Z" }),
      watchedRun({
        session_id: "other-workspace",
        workspace: "/workspace/docs",
        name: "Documentation",
        status: "completed",
      }),
    ]);

    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      provider: "openai",
      workspace: "/workspace/checkout",
      metrics: {
        total: 3,
        completed: 1,
        blocked: 1,
        successRate: 33,
      },
    });
  });

  it("selects the most recently updated active run as current before newer completed history", () => {
    const agent = buildHexaAgentOverview([
      watchedRun({ session_id: "finished-now", status: "completed", updated_at: "2026-07-14T10:00:00.000Z" }),
      watchedRun({ session_id: "working-earlier", status: "working", updated_at: "2026-07-14T09:00:00.000Z" }),
      watchedRun({ session_id: "blocked-old", status: "blocked", updated_at: "2026-07-14T08:00:00.000Z" }),
    ])[0]!;

    expect(agent.currentRun?.session_id).toBe("working-earlier");
    expect(agent.online).toBe(true);
    expect(agent.currentStatus).toBe("working");
  });

  it("keeps the newest blocked run current so an intervention is not hidden by older work", () => {
    const agent = buildHexaAgentOverview([
      watchedRun({ session_id: "working-old", status: "working", updated_at: "2026-07-14T08:00:00.000Z" }),
      watchedRun({ session_id: "blocked-now", status: "blocked", updated_at: "2026-07-14T09:00:00.000Z" }),
    ])[0]!;

    expect(agent.currentRun?.session_id).toBe("blocked-now");
    expect(agent.online).toBe(false);
    expect(agent.currentStatus).toBe("blocked");
  });

  it("orders Agents and recent run history by updated-at heartbeat", () => {
    const agents = buildHexaAgentOverview([
      watchedRun({ session_id: "older-history", status: "completed", updated_at: "2026-07-10T08:00:00.000Z" }),
      watchedRun({ session_id: "newer-history", status: "blocked", updated_at: "2026-07-12T08:00:00.000Z" }),
      watchedRun({
        session_id: "most-recent-agent",
        workspace: "/workspace/api",
        name: "API migration",
        updated_at: "2026-07-15T08:00:00.000Z",
      }),
    ]);

    expect(agents.map((agent) => agent.workspace)).toEqual(["/workspace/api", "/workspace/checkout"]);
    expect(agents[1]!.recentRuns.map((run) => run.session_id)).toEqual(["newer-history", "older-history"]);
  });
});
