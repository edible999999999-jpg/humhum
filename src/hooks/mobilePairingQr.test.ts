import { describe, expect, it } from "vitest";
import {
  mobilePairingSecondsRemaining,
  shouldShowMobilePairingQr,
} from "./mobilePairingQr";

describe("mobilePairingSecondsRemaining", () => {
  it("reports the whole seconds left for an active pairing challenge", () => {
    expect(mobilePairingSecondsRemaining(1_000, 995_250)).toBe(5);
  });

  it("clamps an expired pairing challenge to zero", () => {
    expect(mobilePairingSecondsRemaining(1_000, 1_001_000)).toBe(0);
  });

  it("hides a consumed or locked challenge even before its timestamp expires", () => {
    expect(shouldShowMobilePairingQr(false, 1_000, 995_000)).toBe(false);
    expect(shouldShowMobilePairingQr(true, 1_000, 995_000)).toBe(true);
  });
});
