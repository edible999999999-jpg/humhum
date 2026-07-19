// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HexaDevelopmentGoal,
  HexaGoalAttempt,
} from "../../../hooks/hexaGoalMonitoring";
import type { HexaWatchedSession } from "../../../hooks/useHexaData";
import { HexaActiveMonitor } from "./HexaActiveMonitor";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function watchedSession(
  sessionId = "session-1",
  overrides: Partial<HexaWatchedSession> = {},
): HexaWatchedSession {
  return {
    session_id: sessionId,
    agent: "codex",
    name: sessionId === "codex-1" ? "Codex attempt" : `Session ${sessionId}`,
    provider: "codex",
    workspace: "/workspace/humhum",
    goal: "Preserve the current session report",
    status: "working",
    current_step: "Implementing selectors",
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
  surface: HexaGoalAttempt["surface"],
  agentFamily: string,
): HexaGoalAttempt {
  return {
    session_id: sessionId,
    agent_family: agentFamily,
    surface,
    workspace: "/workspace/humhum",
    branch: null,
    worktree: "/workspace/humhum",
    result_status: "unverified",
    evidence: [],
    linked_at: "2026-07-19T08:00:00.000Z",
    completed_at: null,
  };
}

function developmentGoal(
  id = "goal-1",
  title = "修复 Hush 消息分类",
): HexaDevelopmentGoal {
  return {
    id,
    project_key: "/workspace/humhum",
    title,
    success_criteria: ["分类准确"],
    status: "active",
    attempts: [
      attempt("codex-1", "codex_desktop", "codex"),
      attempt("worker-1", "qoder_worker", "qoder"),
    ],
    accepted_attempt_id: null,
    created_at: "2026-07-19T08:00:00.000Z",
    updated_at: "2026-07-19T09:00:00.000Z",
  };
}

type MonitorProps = Parameters<typeof HexaActiveMonitor>[0];

async function renderMonitor(overrides: Partial<MonitorProps>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: MonitorProps = {
    sessions: [],
    developmentGoals: [],
    supervisorBySessionId: new Map(),
    dataState: "ready",
    goalDataState: "ready",
    entryPanel: null,
    onRetry: vi.fn(async () => undefined),
    onRetryGoals: vi.fn(async () => undefined),
    onFocus: vi.fn(async () => ({
      strategy: "application" as const,
      application: null,
      exact: false,
    })),
    onDelete: vi.fn(async () => undefined),
    onMutate: vi.fn(async () => undefined),
    onAcceptGoalAttempt: vi.fn(async () => undefined),
    onDeleteGoal: vi.fn(async () => undefined),
    ...overrides,
  };
  await act(async () => {
    root.render(<HexaActiveMonitor {...props} />);
  });
  return { host, root, props };
}

async function rerender(
  view: { root: Root; props: MonitorProps },
  overrides: Partial<MonitorProps>,
) {
  view.props = { ...view.props, ...overrides };
  await act(async () => {
    view.root.render(<HexaActiveMonitor {...view.props} />);
  });
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

describe("HexaActiveMonitor development goals", () => {
  it("preserves the existing session report for one independent session", async () => {
    const view = await renderMonitor({
      sessions: [watchedSession()],
      developmentGoals: [],
    });

    const report = view.host.querySelector('[aria-label="选中会话监督报告"]');
    expect(report).not.toBeNull();
    expect(report?.textContent).toContain("Preserve the current session report");
    expect(view.host.textContent).not.toContain("比较结果");
    await dispose(view);
  });

  it("renders one development goal with distinct attempt surfaces", async () => {
    const view = await renderMonitor({
      sessions: [
        watchedSession("codex-1"),
        watchedSession("worker-1", { agent: "qoder", provider: "qoder" }),
      ],
      developmentGoals: [developmentGoal()],
    });

    expect(view.host.textContent).toContain("修复 Hush 消息分类");
    expect(view.host.textContent).toContain("Codex Desktop");
    expect(view.host.textContent).toContain("Qoder Worker");
    await dispose(view);
  });

  it("keeps a one-attempt goal session-first unless a goal focus is requested", async () => {
    const singleGoal = developmentGoal("goal-single", "保留单会话报告");
    singleGoal.attempts = [attempt("codex-1", "codex_desktop", "codex")];
    const sessions = [watchedSession("codex-1")];
    const view = await renderMonitor({
      sessions,
      developmentGoals: [singleGoal],
    });

    expect(view.host.querySelector('[aria-label="Codex attempt 会话监督报告"]'))
      .not.toBeNull();
    expect(view.host.querySelector('[aria-label="开发目标摘要"]')).toBeNull();

    await rerender(view, { focusGoalId: "goal-single" });

    expect(view.host.querySelector('[aria-label="开发目标摘要"]')?.textContent)
      .toContain("保留单会话报告");
    await dispose(view);
  });

  it("keeps an orphan-only goal reachable for history and deletion", async () => {
    const orphan = developmentGoal("goal-orphan", "保留历史目标");
    orphan.attempts = [attempt("missing-session", "qoder_worker", "qoder")];
    const view = await renderMonitor({
      sessions: [],
      developmentGoals: [orphan],
    });

    expect(view.host.querySelector('[aria-label="开发目标摘要"]')?.textContent)
      .toContain("历史会话不可用");
    expect(view.host.textContent).not.toContain("还没有主动监控的会话");
    expect(view.host.querySelector('[aria-label="删除开发目标"]')).not.toBeNull();
    await dispose(view);
  });

  it("offers a dedicated retry when development goals fail to refresh", async () => {
    const onRetryGoals = vi.fn(async () => undefined);
    const view = await renderMonitor({
      goalDataState: "error",
      onRetryGoals,
    });

    await act(async () => {
      buttonByText(view.host, "重试目标").click();
      await Promise.resolve();
    });

    expect(onRetryGoals).toHaveBeenCalledTimes(1);
    await dispose(view);
  });

  it("opens the unchanged session report when an attempt is selected", async () => {
    const view = await renderMonitor({
      sessions: [
        watchedSession("codex-1"),
        watchedSession("worker-1", { agent: "qoder", provider: "qoder" }),
      ],
      developmentGoals: [developmentGoal()],
    });

    await act(async () => {
      buttonByText(view.host, "Codex Desktop").click();
    });

    const report = view.host.querySelector('[aria-label="选中会话监督报告"]');
    expect(report?.querySelector('[aria-label="Codex attempt 会话监督报告"]'))
      .not.toBeNull();
    await dispose(view);
  });

  it("keeps a valid focused goal selected when a later focus id is unknown", async () => {
    const secondGoal = developmentGoal("goal-2", "完成 Hexa 比较视图");
    const sessions = [
      watchedSession("codex-1"),
      watchedSession("worker-1", { agent: "qoder", provider: "qoder" }),
    ];
    const view = await renderMonitor({
      sessions,
      developmentGoals: [developmentGoal(), secondGoal],
      focusGoalId: "goal-2",
    });

    expect(view.host.querySelector('[aria-label="开发目标摘要"]')?.textContent)
      .toContain("完成 Hexa 比较视图");

    await rerender(view, { focusGoalId: "missing-goal" });

    expect(view.host.querySelector('[aria-label="开发目标摘要"]')?.textContent)
      .toContain("完成 Hexa 比较视图");
    await dispose(view);
  });

  it("consumes the same valid focus id once across goal and session refreshes", async () => {
    const sessions = [
      watchedSession("codex-1"),
      watchedSession("worker-1", { agent: "qoder", provider: "qoder" }),
    ];
    const view = await renderMonitor({
      sessions,
      developmentGoals: [developmentGoal()],
      focusGoalId: "goal-1",
    });

    await act(async () => {
      buttonByText(view.host, "Codex Desktop").click();
    });
    expect(view.host.querySelector('[aria-label="Codex attempt 会话监督报告"]'))
      .not.toBeNull();

    await rerender(view, {
      sessions: sessions.map((session) => ({
        ...session,
        updated_at: "2026-07-19T10:00:00.000Z",
      })),
      developmentGoals: [{
        ...developmentGoal(),
        updated_at: "2026-07-19T10:00:00.000Z",
      }],
      focusGoalId: "goal-1",
    });

    expect(view.host.querySelector('[aria-label="Codex attempt 会话监督报告"]'))
      .not.toBeNull();
    expect(view.host.querySelector('[aria-label="开发目标摘要"]')).toBeNull();
    await dispose(view);
  });

  it("focuses a delayed goal once and does not reclaim selection on later refresh", async () => {
    const sessions = [
      watchedSession("codex-1"),
      watchedSession("worker-1", { agent: "qoder", provider: "qoder" }),
    ];
    const view = await renderMonitor({
      sessions,
      developmentGoals: [],
      focusGoalId: "goal-1",
    });

    expect(view.host.querySelector('[aria-label="开发目标摘要"]')).toBeNull();

    await rerender(view, {
      developmentGoals: [
        developmentGoal("goal-2", "保持默认目标"),
        developmentGoal(),
      ],
      focusGoalId: "goal-1",
    });

    expect(view.host.querySelector('[aria-label="开发目标摘要"]')?.textContent)
      .toContain("修复 Hush 消息分类");

    await act(async () => {
      buttonByText(view.host, "Codex Desktop").click();
    });
    await rerender(view, {
      sessions: sessions.map((session) => ({
        ...session,
        updated_at: "2026-07-19T10:30:00.000Z",
      })),
      developmentGoals: [{
        ...developmentGoal(),
        updated_at: "2026-07-19T10:30:00.000Z",
      }],
      focusGoalId: "goal-1",
    });

    expect(view.host.querySelector('[aria-label="Codex attempt 会话监督报告"]'))
      .not.toBeNull();
    expect(view.host.querySelector('[aria-label="开发目标摘要"]')).toBeNull();
    await dispose(view);
  });

  it("toggles an already selected goal disclosure without changing selection", async () => {
    const view = await renderMonitor({
      sessions: [
        watchedSession("codex-1"),
        watchedSession("worker-1", { agent: "qoder", provider: "qoder" }),
      ],
      developmentGoals: [developmentGoal()],
    });

    const collapse = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="折叠目标 修复 Hush 消息分类"]',
    );
    expect(collapse).not.toBeNull();
    await act(async () => collapse?.click());

    expect(view.host.querySelector('[aria-label="开发目标摘要"]')?.textContent)
      .toContain("修复 Hush 消息分类");
    expect(view.host.textContent).not.toContain("Codex attempt");

    const expand = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="展开目标 修复 Hush 消息分类"]',
    );
    expect(expand).not.toBeNull();
    await act(async () => expand?.click());
    expect(view.host.textContent).toContain("Codex Desktop");
    await dispose(view);
  });
});
