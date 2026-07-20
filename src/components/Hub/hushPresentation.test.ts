import { describe, expect, it } from "vitest";
import {
  filterHushContacts,
  formatHushConversationTime,
  getHushChatScope,
  getHushConversationIdentity,
  getLatestHushMessage,
  getHushPriorityLabel,
  getHushUnreadCount,
  getVisibleHushSuggestedReply,
  groupHushMessages,
  isHushContactUnread,
  migrateHushConversationState,
  parseHushConversationState,
  resolveHushSelectedContact,
  serializeHushConversationState,
  sortHushContactsByAttention,
  type DerivedContact,
  type HushConversationState,
  type HushInboxMessage,
} from "./hushPresentation";

type TestConversationKind =
  | "dws-id"
  | "dws-chat"
  | "notification-thread"
  | "sender";

function canonicalId(
  kind: TestConversationKind,
  platform: string,
  value: string,
): string {
  return `hush:v2:${kind}:${encodeURIComponent(platform)}:${encodeURIComponent(value)}`;
}

function message(
  id: string,
  receivedAt: string,
  sender = "成员甲",
  platform = "dingtalk",
): HushInboxMessage {
  return {
    id,
    platform,
    sender,
    chat: "项目群",
    text: `消息 ${id}`,
    tier: "work",
    importance: 2,
    received_at: receivedAt,
  };
}

function contact(
  id: string,
  lastMessageTime: string,
  messages: HushInboxMessage[] = [],
): DerivedContact {
  return {
    id,
    legacyIds: [],
    name: id,
    tier: "work",
    platforms: ["dingtalk"],
    lastMessage: messages[messages.length - 1]?.text ?? "",
    lastMessageTime,
    importance: 2,
    messages,
  };
}

describe("Hush conversation time labels", () => {
  const now = new Date(2026, 6, 20, 12, 0, 0);
  const localIso = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
  ) => new Date(year, month, day, hour, minute, 0).toISOString();

  it.each([
    [localIso(2026, 6, 20, 11, 8), "11:08"],
    [localIso(2026, 6, 19, 13, 27), "昨天 13:27"],
    [localIso(2026, 6, 17, 13, 27), "7月17日"],
    [localIso(2025, 11, 31, 23, 59), "2025/12/31"],
    ["invalid-time", "invalid-time"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatHushConversationTime(value, now)).toBe(expected);
  });
});

describe("Hush conversation scope", () => {
  it.each([
    {
      label: "explicit direct kind",
      candidate: { ...message("direct", "2026-07-18T01:00:00Z"), conversation_kind: "direct" },
      expected: "direct",
    },
    {
      label: "legacy DWS direct flag",
      candidate: {
        ...message("legacy-direct", "2026-07-18T01:00:00Z"),
        raw: { source: "dws", single_chat: true },
      },
      expected: "direct",
    },
    {
      label: "legacy DWS group flag",
      candidate: {
        ...message("legacy-group", "2026-07-18T01:00:00Z"),
        raw: { source: "dws", single_chat: false },
      },
      expected: "group",
    },
    {
      label: "unclassified notification",
      candidate: message("unknown", "2026-07-18T01:00:00Z"),
      expected: "unknown",
    },
  ])("classifies $label", ({ candidate, expected }) => {
    expect(getHushChatScope(candidate)).toBe(expected);
  });

  it("hides persisted group suggestions but keeps direct suggestions", () => {
    const group = {
      ...message("group", "2026-07-18T01:00:00Z"),
      conversation_kind: "group",
      suggested_reply: "看到了，我晚点回你",
    };
    const direct = {
      ...message("direct", "2026-07-18T01:00:00Z"),
      conversation_kind: "direct",
      suggested_reply: "可以，我确认时间后明确回复你。",
    };

    expect(getVisibleHushSuggestedReply(group)).toBeNull();
    expect(getVisibleHushSuggestedReply(direct)).toBe(
      "可以，我确认时间后明确回复你。",
    );
  });

  it("upgrades a persisted generic direct reply using the message content", () => {
    const legacyDirect = {
      ...message("legacy-direct", "2026-07-18T01:00:00Z"),
      conversation_kind: "direct",
      text: "明天下午三点开会可以吗？",
      suggested_reply: "看到了，我晚点回你～",
    };

    expect(getVisibleHushSuggestedReply(legacyDirect)).toBe(
      "可以，我先确认一下明天下午三点的安排，稍后明确回复你。",
    );
  });

  it.each([
    {
      text: "怎么样郭师，有查到吗",
      expected: "我正在确认，查到明确结果后马上回复你。",
    },
    {
      text: "图片消息 注意：如需下载使用 dws chat message download-media",
      expected: "图片收到了，我看一下内容，确认后回复你。",
    },
  ])("upgrades legacy direct replies for: $text", ({ text, expected }) => {
    const legacyDirect = {
      ...message("legacy-direct", "2026-07-18T01:00:00Z"),
      conversation_kind: "direct",
      text,
      suggested_reply: "看到了，我晚点回你～",
    };

    expect(getVisibleHushSuggestedReply(legacyDirect)).toBe(expected);
  });
});

