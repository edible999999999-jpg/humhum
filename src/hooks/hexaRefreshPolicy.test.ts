import { describe, expect, it, vi } from "vitest";
import {
  WATCHED_REFRESH_INTERVAL_MS,
  createCoalescedRefresh,
  hasPollableWatchedRun,
  watchedRefreshAction,
} from "./hexaRefreshPolicy";

describe("Hexa refresh policy", () => {
  it("polls watched sessions every 20 seconds", () => {
    expect(WATCHED_REFRESH_INTERVAL_MS).toBe(20_000);
  });

  it("polls only fresh active watched runs", () => {
    const now = new Date("2026-07-17T12:00:00Z").getTime();
    expect(hasPollableWatchedRun([], now)).toBe(false);
    expect(hasPollableWatchedRun([{
      runs: [{ status: "completed", updated_at: "2026-07-17T11:59:00Z" }],
    }], now)).toBe(false);
    expect(hasPollableWatchedRun([{
      runs: [{ status: "working", updated_at: "2026-07-17T11:45:00Z" }],
    }], now)).toBe(true);
    expect(hasPollableWatchedRun([{
      runs: [{ status: "waiting", updated_at: "2026-07-17T11:29:59Z" }],
    }], now)).toBe(false);
    expect(hasPollableWatchedRun([{
      runs: [{ status: "blocked", updated_at: "not-a-date" }],
    }], now)).toBe(false);
  });

  it("renders a stale transition once without polling the backend forever", () => {
    const now = new Date("2026-07-17T12:00:00Z").getTime();
    const stale = [{
      runs: [{ status: "working", updated_at: "2026-07-17T11:29:59Z" }],
    }];
    expect(watchedRefreshAction(stale, false, now)).toBe("render_expired");
    expect(watchedRefreshAction(stale, true, now)).toBe("idle");
    expect(watchedRefreshAction([{
      runs: [{ status: "working", updated_at: "2026-07-17T11:45:00Z" }],
    }], true, now)).toBe("poll");
  });

  it("coalesces triggers received during a refresh into one follow-up", async () => {
    const releases: Array<() => void> = [];
    let calls = 0;
    const refresh = createCoalescedRefresh(async () => {
      calls += 1;
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    const first = refresh();
    const second = refresh();
    const third = refresh();

    expect(calls).toBe(1);
    releases.shift()?.();
    await vi.waitFor(() => expect(calls).toBe(2));
    releases.shift()?.();
    await Promise.all([first, second, third]);
    expect(calls).toBe(2);
  });
});
