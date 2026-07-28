// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookEvent } from "@/types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { ConfirmToast } from "./ConfirmToast";
import { QuestionToast } from "./QuestionToast";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const permissionEvent: HookEvent = {
  id: "permission-1",
  hook_event_name: "PermissionRequest",
  session_id: "session-1",
  client_type: "Codex",
  timestamp: new Date().toISOString(),
  payload: {
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
  },
};

const questionEvent: HookEvent = {
  ...permissionEvent,
  id: "question-1",
  payload: {
    hook_event_name: "PermissionRequest",
    tool_input: {
      questions: [{
        question: "继续执行吗？",
        options: [{ label: "继续" }, { label: "停止" }],
      }],
    },
  },
};

async function render(element: React.ReactElement): Promise<{
  host: HTMLDivElement;
  root: Root;
}> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });
  return { host, root };
}

async function dispose(view: { host: HTMLDivElement; root: Root }) {
  await act(async () => view.root.unmount());
  view.host.remove();
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("permission toast failure semantics", () => {
  it("keeps ConfirmToast open when the backend rejects the answer", async () => {
    const onConfirm = vi.fn();
    invokeMock.mockRejectedValueOnce(new Error("bridge unavailable"));
    const view = await render(createElement(ConfirmToast, { event: permissionEvent, onConfirm }));
    const allowButton = Array.from(view.host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Y"));

    await act(async () => {
      allowButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(view.host.textContent).toContain("bridge unavailable");
    expect(allowButton?.disabled).toBe(false);
    await dispose(view);
  });

  it("treats closing a blocking question as deny and dismisses only after success", async () => {
    const onDismiss = vi.fn();
    invokeMock.mockResolvedValueOnce(undefined);
    const view = await render(createElement(QuestionToast, { event: questionEvent, onDismiss }));
    const closeButton = view.host.querySelector<HTMLButtonElement>("button");

    await act(async () => {
      closeButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("respond_to_permission", {
      eventId: questionEvent.id,
      behavior: "deny",
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await dispose(view);
  });

  it("keeps a blocking question open when submitting an option fails", async () => {
    const onDismiss = vi.fn();
    invokeMock.mockRejectedValueOnce(new Error("answer failed"));
    const view = await render(createElement(QuestionToast, { event: questionEvent, onDismiss }));
    const option = Array.from(view.host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("继续"));

    await act(async () => {
      option?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(view.host.textContent).toContain("answer failed");
    expect(option?.disabled).toBe(false);
    await dispose(view);
  });
});
