import { describe, expect, it, vi } from "vitest";
import {
  WATCHED_REFRESH_INTERVAL_MS,
  createCoalescedRefresh,
  hasPollableWatchedRun,
} from "./hexaRefreshPolicy";

describe("Hexa refresh policy", () => {
  it("polls watched sessions every 20 seconds", () => {
    expect(WATCHED_REFRESH_INTERVAL_MS).toBe(20_000);
  });

  it("polls only while a watched run has not completed", () => {
    expect(hasPollableWatchedRun([])).toBe(false);
    expect(hasPollableWatchedRun([{ runs: [{ status: "completed" }] }])).toBe(false);
    expect(hasPollableWatchedRun([{ runs: [{ status: "working" }] }])).toBe(true);
    expect(hasPollableWatchedRun([{ runs: [{ status: "waiting" }] }])).toBe(true);
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
