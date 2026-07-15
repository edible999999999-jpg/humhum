export type WatchDataState = "loading" | "ready" | "error";

export interface WatchRefresh<T> {
  data: T | null;
  state: WatchDataState;
  error: unknown | null;
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