describe("Hush priority labels", () => {
  it("uses P0 for explicit attention and maps higher internal scores to lower P numbers", () => {
    expect(getHushPriorityLabel(5, false)).toBe("P1");
    expect(getHushPriorityLabel(4, false)).toBe("P2");
    expect(getHushPriorityLabel(3, false)).toBe("P3");
    expect(getHushPriorityLabel(2, false)).toBe("P4");
    expect(getHushPriorityLabel(4, true)).toBe("P0 · 特别关注");
  });
});

describe("Hush latest-message and attention ordering", () => {
  it("chooses the latest instant instead of comparing timestamp strings", () => {
    const newer = message("newer", "2026-07-18T03:00:00Z");
    const olderWithLargerClockText = message(
      "older",
      "2026-07-18T10:30:00+08:00",
    );

    expect(
      getLatestHushMessage([newer, olderWithLargerClockText]),
    ).toBe(newer);
  });

  it("puts special-attention contacts first and keeps each group time-sorted", () => {
    const newestNormal = contact("normal-new", "2026-07-18T05:00:00Z");
    const newestAttention = contact("attention-new", "2026-07-18T04:00:00Z");
    const olderAttention = contact("attention-old", "2026-07-18T03:00:00Z");

    expect(
      sortHushContactsByAttention(
        [newestNormal, olderAttention, newestAttention],
        {
          attentionIds: ["attention-old", "attention-new"],
        },
      ).map(({ id }) => id),
    ).toEqual(["attention-new", "attention-old", "normal-new"]);
  });
});

