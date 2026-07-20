// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  KnowledgeModule,
  KnowledgeLoadGate,
  KnowledgeSearchToolbar,
  dispatchKnowledgeRefresh,
  getAgentAssetScanSummary,
  runKnowledgeOperation,
} from "./KnowledgeModule";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const knowledgeModuleSource = readFileSync(
  resolve(process.cwd(), "src/components/Hub/KnowledgeModule.tsx"),
  "utf8",
);
const characterRoomStyles = readFileSync(
  resolve(process.cwd(), "src/styles/hub-character-rooms.css"),
  "utf8",
);

const emptyKnowledge = {
  preferences: [],
  memory_items: [],
  agent_rules: [],
  agent_assets: [],
  obsidian_notes: [],
  obsidian_vault: null,
};

describe("Hype asset refresh summary", () => {
  it("counts unique logical skills using declared asset types", () => {
    const baseSkill = {
      id: "asset:codex-release",
      asset_type: "skill",
      agent_id: "codex",
      name: "Release Helper",
      file_path: "/Users/me/.codex/skills/release/SKILL.md",
      relative_path: "release/SKILL.md",
      source: "codex",
      content: "release",
      tags: [],
    };
    const assets = [
      baseSkill,
      {
        ...baseSkill,
        id: "asset:claude-release",
        agent_id: "claude",
        name: "release_helper",
        file_path: "/Users/me/.claude/skills/release/SKILL.md",
      },
      {
        ...baseSkill,
        id: "asset:prompt-skill-filename",
        asset_type: "prompt",
        name: "Prompt descriptor",
        file_path: "/Users/me/.codex/prompts/SKILL.md",
      },
      {
        ...baseSkill,
        id: "asset:agent",
        asset_type: "agent",
        name: "Builder Agent",
        file_path: "/Users/me/.codex/agents/builder.md",
      },
    ];

    expect(getAgentAssetScanSummary(assets)).toBe(
      "已整理 4 项本地知识 · 1 个个人技能 · 1 个 Agent 配置",
    );
  });
});

describe("Hype automatic skill freshness", () => {
  beforeEach(() => {
    sessionStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_knowledge") return Promise.resolve(emptyKnowledge);
      if (command === "scan_agent_assets") return Promise.resolve([]);
      if (command === "check_hooks_status") return Promise.resolve({});
      if (
        command === "get_codex_bridge_health" ||
        command === "check_qoder_acp_support" ||
        command === "get_config"
      ) {
        return Promise.resolve(null);
      }
      return Promise.reject(new Error(`Unexpected invoke: ${command}`));
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("rescans real skill usage on the first Hype visit", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(KnowledgeModule));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("scan_agent_assets", {
        roots: [
          "~/.qoder",
          "~/.qoderwork",
          "~/.gemini",
          "~/.qwen",
          "~/.kimi",
          "~/.pi",
        ],
      });
    });

    await vi.waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "get_knowledge"),
      ).toHaveLength(2);
    });

    await act(async () => root.unmount());
  });

  it("reuses the recent scan when Hype is reopened", async () => {
    sessionStorage.setItem("humhum:hype:auto-skill-scan-at", String(Date.now()));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(KnowledgeModule));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "scan_agent_assets"),
    ).toHaveLength(0);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "get_knowledge"),
    ).toHaveLength(1);

    await act(async () => root.unmount());
  });
});

