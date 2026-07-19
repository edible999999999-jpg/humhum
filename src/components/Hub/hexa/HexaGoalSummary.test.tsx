// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HexaDevelopmentGoal,
  HexaGoalAttempt,
  HexaGoalSummary as HexaGoalSummaryData,
} from "../../../hooks/hexaGoalMonitoring";
import type { HexaWatchedSession } from "../../../hooks/useHexaData";
import { HexaGoalSummary } from "./HexaGoalSummary";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function watchedSession(
  sessionId: string,
  overrides: Partial<HexaWatchedSession> = {},
): HexaWatchedSession {
  return {
    session_id: sessionId,
    agent: "codex",
    name: `Session ${sessionId}`,
    provider: "codex",
    workspace: "/workspace/humhum",
    goal: "Ship a trustworthy result",
    status: "completed",
    current_step: "Verification finished",
    blocked_reason: null,
    need_user: false,
    confidence: "agent-bound",
    started_at: "2026-07-19T08:00:00.000Z",
    updated_at: "2026-07-19T09:00:00.000Z",
    audit: {
      goal_revisions: [],
      success_criteria: [],
      work_items: [],
      milestones: [],
      important_outputs: [],
      interventions: [],
      hexa_review: null,
      user_review: null,
    },
    ...overrides,
  };
}

function attempt(
  sessionId: string,
  overrides: Partial<HexaGoalAttempt> = {},
): HexaGoalAttempt {
  return {
    session_id: sessionId,
    agent_family: "codex",
    surface: "codex_desktop",
    workspace: "/workspace/humhum",
    branch: "codex/hexa-goals",
    worktree: "/workspace/humhum",
    result_status: "unverified",
    evidence: [{
      id: `evidence-${sessionId}`,
      kind: "test",
      label: `${sessionId} tests passed`,
      location: null,
      observed_at: "2026-07-19T09:00:00.000Z",
    }],
    linked_at: "2026-07-19T08:00:00.000Z",
    completed_at: "2026-07-19T09:00:00.000Z",
    ...overrides,
  };
}

function goal(overrides: Partial<HexaDevelopmentGoal> = {}): HexaDevelopmentGoal {
  return {
    id: "goal-1",
    project_key: "/workspace/humhum",
    title: "修复 Hush 消息分类",
    success_criteria: ["群聊与单聊可正确区分", "聚焦会话可被验证"],
    status: "waiting",
    attempts: [],
    accepted_attempt_id: null,
    created_at: "2026-07-19T08:00:00.000Z",
    updated_at: "2026-07-19T09:00:00.000Z",
    ...overrides,
  };
}

async function renderSummary(
  summary: HexaGoalSummaryData,
  handlers: {
    onAccept?: (goalId: string, sessionId: string) => Promise<unknown> | unknown;
    onDelete?: (goalId: string) => Promise<unknown> | unknown;
  } = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onAccept = handlers.onAccept ?? vi.fn();
  const onDelete = handlers.onDelete ?? vi.fn();
  await act(async () => {
    root.render(
      <HexaGoalSummary
        summary={summary}
        onViewSession={vi.fn()}
        onAccept={onAccept}
        onDelete={onDelete}
      />,
    );
  });
  return { host, root, onAccept, onDelete };
}

