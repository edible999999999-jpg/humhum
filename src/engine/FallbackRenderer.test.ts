import { afterEach, describe, expect, it, vi } from "vitest";
import { FallbackRenderer } from "./FallbackRenderer";

function createContextStub() {
  return {
    clearRect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
  };
}

describe("FallbackRenderer canvas selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses OffscreenCanvas when the runtime provides it", () => {
    const ctx = createContextStub();
    const instances: Array<{ width: number; height: number }> = [];

    class FakeOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {
        instances.push(this);
      }

      getContext() {
        return ctx;
      }
    }

    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("document", undefined);

    const renderer = new FallbackRenderer(64, 2);
    const canvas = renderer.render(0.016);

    expect(canvas).toBe(instances[0]);
    expect(instances[0]).toMatchObject({ width: 128, height: 128 });
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it("uses a regular HTML canvas when OffscreenCanvas is unavailable", () => {
    const ctx = createContextStub();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    };
    const createElement = vi.fn(() => canvas);

    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", { createElement });

    const renderer = new FallbackRenderer(80, 1.5);
    const rendered = renderer.render(0.016);

    expect(createElement).toHaveBeenCalledWith("canvas");
    expect(rendered).toBe(canvas);
    expect(canvas).toMatchObject({ width: 120, height: 120 });
    expect(ctx.scale).toHaveBeenCalledWith(1.5, 1.5);
  });

  it("falls back when the OffscreenCanvas constructor fails", () => {
    const ctx = createContextStub();
    const htmlCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    };

    class BrokenOffscreenCanvas {
      constructor() {
        throw new Error("OffscreenCanvas is disabled");
      }
    }

    vi.stubGlobal("OffscreenCanvas", BrokenOffscreenCanvas);
    vi.stubGlobal("document", { createElement: vi.fn(() => htmlCanvas) });

    const rendered = new FallbackRenderer(72, 1).render(0.016);

    expect(rendered).toBe(htmlCanvas);
    expect(htmlCanvas.getContext).toHaveBeenCalledWith("2d");
  });

  it("falls back when OffscreenCanvas has no 2D context", () => {
    const ctx = createContextStub();
    const htmlCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    };

    class ContextlessOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}

      getContext() {
        return null;
      }
    }

    vi.stubGlobal("OffscreenCanvas", ContextlessOffscreenCanvas);
    vi.stubGlobal("document", { createElement: vi.fn(() => htmlCanvas) });

    const rendered = new FallbackRenderer(72, 1).render(0.016);

    expect(rendered).toBe(htmlCanvas);
    expect(htmlCanvas.getContext).toHaveBeenCalledWith("2d");
  });

  it("reports a clear error when no canvas implementation exists", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", undefined);

    expect(() => new FallbackRenderer(64, 1)).toThrow(
      "Canvas rendering is not available in this environment",
    );
  });
});
