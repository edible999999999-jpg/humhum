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
  it("includes known user skill roots", () => {
    expect(isPersonalAgentAsset(asset("/Users/me/.codex/skills/my-skill/SKILL.md"))).toBe(true);
    expect(isPersonalAgentAsset(asset("/Users/me/.agents/skills/ali-dws-cli/SKILL.md"))).toBe(true);
  });

  it("includes installed curated remote skills such as Superpowers", () => {
    expect(
      isPersonalAgentAsset(
        asset(
          "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
        ),
      ),
    ).toBe(true);
  });

  it("includes arbitrary configured roots after tilde expansion", () => {
    const custom = asset(
      "/Users/me/Projects/my-skills/foo/SKILL.md",
      "",
      { source: "/Users/me/Projects/my-skills" },
    );

    expect(isPersonalAgentAsset(custom, ["~/Projects/my-skills"])).toBe(true);
  });

  it("matches configured Windows roots case-insensitively across separators", () => {
    const custom = asset(
      "C:\\Users\\Me\\Projects\\My-Skills\\Foo\\SKILL.md",
      "",
      { source: "C:\\Users\\Me\\Projects\\My-Skills" },
    );

    expect(
      isPersonalAgentAsset(custom, ["c:/users/me/PROJECTS/my-skills"]),
    ).toBe(true);
  });

  it("matches mixed-case Unix configured roots", () => {
    const custom = asset(
      "/Users/me/Projects/My-Skills/Foo/SKILL.md",
      "",
      { source: "/Users/me/Projects/My-Skills" },
    );

    expect(
      isPersonalAgentAsset(custom, ["/users/ME/projects/my-skills"]),
    ).toBe(true);
  });

  it("excludes system and provider inventory before configured roots", () => {
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
    expect(
      isPersonalAgentAsset(
        asset(
          "/Users/me/.codex/plugins/cache/openai-primary-runtime/documents/skills/documents/SKILL.md",
          "",
          { source: "/Users/me/.codex/plugins/cache" },
        ),
        ["~/.codex/plugins/cache"],
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
  const projectSkill = asset(
    "/Users/me/Projects/my-skills/brainstorming/SKILL.md",
    "Explore intent before implementation.",
    {
      name: "Brainstorming",
      agent_id: "codex",
      source: "/Users/me/Projects/my-skills",
      tags: ["design"],
    },
  );
  const superpowers = asset(
    "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/brainstorming/SKILL.md",
    "Explore intent before implementation.",
    {
      name: "Superpowers Brainstorming",
      source: "/Users/me/.codex/plugins/cache",
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
    projectSkill,
    superpowers,
    bundled,
    system,
    marketplace,
  ];

  it("keeps known and configured personal assets in mine scope", () => {
    expect(filterAgentAssets(
      mixedAssets,
      "mine",
      "",
      ["~/Projects/my-skills"],
    )).toEqual([
      custom,
      agentsSkill,
      projectSkill,
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
    expect(
      filterAgentAssets(
        mixedAssets,
        "mine",
        `  ${query}  `,
        ["~/Projects/my-skills"],
      ),
    ).toEqual([expected]);
  });

  it("returns all matching skills when scope is all", () => {
    expect(filterAgentAssets(mixedAssets, "all", "")).toEqual(
      mixedAssets.slice(0, -1),
    );
    expect(filterAgentAssets(mixedAssets, "all", "marketplace")).toEqual([]);
  });

  it("keeps the skills view limited to real SKILL.md descriptors", () => {
    const jsonConfig = asset(
      "/Users/me/.qoder/projects/session/task.json",
      '{"status":"done"}',
      {
        name: "task.json",
        asset_type: "config",
      },
    );
    const mislabeledJson = asset(
      "/Users/me/.agents/skills/example/package.json",
      '{"name":"example"}',
      {
        name: "package.json",
        asset_type: "skill",
      },
    );
    const skillReference = asset(
      "/Users/me/.agents/skills/example/references/usage.md",
      "# Usage",
      {
        name: "usage",
        asset_type: "skill",
      },
    );

    expect(
      filterAgentAssets(
        [custom, jsonConfig, mislabeledJson, skillReference],
        "all",
        "",
      ),
    ).toEqual([custom]);
  });
});
