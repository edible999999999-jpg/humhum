import { describe, expect, it } from "vitest";
import type { HexaWatchedSession } from "./useHexaData";
import {
  buildActiveMonitoringProjects,
  buildGoalSummary,
  type HexaAgentSurface,
  type HexaAttemptResultStatus,
  type HexaDevelopmentGoal,
  type HexaGoalAttempt,
} from "./hexaGoalMonitoring";

function watchedSession(overrides: Partial<HexaWatchedSession> = {}): HexaWatchedSession {
  const audit: HexaWatchedSession["audit"] = {
    goal_revisions: [],
    success_criteria: [],
    work_items: [],
    milestones: [],
    important_outputs: [],
    interventions: [],
    hexa_review: null,
    user_review: null,
  };

  const base: HexaWatchedSession = {
    session_id: "session-1",
    agent: "codex",
    name: "Goal attempt",
    provider: "codex",
    workspace: "/workspace/humhum",
    goal: "Ship goal monitoring",
    status: "working",
    current_step: "Implementing the selector",
    blocked_reason: null,
    need_user: false,
    confidence: "agent-bound",
    started_at: "2026-07-19T08:00:00.000Z",
    updated_at: "2026-07-19T09:00:00.000Z",
    audit,
  };
  return { ...base, ...overrides, audit: overrides.audit ?? audit };
}

function attempt(
  sessionId: string,
  agentFamily: string,
  surface: HexaAgentSurface,
  resultStatus: HexaAttemptResultStatus = "unverified",
): HexaGoalAttempt {
  return {
    session_id: sessionId,
    agent_family: agentFamily,
    surface,
    workspace: "/workspace/humhum",
    branch: null,
    worktree: null,
    result_status: resultStatus,
    evidence: [],
    linked_at: "2026-07-19T08:30:00.000Z",
    completed_at: resultStatus === "unverified" ? null : "2026-07-19T09:30:00.000Z",
  };
}

function developmentGoal(overrides: Partial<HexaDevelopmentGoal> = {}): HexaDevelopmentGoal {
  return {
    id: "goal-1",
    project_key: "/workspace/humhum",
    title: "Ship goal monitoring",
    success_criteria: ["Focused tests pass"],
    status: "active",
    attempts: [],
    accepted_attempt_id: null,
    created_at: "2026-07-19T08:00:00.000Z",
    updated_at: "2026-07-19T09:00:00.000Z",
    ...overrides,
  };
}

describe("Hexa goal monitoring selectors", () => {
  it("keeps one unlinked session as the existing independent row", () => {
    const projects = buildActiveMonitoringProjects([watchedSession()], []);

    expect(projects[0]?.entries).toEqual([
      expect.objectContaining({ kind: "session", sessionId: "session-1" }),
    ]);
  });

  it("groups linked Codex and Qoder Worker attempts without merging reports", () => {
    const sessions = [
      watchedSession({ session_id: "codex-1", provider: "codex" }),
      watchedSession({ session_id: "worker-1", provider: "qoder" }),
    ];
    const goals = [developmentGoal({
      attempts: [
        attempt("codex-1", "codex", "codex_desktop"),
        attempt("worker-1", "qoder", "qoder_worker"),
      ],
    })];

    const projects = buildActiveMonitoringProjects(sessions, goals);
    const entry = projects[0]?.entries[0];

    expect(entry?.kind).toBe("goal");
    if (!entry || entry.kind !== "goal") throw new Error("expected goal");
    expect(entry.attempts.map((item) => item.session.session_id)).toEqual(["codex-1", "worker-1"]);
  });

  it("keeps active attempts ahead of completed attempts and orders each state newest first", () => {
    const sessions = [
      watchedSession({ session_id: "completed-newest", status: "completed", updated_at: "2026-07-19T12:00:00.000Z" }),
      watchedSession({ session_id: "working-older", updated_at: "2026-07-19T09:00:00.000Z" }),
      watchedSession({ session_id: "working-newest", updated_at: "2026-07-19T10:00:00.000Z" }),
    ];
    const [project] = buildActiveMonitoringProjects(sessions, [developmentGoal({
      attempts: [
        attempt("completed-newest", "codex", "codex_desktop"),
        attempt("working-older", "qoder", "qoder_cli"),
        attempt("working-newest", "qoder", "qoder_worker"),
      ],
    })]);
    const entry = project?.entries[0];

    expect(entry?.kind).toBe("goal");
    if (!entry || entry.kind !== "goal") throw new Error("expected goal");
    expect(entry.attempts.map((item) => item.session.session_id)).toEqual([
      "working-newest",
      "working-older",
      "completed-newest",
    ]);
  });

  it("keeps orphan-only goals reachable without hiding independent sessions", () => {
    const projects = buildActiveMonitoringProjects(
      [watchedSession({ session_id: "session-1" })],
      [developmentGoal({ attempts: [attempt("missing", "qoder", "qoder_worker")] })],
    );

    expect(projects.flatMap((project) => project.entries)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "goal", key: "goal-1", attempts: [] }),
      expect.objectContaining({ kind: "session", sessionId: "session-1" }),
    ]));
  });

  it("treats completed-without-evidence as unverified", () => {
    const summary = buildGoalSummary(
      developmentGoal({
        attempts: [attempt("session-1", "codex", "codex_desktop", "unverified")],
      }),
      [watchedSession({ session_id: "session-1", status: "completed" })],
    );

    expect(summary.counts).toEqual({
      total: 1,
      working: 0,
      verified: 0,
      failed: 0,
      blocked: 0,
      unverified: 1,
    });
  });

  it("separates blocked attempts and never calls superseded history unverified", () => {
    const summary = buildGoalSummary(developmentGoal({
      attempts: [
        attempt("blocked", "qoder", "qoder_worker"),
        attempt("superseded", "codex", "codex_desktop", "superseded"),
      ],
    }), [
      watchedSession({ session_id: "blocked", status: "blocked" }),
      watchedSession({ session_id: "superseded", status: "completed" }),
    ]);

    expect(summary.counts).toEqual({
      total: 2,
      working: 0,
      verified: 0,
      failed: 0,
      blocked: 1,
      unverified: 0,
    });
  });

  it("keeps summary attempts active-first while retaining unavailable history", () => {
    const summary = buildGoalSummary(developmentGoal({
      attempts: [
        { ...attempt("missing", "qoder", "qoder_worker"), linked_at: "2026-07-19T11:00:00.000Z" },
        attempt("completed", "codex", "codex_desktop"),
        attempt("working", "qoder", "qoder_cli"),
      ],
    }), [
      watchedSession({ session_id: "completed", status: "completed", updated_at: "2026-07-19T12:00:00.000Z" }),
      watchedSession({ session_id: "working", updated_at: "2026-07-19T10:00:00.000Z" }),
    ]);

    expect(summary.attempts.map((item) => item.attempt.session_id)).toEqual([
      "working",
      "completed",
      "missing",
    ]);
    expect(summary.attempts[2]?.session).toBeNull();
  });
});
