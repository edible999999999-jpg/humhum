import type {
  HexaSupervisorSession,
  HexaWatchedAgent,
  HexaWatchedSession,
} from "./useHexaData";

export interface HexaAgentMetrics {
  total: number;
  completed: number;
  blocked: number;
  successRate: number;
}

export interface HexaAgentOverview {
  id: string;
  name: string;
  provider: string;
  workspace: string | null;
  online: boolean;
  currentStatus: HexaWatchedSession["status"] | "offline";
  currentRun: HexaWatchedSession | null;
  lastHeartbeat: string | null;
  metrics: HexaAgentMetrics;
  recentRuns: HexaWatchedSession[];
}

export interface HexaAgentOverviewOptions {
  now?: number;
}

const ONLINE_HEARTBEAT_WINDOW_MS = 10 * 60 * 1000;
const RECENT_RUN_LIMIT = 6;

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isHeartbeatFresh(updatedAt: string | null, now: number): boolean {
  if (!updatedAt) return false;
  const age = now - timestamp(updatedAt);
  return Number.isFinite(age) && age >= 0 && age <= ONLINE_HEARTBEAT_WINDOW_MS;
}

export function buildHexaAgentOverview(
  agents: HexaWatchedAgent[],
  { now = Date.now() }: HexaAgentOverviewOptions = {},
): HexaAgentOverview[] {
  return [...agents]
    .sort((left, right) => timestamp(right.updated_at) - timestamp(left.updated_at))
    .map((agent): HexaAgentOverview => {
      const orderedRuns = [...agent.runs].sort(
        (left, right) => timestamp(right.updated_at) - timestamp(left.updated_at),
      );
      const currentRun = orderedRuns.find((run) => run.status !== "completed") ?? null;
      const completed = orderedRuns.filter((run) => run.status === "completed").length;
      const blocked = orderedRuns.filter((run) => run.status === "blocked").length;
      const lastHeartbeat = currentRun?.updated_at ?? null;

      return {
        id: agent.key,
        name: agent.name,
        provider: agent.provider,
        workspace: agent.workspace,
        online: isHeartbeatFresh(lastHeartbeat, now),
        currentStatus: currentRun?.status ?? "offline",
        currentRun,
        lastHeartbeat,
        metrics: {
          total: orderedRuns.length,
          completed,
          blocked,
          successRate: orderedRuns.length === 0 ? 0 : Math.round((completed / orderedRuns.length) * 100),
        },
        recentRuns: orderedRuns.slice(0, RECENT_RUN_LIMIT),
      };
    });
}

export function selectNeedFitSessions(
  agents: HexaAgentOverview[],
  sessions: HexaSupervisorSession[],
): HexaSupervisorSession[] {
  const currentWatchedRunIds = new Set(
    agents.flatMap((agent) => agent.currentRun ? [agent.currentRun.session_id] : []),
  );

  return sessions.filter((item) => item.source === "watched"
    ? currentWatchedRunIds.has(item.session.session_id)
    : item.session.status !== "completed");
}
