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

const ACTIVE_STATUSES = new Set<HexaWatchedSession["status"]>([
  "starting",
  "working",
  "waiting",
  "idle",
]);

function agentIdentity(run: HexaWatchedSession): string {
  return `${run.provider}\u0000${run.workspace ?? ""}`;
}

function updatedAtTime(run: HexaWatchedSession): number {
  const timestamp = new Date(run.updated_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function buildHexaAgentOverview(runs: HexaWatchedSession[]): HexaAgentOverview[] {
  const runsByAgent = new Map<string, HexaWatchedSession[]>();

  for (const run of runs) {
    const identity = agentIdentity(run);
    runsByAgent.set(identity, [...(runsByAgent.get(identity) ?? []), run]);
  }

  return [...runsByAgent.entries()]
    .map(([id, groupedRuns]): HexaAgentOverview => {
      const recentRuns = [...groupedRuns].sort((left, right) => updatedAtTime(right) - updatedAtTime(left));
      const currentRun = recentRuns.find((run) => run.status !== "completed") ?? recentRuns[0] ?? null;
      const newestRun = recentRuns[0] ?? null;
      const completed = recentRuns.filter((run) => run.status === "completed").length;
      const blocked = recentRuns.filter((run) => run.status === "blocked").length;
      const currentStatus: HexaAgentOverview["currentStatus"] = currentRun?.status ?? "offline";

      return {
        id,
        name: currentRun?.name ?? newestRun?.name ?? "Watched Agent",
        provider: newestRun?.provider ?? "unknown",
        workspace: newestRun?.workspace ?? null,
        online: currentRun ? ACTIVE_STATUSES.has(currentRun.status) : false,
        currentStatus,
        currentRun,
        lastHeartbeat: newestRun?.updated_at ?? null,
        metrics: {
          total: recentRuns.length,
          completed,
          blocked,
          successRate: recentRuns.length === 0 ? 0 : Math.round((completed / recentRuns.length) * 100),
        },
        recentRuns,
      };
    })
    .sort((left, right) => {
      const leftTime = left.lastHeartbeat ? new Date(left.lastHeartbeat).getTime() : 0;
      const rightTime = right.lastHeartbeat ? new Date(right.lastHeartbeat).getTime() : 0;
      return rightTime - leftTime;
    });
}
