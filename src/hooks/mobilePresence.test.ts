import { describe, expect, it } from "vitest";
import { mobilePresenceLabel } from "./mobilePresence";

describe("mobilePresenceLabel", () => {
  it("labels foreground, monitoring, and absent reports without guessing", () => {
    expect(mobilePresenceLabel("foreground")).toBe("正在使用");
    expect(mobilePresenceLabel("monitoring")).toBe("后台监控");
    expect(mobilePresenceLabel(null)).toBe("离线");
  });
});
