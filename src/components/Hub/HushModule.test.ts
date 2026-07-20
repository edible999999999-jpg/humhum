// @vitest-environment happy-dom

import {
  Children,
  act,
  createElement,
  isValidElement,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMock, runHushReplySkillMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  runHushReplySkillMock: vi.fn(),
}));

declare global {
  // React uses this opt-in flag to verify state updates stay inside act().
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("../../lib/hush/replySkill", () => ({
  runHushReplySkill: runHushReplySkillMock,
}));

import {
  HUSH_CONVERSATION_STATE_KEY,
  HushContactRow,
  compareHushContacts,
  deriveHushHealthSource,
  getHushConversationIdentity,
  HushHealthSourcePanel,
  HushModule,
  HushPlatformLabel,
  type HushHealthSignal,
} from "./HushModule";
import {
  filterHushContacts,
  filterHushContactsByName,
  formatHushMessageText,
  parseHushConversationState,
  resolveHushSelectedContact,
  serializeHushConversationState,
  type DerivedContact,
  type HushInboxMessage,
} from "./hushPresentation";

const hushModuleSource = readFileSync(
  resolve(process.cwd(), "src/components/Hub/HushModule.tsx"),
  "utf8",
);
const characterRoomStyles = readFileSync(
  resolve(process.cwd(), "src/styles/hub-character-rooms.css"),
  "utf8",
);

const capturedAt = "2026-07-18T01:20:00Z";

function healthSignal(
  overrides: Partial<HushHealthSignal> = {},
): HushHealthSignal {
  return {
    device_id: "phone-token-should-never-render",
    source_id: "health-connect:steps:secret",
    kind: "health.steps.daily",
    started_at: "2026-07-17T00:00:00Z",
    ended_at: "2026-07-18T00:00:00Z",
    value: 6342,
    unit: "count",
    source: "health_connect",
    captured_at: capturedAt,
    quality: "trusted",
    ...overrides,
  };
}

function defaultInvoke(command: string): unknown {
  if (command === "get_hush_health_signals") return [];
  if (command === "get_hush_connectors") return [];
  if (command === "get_hush_inbox") {
    return {
      total: 0,
      unread_priority: 0,
      by_tier: {},
      by_platform: {},
      messages: [],
    };
  }
  if (command === "get_hush_notification_bridge_status") {
    return {
      state: "running",
      message: "ready",
      last_scan_at: null,
      supported_apps: [],
    };
  }
  if (command === "get_hush_dws_status") {
    return {
      state: "not_installed",
      message: "not installed",
      executable_source: null,
      executable_path: null,
      authenticated: false,
      auto_sync_enabled: false,
      sync_interval_minutes: 5,
      last_success_at: null,
      last_attempt_at: null,
      syncing: false,
      pending_sync: false,
    };
  }
  throw new Error(`Unexpected invoke: ${command}`);
}

async function renderHushModule(): Promise<{
  host: HTMLDivElement;
  root: Root;
}> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(HushModule));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { host, root };
}

async function disposeHushModule(view: { host: HTMLDivElement; root: Root }) {
  await act(async () => view.root.unmount());
  view.host.remove();
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button as HTMLButtonElement;
}

function message(id: string, receivedAt: string): HushInboxMessage {
  return {
    id,
    platform: "dingtalk",
    sender: "成员甲",
    chat: "项目群",
    text: `消息 ${id}`,
    tier: "work",
    importance: 2,
    received_at: receivedAt,
  };
}

function contact(id: string, messages: HushInboxMessage[]): DerivedContact {
  const latest = messages[messages.length - 1]!;
  return {
    id,
    legacyIds: [],
    name: id,
    tier: "work",
    platforms: ["dingtalk"],
    lastMessage: latest.text,
    lastMessageTime: latest.received_at,
    importance: 2,
    messages,
  };
}

describe("compareHushContacts", () => {
  it("orders contacts by their latest message before importance", () => {
    const olderPriorityContact = {
      importance: 5,
      lastMessageTime: "2026-07-17T04:00:00Z",
    };
    const newerContact = {
      importance: 2,
      lastMessageTime: "2026-07-17T05:00:00Z",
    };

    expect(
      [olderPriorityContact, newerContact].sort(compareHushContacts),
    ).toEqual([newerContact, olderPriorityContact]);
  });
});

