import { describe, expect, it } from "vitest";
import type { AgentAsset } from "@/types";
import { getAgentAssetSummary, isPersonalAgentAsset } from "./knowledgePresentation";

function asset(filePath: string, content = ""): AgentAsset {
  return {
    id: `asset:${filePath}`,
    asset_type: "skill",
    agent_id: "codex",
    name: "Personal helper",
    file_path: filePath,
    relative_path: filePath,
    source: "/Users/me",
    content,
    tags: [],
  };
}

describe("isPersonalAgentAsset", () => {
  it("includes user skill roots and curated remote skills", () => {
    expect(isPersonalAgentAsset(asset("/Users/me/.codex/skills/my-skill/SKILL.md"))).toBe(true);
    expect(isPersonalAgentAsset(asset("/Users/me/.agents/skills/ali-dws-cli/SKILL.md"))).toBe(true);
    expect(
      isPersonalAgentAsset(
        asset(
          "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
        ),
      ),
    ).toBe(true);
  });

  it("excludes bundled, system, and marketplace inventories", () => {
    expect(isPersonalAgentAsset(asset("/Users/me/.codex/skills/.system/skill-installer/SKILL.md"))).toBe(false);
    expect(
      isPersonalAgentAsset(
        asset("/Users/me/.codex/plugins/cache/openai-bundled/browser/skills/control/SKILL.md"),
      ),
    ).toBe(false);
    expect(
      isPersonalAgentAsset(
        asset("/Users/me/.claude/plugins/marketplaces/official/agents/reviewer.md"),
      ),
    ).toBe(false);
  });
});

describe("getAgentAssetSummary", () => {
  it("uses a frontmatter description", () => {
    const summary = getAgentAssetSummary(
      asset(
        "/Users/me/.codex/skills/release-helper/SKILL.md",
        "---\ndescription: Keep releases calm and reversible.\n---\n# Release helper",
      ),
    );

    expect(summary).toBe("Keep releases calm and reversible.");
  });

  it("uses a Markdown heading when frontmatter has no description", () => {
    const summary = getAgentAssetSummary(
      asset(
        "/Users/me/.codex/skills/review-helper/SKILL.md",
        "# Review assistant\n\nKeep feedback kind and specific.",
      ),
    );

    expect(summary).toBe("Review assistant");
  });

  it("provides a safe one-line fallback for empty content", () => {
    expect(getAgentAssetSummary(asset("/Users/me/.codex/skills/empty/SKILL.md"))).toBe(
      "No description available.",
    );
  });
});
