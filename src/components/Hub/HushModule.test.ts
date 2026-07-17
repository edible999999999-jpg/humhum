import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  compareHushContacts,
  deriveHushHealthSource,
  getHushConversationIdentity,
  HushHealthSourcePanel,
  type HushHealthSignal,
} from "./HushModule";

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

    const ordered = [olderPriorityContact, newerContact].sort(compareHushContacts);

    expect(ordered).toEqual([newerContact, olderPriorityContact]);
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
      id: "dingtalk:conversation:conversation-42",
      name: "项目群",
    });
    expect(second).toEqual(first);
  });
});

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

describe("deriveHushHealthSource", () => {
  it("marks a complete paired-phone daily summary ready", () => {
    const summary = deriveHushHealthSource([
      healthSignal(),
      healthSignal({
        kind: "health.resting_heart_rate.daily",
        source_id: "health-connect:heart:secret",
        value: 58,
        unit: "bpm",
      }),
      healthSignal({
        kind: "health.sleep.daily",
        source_id: "health-connect:sleep:secret",
        value: 431,
        unit: "minutes",
      }),
    ], new Date("2026-07-18T12:00:00Z"));

    expect(summary.state).toBe("ready");
    expect(summary.latestDate).toBe("2026-07-18T00:00:00.000Z");
    expect(summary.lastSync).toBe("2026-07-18T01:20:00.000Z");
  });

  it("turns the newest connected-phone signals into an interpreted, partial summary", () => {
    const summary = deriveHushHealthSource([
      healthSignal(),
      healthSignal({
        kind: "health.resting_heart_rate.daily",
        source_id: "health-connect:heart:secret",
        value: 58,
        unit: "bpm",
      }),
    ], new Date("2026-07-18T12:00:00Z"));

    expect(summary.state).toBe("partial");
    expect(summary.deviceCount).toBe(1);
    expect(summary.metrics.steps?.value).toBe(6342);
    expect(summary.metrics.restingHeartRate?.value).toBe(58);
    expect(summary.metrics.sleep).toBeNull();
    expect(summary.deviceLabel).not.toContain("phone-token");
  });

  it("marks old summaries as stale and handles an empty private vault", () => {
    const stale = deriveHushHealthSource([
      healthSignal({
        ended_at: "2026-07-13T00:00:00Z",
        captured_at: "2026-07-13T01:00:00Z",
      }),
    ], new Date("2026-07-18T12:00:00Z"));
    const empty = deriveHushHealthSource([], new Date("2026-07-18T12:00:00Z"));

    expect(stale.state).toBe("stale");
    expect(empty.state).toBe("empty");
    expect(empty.latestDate).toBeNull();
  });
});

describe("HushHealthSourcePanel", () => {
  it("renders interpreted values and delete confirmation without raw local identifiers", () => {
    const summary = deriveHushHealthSource([
      healthSignal(),
      healthSignal({
        kind: "health.sleep.daily",
        source_id: "health-connect:sleep:secret",
        value: 431,
        unit: "minutes",
      }),
    ], new Date("2026-07-18T12:00:00Z"));
    const html = renderToStaticMarkup(createElement(HushHealthSourcePanel, {
      summary,
      confirmingClear: true,
      clearing: false,
      onRequestClear: vi.fn(),
      onCancelClear: vi.fn(),
      onConfirmClear: vi.fn(),
    }));

    expect(html).toContain("健康数据来源");
    expect(html).toContain("6,342");
    expect(html).toContain("删除本机健康摘要？");
    expect(html).not.toContain("phone-token-should-never-render");
    expect(html).not.toContain("health-connect:steps:secret");
    expect(html).not.toContain("structured-signals.sqlite3");
  });
});
