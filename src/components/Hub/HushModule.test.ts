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

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

declare global {
  // React uses this opt-in flag to verify state updates stay inside act().
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

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

  it("keeps status collapsed and relies on the central room mascot", () => {
    expect(hushModuleSource).toContain(
      '<details className="hush-status-area">',
    );
    expect(hushModuleSource).not.toMatch(
      /<details className="hush-status-area"\s+open/,
    );
    expect(hushModuleSource).not.toContain("<HubRoom");
    expect(hushModuleSource).not.toContain("<img");
    expect(hushModuleSource).not.toContain("mascot");
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
