import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { runHushReplySkill } from "./replySkill";

describe("runHushReplySkill", () => {
  it("creates a local draft without invoking Tauri or a model provider", async () => {
    const suggestion = await runHushReplySkill({
      conversationName: "成员乙",
      messages: [
        {
          sender: "成员乙",
          text: "明天下午三点开会可以吗？",
          received_at: "2026-07-18T04:00:00Z",
        },
      ],
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(suggestion).toBe("我看到了，稍后确认好再回复你。");
  });

  it("uses a short acknowledgement when the latest message is not a question", async () => {
    const suggestion = await runHushReplySkill({
      conversationName: "成员乙",
      messages: [
        {
          sender: "成员乙",
          text: "文件已经发给你了",
          received_at: "2026-07-18T04:00:00Z",
        },
      ],
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(suggestion).toBe("收到，我看到了。");
  });
});
