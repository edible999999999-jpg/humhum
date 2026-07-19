import type { HexaEvidenceInput, HexaEvidenceRef, HexaWatchedSession } from "./useHexaData";

export type HexaAgentSurface =
  | "codex_desktop"
  | "codex_cli"
  | "qoder_ide"
  | "qoder_cli"
  | "qoder_worker"
  | "terminal"
  | "remote_worker"
  | "unknown";

export type HexaAttemptResultStatus =
  | "unverified"
  | "verified"
  | "failed"
  | "superseded"
  | "accepted";

export type HexaGoalStatus = "active" | "waiting" | "completed";

export interface HexaGoalAttempt {
  session_id: string;
  agent_family: string;
  surface: HexaAgentSurface;
  workspace: string | null;
  branch: string | null;
  worktree: string | null;
  result_status: HexaAttemptResultStatus;
  evidence: HexaEvidenceRef[];
  linked_at: string;
  completed_at: string | null;
}

export interface HexaDevelopmentGoal {
  id: string;
  project_key: string;
  title: string;
  success_criteria: string[];
  status: HexaGoalStatus;
  attempts: HexaGoalAttempt[];
  accepted_attempt_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface HexaGoalLinkRequest {
  goal_id: string | null;
  project_key: string;
  title: string;
  success_criteria: string[];
  session_id: string;
  surface: HexaAgentSurface;
  branch: string | null;
  worktree: string | null;
}

export interface HexaAttemptResultRequest {
  goal_id: string;
  session_id: string;
  result_status: HexaAttemptResultStatus;
  evidence: HexaEvidenceInput[];
}

export interface HexaGoalAcceptRequest {
  goal_id: string;
  session_id: string;
}

export interface HexaGoalAttemptContext {
  agent_family: string;
  workspace: string | null;
}

export interface HexaMonitoringGoalEntry {
  kind: "goal";
  key: string;
  goal: HexaDevelopmentGoal;
  attempts: Array<{ attempt: HexaGoalAttempt; session: HexaWatchedSession }>;
  updatedAt: string;
}

export interface HexaMonitoringSessionEntry {
  kind: "session";
  key: string;
  sessionId: string;
  session: HexaWatchedSession;
  updatedAt: string;
}

export type HexaMonitoringEntry = HexaMonitoringGoalEntry | HexaMonitoringSessionEntry;

export interface HexaMonitoringProject {
  key: string;
  label: string;
  workspace: string | null;
  entries: HexaMonitoringEntry[];
  updatedAt: string;
}

export interface HexaGoalSummaryAttempt {
  attempt: HexaGoalAttempt;
  session: HexaWatchedSession | null;
}

export interface HexaGoalSummary {
  goal: HexaDevelopmentGoal;
  attempts: HexaGoalSummaryAttempt[];
  counts: {
    total: number;
    working: number;
    verified: number;
    failed: number;
    blocked: number;
    unverified: number;
  };
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function workspaceLabel(workspace: string | null): string {
  if (!workspace) return "未报告工作区";
  const parts = workspace.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? workspace;
}

function sessionProjectKey(session: HexaWatchedSession): string {
  return session.workspace ?? "__unknown_workspace__";
}

function compareSessions(left: HexaWatchedSession, right: HexaWatchedSession): number {
  const leftCompleted = left.status === "completed" ? 1 : 0;
  const rightCompleted = right.status === "completed" ? 1 : 0;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  return timestamp(right.updated_at) - timestamp(left.updated_at);
}

function compareEntries(left: HexaMonitoringEntry, right: HexaMonitoringEntry): number {
  const leftCompleted = entryIsCompleted(left) ? 1 : 0;
  const rightCompleted = entryIsCompleted(right) ? 1 : 0;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  return timestamp(right.updatedAt) - timestamp(left.updatedAt);
}

function entryIsCompleted(entry: HexaMonitoringEntry): boolean {
  if (entry.kind === "session") return entry.session.status === "completed";
  return entry.goal.status === "completed"
    || (entry.attempts.length > 0 && entry.attempts.every(({ session }) => session.status === "completed"));
}

function latestTimestamp(values: string[]): string {
  return values.reduce((latest, value) => timestamp(value) > timestamp(latest) ? value : latest, "");
}

function goalEntry(goal: HexaDevelopmentGoal, sessionsById: Map<string, HexaWatchedSession>): HexaMonitoringGoalEntry | null {
  const attempts = goal.attempts
    .flatMap((attempt) => {
      const session = sessionsById.get(attempt.session_id);
      return session ? [{ attempt, session }] : [];
    })
    .sort((left, right) => compareSessions(left.session, right.session));

  return {
    kind: "goal",
    key: goal.id,
    goal,
    attempts,
    updatedAt: latestTimestamp([goal.updated_at, ...attempts.map(({ session }) => session.updated_at)]),
  };
}

function compareSummaryAttempts(left: HexaGoalSummaryAttempt, right: HexaGoalSummaryAttempt): number {
  if (left.session && right.session) return compareSessions(left.session, right.session);
  if (left.session) return -1;
  if (right.session) return 1;
  return timestamp(right.attempt.linked_at) - timestamp(left.attempt.linked_at);
}

export function buildActiveMonitoringProjects(
  sessions: HexaWatchedSession[],
  goals: HexaDevelopmentGoal[],
): HexaMonitoringProject[] {
  const sessionsById = new Map(sessions.map((session) => [session.session_id, session]));
  const linkedSessionIds = new Set<string>();
  const entriesByProject = new Map<string, HexaMonitoringEntry[]>();

  for (const goal of goals) {
    const entry = goalEntry(goal, sessionsById);
    if (!entry) continue;
    for (const { session } of entry.attempts) linkedSessionIds.add(session.session_id);
    entriesByProject.set(goal.project_key, [...(entriesByProject.get(goal.project_key) ?? []), entry]);
  }

  for (const session of sessions) {
    if (linkedSessionIds.has(session.session_id)) continue;
    const projectKey = sessionProjectKey(session);
    const entry: HexaMonitoringSessionEntry = {
      kind: "session",
      key: session.session_id,
      sessionId: session.session_id,
      session,
      updatedAt: session.updated_at,
    };
    entriesByProject.set(projectKey, [...(entriesByProject.get(projectKey) ?? []), entry]);
  }

  return Array.from(entriesByProject, ([key, projectEntries]) => {
    const entries = [...projectEntries].sort(compareEntries);
    const workspace = entries.find((entry) => entry.kind === "session")?.session.workspace
      ?? entries.find((entry) => entry.kind === "goal")?.attempts[0]?.session.workspace
      ?? entries.find((entry) => entry.kind === "goal")?.goal.attempts[0]?.workspace
      ?? null;
    return {
      key,
      label: workspaceLabel(workspace),
      workspace,
      entries,
      updatedAt: latestTimestamp(entries.map((entry) => entry.updatedAt)),
    };
  }).sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
}

export function buildGoalSummary(
  goal: HexaDevelopmentGoal,
  sessions: HexaWatchedSession[],
): HexaGoalSummary {
  const sessionsById = new Map(sessions.map((session) => [session.session_id, session]));
  const attempts = goal.attempts.map((attempt) => ({
    attempt,
    session: sessionsById.get(attempt.session_id) ?? null,
  })).sort(compareSummaryAttempts);
  const counts: HexaGoalSummary["counts"] = {
    total: attempts.length,
    working: 0,
    verified: 0,
    failed: 0,
    blocked: 0,
    unverified: 0,
  };

  for (const { attempt, session } of attempts) {
    if (attempt.result_status === "verified" || attempt.result_status === "accepted") {
      counts.verified += 1;
    } else if (attempt.result_status === "failed") {
      counts.failed += 1;
    } else if (attempt.result_status === "superseded") {
      continue;
    } else if (session?.status === "blocked" || session?.status === "waiting") {
      counts.blocked += 1;
    } else if (session && session.status !== "completed" && !attempt.completed_at) {
      counts.working += 1;
    } else {
      counts.unverified += 1;
    }
  }

  return { goal, attempts, counts };
}