async function dispose(view: { host: HTMLDivElement; root: Root }) {
  await act(async () => view.root.unmount());
  view.host.remove();
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button containing: ${text}`);
  return button;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HexaGoalSummary", () => {
  it("explains unverified completion and failed attempts without adding intervention controls", async () => {
    const unverified = attempt("codex-1");
    const failed = attempt("worker-1", {
      agent_family: "qoder",
      surface: "qoder_worker",
      result_status: "failed",
      branch: null,
      evidence: [{
        id: "failure-log",
        kind: "test",
        label: "integration suite failed",
        location: null,
        observed_at: "2026-07-19T09:00:00.000Z",
      }],
    });
    const summary: HexaGoalSummaryData = {
      goal: goal({ attempts: [unverified, failed] }),
      attempts: [
        { attempt: unverified, session: watchedSession("codex-1") },
        { attempt: failed, session: watchedSession("worker-1", { agent: "qoder" }) },
      ],
      counts: { total: 2, working: 0, verified: 0, failed: 1, blocked: 0, unverified: 1 },
    };

    const view = await renderSummary(summary);

    expect(view.host.textContent).toContain("已完成，尚未验证");
    expect(view.host.textContent).toContain("测试失败");
    expect(view.host.textContent).toContain("Codex Desktop");
    expect(view.host.textContent).toContain("Qoder Worker");
    expect(view.host.textContent).toContain("比较结果");
    expect(view.host.textContent).toContain("阻塞");
    expect(view.host.querySelector("textarea")).toBeNull();
    expect(view.host.textContent).not.toContain("人工介入");
    expect(view.host.textContent).not.toContain("权限确认");
    expect(view.host.textContent).not.toContain("工作流编辑");

    await dispose(view);
  });

  it("lets the user accept one available attempt", async () => {
    const onAccept = vi.fn(async () => undefined);
    const result = attempt("codex-1");
    const view = await renderSummary({
      goal: goal({ attempts: [result] }),
      attempts: [{ attempt: result, session: watchedSession("codex-1") }],
      counts: { total: 1, working: 0, verified: 0, failed: 0, blocked: 0, unverified: 1 },
    }, { onAccept });

    await act(async () => {
      buttonByText(view.host, "采用此结果").click();
      await Promise.resolve();
    });

    expect(onAccept).toHaveBeenCalledWith("goal-1", "codex-1");
    await dispose(view);
  });

  it("does not show comparison copy with fewer than two available attempts", async () => {
    const result = attempt("codex-1");
    const orphan = attempt("missing-worker", {
      agent_family: "qoder",
      surface: "qoder_worker",
    });
    const view = await renderSummary({
      goal: goal({ attempts: [result, orphan] }),
      attempts: [
        { attempt: result, session: watchedSession("codex-1") },
        { attempt: orphan, session: null },
      ],
      counts: { total: 2, working: 0, verified: 0, failed: 0, blocked: 0, unverified: 2 },
    });

    expect(view.host.textContent).toContain("历史会话不可用");
    expect(view.host.textContent).not.toContain("比较结果");
    await dispose(view);
  });

  it("shows the newest evidence from the strongest trust tier", async () => {
    const result = attempt("codex-1", {
      evidence: [
        {
          id: "agent-newest",
          kind: "agent_report",
          label: "Agent claims completion",
          location: null,
          observed_at: "2026-07-19T12:00:00.000Z",
        },
        {
          id: "test-old",
          kind: "test",
          label: "older trusted test",
          location: null,
          observed_at: "2026-07-19T09:00:00.000Z",
        },
        {
          id: "artifact-newer",
          kind: "artifact",
          label: "newer artifact",
          location: null,
          observed_at: "2026-07-19T13:00:00.000Z",
        },
        {
          id: "test-new",
          kind: "test",
          label: "newest trusted test",
          location: null,
          observed_at: "2026-07-19T10:00:00.000Z",
        },
      ],
    });
    const view = await renderSummary({
      goal: goal({ attempts: [result] }),
      attempts: [{ attempt: result, session: watchedSession("codex-1") }],
      counts: { total: 1, working: 0, verified: 0, failed: 0, blocked: 0, unverified: 1 },
    });

    expect(view.host.textContent).toContain("newest trusted test");
    expect(view.host.textContent).not.toContain("Agent claims completion");
    expect(view.host.textContent).not.toContain("newer artifact");
    await dispose(view);
  });

  it("surfaces an accept failure and re-enables the action", async () => {
    const result = attempt("codex-1");
    const onAccept = vi.fn(async () => {
      throw new Error("accept failed");
    });
    const view = await renderSummary({
      goal: goal({ attempts: [result] }),
      attempts: [{ attempt: result, session: watchedSession("codex-1") }],
      counts: { total: 1, working: 0, verified: 0, failed: 0, blocked: 0, unverified: 1 },
    }, { onAccept });

    await act(async () => {
      buttonByText(view.host, "采用此结果").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.host.querySelector('[role="alert"]')?.textContent)
      .toContain("采用失败，请重试");
    expect(buttonByText(view.host, "采用此结果").disabled).toBe(false);
    await dispose(view);
  });

  it("prevents duplicate acceptance while the mutation is pending", async () => {
    const result = attempt("codex-1");
    let resolveAccept: ((value?: unknown) => void) | null = null;
    const onAccept = vi.fn(() => new Promise<unknown>((resolve) => {
      resolveAccept = resolve;
    }));
    const view = await renderSummary({
      goal: goal({ attempts: [result] }),
      attempts: [{ attempt: result, session: watchedSession("codex-1") }],
      counts: { total: 1, working: 0, verified: 0, failed: 0, blocked: 0, unverified: 1 },
    }, { onAccept });
    const acceptButton = buttonByText(view.host, "采用此结果");

    await act(async () => {
      acceptButton.click();
    });
    expect(acceptButton.disabled).toBe(true);
    expect(acceptButton.textContent).toContain("正在采用");
    acceptButton.click();
    expect(onAccept).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAccept?.();
      await Promise.resolve();
    });

    expect(acceptButton.disabled).toBe(false);
    expect(acceptButton.textContent).toContain("采用此结果");
    await dispose(view);
  });

  it("surfaces a delete failure and prevents duplicate deletion while pending", async () => {
    const result = attempt("codex-1");
    let rejectDelete: ((reason?: unknown) => void) | null = null;
    const onDelete = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
      rejectDelete = reject;
    }));
    const view = await renderSummary({
      goal: goal({ attempts: [result] }),
      attempts: [{ attempt: result, session: watchedSession("codex-1") }],
      counts: { total: 1, working: 0, verified: 0, failed: 0, blocked: 0, unverified: 1 },
    }, { onDelete });
    const deleteButton = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="删除开发目标"]',
    );
    if (!deleteButton) throw new Error("Missing delete goal button");

    await act(async () => {
      deleteButton.click();
    });
    expect(deleteButton.disabled).toBe(true);
    deleteButton.click();
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectDelete?.(new Error("delete failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.host.querySelector('[role="alert"]')?.textContent)
      .toContain("删除失败，请重试");
    expect(deleteButton.disabled).toBe(false);
    await dispose(view);
  });
});
