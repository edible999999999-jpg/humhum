import { describe, expect, it } from "vitest";
import { compareHushContacts, getHushConversationIdentity } from "./HushModule";

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
