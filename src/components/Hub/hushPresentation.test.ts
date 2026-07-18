import { describe, expect, it } from "vitest";
import {
  filterHushContacts,
  getHushConversationIdentity,
  getHushUnreadCount,
  groupHushMessages,
  isHushContactUnread,
  parseHushConversationState,
  resolveHushSelectedContact,
  serializeHushConversationState,
  type DerivedContact,
  type HushConversationState,
  type HushInboxMessage,
} from "./hushPresentation";

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
    name: id,
    tier: "work",
    platforms: ["dingtalk"],
    lastMessage: messages[messages.length - 1]?.text ?? "",
    lastMessageTime,
    importance: 2,
    messages,
  };
}

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

    expect(first.id).toBe("wechat:conversation:thread-one");
    expect(second.id).toBe("wechat:conversation:thread-two");
    expect(first.id).not.toBe(second.id);
  });

  it("uses normalized DWS conversation_id and chat_id values as stable keys", () => {
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
        chat_id: " project-42 ",
      },
    });

    expect(fromConversationId).toEqual({
      id: "dingtalk:conversation:project-42",
      name: "项目群",
    });
    expect(fromChatId.id).toBe(fromConversationId.id);
  });

  it("falls back to a normalized platform and sender when metadata is missing", () => {
    const first = getHushConversationIdentity({
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
    const second = getHushConversationIdentity({
      platform: "wechat",
      sender: "alice",
      chat: " ",
      source_id: "com.tencent.xinwechat:second",
    });

    expect(first).toEqual({ id: "wechat:alice", name: "Alice" });
    expect(second.id).toBe(first.id);
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