describe("Hush conversation search and message text", () => {
  it("searches only direct-chat and group-chat names", () => {
    const projectGroup = {
      ...contact("项目群", [message("project", "2026-07-18T01:00:00Z")]),
      lastMessage: "正文里有独有关键词",
    };
    const directChat = {
      ...contact("Alice", [message("direct", "2026-07-18T02:00:00Z")]),
      lastMessage: "普通消息",
    };
    const contacts = [projectGroup, directChat];

    expect(filterHushContactsByName(contacts, "独有关键词")).toEqual([]);
    expect(filterHushContactsByName(contacts, "  项目  ")).toEqual([
      projectGroup,
    ]);
    expect(filterHushContactsByName(contacts, "alice")).toEqual([directChat]);
    expect(filterHushContactsByName(contacts, "   ")).toBe(contacts);
  });

  it("projects common DWS Markdown, HTML, and XML into readable plain text", () => {
    const raw = [
      "### **进度更新**",
      '<font color="#0089ff">@成员甲 </font>&nbsp;[查看详情](https://example.com/private)',
      "<imageContent>table_仅展示50条</imageContent>",
      "[图片消息](mediaId=@secret)",
      "<@AI119> `status --all`",
    ].join("\n");

    expect(formatHushMessageText(raw)).toBe(
      ["进度更新", "@成员甲 查看详情", "table_仅展示50条", "图片消息", "@ status --all"].join(
        "\n",
      ),
    );
  });

  it("keeps human content while removing code fences and formatting syntax", () => {
    const readable = formatHushMessageText(
      [
        "> **说明**",
        "```text",
        "需要保留的内容",
        "```",
        "<br>",
        "A &amp; B&nbsp;&lt;完成&gt;",
      ].join("\n"),
    );

    expect(readable).toContain("说明");
    expect(readable).toContain("需要保留的内容");
    expect(readable).toContain("A & B <完成>");
    expect(readable).not.toMatch(/```|<br>|&nbsp;|\*\*|^>/);
  });

  it("extracts the human message from a structured DWS JSON envelope", () => {
    const raw = JSON.stringify({
      textContent: {
        text: "需求更新\n请查看最新方案",
      },
      contentType: 1200,
    });

    expect(formatHushMessageText(raw)).toBe(
      "需求更新\n请查看最新方案",
    );
  });
});

describe("getHushConversationIdentity", () => {
  it("groups different senders from the same DingTalk group conversation", () => {
    const first = getHushConversationIdentity({
      platform: "dingtalk",
      sender: "成员甲",
      chat: "项目群",
      source_id: "dws:message-1",
      raw: {
        source: "dws",
        conversation_id: "conversation-42",
        single_chat: false,
      },
    });
    const second = getHushConversationIdentity({
      platform: "dingtalk",
      sender: "成员乙",
      chat: "项目群",
      source_id: "dws:message-2",
      raw: {
        source: "dws",
        conversation_id: "conversation-42",
        single_chat: false,
      },
    });

    expect(first).toEqual({
      id: "hush:v2:dws-id:dingtalk:conversation-42",
      name: "项目群",
      legacyIds: ["dingtalk:conversation:conversation-42"],
    });
    expect(second).toEqual(first);
  });
});

describe("deriveHushHealthSource", () => {
  it("selects one newest device-day group without mixing measurements", () => {
    const summary = deriveHushHealthSource(
      [
        healthSignal({ device_id: "phone-a", value: 6342 }),
        healthSignal({
          device_id: "phone-a",
          kind: "health.sleep.daily",
          source_id: "a-sleep",
          value: 431,
          unit: "minutes",
        }),
        healthSignal({
          device_id: "phone-b",
          kind: "health.resting_heart_rate.daily",
          source_id: "b-heart",
          started_at: "2026-07-18T00:00:00Z",
          ended_at: "2026-07-19T00:00:00Z",
          captured_at: "2026-07-19T01:20:00Z",
          value: 58,
          unit: "bpm",
        }),
      ],
      new Date("2026-07-19T12:00:00Z"),
    );

    expect(summary.state).toBe("partial");
    expect(summary.deviceCount).toBe(2);
    expect(summary.localDate).toBe("2026-07-18");
    expect(summary.metrics.restingHeartRate?.value).toBe(58);
    expect(summary.metrics.steps).toBeNull();
    expect(summary.metrics.sleep).toBeNull();
  });

  it("does not combine different local days from the same device", () => {
    const summary = deriveHushHealthSource(
      [
        healthSignal({ value: 6342 }),
        healthSignal({
          kind: "health.sleep.daily",
          source_id: "sleep-yesterday",
          value: 431,
          unit: "minutes",
        }),
        healthSignal({
          kind: "health.resting_heart_rate.daily",
          source_id: "heart-today",
          started_at: "2026-07-18T00:00:00Z",
          ended_at: "2026-07-19T00:00:00Z",
          captured_at: "2026-07-19T01:20:00Z",
          value: 58,
          unit: "bpm",
        }),
      ],
      new Date("2026-07-19T12:00:00Z"),
    );

    expect(summary.localDate).toBe("2026-07-18");
    expect(summary.metrics.restingHeartRate?.value).toBe(58);
    expect(summary.metrics.steps).toBeNull();
    expect(summary.metrics.sleep).toBeNull();
  });

  it("breaks equal recency ties by device and keeps that chosen group's sync time", () => {
    const summary = deriveHushHealthSource(
      [
        healthSignal({ device_id: "phone-z", value: 9999 }),
        healthSignal({ device_id: "phone-a", value: 1111 }),
      ],
      new Date("2026-07-18T12:00:00Z"),
    );

    expect(summary.metrics.steps?.value).toBe(1111);
    expect(summary.localDate).toBe("2026-07-17");
    expect(summary.lastSync).toBe("2026-07-18T01:20:00.000Z");
  });

  it("marks old summaries as stale and handles an empty private vault", () => {
    const stale = deriveHushHealthSource(
      [
        healthSignal({
          ended_at: "2026-07-13T00:00:00Z",
          captured_at: "2026-07-13T01:00:00Z",
        }),
      ],
      new Date("2026-07-18T12:00:00Z"),
    );
    const empty = deriveHushHealthSource([], new Date("2026-07-18T12:00:00Z"));

    expect(stale.state).toBe("stale");
    expect(empty.state).toBe("empty");
    expect(empty.localDate).toBeNull();
  });
});

describe("HushHealthSourcePanel", () => {
  it("renders interpreted values and a counted delete confirmation without raw identifiers", () => {
    const summary = deriveHushHealthSource(
      [
        healthSignal(),
        healthSignal({
          kind: "health.sleep.daily",
          source_id: "health-connect:sleep:secret",
          value: 431,
          unit: "minutes",
        }),
      ],
      new Date("2026-07-18T12:00:00Z"),
    );
    const html = renderToStaticMarkup(
      createElement(HushHealthSourcePanel, {
        summary,
        availability: "ready",
        confirmingClear: true,
        clearCount: 2,
        lastClearCount: null,
        clearing: false,
        onRequestClear: vi.fn(),
        onCancelClear: vi.fn(),
        onConfirmClear: vi.fn(),
      }),
    );

    expect(html).toContain("健康数据来源");
    expect(html).toContain("6,342");
    expect(html).toContain("将删除 2 条本机健康摘要？");
    expect(html).not.toContain("phone-token-should-never-render");
    expect(html).not.toContain("health-connect:steps:secret");
    expect(html).not.toContain("structured-signals.sqlite3");
  });
});

describe("HushModule health interactions", () => {
  let view: { host: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    listenMock.mockResolvedValue(() => undefined);
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(defaultInvoke(command)),
    );
  });

  afterEach(async () => {
    if (view) await disposeHushModule(view);
    view = null;
    vi.clearAllMocks();
  });

  it("loads a connected phone summary through the Tauri command", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_health_signals")
        return Promise.resolve([healthSignal()]);
      return Promise.resolve(defaultInvoke(command));
    });
    view = await renderHushModule();

    expect(invokeMock).toHaveBeenCalledWith("get_hush_health_signals");
    expect(view.host.textContent).toContain("6,342");
    expect(view.host.textContent).toContain("数据日期");
  });

  it("renders an explicit unavailable state when health loading fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_health_signals")
        return Promise.reject(new Error("offline"));
      return Promise.resolve(defaultInvoke(command));
    });
    view = await renderHushModule();

    expect(view.host.textContent).toContain("健康摘要暂不可用");
    expect(view.host.textContent).not.toContain("尚未连接");
    expect(view.host.textContent).not.toContain("6,342");
  });

  it("uses only the health clear command and reports its exact deleted count", async () => {
    const signals = [
      healthSignal(),
      healthSignal({
        kind: "health.sleep.daily",
        source_id: "sleep",
        value: 431,
        unit: "minutes",
      }),
    ];
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_health_signals")
        return Promise.resolve(signals);
      // Another paired device may ingest between confirmation and deletion;
      // success must report the vault's returned count, not the stale UI count.
      if (command === "clear_hush_health_signals") return Promise.resolve(3);
      return Promise.resolve(defaultInvoke(command));
    });
    view = await renderHushModule();

    await act(async () => buttonByText(view!.host, "删除健康摘要").click());
    expect(view.host.textContent).toContain("将删除 2 条本机健康摘要？");
    expect(invokeMock).not.toHaveBeenCalledWith("clear_hush_inbox");

    await act(async () => {
      buttonByText(view!.host, "确认删除 2 条").click();
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith("clear_hush_health_signals");
    expect(invokeMock).not.toHaveBeenCalledWith("clear_hush_inbox");
    expect(view.host.textContent).toContain("已删除 3 条本机健康摘要");
  });
});

describe("Hush health command registration", () => {
  it("registers both health vault commands with Tauri", () => {
    const lib = readFileSync(
      resolve(process.cwd(), "src-tauri/src/lib.rs"),
      "utf8",
    );
    const commands = readFileSync(
      resolve(process.cwd(), "src-tauri/src/commands.rs"),
      "utf8",
    );

    expect(lib).toContain("commands::get_hush_health_signals");
    expect(lib).toContain("commands::clear_hush_health_signals");
    expect(commands).toContain("pub async fn get_hush_health_signals");
    expect(commands).toContain("pub async fn clear_hush_health_signals");
  });
});

describe("HushModule conversation state migration", () => {
  let view: { host: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    listenMock.mockResolvedValue(() => undefined);
  });

  afterEach(async () => {
    if (view) await disposeHushModule(view);
    view = null;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("persists b6 attention and read-through state under the canonical ID", async () => {
    const sourceMessage: HushInboxMessage = {
      id: "message-1",
      platform: "dingtalk",
      sender: "成员甲",
      chat: "项目群",
      text: "需求文档已更新",
      tier: "work",
      importance: 3,
      received_at: "2026-07-18T05:00:00Z",
      source_id: "dws:message-1",
      raw: {
        source: "dws",
        conversation_id: "conversation-42",
        chat: "项目群",
      },
    };
    const sourceSnapshot = JSON.stringify(sourceMessage);
    const legacyId = "dingtalk:conversation:conversation-42";
    const canonicalId = "hush:v2:dws-id:dingtalk:conversation-42";
    const readThrough = "2026-07-18T04:00:00Z";
    window.localStorage.setItem(
      HUSH_CONVERSATION_STATE_KEY,
      JSON.stringify({
        version: 1,
        attentionIds: [legacyId, canonicalId, legacyId],
        readThrough: { [legacyId]: readThrough },
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_inbox") {
        return Promise.resolve({
          total: 1,
          unread_priority: 1,
          by_tier: { work: 1 },
          by_platform: { dingtalk: 1 },
          messages: [sourceMessage],
        });
      }
      return Promise.resolve(defaultInvoke(command));
    });

    view = await renderHushModule();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      JSON.parse(
        window.localStorage.getItem(HUSH_CONVERSATION_STATE_KEY) ?? "null",
      ),
    ).toEqual({
      version: 1,
      attentionIds: [canonicalId],
      readThrough: { [canonicalId]: readThrough },
      legacyMigrations: {
        [legacyId]: {
          attention: true,
          readThrough,
          targetIds: [canonicalId],
        },
      },
    });
    expect(JSON.stringify(sourceMessage)).toBe(sourceSnapshot);
    expect(invokeMock).not.toHaveBeenCalledWith("clear_hush_inbox");
    expect(invokeMock).not.toHaveBeenCalledWith("sync_hush_dws");
  });
});

describe("HushModule DingTalk refresh", () => {
  let view: { host: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    listenMock.mockResolvedValue(() => undefined);
  });

  afterEach(async () => {
    if (view) await disposeHushModule(view);
    view = null;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("uses the header refresh to sync authenticated DingTalk messages", async () => {
    let finishSync: ((report: unknown) => void) | undefined;
    const syncResult = new Promise((resolve) => {
      finishSync = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_dws_status") {
        return Promise.resolve({
          state: "ready",
          message: "ready",
          executable_source: "wukong",
          executable_path: "/Users/example/.real/.bin/dws/bin/dws",
          authenticated: true,
          auto_sync_enabled: true,
          sync_interval_minutes: 5,
          last_success_at: null,
          last_attempt_at: null,
          syncing: false,
          pending_sync: false,
        });
      }
      if (command === "sync_hush_dws") return syncResult;
      return Promise.resolve(defaultInvoke(command));
    });
    view = await renderHushModule();
    invokeMock.mockClear();

    const refresh = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="同步并刷新钉钉消息"]',
    );
    expect(refresh).not.toBeNull();
    await act(async () => {
      refresh?.click();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("sync_hush_dws");
    expect(refresh?.disabled).toBe(true);
    expect(
      refresh?.querySelector("svg")?.classList.contains("is-spinning"),
    ).toBe(true);

    await act(async () => {
      finishSync?.({
        conversations: 1,
        examined_messages: 1,
        imported_messages: 1,
        duplicate_messages: 0,
        pages: 1,
        partial: false,
        next_cursor: null,
      });
      await syncResult;
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("get_hush_inbox");
    expect(invokeMock).toHaveBeenCalledWith("get_hush_dws_status");
    expect(refresh?.disabled).toBe(false);
  });
});

describe("HushModule conversation presentation", () => {
  let view: { host: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    listenMock.mockResolvedValue(() => undefined);
    runHushReplySkillMock.mockResolvedValue(
      "可以，明天下午三点我有空，我们到时同步。",
    );
    const messages: HushInboxMessage[] = [
      {
        id: "project-message",
        platform: "dingtalk",
        sender: "成员甲",
        chat: "项目群",
        text: '<font color="#0089ff">**正文独有词**</font>&nbsp;[详情](https://example.com)',
        tier: "work",
        importance: 3,
        received_at: "2026-07-18T05:00:00Z",
        source_id: "dws:project-message",
        raw: {
          source: "dws",
          conversation_id: "project-conversation",
          chat: "项目群",
        },
      },
      {
        id: "direct-message",
        platform: "dingtalk",
        sender: "成员乙",
        chat: "成员乙",
        text: "普通消息",
        tier: "work",
        importance: 2,
        received_at: "2026-07-18T04:00:00Z",
        source_id: "dws:direct-message",
        raw: {
          source: "dws",
          conversation_id: "direct-conversation",
          chat: "成员乙",
          single_chat: true,
        },
      },
    ];
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_inbox") {
        return Promise.resolve({
          total: messages.length,
          unread_priority: 0,
          by_tier: { work: messages.length },
          by_platform: { dingtalk: messages.length },
          messages,
        });
      }
      return Promise.resolve(defaultInvoke(command));
    });
  });

  afterEach(async () => {
    if (view) await disposeHushModule(view);
    view = null;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("wires name-only search and readable text into the conversation list", async () => {
    view = await renderHushModule();
    const search = view.host.querySelector<HTMLInputElement>(
      'input[aria-label="搜索单聊或群聊名称"]',
    );
    const previews = () =>
      Array.from(view!.host.querySelectorAll(".hush-contact-preview"));
    const rows = () =>
      Array.from(view!.host.querySelectorAll(".hush-contact-row"));
    const enterSearch = (value: string) => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(search, value);
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    };

    expect(search).not.toBeNull();
    expect(rows()).toHaveLength(2);
    expect(previews()[0]?.textContent).toBe("正文独有词 详情");
    expect(view.host.innerHTML).not.toContain("&lt;font");
    expect(view.host.textContent).not.toContain("&nbsp;");

    await act(async () => {
      enterSearch("正文独有词");
    });
    expect(rows()).toHaveLength(0);
    expect(
      view.host.querySelector(".hush-conversation-detail"),
    ).toBeNull();

    await act(async () => {
      enterSearch("项目");
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("项目群");
    expect(
      view.host.querySelector(".hush-conversation-header h3")?.textContent,
    ).toBe("项目群");
  });

  it("updates the selected conversation to P0 when it becomes special attention", async () => {
    view = await renderHushModule();
    const detail = () =>
      view!.host.querySelector(".hush-conversation-header")?.textContent ?? "";
    const attentionButton = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="特别关注项目群"]',
    );

    expect(detail()).toContain("work · P3");
    expect(attentionButton).not.toBeNull();

    await act(async () => {
      attentionButton!.click();
    });

    expect(detail()).toContain("work · P0 · 特别关注");
  });

  it("shows one on-demand reply action for a direct chat without prefilled suggestions", async () => {
    view = await renderHushModule();
    const directContact = Array.from(
      view.host.querySelectorAll<HTMLButtonElement>(".hush-contact-select"),
    ).find((button) => button.textContent?.includes("成员乙"));

    expect(directContact).toBeDefined();
    expect(
      Array.from(view.host.querySelectorAll("button")).filter(
        (button) => button.textContent?.trim() === "建议回复",
      ),
    ).toHaveLength(0);

    await act(async () => {
      directContact?.click();
    });

    expect(
      view.host.querySelectorAll(".hush-message-suggestion"),
    ).toHaveLength(0);
    expect(
      Array.from(view.host.querySelectorAll("button")).filter(
        (button) => button.textContent?.trim() === "建议回复",
      ),
    ).toHaveLength(1);
    expect(view.host.textContent).not.toContain(
      "建议回复：收到，我会按这条信息推进，有结果后回复你。",
    );
  });

  it("runs the reply Skill once on demand and shows one contextual suggestion", async () => {
    view = await renderHushModule();
    const directContact = Array.from(
      view.host.querySelectorAll<HTMLButtonElement>(".hush-contact-select"),
    ).find((button) => button.textContent?.includes("成员乙"));

    await act(async () => {
      directContact?.click();
    });
    expect(runHushReplySkillMock).not.toHaveBeenCalled();

    const trigger = buttonByText(view.host, "建议回复");
    await act(async () => {
      trigger.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runHushReplySkillMock).toHaveBeenCalledTimes(1);
    expect(runHushReplySkillMock).toHaveBeenCalledWith({
      conversationName: "成员乙",
      messages: [
        {
          sender: "成员乙",
          text: "普通消息",
          received_at: "2026-07-18T04:00:00Z",
        },
      ],
    });
    expect(
      view.host.querySelectorAll(".hush-reply-skill-suggestion"),
    ).toHaveLength(1);
    expect(
      view.host.querySelector(".hush-reply-skill-suggestion")?.textContent,
    ).toContain("可以，明天下午三点我有空，我们到时同步。");
  });

  it("moves a newly starred conversation ahead of newer normal conversations", async () => {
    view = await renderHushModule();
    const rowNames = () =>
      Array.from(view!.host.querySelectorAll(".hush-contact-heading strong"))
        .map((node) => node.textContent);
    const directAttentionButton = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="特别关注成员乙"]',
    );

    expect(rowNames()).toEqual(["项目群", "成员乙"]);

    await act(async () => {
      directAttentionButton!.click();
    });

    expect(rowNames()).toEqual(["成员乙", "项目群"]);
  });

  it("uses the same parsed latest timestamp for the sidebar and message list", async () => {
    const newer: HushInboxMessage = {
      id: "newer-message",
      platform: "dingtalk",
      sender: "成员甲",
      chat: "跨时区项目群",
      text: "真正最新消息",
      tier: "work",
      importance: 3,
      received_at: "2026-07-18T03:00:00Z",
      source_id: "dws:newer-message",
      raw: {
        source: "dws",
        conversation_id: "timezone-conversation",
        chat: "跨时区项目群",
      },
    };
    const olderWithLargerClockText: HushInboxMessage = {
      ...newer,
      id: "older-message",
      text: "较早消息",
      received_at: "2026-07-18T10:30:00+08:00",
      source_id: "dws:older-message",
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_inbox") {
        return Promise.resolve({
          total: 2,
          unread_priority: 0,
          by_tier: { work: 2 },
          by_platform: { dingtalk: 2 },
          messages: [newer, olderWithLargerClockText],
        });
      }
      return Promise.resolve(defaultInvoke(command));
    });

    view = await renderHushModule();

    expect(
      view.host.querySelector(".hush-contact-preview")?.textContent,
    ).toBe("真正最新消息");
    expect(
      view.host.querySelector(".hush-contact-heading time")
        ?.getAttribute("datetime"),
    ).toBe("2026-07-18T03:00:00Z");
    const messageTexts = Array.from(
      view.host.querySelectorAll(".hush-message-line p"),
    ).map((node) => node.textContent);
    expect(messageTexts[messageTexts.length - 1]).toBe("真正最新消息");
  });
});

describe("Hush conversation UI contracts", () => {
  it("uses the exact versioned local storage key and payload version", () => {
    const state = {
      attentionIds: ["project"],
      readThrough: { project: "2026-07-18T03:00:00Z" },
    };

    expect(HUSH_CONVERSATION_STATE_KEY).toBe(
      "humhum:hush:conversation-state:v1",
    );
    expect(JSON.parse(serializeHushConversationState(state))).toEqual({
      version: 1,
      ...state,
    });
    expect(
      parseHushConversationState(serializeHushConversationState(state)),
    ).toEqual(state);
  });

  it("renders a text and aria-labelled unread count", () => {
    const html = renderToStaticMarkup(
      createElement(HushContactRow, {
        contact: contact("项目群", [
          message("one", "2026-07-18T01:00:00Z"),
          message("two", "2026-07-18T02:00:00Z"),
          message("three", "2026-07-18T03:00:00Z"),
        ]),
        selected: false,
        attention: false,
        unreadCount: 3,
        onSelect: vi.fn(),
        onToggleAttention: vi.fn(),
      }),
    );

    expect(html).toContain('aria-label="3 条未读"');
    expect(html).toContain(">3 条未读</span>");
  });

  it("stops star clicks from selecting the row and exposes pressed state", () => {
    const onToggleAttention = vi.fn();
    const row = HushContactRow({
      contact: contact("项目群", [message("one", "2026-07-18T01:00:00Z")]),
      selected: false,
      attention: true,
      unreadCount: 1,
      onSelect: vi.fn(),
      onToggleAttention,
    });
    const star = Children.toArray(row.props.children).find(
      (child) =>
        isValidElement<{ className?: string }>(child) &&
        child.props.className?.includes("hush-star-button"),
    ) as
      | ReactElement<{
          "aria-pressed": boolean;
          onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
        }>
      | undefined;
    const stopPropagation = vi.fn();

    expect(star?.props["aria-pressed"]).toBe(true);
    star?.props.onClick({
      stopPropagation,
    } as unknown as ReactMouseEvent<HTMLButtonElement>);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onToggleAttention).toHaveBeenCalledOnce();
  });

  it("renders explicit attention as the highest visible priority", () => {
    const priorityContact = {
      ...contact("项目群", [message("one", "2026-07-18T01:00:00Z")]),
      importance: 4,
    };
    const html = renderToStaticMarkup(
      createElement(HushContactRow, {
        contact: priorityContact,
        selected: false,
        attention: true,
        unreadCount: 0,
        onSelect: vi.fn(),
        onToggleAttention: vi.fn(),
      }),
    );

    expect(html).toContain(
      'class="hush-priority-label">特别关注</span>',
    );
    expect(html).not.toContain(
      'class="hush-priority-label">重点</span>',
    );
  });

  it("keeps selection resolved from all contacts while filters use subsets", () => {
    const selected = contact("read", [message("read", "2026-07-18T02:00:00Z")]);
    const unread = contact("unread", [
      message("unread", "2026-07-18T03:00:00Z"),
    ]);
    const contacts = [unread, selected];
    const state = {
      attentionIds: ["read"],
      readThrough: { read: "2026-07-18T02:00:00Z" },
    };

    expect(filterHushContacts(contacts, "all", state)).toEqual(contacts);
    expect(filterHushContacts(contacts, "attention", state)).toEqual([
      selected,
    ]);
    expect(filterHushContacts(contacts, "unread", state)).toEqual([unread]);
    expect(resolveHushSelectedContact(contacts, selected.id)).toBe(selected);
  });

  it("normalizes 钉钉 and WeChat with distinct source class hooks", () => {
    const dingTalk = renderToStaticMarkup(
      createElement(HushPlatformLabel, { platform: "DingTalk" }),
    );
    const weChat = renderToStaticMarkup(
      createElement(HushPlatformLabel, { platform: "wechat" }),
    );

    expect(dingTalk).toContain("is-dingtalk");
    expect(dingTalk).toContain("钉钉");
    expect(weChat).toContain("is-wechat");
    expect(weChat).toContain("WeChat");
  });

  it("keeps status collapsed and uses one dedicated peeking mascot", () => {
    expect(hushModuleSource).toContain(
      '<details className="hush-status-area">',
    );
    expect(hushModuleSource).not.toMatch(
      /<details className="hush-status-area"\s+open/,
    );
    expect(hushModuleSource).not.toContain("<HubRoom");
    expect(hushModuleSource.match(/<img/g)).toHaveLength(1);
    expect(hushModuleSource).toContain('className="hush-peek-character"');
    expect(hushModuleSource).toContain(
      'src="/mascots/avatars/hush-peek.png"',
    );
  });

  it("keeps reply suggestions on demand instead of rendering stored message replies", () => {
    expect(hushModuleSource).not.toContain("getVisibleHushSuggestedReply");
    expect(hushModuleSource).not.toContain("hush-message-suggestion");
    expect(hushModuleSource).toContain("runHushReplySkill");
    expect(hushModuleSource).toContain('conversationScope === "direct"');
    expect(hushModuleSource).toContain("getHushConversationScopeLabel");
  });

  it("retains every Hush invoke command and message listener", () => {
    const commands = [
      "get_hush_connectors",
      "get_hush_inbox",
      "get_hush_notification_bridge_status",
      "get_hush_dws_status",
      "open_full_disk_access_settings",
      "open_hush_connector",
      "clear_hush_inbox",
      "sync_hush_dws",
      "open_hush_dws_login",
      "set_hush_dws_auto_sync",
    ];

    for (const command of commands) {
      expect(hushModuleSource).toContain(`"${command}"`);
    }
    expect(hushModuleSource).toContain('"humhum://hush-message"');
  });

  it("keeps Hush radii bounded and disables loading motion when requested", () => {
    const hushStyles = characterRoomStyles.slice(
      characterRoomStyles.indexOf(".hush-room-module"),
    );
    const pixelRadii = Array.from(
      hushStyles.matchAll(/border-radius:\s*([^;]+);/g),
      (match) =>
        Array.from(match[1]!.matchAll(/(\d+)px/g), (value) => Number(value[1])),
    ).flat();

    expect(pixelRadii.length).toBeGreaterThan(0);
    expect(Math.max(...pixelRadii)).toBeLessThanOrEqual(8);
    expect(hushStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.hush-status-action \.is-spinning\s*\{[^}]*animation:\s*none/,
    );
  });
});
