import { describe, expect, it } from "vitest";
import { resolveWatchRefresh, type WatchRefresh } from "./hexaWatchState";

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
});
