import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLatestTimeout, scheduleLatestTimeout } from "./latestTimeout";

describe("latest timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels an older callback when a newer state replaces it", () => {
    vi.useFakeTimers();
    const ref = { current: null as ReturnType<typeof setTimeout> | null };
    const oldCallback = vi.fn();
    const newCallback = vi.fn();

    scheduleLatestTimeout(ref, oldCallback, 1000);
    scheduleLatestTimeout(ref, newCallback, 2000);
    vi.advanceTimersByTime(1000);

    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(newCallback).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it("clears a pending callback during cleanup", () => {
    vi.useFakeTimers();
    const ref = { current: null as ReturnType<typeof setTimeout> | null };
    const callback = vi.fn();

    scheduleLatestTimeout(ref, callback, 1000);
    clearLatestTimeout(ref);
    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
    expect(ref.current).toBeNull();
  });
});
