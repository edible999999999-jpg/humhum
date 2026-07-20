import { describe, expect, it } from "vitest";
import type { AgentAsset } from "@/types";
import {
  agentAssetLastUsedTimestamp,
  agentAssetModifiedTimestamp,
  filterLogicalSkills,
  filterAgentAssets,
  getAgentAssetSummary,
  groupLogicalSkills,
  isPersonalAgentAsset,
  normalizeLogicalSkillName,
  sortAgentAssetsByRecentUse,
  sortByRecentUpdate,
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
  it("trusts backend ownership for created, installed, and used skills", () => {
    expect(
      isPersonalAgentAsset(
        asset(
          "/Users/me/.codex/plugins/cache/openai-primary-runtime/documents/1.0.0/skills/documents/SKILL.md",
          "",
          { ownership: "installed" },
        ),
      ),
    ).toBe(true);
    expect(
      isPersonalAgentAsset(
        asset(
          "/Users/me/.codex/plugins/cache/openai-curated-remote/superpowers/skills/brainstorming/SKILL.md",
          "",
          { ownership: "used" },
        ),
      ),
    ).toBe(true);
  });

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
  it("prefers the backend Chinese summary", () => {
    expect(
      getAgentAssetSummary(
        asset("/Users/me/.codex/skills/release-helper/SKILL.md", "# Release helper", {
          summary_zh: "让发布过程保持可回退",
        }),
      ),
    ).toBe("让发布过程保持可回退");
  });

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

  it("searches localized skill names and summaries", () => {
    const localized = asset(
      "/Users/me/.agents/skills/document-helper/SKILL.md",
      "# Document helper",
      {
        display_name_zh: "文档助手",
        summary_zh: "创建和整理 Word 文档",
      },
    );

    expect(filterAgentAssets([localized], "mine", "Word")).toEqual([localized]);
    expect(filterAgentAssets([localized], "mine", "文档助手")).toEqual([localized]);
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

describe("recent skill usage presentation", () => {
  it("sorts real usage first and newest to oldest", () => {
    const oldUse = asset("/Users/me/.codex/skills/old/SKILL.md", "", {
      name: "Old use",
      last_used_at: "2026-07-18T09:00:00Z",
      modified_at: "2026-07-20T09:00:00Z",
    });
    const newUse = asset("/Users/me/.codex/skills/new/SKILL.md", "", {
      name: "New use",
      last_used_at: "2026-07-19T09:00:00Z",
      modified_at: "2026-01-01T09:00:00Z",
    });
    const neverUsed = asset("/Users/me/.codex/skills/never/SKILL.md", "", {
      name: "Never used",
      modified_at: "2026-07-20T10:00:00Z",
    });
    const epochMetadata = asset("/Users/me/.codex/skills/epoch/SKILL.md", "", {
      name: "Epoch metadata",
      modified_at: "1970-01-01T00:00:01Z",
    });

    expect(sortAgentAssetsByRecentUse([epochMetadata, neverUsed, oldUse, newUse])).toEqual([
      newUse,
      oldUse,
      neverUsed,
      epochMetadata,
    ]);
  });

  it("treats Unix epoch metadata as unknown instead of a user-facing date", () => {
    expect(agentAssetModifiedTimestamp({
      ...asset("/Users/me/.codex/plugins/cache/example/SKILL.md"),
      modified_at: "1970-01-01T00:00:01Z",
    })).toBeNull();
    expect(agentAssetLastUsedTimestamp({
      ...asset("/Users/me/.codex/plugins/cache/example/SKILL.md"),
      last_used_at: "1970-01-01T00:00:01Z",
    })).toBeNull();
    expect(agentAssetLastUsedTimestamp({
      ...asset("/Users/me/.codex/skills/recent/SKILL.md"),
      last_used_at: "2026-07-19T09:00:00Z",
    })).toBe(Date.parse("2026-07-19T09:00:00Z"));
  });
});

describe("Hype module chronology", () => {
  it("sorts updated records newest first and keeps unknown dates last", () => {
    const records = [
      { id: "unknown" },
      { id: "older", modified_at: "2026-07-18T09:00:00Z" },
      { id: "epoch", modified_at: "1970-01-01T00:00:01Z" },
      { id: "newer", modified_at: "2026-07-20T09:00:00Z" },
    ];

    expect(sortByRecentUpdate(records).map((record) => record.id)).toEqual([
      "newer",
      "older",
      "unknown",
      "epoch",
    ]);
  });
});


describe("logical skill presentation", () => {
  it("normalizes equivalent skill names to one key", () => {
    expect(normalizeLogicalSkillName(" HumHum_Hexa ")).toBe("humhum-hexa");
    expect(normalizeLogicalSkillName("HumHum-Hexa")).toBe("humhum-hexa");
  });

  it("groups copies, deduplicates sessions, and sorts the newest use first", () => {
    const codexCopy = asset("/codex/humhum_hexa/SKILL.md", "# Codex HumHum Hexa", {
      agent_id: "codex",
      name: "humhum_hexa",
      modified_at: "2026-07-18T09:00:00Z",
      usage_evidence: [
        {
          session_id: "older-session",
          agent_id: "codex",
          session_path: "/sessions/older",
          workspace: "/workspace/older",
          used_at: "2026-07-18T10:00:00Z",
        },
        {
          session_id: "newest-session",
          agent_id: "codex",
          session_path: "/sessions/newest-old-copy",
          workspace: "/workspace/newest",
          used_at: "2026-07-19T10:00:00Z",
        },
      ],
    });
    const claudeCopy = asset("/claude/HumHum-Hexa/SKILL.md", "# Claude HumHum Hexa", {
      agent_id: "claude",
      name: "HumHum-Hexa",
      modified_at: "2026-07-19T09:00:00Z",
      usage_evidence: [
        {
          session_id: "older-session",
          agent_id: "codex",
          session_path: "/sessions/older-copy",
          workspace: "/workspace/older",
          used_at: "2026-07-18T11:00:00Z",
        },
        {
          session_id: "newest-session",
          agent_id: "codex",
          session_path: "/sessions/newest",
          workspace: "/workspace/newest",
          used_at: "2026-07-20T10:00:00Z",
        },
      ],
    });

    const skill = groupLogicalSkills([codexCopy, claudeCopy])[0];

    expect(skill?.key).toBe("humhum-hexa");
    expect(skill?.copies).toHaveLength(2);
    expect(skill?.sessions.map((session) => session.session_id)).toEqual([
      "newest-session",
      "older-session",
    ]);
    expect(skill?.session_count).toBe(2);
    expect(skill?.agent_count).toBe(2);
    expect(skill?.has_multiple_versions).toBe(true);
    expect(skill?.sessions[0]?.session_path).toBe("/sessions/newest");
  });

  it("keeps installed copies without evidence and searches session workspaces", () => {
    const installedCopy = asset("/codex/installed/SKILL.md", "", {
      name: "Installed Helper",
      ownership: "installed",
    });
    const usedCopy = asset("/claude/workspace-helper/SKILL.md", "", {
      agent_id: "claude",
      name: "Workspace Helper",
      summary_zh: "整理项目工作区",
      usage_evidence: [
        {
          session_id: "workspace-session",
          agent_id: "claude",
          session_path: "/sessions/workspace",
          workspace: "/Projects/HumHum",
          used_at: "2026-07-20T12:00:00Z",
        },
      ],
    });

    const skills = groupLogicalSkills([installedCopy, usedCopy]);
    const installed = skills.find((skill) => skill.key === "installed-helper");

    expect(installed?.session_count).toBe(0);
    expect(filterLogicalSkills(skills, "整理")).toHaveLength(1);
    expect(filterLogicalSkills(skills, "Projects/HumHum").map((skill) => skill.key)).toEqual([
      "workspace-helper",
    ]);
  });

  it("keeps the same session ID when usage belongs to different Agents", () => {
    const codexCopy = asset("/codex/shared/SKILL.md", "shared", {
      agent_id: "codex",
      name: "Shared Skill",
      usage_evidence: [
        {
          session_id: "same-session",
          agent_id: "codex",
          session_path: "/codex/sessions/same",
          used_at: "2026-07-20T10:00:00Z",
        },
      ],
    });
    const claudeCopy = asset("/claude/shared/SKILL.md", "shared", {
      agent_id: "claude",
      name: "Shared Skill",
      usage_evidence: [
        {
          session_id: "same-session",
          agent_id: "claude",
          session_path: "/claude/sessions/same",
          used_at: "2026-07-20T10:00:00Z",
        },
      ],
    });

    const [skill] = groupLogicalSkills([codexCopy, claudeCopy]);

    expect(skill?.session_count).toBe(2);
    expect(skill?.sessions.map((session) => session.agent_id)).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("orders real use, meaningful modification, then names with unknown dates last", () => {
    const recentUse = asset("/skills/recent-use/SKILL.md", "recent", {
      name: "recent-use",
      modified_at: "2026-01-01T00:00:00Z",
      usage_evidence: [
        {
          session_id: "recent-session",
          agent_id: "codex",
          session_path: "/sessions/recent",
          used_at: "2026-07-20T12:00:00Z",
        },
      ],
    });
    const modifiedOnly = asset("/skills/modified-only/SKILL.md", "modified", {
      name: "modified-only",
      modified_at: "2026-07-19T12:00:00Z",
    });
    const invalidDate = asset("/skills/alpha-unknown/SKILL.md", "invalid", {
      name: "alpha-unknown",
      modified_at: "not-a-date",
    });
    const epochDate = asset("/skills/beta-unknown/SKILL.md", "epoch", {
      name: "beta-unknown",
      modified_at: "1970-01-01T00:00:01Z",
    });
    const epochUse = asset("/skills/epoch-use/SKILL.md", "epoch use", {
      name: "epoch-use",
      usage_evidence: [
        {
          session_id: "epoch-session",
          agent_id: "codex",
          session_path: "/sessions/epoch",
          used_at: "1970-01-01T00:00:01Z",
        },
      ],
    });

    expect(
      groupLogicalSkills([epochDate, epochUse, invalidDate, modifiedOnly, recentUse])
        .map((skill) => skill.name),
    ).toEqual([
      "recent-use",
      "modified-only",
      "alpha-unknown",
      "beta-unknown",
      "epoch-use",
    ]);
  });
});
