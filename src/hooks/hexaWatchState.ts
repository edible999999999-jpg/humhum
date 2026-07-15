export type WatchDataState = "loading" | "ready" | "error";

export interface WatchRefresh<T> {
  data: T | null;
  state: WatchDataState;
  error: unknown | null;
}

export interface OrderedWatchRefresh<T> {
  applied: boolean;
  refresh: WatchRefresh<T> | null;
}

export function resolveWatchRefresh<T>(
  previous: WatchRefresh<T> | null,
  result: PromiseSettledResult<T>,
): WatchRefresh<T> {
  if (result.status === "fulfilled") {
    return { data: result.value, state: "ready", error: null };
  }

  return {
    data: previous?.data ?? null,
    state: "error",
    error: result.reason,
  };
}

export function resolveOrderedWatchRefresh<T>(
  previous: WatchRefresh<T> | null,
  result: PromiseSettledResult<T>,
  requestGeneration: number,
  currentGeneration: number,
): OrderedWatchRefresh<T> {
  if (requestGeneration !== currentGeneration) {
    return { applied: false, refresh: previous };
  }

  return {
    applied: true,
    refresh: resolveWatchRefresh(previous, result),
  };
}