describe("getHushConversationIdentity", () => {
  it("keeps system notification threads separate for the same sender and platform", () => {
    const first = getHushConversationIdentity({
      platform: " WeChat ",
      sender: " WeChat ",
      chat: " THREAD-ONE ",
      source_id: "com.tencent.xinwechat:first",
      raw: {
        source: "macos_notification_center",
        chat: " THREAD-ONE ",
      },
    });
    const second = getHushConversationIdentity({
      platform: "wechat",
      sender: "wechat",
      chat: "thread-two",
      source_id: "com.tencent.xinwechat:second",
      raw: {
        source: "macos_notification_center",
        threadIdentifier: " thread-two ",
      },
    });

    expect(first.id).toBe(
      canonicalId("notification-thread", "wechat", "THREAD-ONE"),
    );
    expect(second.id).toBe(
      canonicalId("notification-thread", "wechat", "thread-two"),
    );
    expect(first.id).not.toBe(second.id);
    expect(first.legacyIds).toEqual([" WeChat : WeChat "]);
    expect(second.legacyIds).toEqual(["wechat:wechat"]);
  });

  it("trims DWS conversation_id and chat_id values without changing case", () => {
    const fromConversationId = getHushConversationIdentity({
      platform: " DingTalk ",
      sender: "成员甲",
      chat: "项目群",
      source_id: " DWS:message-1 ",
      raw: {
        source: " DWS ",
        conversation_id: " PROJECT-42 ",
        chat_id: "ignored-chat",
      },
    });
    const fromChatId = getHushConversationIdentity({
      platform: "dingtalk",
      sender: "成员乙",
      chat: "项目群",
      source_id: "dws:message-2",
      raw: {
        source: "dws",
        conversation_id: " ",
        chat_id: " PROJECT-42 ",
      },
    });

    expect(fromConversationId).toEqual({
      id: canonicalId("dws-id", "dingtalk", "PROJECT-42"),
      name: "项目群",
      legacyIds: [" DingTalk :成员甲"],
    });
    expect(fromChatId.id).toBe(fromConversationId.id);
    expect(fromChatId.legacyIds).toEqual([
      "dingtalk:conversation:项目群",
    ]);
  });

  it("uses DWS chat metadata when conversation_id and chat_id are blank", () => {
    const first = getHushConversationIdentity({
      platform: "dingtalk",
      sender: "成员甲",
      chat: "项目群甲",
      source_id: "dws:first",
      raw: {
        source: "dws",
        conversation_id: " ",
        chat_id: "",
        chat: " 项目群甲 ",
      },
    });
    const second = getHushConversationIdentity({
      platform: "dingtalk",
      sender: "成员甲",
      chat: "项目群乙",
      source_id: "dws:second",
      raw: {
        source: "dws",
        conversation_id: "",
        chat_id: " ",
        chat: " 项目群乙 ",
      },
    });

    expect(first.id).toBe(canonicalId("dws-chat", "dingtalk", "项目群甲"));
    expect(second.id).toBe(canonicalId("dws-chat", "dingtalk", "项目群乙"));
    expect(first.id).not.toBe(second.id);
    expect(first.legacyIds).toEqual([
      "dingtalk:conversation:项目群甲",
    ]);
    expect(second.legacyIds).toEqual([
      "dingtalk:conversation:项目群乙",
    ]);
  });

  it.each([
    {
      label: "threadIdentifier",
      sourceId: "com.tencent.xinwechat:first",
      upperRaw: {
        source: "macos_notification_center",
        threadIdentifier: " Chat-Aa ",
      },
      lowerRaw: {
        source: "macos_notification_center",
        threadIdentifier: " chat-aa ",
      },
    },
    {
      label: "raw chat",
      sourceId: "com.tencent.xinwechat:first",
      upperRaw: {
        source: "macos_notification_center",
        chat: " Chat-Aa ",
      },
      lowerRaw: {
        source: "macos_notification_center",
        chat: " chat-aa ",
      },
    },
    {
      label: "DWS conversation_id",
      sourceId: "dws:first",
      upperRaw: {
        source: "dws",
        conversation_id: " Chat-Aa ",
      },
      lowerRaw: {
        source: "dws",
        conversation_id: " chat-aa ",
      },
    },
    {
      label: "DWS chat_id",
      sourceId: "dws:first",
      upperRaw: {
        source: "dws",
        chat_id: " Chat-Aa ",
      },
      lowerRaw: {
        source: "dws",
        chat_id: " chat-aa ",
      },
    },
  ])("preserves case for opaque $label keys", ({ sourceId, upperRaw, lowerRaw }) => {
    const upper = getHushConversationIdentity({
      platform: "wechat",
      sender: "同一发送者",
      chat: null,
      source_id: sourceId,
      raw: upperRaw,
    });
    const lower = getHushConversationIdentity({
      platform: "wechat",
      sender: "同一发送者",
      chat: null,
      source_id: sourceId.replace("first", "second"),
      raw: lowerRaw,
    });

    const kind = sourceId.startsWith("dws:")
      ? "dws-id"
      : "notification-thread";
    expect(upper.id).toBe(canonicalId(kind, "wechat", "Chat-Aa"));
    expect(lower.id).toBe(canonicalId(kind, "wechat", "chat-aa"));
    expect(upper.id).not.toBe(lower.id);
  });

  it("preserves the legacy platform and sender fallback ID", () => {
    const identity = getHushConversationIdentity({
      platform: " WeChat ",
      sender: " Alice ",
      chat: null,
      source_id: "com.tencent.xinwechat:first",
      raw: {
        source: "macos_notification_center",
        chat: " ",
        threadIdentifier: null,
      },
    });

    expect(identity).toEqual({
      id: canonicalId("sender", "wechat", "Alice"),
      name: "Alice",
      legacyIds: [" WeChat : Alice "],
    });
  });

  it("does not merge sender fallback IDs that differ only by case", () => {
    const upper = getHushConversationIdentity({
      platform: "wechat",
      sender: "Alice",
      chat: null,
    });
    const lower = getHushConversationIdentity({
      platform: "wechat",
      sender: "alice",
      chat: null,
    });

    expect(upper.id).toBe(canonicalId("sender", "wechat", "Alice"));
    expect(lower.id).toBe(canonicalId("sender", "wechat", "alice"));
    expect(upper.id).not.toBe(lower.id);
    expect(upper.legacyIds).toEqual(["wechat:Alice"]);
    expect(lower.legacyIds).toEqual(["wechat:alice"]);
  });

  it("keeps the same notification thread key isolated by platform", () => {
    const wechat = getHushConversationIdentity({
      platform: "wechat",
      sender: "系统通知",
      chat: null,
      source_id: "com.tencent.xinwechat:first",
      raw: {
        source: "macos_notification_center",
        threadIdentifier: " Shared-Thread ",
      },
    });
    const dingtalk = getHushConversationIdentity({
      platform: "dingtalk",
      sender: "系统通知",
      chat: null,
      source_id: "com.alibaba.dingtalkmac:first",
      raw: {
        source: "macos_notification_center",
        threadIdentifier: " Shared-Thread ",
      },
    });

    expect(wechat.id).toBe(
      canonicalId("notification-thread", "wechat", "Shared-Thread"),
    );
    expect(dingtalk.id).toBe(
      canonicalId("notification-thread", "dingtalk", "Shared-Thread"),
    );
    expect(wechat.id).not.toBe(dingtalk.id);
  });

  it("uses distinct canonical kinds for cross-type identity values", () => {
    const sharedValue = "Shared:Key";
    const identities = [
      getHushConversationIdentity({
        platform: "dingtalk",
        sender: "sender",
        chat: "group",
        source_id: "dws:id",
        raw: { source: "dws", conversation_id: sharedValue },
      }),
      getHushConversationIdentity({
        platform: "dingtalk",
        sender: "sender",
        chat: sharedValue,
        source_id: "dws:chat",
        raw: {
          source: "dws",
          conversation_id: "",
          chat_id: "",
          chat: sharedValue,
        },
      }),
      getHushConversationIdentity({
        platform: "dingtalk",
        sender: "sender",
        chat: sharedValue,
        source_id: "com.alibaba.dingtalkmac:thread",
        raw: {
          source: "macos_notification_center",
          threadIdentifier: sharedValue,
        },
      }),
      getHushConversationIdentity({
        platform: "dingtalk",
        sender: sharedValue,
        chat: null,
      }),
    ];

    expect(identities.map(({ id }) => id)).toEqual([
      canonicalId("dws-id", "dingtalk", sharedValue),
      canonicalId("dws-chat", "dingtalk", sharedValue),
      canonicalId("notification-thread", "dingtalk", sharedValue),
      canonicalId("sender", "dingtalk", sharedValue),
    ]);
    expect(new Set(identities.map(({ id }) => id))).toHaveLength(4);
  });

  it("encodes platform and value segments so delimiters cannot collide", () => {
    const platformDelimiter = getHushConversationIdentity({
      platform: "a:b",
      sender: "c",
      chat: null,
    });
    const valueDelimiter = getHushConversationIdentity({
      platform: "a",
      sender: "b:c",
      chat: null,
    });

    expect(platformDelimiter.id).toBe(canonicalId("sender", "a:b", "c"));
    expect(valueDelimiter.id).toBe(canonicalId("sender", "a", "b:c"));
    expect(platformDelimiter.id).not.toBe(valueDelimiter.id);
  });
});

