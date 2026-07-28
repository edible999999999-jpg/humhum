import { beforeEach, describe, expect, it, vi } from "vitest";

const { askMock, createRuntimeMock, invokeMock } = vi.hoisted(() => ({
  askMock: vi.fn(),
  createRuntimeMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../pi/runtime", () => ({
  createHumiPiRuntime: createRuntimeMock,
}));

import { runHushReplySkill } from "./replySkill";

describe("runHushReplySkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({
      pi: {
        url: "https://example.com/v1",
        token: "test-token",
        model_name: "test-model",
      },
    });
    askMock.mockResolvedValue("建议回复：可以，明天下午三点我有空。");
    createRuntimeMock.mockReturnValue({ ask: askMock });
  });

  it("loads the current config and makes exactly one contextual Skill call", async () => {
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

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_config");
    expect(createRuntimeMock).toHaveBeenCalledTimes(1);
    expect(askMock).toHaveBeenCalledTimes(1);
    expect(askMock.mock.calls[0]?.[0]).toContain("成员乙");
    expect(askMock.mock.calls[0]?.[0]).toContain(
      "明天下午三点开会可以吗？",
    );
    expect(askMock.mock.calls[0]?.[0]).toContain("只输出一条可直接发送的回复");
    expect(suggestion).toBe("可以，明天下午三点我有空。");
  });
});
