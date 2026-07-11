import { describe, expect, it } from "vitest";
import { interventionMatches, interventionProviderForClient } from "./interventionProvider";

describe("interventionProviderForClient", () => {
  it("selects durable transports only for supported agents", () => {
    expect(interventionProviderForClient("codex")).toBe("codex");
    expect(interventionProviderForClient("claude-code")).toBe("claude");
    expect(interventionProviderForClient("opencode")).toBe("opencode");
    expect(interventionProviderForClient("cursor")).toBeNull();
  });
});

describe("interventionMatches", () => {
  it("keeps provider queues isolated and treats legacy entries as Codex", () => {
    expect(interventionMatches({ thread_id: "same", provider: "claude" }, "claude", "same")).toBe(true);
    expect(interventionMatches({ thread_id: "same", provider: "claude" }, "codex", "same")).toBe(false);
    expect(interventionMatches({ thread_id: "same", provider: "opencode" }, "opencode", "same")).toBe(true);
    expect(interventionMatches({ thread_id: "same" }, "codex", "same")).toBe(true);
    expect(interventionMatches({ thread_id: "other" }, "codex", "same")).toBe(false);
  });
});
