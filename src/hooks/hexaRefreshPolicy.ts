export const WATCHED_REFRESH_INTERVAL_MS = 20_000;

type WatchedAgentLike = {
  runs: Array<{ status: string }>;
};

export function hasPollableWatchedRun(agents: WatchedAgentLike[]): boolean {
  return agents.some((agent) => agent.runs.some((run) => run.status !== "completed"));
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
