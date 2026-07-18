export const WATCHED_REFRESH_INTERVAL_MS = 20_000;

import { watchedSessionIsExpired } from "./hexaPlanningCapability";

type WatchedAgentLike = {
  runs: Array<{ status: string; updated_at: string }>;
};

const ACTIVE_WATCHED_STATUSES = new Set(["starting", "working", "waiting", "idle", "blocked"]);

export function hasPollableWatchedRun(
  agents: WatchedAgentLike[],
  now = Date.now(),
): boolean {
  return agents.some((agent) => agent.runs.some((run) => (
    ACTIVE_WATCHED_STATUSES.has(run.status)
    && !watchedSessionIsExpired(run.status, run.updated_at, now)
  )));
}

export type WatchedRefreshAction = "poll" | "render_expired" | "idle";

export function watchedRefreshAction(
  agents: WatchedAgentLike[],
  expiredTransitionRendered: boolean,
  now = Date.now(),
): WatchedRefreshAction {
  if (hasPollableWatchedRun(agents, now)) return "poll";
  const hasDisconnectedActiveRun = agents.some((agent) => agent.runs.some(
    (run) => ACTIVE_WATCHED_STATUSES.has(run.status),
  ));
  if (hasDisconnectedActiveRun && !expiredTransitionRendered) return "render_expired";
  return "idle";
}

export function createCoalescedRefresh(
  operation: () => Promise<void>,
): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued = false;

  return () => {
    if (running) {
      queued = true;
      return running;
    }

    running = (async () => {
      do {
        queued = false;
        await operation();
      } while (queued);
    })().finally(() => {
      running = null;
    });

    return running;
  };
}
