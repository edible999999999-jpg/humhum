import { describe, expect, it } from "vitest";
import {
  applyWatchedLifecycle,
  initialWatchDeleteState,
  partitionSupervisorSessions,
  resolveOrderedWatchRefresh,
  resolveWatchedLifecycleAlerts,
  resolveWatchRefresh,
  watchDeleteReducer,
  type WatchRefresh,
} from "./hexaWatchState";

describe("resolveWatchRefresh", () => {
  it("replaces the previous watched-session snapshot after a fulfilled refresh", () => {
    const previous: WatchRefresh<string[]> = {
      data: ["previous-session"],
      state: "ready",
      error: null,
    };

    const resolved = resolveWatchRefresh(previous, {
      status: "fulfilled",
      value: ["current-session"],
    });

    expect(resolved).toEqual({
      data: ["current-session"],
      state: "ready",
      error: null,
    });
  });

  it("preserves the last successful watched-session snapshot after a rejected refresh", () => {
    const previous: WatchRefresh<string[]> = {
      data: ["last-successful-session"],
      state: "ready",
      error: null,
    };
    const failure = new Error("watch command unavailable");

    const resolved = resolveWatchRefresh(previous, {
      status: "rejected",
      reason: failure,
    });

    expect(resolved).toEqual({
      data: ["last-successful-session"],
      state: "error",
      error: failure,
    });
  });

  it("keeps a first refresh failure distinct from a successful empty watched-session list", () => {
    const firstFailure = resolveWatchRefresh<string[]>(null, {
      status: "rejected",
      reason: new Error("watch command unavailable"),
    });
    const emptySuccess = resolveWatchRefresh<string[]>(null, {
      status: "fulfilled",
      value: [],
    });

    expect(firstFailure).toMatchObject({ data: null, state: "error" });
    expect(emptySuccess).toEqual({ data: [], state: "ready", error: null });
  });

  it("does not apply a stale rejection over a newer successful refresh", () => {
    const newerSuccess = resolveWatchRefresh<string[]>(null, {
      status: "fulfilled",
      value: ["newer-session"],
    });

    const resolved = resolveOrderedWatchRefresh(
      newerSuccess,
      { status: "rejected", reason: new Error("stale watch failure") },
      1,
      2,
    );

    expect(resolved).toEqual({ applied: false, refresh: newerSuccess });
  });

  it("applies the newest refresh generation", () => {
    const resolved = resolveOrderedWatchRefresh<string[]>(
      null,
      { status: "fulfilled", value: ["current-session"] },
      2,
      2,
    );

    expect(resolved).toEqual({
      applied: true,
      refresh: { data: ["current-session"], state: "ready", error: null },
    });
  });
});

describe("watched lifecycle authority", () => {
  it("projects watched status onto the effective session while preserving pending permission", () => {
    const resumed = applyWatchedLifecycle(
      { status: "completed" as const, has_pending_permission: true },
      "working",
    );
    const completed = applyWatchedLifecycle(
      { status: "active" as const, has_pending_permission: true },
      "completed",
    );

    expect(resumed).toEqual({ status: "active", has_pending_permission: true });
    expect(completed).toEqual({ status: "completed", has_pending_permission: true });
  });

  it("puts projected watched sessions into authoritative active and completed buckets", () => {
    const resumed = {
      id: "resumed",
      session: applyWatchedLifecycle({ status: "completed" as const }, "working"),
    };
    const completed = {
      id: "completed",
      session: applyWatchedLifecycle({ status: "active" as const }, "completed"),
    };

    const buckets = partitionSupervisorSessions([resumed, completed]);

    expect(buckets.active.map((item) => item.id)).toEqual(["resumed"]);
    expect(buckets.completed.map((item) => item.id)).toEqual(["completed"]);
  });

  it("keeps permission alerts separate while replacing passive lifecycle alerts", () => {
    const alerts = resolveWatchedLifecycleAlerts(
      [
        { session_id: "run-1", type: "stalled" as const, message: "stale hook" },
        { session_id: "run-1", type: "looping" as const, message: "repeated hook tool" },
        { session_id: "run-1", type: "permission" as const, message: "permission pending" },
      ],
      {
        session_id: "run-1",
        status: "completed",
        blocked_reason: null,
      },
    );

    expect(alerts).toEqual([
      { session_id: "run-1", type: "permission", message: "permission pending" },
    ]);
  });

  it("reports an authoritative watched block instead of passive hook alerts", () => {
    const alerts = resolveWatchedLifecycleAlerts(
      [{ session_id: "run-1", type: "low_signal" as const, message: "stale hook signal" }],
      {
        session_id: "run-1",
        status: "blocked",
        blocked_reason: "Waiting for credentials",
      },
    );

    expect(alerts).toEqual([
      { session_id: "run-1", type: "stalled", message: "Waiting for credentials" },
    ]);
  });
});

describe("watchDeleteReducer", () => {
  it("keeps a delete failure visible and clears it when the user retries", () => {
    const failed = watchDeleteReducer(
      watchDeleteReducer(initialWatchDeleteState, { type: "start" }),
      { type: "failure", error: "Watch store is read-only" },
    );

    expect(failed).toEqual({ pending: false, error: "Watch store is read-only" });
    expect(watchDeleteReducer(failed, { type: "start" })).toEqual({ pending: true, error: null });
  });
});
