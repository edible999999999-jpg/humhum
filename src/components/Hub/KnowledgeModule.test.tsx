import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  KnowledgeLoadGate,
  KnowledgeSearchToolbar,
  dispatchKnowledgeRefresh,
  runKnowledgeOperation,
} from "./KnowledgeModule";

const knowledgeModuleSource = readFileSync(
  new URL("./KnowledgeModule.tsx", import.meta.url),
  "utf8",
);
const characterRoomStyles = readFileSync(
  new URL("../../styles/hub-character-rooms.css", import.meta.url),
  "utf8",
);

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