describe("Hype logical skill rows", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("humhum:hype:auto-skill-scan-at", String(Date.now()));
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_knowledge") {
        return Promise.resolve({
          ...emptyKnowledge,
          agent_assets: [
            {
              id: "asset:codex-humhum-hexa",
              asset_type: "skill",
              agent_id: "codex",
              name: "humhum-hexa",
              file_path: "/Users/me/.codex/skills/humhum-hexa/SKILL.md",
              relative_path: "humhum-hexa/SKILL.md",
              source: "codex",
              content: "Codex copy",
              tags: [],
              ownership: "created",
              usage_evidence: [
                {
                  session_id: "older-session",
                  agent_id: "codex",
                  session_path: "/Users/me/.codex/sessions/older.jsonl",
                  workspace: "/Users/me/Projects/older-work",
                  used_at: "2026-07-19T09:00:00Z",
                },
              ],
            },
            {
              id: "asset:claude-humhum-hexa",
              asset_type: "skill",
              agent_id: "claude-code",
              name: "HumHum_Hexa",
              file_path: "/Users/me/.claude/skills/humhum-hexa/SKILL.md",
              relative_path: "humhum-hexa/SKILL.md",
              source: "claude",
              content: "Claude copy",
              tags: [],
              ownership: "created",
              usage_evidence: [
                {
                  session_id: "newest-session",
                  agent_id: "claude-code",
                  session_path: "/Users/me/.claude/sessions/newest.jsonl",
                  workspace: "/Users/me/Projects/newest-work",
                  used_at: "2026-07-20T09:00:00Z",
                },
              ],
            },
            {
              id: "asset:unknown-time-skill",
              asset_type: "skill",
              agent_id: "claude-code",
              name: "Unknown-time skill",
              file_path: "/Users/me/.claude/skills/unknown-time/SKILL.md",
              relative_path: "unknown-time/SKILL.md",
              source: "claude",
              content: "Unknown time copy",
              tags: [],
              ownership: "created",
              usage_evidence: [
                {
                  session_id: "newest-session",
                  agent_id: "claude-code",
                  session_path: "/Users/me/.claude/sessions/newest.jsonl",
                  workspace: "/Users/me/Projects/newest-work",
                  used_at: null,
                },
              ],
            },
            {
              id: "asset:release-prompt",
              asset_type: "prompt",
              agent_id: "codex",
              name: "Release prompt",
              file_path: "/Users/me/.codex/prompts/release.md",
              relative_path: "prompts/release.md",
              source: "codex",
              content: "Keep releases reversible.",
              tags: [],
              ownership: "created",
              modified_at: "2026-07-18T09:00:00Z",
            },
            {
              id: "asset:typed-skill-custom-filename",
              asset_type: "skill",
              agent_id: "codex",
              name: "Filename-independent skill",
              file_path: "/Users/me/.codex/skills/custom-skill.md",
              relative_path: "skills/custom-skill.md",
              source: "codex",
              content: "A scanner-confirmed skill.",
              tags: [],
              ownership: "created",
            },
            {
              id: "asset:prompt-named-skill-file",
              asset_type: "prompt",
              agent_id: "codex",
              name: "Prompt named skill descriptor",
              file_path: "/Users/me/.codex/prompts/SKILL.md",
              relative_path: "prompts/SKILL.md",
              source: "codex",
              content: "This remains a prompt.",
              tags: [],
              ownership: "created",
            },
          ],
        });
      }
      if (command === "check_hooks_status") return Promise.resolve({});
      if (
        command === "get_codex_bridge_health" ||
        command === "check_qoder_acp_support" ||
        command === "get_config"
      ) {
        return Promise.resolve(null);
      }
      return Promise.reject(new Error(`Unexpected invoke: ${command}`));
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows one skill row with newest sessions and every source in its details", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(KnowledgeModule));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(
        host.querySelectorAll(
          ".hype-logical-skill-row .hype-asset-name strong",
        ),
      ).toHaveLength(3);
    });
    const logicalSkillText = [...host.querySelectorAll(".hype-logical-skill-row")]
      .map((row) => row.textContent)
      .join(" ");
    expect(logicalSkillText).toContain("Filename-independent skill");
    expect(logicalSkillText).not.toContain("Prompt named skill descriptor");
    expect(host.textContent).toContain("2 个 Agent");
    expect(host.textContent).toContain("2 个会话");
    expect(host.textContent).toContain("Release prompt");
    expect(host.textContent).toContain("Prompt named skill descriptor");

    const row = host.querySelector<HTMLButtonElement>(
      ".hype-logical-skill-row .hype-asset-row",
    );
    await act(async () => row?.click());

    const expanded = host.querySelector(".hype-asset-expanded");
    const details = expanded?.textContent ?? "";
    const sourcePaths = [...(expanded?.querySelectorAll("code") ?? [])].map(
      (code) => code.getAttribute("title"),
    );
    expect(sourcePaths).toContain("/Users/me/.codex/skills/humhum-hexa/SKILL.md");
    expect(sourcePaths).toContain("/Users/me/.claude/skills/humhum-hexa/SKILL.md");
    expect(details).toContain("~/.codex/skills/humhum-hexa/SKILL.md");
    expect(details).toContain("~/.claude/skills/humhum-hexa/SKILL.md");
    expect(details.indexOf("newest-work")).toBeLessThan(details.indexOf("older-work"));

    await act(async () => root.unmount());
  });

  it("shows unknown usage time when sessions exist without a meaningful timestamp", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(KnowledgeModule));
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = await vi.waitFor(() => {
      const found = [...host.querySelectorAll(".hype-logical-skill-row")].find(
        (item) => item.textContent?.includes("Unknown-time skill"),
      );
      expect(found).toBeTruthy();
      return found;
    });
    expect(row.querySelector("time")?.textContent).toBe("使用时间未知");
    expect(row.querySelector("time")?.textContent).not.toBe("未发现使用记录");
    await act(async () => {
      row.querySelector<HTMLButtonElement>(".hype-asset-row")?.click();
    });
    expect(
      row.querySelector(".hype-skill-session-row time")?.textContent,
    ).toBe("使用时间未知");

    await act(async () => root.unmount());
  });

  it("omits version evidence when skill content does not differ", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(KnowledgeModule));
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = await vi.waitFor(() => {
      const found = [...host.querySelectorAll(".hype-logical-skill-row")].find(
        (item) => item.textContent?.includes("Unknown-time skill"),
      );
      expect(found).toBeTruthy();
      return found;
    });
    await act(async () => {
      row.querySelector<HTMLButtonElement>(".hype-asset-row")?.click();
    });

    expect(row.textContent).not.toContain("内容版本一致");
    expect(row.textContent).not.toContain("发现内容不同的版本");

    await act(async () => root.unmount());
  });
});

