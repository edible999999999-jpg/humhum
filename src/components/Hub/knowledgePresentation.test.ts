import { describe, expect, it } from "vitest";
import type { AgentAsset } from "@/types";
import {
  filterAgentAssets,
  getAgentAssetSummary,
  isPersonalAgentAsset,
} from "./knowledgePresentation";

function asset(
  filePath: string,
  content = "",
  overrides: Partial<AgentAsset> = {},
): AgentAsset {
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
    ...overrides,
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

describe("filterAgentAssets", () => {
  const custom = asset(
    "/Users/me/.codex/skills/release-helper/SKILL.md",
    "---\ndescription: Keeps launches reversible.\n---\n# Release helper",
    {
      name: "Launch Steward",
      source: "Personal toolbox",
      tags: ["shipping"],
    },
  );
  const agentsSkill = asset(
    "/Users/me/.agents/skills/ali-dws-cli/SKILL.md",
    "Coordinates DingTalk tasks.",
    {
      name: "DingTalk Assistant",
      agent_id: "desk-agent",
      asset_type: "routine",
      relative_path: "ali-dws-cli/SKILL.md",
      source: "/Users/me/.agents/skills",
      tags: ["collaboration"],
    },
  );
  const superpowers = asset(
    "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
    "Explore intent before implementation.",
    {
      name: "Brainstorming",
      agent_id: "codex",
      source: "OpenAI curated remote",
      tags: ["design"],
    },
  );
  const bundled = asset(
    "/Users/me/.codex/plugins/cache/openai-bundled/browser/skills/control/SKILL.md",
    "Browser controls",
    { name: "Bundled Browser" },
  );
  const system = asset(
    "/Users/me/.codex/skills/.system/skill-installer/SKILL.md",
    "Installs skills",
    { name: "System Installer" },
  );
  const marketplace = asset(
    "/Users/me/.claude/plugins/marketplaces/official/agents/reviewer.md",
    "Reviews code",
    { name: "Marketplace Reviewer" },
  );
  const mixedAssets = [
    custom,
    agentsSkill,
    superpowers,
    bundled,
    system,
    marketplace,
  ];

  it("keeps personal and curated installed assets in mine scope", () => {
    expect(filterAgentAssets(mixedAssets, "mine", "")).toEqual([
      custom,
      agentsSkill,
      superpowers,
    ]);
  });

  it.each([
    ["name", "launch steward", custom],
    ["description/content", "launches reversible", custom],
    ["source", "personal toolbox", custom],
    ["type", "routine", agentsSkill],
    ["agent", "DESK-AGENT", agentsSkill],
    ["path", "ali-dws-cli", agentsSkill],
    ["tags", "COLLABORATION", agentsSkill],
  ])("searches asset %s", (_field, query, expected) => {
    expect(filterAgentAssets(mixedAssets, "mine", `  ${query}  `)).toEqual([
      expected,
    ]);
  });

  it("returns all matching inventory when scope is all", () => {
    expect(filterAgentAssets(mixedAssets, "all", "")).toEqual(mixedAssets);
    expect(filterAgentAssets(mixedAssets, "all", "marketplace")).toEqual([
      marketplace,
    ]);
  });
});
