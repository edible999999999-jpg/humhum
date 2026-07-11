import { describe, expect, it } from "vitest";
import { agentLabel } from "./useHexaData";

describe("agentLabel", () => {
  it("presents Hermes as a named compatible agent", () => {
    expect(agentLabel("hermes")).toBe("Hermes Agent");
    expect(agentLabel("openclaw")).toBe("OpenClaw");
  });
});
