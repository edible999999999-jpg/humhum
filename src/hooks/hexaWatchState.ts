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

export type HookLifecycleStatus = "active" | "idle" | "completed";
export type WatchedLifecycleStatus = "starting" | "working" | "waiting" | "idle" | "completed" | "blocked";

export interface LifecycleAlert {
  session_id: string;
  type: "stalled" | "looping" | "permission" | "low_signal";
  message: string;
}

export interface WatchedLifecycle {
  session_id: string;
  status: WatchedLifecycleStatus;
  blocked_reason: string | null;
}

export interface WatchDeleteState {
  pending: boolean;
  error: string | null;
}

export type WatchDeleteAction =
  | { type: "start" }
  | { type: "success" }
  | { type: "failure"; error: string };

export const initialWatchDeleteState: WatchDeleteState = {
  pending: false,
  error: null,
};

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

export function applyWatchedLifecycle<T extends { status: HookLifecycleStatus }>(
  session: T,
  watchedStatus: WatchedLifecycleStatus,
): Omit<T, "status"> & { status: HookLifecycleStatus } {
  const status: HookLifecycleStatus = watchedStatus === "completed"
    ? "completed"
    : watchedStatus === "idle"
      ? "idle"
      : "active";
  return { ...session, status };
}

export function partitionSupervisorSessions<T extends { session: { status: HookLifecycleStatus } }>(
  sessions: T[],
): { active: T[]; completed: T[] } {
  return {
    active: sessions.filter((item) => item.session.status !== "completed"),
    completed: sessions.filter((item) => item.session.status === "completed"),
  };
}

export function resolveWatchedLifecycleAlerts(
  detectedAlerts: LifecycleAlert[],
  watched: WatchedLifecycle,
): LifecycleAlert[] {
  const alerts = detectedAlerts.filter((alert) => alert.type === "permission");
  if (watched.status === "blocked") {
    alerts.push({
      session_id: watched.session_id,
      type: "stalled",
      message: watched.blocked_reason ?? "Agent reported a blocked watched run",
    });
  }
  return alerts;
}

export function watchDeleteReducer(
  _state: WatchDeleteState,
  action: WatchDeleteAction,
): WatchDeleteState {
  switch (action.type) {
    case "start":
      return { pending: true, error: null };
    case "failure":
      return { pending: false, error: action.error };
    case "success":
      return initialWatchDeleteState;
  }
}
