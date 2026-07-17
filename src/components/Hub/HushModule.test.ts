// @vitest-environment happy-dom

import { act, createElement } from "react";
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
  compareHushContacts,
  deriveHushHealthSource,
  getHushConversationIdentity,
  HushHealthSourcePanel,
  HushModule,
  type HushHealthSignal,
} from "./HushModule";

const capturedAt = "2026-07-18T01:20:00Z";

function healthSignal(overrides: Partial<HushHealthSignal> = {}): HushHealthSignal {
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
    return { total: 0, unread_priority: 0, by_tier: {}, by_platform: {}, messages: [] };
  }
  if (command === "get_hush_notification_bridge_status") {
    return { state: "running", message: "ready", last_scan_at: null, supported_apps: [] };
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

async function renderHushModule(): Promise<{ host: HTMLDivElement; root: Root }> {
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
  const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  return button as HTMLButtonElement;
}

describe("compareHushContacts", () => {
  it("orders contacts by their latest message before importance", () => {
    const olderPriorityContact = { importance: 5, lastMessageTime: "2026-07-17T04:00:00Z" };
    const newerContact = { importance: 2, lastMessageTime: "2026-07-17T05:00:00Z" };

    expect([olderPriorityContact, newerContact].sort(compareHushContacts)).toEqual([newerContact, olderPriorityContact]);
  });
});

describe("getHushConversationIdentity", () => {
  it("groups different senders from the same DingTalk group conversation", () => {
    const first = getHushConversationIdentity({
      platform: "dingtalk", sender: "成员甲", chat: "项目群", source_id: "dws:message-1",
      raw: { source: "dws", conversation_id: "conversation-42", single_chat: false },
    });
    const second = getHushConversationIdentity({
      platform: "dingtalk", sender: "成员乙", chat: "项目群", source_id: "dws:message-2",
      raw: { source: "dws", conversation_id: "conversation-42", single_chat: false },
    });

    expect(first).toEqual({ id: "dingtalk:conversation:conversation-42", name: "项目群" });
    expect(second).toEqual(first);
  });
});

describe("deriveHushHealthSource", () => {
  it("selects one newest device-day group without mixing measurements", () => {
    const summary = deriveHushHealthSource([
      healthSignal({ device_id: "phone-a", value: 6342 }),
      healthSignal({ device_id: "phone-a", kind: "health.sleep.daily", source_id: "a-sleep", value: 431, unit: "minutes" }),
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
    ], new Date("2026-07-19T12:00:00Z"));

    expect(summary.state).toBe("partial");
    expect(summary.deviceCount).toBe(2);
    expect(summary.localDate).toBe("2026-07-18");
    expect(summary.metrics.restingHeartRate?.value).toBe(58);
    expect(summary.metrics.steps).toBeNull();
    expect(summary.metrics.sleep).toBeNull();
  });

  it("does not combine different local days from the same device", () => {
    const summary = deriveHushHealthSource([
      healthSignal({ value: 6342 }),
      healthSignal({ kind: "health.sleep.daily", source_id: "sleep-yesterday", value: 431, unit: "minutes" }),
      healthSignal({
        kind: "health.resting_heart_rate.daily",
        source_id: "heart-today",
        started_at: "2026-07-18T00:00:00Z",
        ended_at: "2026-07-19T00:00:00Z",
        captured_at: "2026-07-19T01:20:00Z",
        value: 58,
        unit: "bpm",
      }),
    ], new Date("2026-07-19T12:00:00Z"));

    expect(summary.localDate).toBe("2026-07-18");
    expect(summary.metrics.restingHeartRate?.value).toBe(58);
    expect(summary.metrics.steps).toBeNull();
    expect(summary.metrics.sleep).toBeNull();
  });

  it("breaks equal recency ties by device and keeps that chosen group's sync time", () => {
    const summary = deriveHushHealthSource([
      healthSignal({ device_id: "phone-z", value: 9999 }),
      healthSignal({ device_id: "phone-a", value: 1111 }),
    ], new Date("2026-07-18T12:00:00Z"));

    expect(summary.metrics.steps?.value).toBe(1111);
    expect(summary.localDate).toBe("2026-07-17");
    expect(summary.lastSync).toBe("2026-07-18T01:20:00.000Z");
  });

  it("marks old summaries as stale and handles an empty private vault", () => {
    const stale = deriveHushHealthSource([
      healthSignal({ ended_at: "2026-07-13T00:00:00Z", captured_at: "2026-07-13T01:00:00Z" }),
    ], new Date("2026-07-18T12:00:00Z"));
    const empty = deriveHushHealthSource([], new Date("2026-07-18T12:00:00Z"));

    expect(stale.state).toBe("stale");
    expect(empty.state).toBe("empty");
    expect(empty.localDate).toBeNull();
  });
});

describe("HushHealthSourcePanel", () => {
  it("renders interpreted values and a counted delete confirmation without raw identifiers", () => {
    const summary = deriveHushHealthSource([
      healthSignal(),
      healthSignal({ kind: "health.sleep.daily", source_id: "health-connect:sleep:secret", value: 431, unit: "minutes" }),
    ], new Date("2026-07-18T12:00:00Z"));
    const html = renderToStaticMarkup(createElement(HushHealthSourcePanel, {
      summary,
      availability: "ready",
      confirmingClear: true,
      clearCount: 2,
      lastClearCount: null,
      clearing: false,
      onRequestClear: vi.fn(),
      onCancelClear: vi.fn(),
      onConfirmClear: vi.fn(),
    }));

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
    invokeMock.mockImplementation((command: string) => Promise.resolve(defaultInvoke(command)));
  });

  afterEach(async () => {
    if (view) await disposeHushModule(view);
    view = null;
    vi.clearAllMocks();
  });

  it("loads a connected phone summary through the Tauri command", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_health_signals") return Promise.resolve([healthSignal()]);
      return Promise.resolve(defaultInvoke(command));
    });
    view = await renderHushModule();

    expect(invokeMock).toHaveBeenCalledWith("get_hush_health_signals");
    expect(view.host.textContent).toContain("6,342");
    expect(view.host.textContent).toContain("数据日期");
  });

  it("renders an explicit unavailable state when health loading fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_health_signals") return Promise.reject(new Error("offline"));
      return Promise.resolve(defaultInvoke(command));
    });
    view = await renderHushModule();

    expect(view.host.textContent).toContain("健康摘要暂不可用");
    expect(view.host.textContent).not.toContain("尚未连接");
    expect(view.host.textContent).not.toContain("6,342");
  });

  it("uses only the health clear command and reports its exact deleted count", async () => {
    const signals = [healthSignal(), healthSignal({ kind: "health.sleep.daily", source_id: "sleep", value: 431, unit: "minutes" })];
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hush_health_signals") return Promise.resolve(signals);
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
    const lib = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const commands = readFileSync(resolve(process.cwd(), "src-tauri/src/commands.rs"), "utf8");

    expect(lib).toContain("commands::get_hush_health_signals");
    expect(lib).toContain("commands::clear_hush_health_signals");
    expect(commands).toContain("pub async fn get_hush_health_signals");
    expect(commands).toContain("pub async fn clear_hush_health_signals");
  });
});
