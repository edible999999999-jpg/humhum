import { describe, expect, it, vi } from "vitest";
import {
  drainLatestPetWindowResize,
  resizePetWindow,
} from "./petWindowResize";

describe("resizePetWindow", () => {
  it("does not expose an expanded overlay when the native resize fails", async () => {
    const report = vi.fn();

    const ready = await resizePetWindow(
      async () => {
        throw new Error("window manager rejected resize");
      },
      true,
      report,
    );

    expect(ready).toBe(false);
    expect(report).toHaveBeenCalledOnce();
  });

  it("does not mark the compact pet window as overlay-ready", async () => {
    const ready = await resizePetWindow(async () => {}, false);

    expect(ready).toBe(false);
  });

  it("processes the newest height requested during an in-flight resize", async () => {
    let latestHeight = 420;
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const resized: number[] = [];

    const draining = drainLatestPetWindowResize(
      latestHeight,
      () => latestHeight,
      async (height) => {
        resized.push(height);
        if (resized.length === 1) await firstBlocked;
      },
    );
    latestHeight = 180;
    releaseFirst?.();
    const settledHeight = await draining;

    expect(resized).toEqual([420, 180]);
    expect(settledHeight).toBe(180);
  });

  it("reclaims the queue when a height arrives as the final claim is released", async () => {
    let latestHeight = 420;
    const resized: number[] = [];
    let releases = 0;
    let reclaims = 0;

    const settledHeight = await drainLatestPetWindowResize(
      latestHeight,
      () => latestHeight,
      async (height) => {
        resized.push(height);
      },
      () => {
        releases++;
        if (releases === 1) latestHeight = 180;
      },
      () => {
        reclaims++;
      },
    );

    expect(resized).toEqual([420, 180]);
    expect(settledHeight).toBe(180);
    expect(releases).toBe(2);
    expect(reclaims).toBe(1);
  });
});
