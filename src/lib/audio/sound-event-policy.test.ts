import { describe, expect, it } from "vitest";
import { failureSoundEvent } from "./sound-event-policy";

describe("failureSoundEvent", () => {
  it("recognizes quota and context exhaustion as resource limits", () => {
    expect(failureSoundEvent("rate limit exceeded; retry later")).toBe("resourceLimit");
    expect(failureSoundEvent("maximum context length reached")).toBe("resourceLimit");
    expect(failureSoundEvent("insufficient quota")).toBe("resourceLimit");
  });

  it("keeps ordinary tool failures in the error category", () => {
    expect(failureSoundEvent("command exited with code 1")).toBe("error");
  });
});
