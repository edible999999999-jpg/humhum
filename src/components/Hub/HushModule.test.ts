import { describe, expect, it } from "vitest";
import { compareHushContacts } from "./HushModule";

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
