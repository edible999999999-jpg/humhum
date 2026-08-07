// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HushReplyComposer } from "./HushReplyComposer";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("HushReplyComposer", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps prepare and consequential send as two distinct user actions", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "prepare_hush_reply") {
        return Promise.resolve({
          confirmation_id: "confirmation-1",
          platform: "dingtalk",
          conversation: "成员乙",
          body: "我看到了，稍后确认好再回复你。",
          expires_at: "2026-07-28T08:02:00Z",
          delivery_mode: "dingtalk_dws",
          notice: "只有点击确认后才会发送。",
        });
      }
      if (command === "confirm_hush_reply") {
        return Promise.resolve({
          platform: "dingtalk",
          conversation: "成员乙",
          sent_at: "2026-07-28T08:00:10Z",
          status: "sent",
        });
      }
      throw new Error(`unexpected command ${command}`);
    });

    await act(async () => {
      root.render(
        <HushReplyComposer
          conversationName="成员乙"
          targetMessageId="hush-message-1"
          messages={[
            {
              sender: "成员乙",
              text: "明天下午三点开会可以吗？",
              received_at: "2026-07-28T04:00:00Z",
            },
          ]}
        />,
      );
    });

    const localDraftButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("快捷短语"));
    expect(localDraftButton).toBeTruthy();
    await act(async () => localDraftButton?.click());

    const textarea = container.querySelector("textarea");
    expect(textarea?.value).toBe("我看到了，稍后确认好再回复你。");

    const prepareButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("检查收件人与内容"),
    );
    await act(async () => prepareButton?.click());

    expect(invokeMock).toHaveBeenCalledWith("prepare_hush_reply", {
      messageId: "hush-message-1",
      body: "我看到了，稍后确认好再回复你。",
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "confirm_hush_reply",
      expect.anything(),
    );
    expect(container.textContent).toContain("发送给：成员乙");

    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("确认发送"),
    );
    await act(async () => confirmButton?.click());

    expect(invokeMock).toHaveBeenCalledWith("confirm_hush_reply", {
      confirmationId: "confirmation-1",
    });
    expect(container.textContent).toContain("已发送");
  });

  it("does not render send controls without a verified direct-message target", async () => {
    await act(async () => {
      root.render(
        <HushReplyComposer
          conversationName="项目群"
          targetMessageId={null}
          messages={[]}
        />,
      );
    });

    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("只对已确认收件人的真实单聊开放");
  });
});
