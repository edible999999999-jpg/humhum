import { describe, expect, it } from "vitest";
import type {
  HexaSupervisorSession,
  HexaWatchedAgent,
  HexaWatchedSession,
} from "./useHexaData";
import { buildHexaAgentOverview, selectNeedFitSessions } from "./hexaAgentOverview";

function watchedRun(overrides: Partial<HexaWatchedSession>): HexaWatchedSession {
  const base: HexaWatchedSession = {
    session_id: "run-1",
    agent: "codex",
    name: "Run display name",
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
    audit: {
      goal_revisions: [],
      success_criteria: [],
      work_items: [],
      milestones: [],
      important_outputs: [],
      interventions: [],
      hexa_review: null,
      user_review: null,
    },
  };
  return { ...base, ...overrides, audit: overrides.audit ?? base.audit };
}

function watchedAgent(overrides: Partial<HexaWatchedAgent> = {}): HexaWatchedAgent {
  return {
    key: "durable-agent-key",
    provider: "openai",
    name: "Durable Agent Name",
    workspace: "/workspace/checkout",
    created_at: "2026-07-10T08:00:00.000Z",
    updated_at: "2026-07-14T08:05:00.000Z",
    runs: [watchedRun({})],
    ...overrides,
  };
}

function supervisorSession(
  sessionId: string,
  source: HexaSupervisorSession["source"],
  status: HexaSupervisorSession["session"]["status"],
  score: number,
): HexaSupervisorSession {
  return {
    session: { session_id: sessionId, status },
    source,
    recent_need_score: score,
  } as HexaSupervisorSession;
}

