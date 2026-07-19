import { describe, expect, it } from "vitest";
import { pointerMovedBeyondDragThreshold } from "./petPointerInteraction";

describe("pet pointer interaction", () => {
  it("keeps a stationary left press available for the session-dashboard click", () => {
    expect(
      pointerMovedBeyondDragThreshold(
        { x: 120, y: 80 },
        { x: 123, y: 83 },
      ),
    ).toBe(false);
  });

  it("starts native dragging only after deliberate pointer movement", () => {
    expect(
      pointerMovedBeyondDragThreshold(
        { x: 120, y: 80 },
        { x: 126, y: 80 },
      ),
    ).toBe(true);
  });
});
