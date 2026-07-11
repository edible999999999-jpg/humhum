import { describe, expect, it } from "vitest";
import { resolveMascotTheme } from "./mascot-theme";

describe("resolveMascotTheme", () => {
  it("uses the current Agent's default HUMHUM theme", () => {
    expect(resolveMascotTheme("codex").id).toBe("codex");
    expect(resolveMascotTheme("github-copilot").id).toBe("github-copilot");
    expect(resolveMascotTheme("hermes").id).toBe("hermes");
    expect(resolveMascotTheme("openclaw").id).toBe("openclaw");
  });

  it("applies a valid per-Agent override", () => {
    expect(resolveMascotTheme("claude-code", { "claude-code": "gemini-cli" }).id).toBe("gemini-cli");
  });

  it("ignores unknown overrides and falls back to Humi for unknown clients", () => {
    expect(resolveMascotTheme("codex", { codex: "not-a-theme" }).id).toBe("codex");
    expect(resolveMascotTheme("future-agent").id).toBe("humi");
  });
});