describe("Hype refresh routing", () => {
  it.each(["assets", "preferences", "rules", "memory"] as const)(
    "dispatches only the active %s refresh",
    async (activeTab) => {
      const actions = {
        assets: vi.fn(),
        preferences: vi.fn(),
        rules: vi.fn(),
        memory: vi.fn(),
      };

      await dispatchKnowledgeRefresh(activeTab, actions);

      for (const [tab, action] of Object.entries(actions)) {
        expect(action).toHaveBeenCalledTimes(tab === activeTab ? 1 : 0);
      }
    },
  );
});

describe("Hype operation status", () => {
  it("reports busy then success", async () => {
    const states: Array<{ kind: string; message: string }> = [];

    const succeeded = await runKnowledgeOperation(
      async () => undefined,
      (state) => states.push(state),
      {
        busy: "正在刷新偏好...",
        success: "偏好已刷新。",
        error: "刷新偏好失败",
      },
    );

    expect(succeeded).toBe(true);
    expect(states).toEqual([
      { kind: "busy", message: "正在刷新偏好..." },
      { kind: "success", message: "偏好已刷新。" },
    ]);
  });

  it("reports a recoverable error instead of swallowing it", async () => {
    const states: Array<{ kind: string; message: string }> = [];

    const succeeded = await runKnowledgeOperation(
      async () => {
        throw new Error("knowledge offline");
      },
      (state) => states.push(state),
      {
        busy: "正在扫描规则...",
        success: "规则已刷新。",
        error: "扫描规则失败",
      },
    );

    expect(succeeded).toBe(false);
    expect(states).toEqual([
      { kind: "busy", message: "正在扫描规则..." },
      {
        kind: "error",
        message: "扫描规则失败：Error: knowledge offline",
      },
    ]);
  });
});

describe("Hype loading and toolbar UI", () => {
  it("shows a recoverable initial-load error with a retry action", () => {
    const html = renderToStaticMarkup(
      <KnowledgeLoadGate
        loading={false}
        error="读取知识库失败"
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("读取知识库失败");
    expect(html).toContain("重试");
    expect(html).toContain('type="button"');
  });

  it("renders one accessible shared search and live refresh status", () => {
    const html = renderToStaticMarkup(
      <KnowledgeSearchToolbar
        query=""
        onQueryChange={vi.fn()}
        onRefresh={vi.fn()}
        refreshBusy={true}
        refreshDisabled={true}
        refreshLabel="刷新偏好"
        status={{ kind: "busy", message: "正在刷新偏好..." }}
      />,
    );

    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain("lucide-search");
    expect(html).toContain('aria-label="刷新偏好"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("keeps a single search entry in the composed Hype module", () => {
    expect(
      knowledgeModuleSource.match(/placeholder="搜索技能、规则、偏好与记忆"/g),
    ).toHaveLength(1);
  });

  it("loads discovered rules and memories instead of hiding them in agent assets", () => {
    expect(knowledgeModuleSource).toContain('asset.asset_type === "rule"');
    expect(knowledgeModuleSource).toContain('asset.asset_type === "memory"');
    expect(knowledgeModuleSource).toContain("data.memory_items");
    expect(knowledgeModuleSource).toContain("我的记忆");
  });

  it("uses bright-room preference controls instead of legacy white-on-white inline colors", () => {
    expect(knowledgeModuleSource).toContain(
      'className="hype-preference-add-button"',
    );
    expect(knowledgeModuleSource).toContain(
      'className="hype-preference-form"',
    );
    expect(knowledgeModuleSource).toContain(
      'className="hype-preference-cancel-button"',
    );
    expect(knowledgeModuleSource).toContain(
      'className="hype-preference-empty"',
    );
    expect(characterRoomStyles).toMatch(
      /\.hype-preference-add-button\s*\{[^}]*color:\s*#4f3f68/,
    );
    expect(characterRoomStyles).toMatch(
      /\.hype-preference-cancel-button\s*\{[^}]*color:\s*#64748b/,
    );
  });
});

describe("Hype responsive and motion styles", () => {
  it("switches asset rows to compact layout before the 780px risk band", () => {
    const compactRule = /\.hype-asset-list-header\s*\{[^}]*display:\s*none/.exec(
      characterRoomStyles,
    );
    expect(compactRule).not.toBeNull();
    const mediaStart = characterRoomStyles.lastIndexOf(
      "@media",
      compactRule?.index,
    );
    const mediaHeader = characterRoomStyles.slice(
      mediaStart,
      characterRoomStyles.indexOf("{", mediaStart),
    );
    const breakpoint = mediaHeader.match(/max-width:\s*(\d+)px/)?.[1];

    expect(Number(breakpoint)).toBeGreaterThanOrEqual(780);
  });

  it("stops the refresh spinner when reduced motion is requested", () => {
    expect(characterRoomStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hype-refresh-button \.is-spinning\s*\{[^}]*animation:\s*none/,
    );
  });
});