describe("buildHexaAgentOverview", () => {
  it("preserves durable Agent identity and display metadata while aggregating its runs", () => {
    const agent = buildHexaAgentOverview([
      watchedAgent({
        key: "rust-agent-key",
        name: "Rust-owned Agent name",
        provider: "openai-codex",
        workspace: "/workspace/durable",
        runs: [
          watchedRun({ session_id: "run-active", name: "stale run name" }),
          watchedRun({ session_id: "run-complete", status: "completed", updated_at: "2026-07-13T08:05:00.000Z" }),
          watchedRun({ session_id: "run-blocked", status: "blocked", updated_at: "2026-07-12T08:05:00.000Z" }),
        ],
      }),
    ])[0]!;

    expect(agent).toMatchObject({
      id: "rust-agent-key",
      name: "Rust-owned Agent name",
      provider: "openai-codex",
      workspace: "/workspace/durable",
      metrics: {
        total: 3,
        completed: 1,
        blocked: 1,
        successRate: 33,
      },
    });
  });

  it("uses the latest non-completed run heartbeat instead of a fresh completion for presence", () => {
    const now = Date.parse("2026-07-14T10:05:00.000Z");
    const agent = buildHexaAgentOverview([
      watchedAgent({
        updated_at: "2026-07-14T10:00:00.000Z",
        runs: [
          watchedRun({ session_id: "finished-now", status: "completed", updated_at: "2026-07-14T10:00:00.000Z" }),
          watchedRun({ session_id: "working-earlier", status: "working", updated_at: "2026-07-14T09:00:00.000Z" }),
        ],
      }),
    ], { now })[0]!;

    expect(agent.currentRun?.session_id).toBe("working-earlier");
    expect(agent.lastHeartbeat).toBe("2026-07-14T09:00:00.000Z");
    expect(agent.online).toBe(false);
    expect(agent.currentStatus).toBe("working");
  });

  it("keeps the newest blocked run current and online when its heartbeat is fresh", () => {
    const now = Date.parse("2030-01-01T10:00:00.000Z");
    const agent = buildHexaAgentOverview([
      watchedAgent({
        updated_at: "2030-01-01T09:55:00.000Z",
        runs: [
          watchedRun({ session_id: "working-old", status: "working", updated_at: "2030-01-01T09:40:00.000Z" }),
          watchedRun({ session_id: "blocked-now", status: "blocked", updated_at: "2030-01-01T09:55:00.000Z" }),
        ],
      }),
    ], { now })[0]!;

    expect(agent.currentRun?.session_id).toBe("blocked-now");
    expect(agent.online).toBe(true);
    expect(agent.currentStatus).toBe("blocked");
  });

  it("keeps a completed-only Agent offline with no current run", () => {
    const now = Date.parse("2030-01-01T10:00:00.000Z");
    const agent = buildHexaAgentOverview([
      watchedAgent({
        updated_at: "2030-01-01T09:59:00.000Z",
        runs: [watchedRun({ status: "completed", updated_at: "2030-01-01T09:59:00.000Z" })],
      }),
    ], { now })[0]!;

    expect(agent).toMatchObject({
      online: false,
      currentRun: null,
      currentStatus: "offline",
      lastHeartbeat: null,
    });
  });

  it("uses the inclusive 10-minute heartbeat boundary", () => {
    const now = Date.parse("2030-01-01T10:00:00.000Z");
    const agents = buildHexaAgentOverview([
      watchedAgent({
        key: "fresh",
        updated_at: "2030-01-01T09:50:00.000Z",
        runs: [watchedRun({ session_id: "waiting-fresh", status: "waiting", updated_at: "2030-01-01T09:50:00.000Z" })],
      }),
      watchedAgent({
        key: "stale",
        workspace: "/workspace/stale",
        updated_at: "2030-01-01T09:49:59.999Z",
        runs: [watchedRun({ session_id: "working-stale", status: "working", updated_at: "2030-01-01T09:49:59.999Z" })],
      }),
    ], { now });

    expect(agents.find((agent) => agent.id === "fresh")).toMatchObject({ online: true, currentStatus: "waiting" });
    expect(agents.find((agent) => agent.id === "stale")).toMatchObject({ online: false, currentStatus: "working" });
  });

  it("orders Agents by durable updated-at and recent run history by heartbeat", () => {
    const agents = buildHexaAgentOverview([
      watchedAgent({
        key: "older-agent",
        updated_at: "2026-07-12T08:00:00.000Z",
        runs: [
          watchedRun({ session_id: "older-history", status: "completed", updated_at: "2026-07-10T08:00:00.000Z" }),
          watchedRun({ session_id: "newer-history", status: "blocked", updated_at: "2026-07-12T08:00:00.000Z" }),
        ],
      }),
      watchedAgent({
        key: "newer-agent",
        updated_at: "2026-07-15T08:00:00.000Z",
        runs: [watchedRun({ session_id: "most-recent-agent", updated_at: "2026-07-15T08:00:00.000Z" })],
      }),
    ]);

    expect(agents.map((agent) => agent.id)).toEqual(["newer-agent", "older-agent"]);
    expect(agents[1]!.recentRuns.map((run) => run.session_id)).toEqual(["newer-history", "older-history"]);
  });

  it("keeps aggregate metrics for every durable run while limiting rendered history to the newest six", () => {
    const runs = Array.from({ length: 8 }, (_, index) => watchedRun({
      session_id: `run-${index + 1}`,
      status: "completed",
      updated_at: `2030-01-01T00:0${index}:00.000Z`,
    }));

    const agent = buildHexaAgentOverview([
      watchedAgent({ updated_at: "2030-01-01T00:07:00.000Z", runs }),
    ], { now: Date.parse("2030-01-01T01:00:00.000Z") })[0]!;

    expect(agent.metrics).toEqual({ total: 8, completed: 8, blocked: 0, successRate: 100 });
    expect(agent.recentRuns).toHaveLength(6);
    expect(agent.recentRuns.map((run) => run.session_id)).toEqual([
      "run-8",
      "run-7",
      "run-6",
      "run-5",
      "run-4",
      "run-3",
    ]);
  });
});

describe("selectNeedFitSessions", () => {
  it("uses one current watched run per Agent plus current discovered sessions", () => {
    const agents = buildHexaAgentOverview([
      watchedAgent({
        runs: [
          watchedRun({ session_id: "watched-current", status: "working" }),
          watchedRun({ session_id: "watched-history", status: "completed", updated_at: "2026-07-13T08:00:00.000Z" }),
        ],
      }),
    ]);
    const sessions = [
      supervisorSession("watched-current", "watched", "active", 76),
      supervisorSession("watched-history", "watched", "completed", 88),
      supervisorSession("discovered-current", "hook", "active", 64),
      supervisorSession("discovered-history", "hook", "completed", 98),
    ];

    expect(selectNeedFitSessions(agents, sessions).map((item) => item.session.session_id)).toEqual([
      "watched-current",
      "discovered-current",
    ]);
  });
});
