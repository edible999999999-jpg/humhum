import type { HexaWatchedSession } from "./useHexaData";

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

function agentIdentity(run: HexaWatchedSession): string {
  return `${run.provider}\u0000${run.workspace ?? ""}`;
}

function updatedAtTime(run: HexaWatchedSession): number {
  const timestamp = new Date(run.updated_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isHeartbeatFresh(updatedAt: string | null, now: number): boolean {
  if (!updatedAt) return false;
  const heartbeatTime = new Date(updatedAt).getTime();
  const age = now - heartbeatTime;
  return Number.isFinite(age) && age >= 0 && age <= ONLINE_HEARTBEAT_WINDOW_MS;
}

export function buildHexaAgentOverview(
  runs: HexaWatchedSession[],
  { now = Date.now() }: HexaAgentOverviewOptions = {},
): HexaAgentOverview[] {
  const runsByAgent = new Map<string, HexaWatchedSession[]>();

  for (const run of runs) {
    const identity = agentIdentity(run);
    runsByAgent.set(identity, [...(runsByAgent.get(identity) ?? []), run]);
  }

  return [...runsByAgent.entries()]
    .map(([id, groupedRuns]): HexaAgentOverview => {
      const orderedRuns = [...groupedRuns].sort((left, right) => updatedAtTime(right) - updatedAtTime(left));
      const currentRun = orderedRuns.find((run) => run.status !== "completed") ?? orderedRuns[0] ?? null;
      const newestRun = orderedRuns[0] ?? null;
      const completed = orderedRuns.filter((run) => run.status === "completed").length;
      const blocked = orderedRuns.filter((run) => run.status === "blocked").length;
      const currentStatus: HexaAgentOverview["currentStatus"] = currentRun?.status ?? "offline";

      return {
        id,
        name: currentRun?.name ?? newestRun?.name ?? "Watched Agent",
        provider: newestRun?.provider ?? "unknown",
        workspace: newestRun?.workspace ?? null,
        online: isHeartbeatFresh(newestRun?.updated_at ?? null, now),
        currentStatus,
        currentRun,
        lastHeartbeat: newestRun?.updated_at ?? null,
        metrics: {
          total: orderedRuns.length,
          completed,
          blocked,
          successRate: orderedRuns.length === 0 ? 0 : Math.round((completed / orderedRuns.length) * 100),
        },
        recentRuns: orderedRuns.slice(0, RECENT_RUN_LIMIT),
      };
    })
    .sort((left, right) => {
      const leftTime = left.lastHeartbeat ? new Date(left.lastHeartbeat).getTime() : 0;
      const rightTime = right.lastHeartbeat ? new Date(right.lastHeartbeat).getTime() : 0;
      return rightTime - leftTime;
    });
}