describe("groupHushMessages", () => {
  it("orders messages chronologically inside a conversation", () => {
    const groups = groupHushMessages([
      message("third", "2026-07-18T03:00:00Z"),
      message("first", "2026-07-18T01:00:00Z"),
      message("second", "2026-07-18T02:00:00Z"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.messages.map(({ id }) => id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(groups[0]!.startedAt).toBe("2026-07-18T01:00:00Z");
    expect(groups[0]!.endedAt).toBe("2026-07-18T03:00:00Z");
  });

  it("groups only adjacent messages from the same sender and platform", () => {
    const groups = groupHushMessages([
      message("one", "2026-07-18T01:00:00Z"),
      message("two", "2026-07-18T02:00:00Z"),
      message("three", "2026-07-18T03:00:00Z", "成员乙"),
      message("four", "2026-07-18T04:00:00Z"),
    ]);

    expect(groups.map((group) => group.messages.map(({ id }) => id))).toEqual([
      ["one", "two"],
      ["three"],
      ["four"],
    ]);
  });

  it("starts a new group when either sender or platform changes", () => {
    const groups = groupHushMessages([
      message("one", "2026-07-18T01:00:00Z"),
      message("two", "2026-07-18T02:00:00Z", "成员乙"),
      message("three", "2026-07-18T03:00:00Z", "成员乙", "wechat"),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.map(({ sender, platform }) => [sender, platform])).toEqual([
      ["成员甲", "dingtalk"],
      ["成员乙", "dingtalk"],
      ["成员乙", "wechat"],
    ]);
  });

  it("orders invalid timestamps after valid timestamps and keeps their input order", () => {
    const groups = groupHushMessages([
      message("invalid-first", "not-a-time-1"),
      message("valid-later", "2026-07-18T03:00:00Z"),
      message("invalid-second", "not-a-time-2"),
      message("valid-earlier", "2026-07-18T01:00:00Z"),
    ]);

    expect(
      groups.flatMap((group) => group.messages.map(({ id }) => id)),
    ).toEqual([
      "valid-earlier",
      "valid-later",
      "invalid-first",
      "invalid-second",
    ]);
  });
});

describe("Hush conversation filters", () => {
  const contacts = [
    contact("attention", "2026-07-18T03:00:00Z", [
      message("attention-message", "2026-07-18T03:00:00Z"),
    ]),
    contact("read", "2026-07-18T02:00:00Z", [
      message("read-message", "2026-07-18T02:00:00Z"),
    ]),
    contact("unread", "2026-07-18T01:00:00Z", [
      message("unread-message", "2026-07-18T01:00:00Z"),
    ]),
  ];
  const state: HushConversationState = {
    attentionIds: ["attention"],
    readThrough: {
      attention: "2026-07-18T03:00:00Z",
      read: "2026-07-18T02:00:00Z",
    },
  };

  it("filters all, special-attention, and unread contacts without changing order", () => {
    expect(
      filterHushContacts(contacts, "all", state).map(({ id }) => id),
    ).toEqual(["attention", "read", "unread"]);
    expect(
      filterHushContacts(contacts, "attention", state).map(({ id }) => id),
    ).toEqual(["attention"]);
    expect(
      filterHushContacts(contacts, "unread", state).map(({ id }) => id),
    ).toEqual(["unread"]);
  });

  it("treats a conversation as unread only when its latest message is after read-through", () => {
    expect(isHushContactUnread(contacts[0]!, state)).toBe(false);
    expect(isHushContactUnread(contacts[2]!, state)).toBe(true);
    expect(
      isHushContactUnread(
        contact("newer", "2026-07-18T04:00:00Z", [
          message("newer-message", "2026-07-18T04:00:00Z"),
        ]),
        {
          attentionIds: [],
          readThrough: { newer: "2026-07-18T03:00:00Z" },
        },
      ),
    ).toBe(true);
  });

  it("counts zero, one, multiple, or all unread messages", () => {
    const messages = [
      message("one", "2026-07-18T01:00:00Z"),
      message("two", "2026-07-18T02:00:00Z"),
      message("three", "2026-07-18T03:00:00Z"),
    ];
    const counted = contact("counted", "2026-07-18T03:00:00Z", messages);

    expect(
      getHushUnreadCount(counted, {
        attentionIds: [],
        readThrough: { counted: "2026-07-18T03:00:00Z" },
      }),
    ).toBe(0);
    expect(
      getHushUnreadCount(counted, {
        attentionIds: [],
        readThrough: { counted: "2026-07-18T02:00:00Z" },
      }),
    ).toBe(1);
    expect(
      getHushUnreadCount(counted, {
        attentionIds: [],
        readThrough: { counted: "2026-07-18T01:00:00Z" },
      }),
    ).toBe(2);
    expect(
      getHushUnreadCount(counted, {
        attentionIds: [],
        readThrough: {},
      }),
    ).toBe(3);
  });

  it("uses deterministic conservative unread counts for invalid timestamps", () => {
    const messages = [
      message("valid-earlier", "2026-07-18T01:00:00Z"),
      message("invalid-first", "not-a-time-1"),
      message("valid-later", "2026-07-18T02:00:00Z"),
      message("invalid-second", "not-a-time-2"),
    ];
    const counted = contact("invalid", "not-a-time-2", messages);

    expect(
      getHushUnreadCount(counted, {
        attentionIds: [],
        readThrough: { invalid: "2026-07-18T02:00:00Z" },
      }),
    ).toBe(2);
    expect(
      getHushUnreadCount(counted, {
        attentionIds: [],
        readThrough: { invalid: "not-a-time-1" },
      }),
    ).toBe(1);
    expect(
      getHushUnreadCount(counted, {
        attentionIds: [],
        readThrough: { invalid: "unknown-marker" },
      }),
    ).toBe(4);
  });

  it("resolves selection from all contacts even when the active filter hides it", () => {
    const selected = contacts[1]!;
    const unreadContacts = filterHushContacts(contacts, "unread", state);

    expect(unreadContacts).not.toContain(selected);
    expect(resolveHushSelectedContact(contacts, selected.id)).toBe(selected);
  });
});

describe("Hush conversation state storage", () => {
  it("serializes and parses versioned attention and read-through state", () => {
    const state: HushConversationState = {
      attentionIds: ["dingtalk:conversation:project"],
      readThrough: {
        "dingtalk:conversation:project": "2026-07-18T05:00:00Z",
      },
    };
    const serialized = serializeHushConversationState(state);

    expect(JSON.parse(serialized)).toEqual({ version: 1, ...state });
    expect(parseHushConversationState(serialized)).toEqual(state);
  });

  it("round-trips optional legacy migration metadata in version 1 storage", () => {
    const legacyId = "wechat:WeChat";
    const targetId = canonicalId(
      "notification-thread",
      "wechat",
      "thread-one",
    );
    const state = {
      attentionIds: [targetId],
      readThrough: { [targetId]: "2026-07-18T03:00:00Z" },
      legacyMigrations: {
        [legacyId]: {
          attention: true,
          readThrough: "2026-07-18T03:00:00Z",
          targetIds: [targetId],
        },
      },
    };
    const serialized = serializeHushConversationState(state);

    expect(JSON.parse(serialized)).toEqual({ version: 1, ...state });
    expect(parseHushConversationState(serialized)).toEqual(state);
  });

  it.each([
    null,
    "",
    "{broken",
    JSON.stringify({ version: 2, attentionIds: ["someone"], readThrough: {} }),
    JSON.stringify({ version: 1, attentionIds: "someone", readThrough: [] }),
  ])("returns empty state for malformed storage: %s", (raw) => {
    expect(parseHushConversationState(raw)).toEqual({
      attentionIds: [],
      readThrough: {},
    });
  });
});

describe("migrateHushConversationState", () => {
  it("maps real b6 DWS keys to canonical IDs without losing state", () => {
    const identity = getHushConversationIdentity({
      platform: "DingTalk",
      sender: "成员甲",
      chat: "项目群",
      source_id: "dws:message-1",
      raw: {
        source: "dws",
        conversation_id: " Conversation:42 ",
      },
    });
    const legacyId = "DingTalk:conversation:Conversation:42";
    const readThrough = "2026-07-18T05:00:00Z";
    const migrated = migrateHushConversationState(
      {
        attentionIds: [legacyId, identity.id, legacyId, "unloaded:contact"],
        readThrough: {
          [legacyId]: readThrough,
          "unloaded:contact": "2026-07-18T04:00:00Z",
        },
      },
      [{ id: identity.id, legacyIds: identity.legacyIds }],
    );

    expect(identity.legacyIds).toEqual([legacyId]);
    expect(migrated).toEqual({
      attentionIds: [identity.id, "unloaded:contact"],
      readThrough: {
        [identity.id]: readThrough,
        "unloaded:contact": "2026-07-18T04:00:00Z",
      },
      legacyMigrations: {
        [legacyId]: {
          attention: true,
          readThrough,
          targetIds: [identity.id],
        },
      },
    });
  });

  it("migrates a shared b6 sender state across contacts loaded in stages", () => {
    const legacyId = "wechat:WeChat";
    const firstId = canonicalId(
      "notification-thread",
      "wechat",
      "thread-one",
    );
    const secondId = canonicalId(
      "notification-thread",
      "wechat",
      "thread-two",
    );
    const readThrough = "2026-07-18T03:00:00Z";
    const firstStage = migrateHushConversationState(
      {
        attentionIds: [legacyId, legacyId],
        readThrough: { [legacyId]: readThrough },
      },
      [{ id: firstId, legacyIds: [legacyId] }],
    );

    expect(firstStage).toEqual({
      attentionIds: [firstId],
      readThrough: {
        [firstId]: readThrough,
      },
      legacyMigrations: {
        [legacyId]: {
          attention: true,
          readThrough,
          targetIds: [firstId],
        },
      },
    });

    const secondStage = migrateHushConversationState(firstStage, [
      { id: firstId, legacyIds: [legacyId] },
      { id: secondId, legacyIds: [legacyId] },
    ]);

    expect(secondStage).toEqual({
      attentionIds: [firstId, secondId],
      readThrough: {
        [firstId]: readThrough,
        [secondId]: readThrough,
      },
      legacyMigrations: {
        [legacyId]: {
          attention: true,
          readThrough,
          targetIds: [firstId, secondId],
        },
      },
    });
  });

  it("does not restore user changes while new targets inherit the legacy source", () => {
    const legacyId = "wechat:WeChat";
    const firstId = canonicalId(
      "notification-thread",
      "wechat",
      "thread-one",
    );
    const secondId = canonicalId(
      "notification-thread",
      "wechat",
      "thread-two",
    );
    const legacyReadThrough = "2026-07-18T03:00:00Z";
    const updatedReadThrough = "2026-07-18T05:00:00Z";
    const firstStage = migrateHushConversationState(
      {
        attentionIds: [legacyId],
        readThrough: { [legacyId]: legacyReadThrough },
      },
      [{ id: firstId, legacyIds: [legacyId] }],
    );
    const userUpdated = {
      ...firstStage,
      attentionIds: [],
      readThrough: { [firstId]: updatedReadThrough },
    };

    expect(
      migrateHushConversationState(userUpdated, [
        { id: firstId, legacyIds: [legacyId] },
      ]),
    ).toBe(userUpdated);

    const secondStage = migrateHushConversationState(userUpdated, [
      { id: firstId, legacyIds: [legacyId] },
      { id: secondId, legacyIds: [legacyId] },
    ]);

    expect(secondStage).toEqual({
      attentionIds: [secondId],
      readThrough: {
        [firstId]: updatedReadThrough,
        [secondId]: legacyReadThrough,
      },
      legacyMigrations: {
        [legacyId]: {
          attention: true,
          readThrough: legacyReadThrough,
          targetIds: [firstId, secondId],
        },
      },
    });
    expect(
      migrateHushConversationState(secondStage, [
        { id: firstId, legacyIds: [legacyId] },
        { id: secondId, legacyIds: [legacyId] },
      ]),
    ).toBe(secondStage);
  });

  it("returns the original state when no loaded contact needs migration", () => {
    const state: HushConversationState = {
      attentionIds: ["unloaded:contact"],
      readThrough: { "unloaded:contact": "2026-07-18T03:00:00Z" },
    };

    expect(
      migrateHushConversationState(state, [
        {
          id: canonicalId("sender", "wechat", "Alice"),
          legacyIds: ["wechat:Alice"],
        },
      ]),
    ).toBe(state);
  });
});
