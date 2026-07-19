// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { HumiModule } from "./HumiModule";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const appConfig = {
  hook_port: 31275,
  api_keys: {},
  tts: {
    provider: "edge",
    voice: "zh-CN-XiaoxiaoNeural",
    speed: 1,
  },
  stt: {
    provider: "web-speech",
    language: "zh-CN",
  },
  summarizer: {
    api_base: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    max_tokens: 500,
  },
  pi: {
    url: "https://api.openai.com/v1",
    model_name: "gpt-4o-mini",
  },
  mobile_relay: {
    enabled: false,
    base_url: null,
    invite_code: null,
  },
  ui: {
    position: "bottom-right",
    language: "zh",
    auto_confirm: false,
    auto_confirm_sessions: [],
    analytics_enabled: true,
    awake_mode: false,
  },
};

function invokeResult(command: string): unknown {
  if (command === "get_active_sessions") {
    return [
      {
        session_id: "codex-live-1",
        client_type: "codex",
        project_name: "HUMHUM",
        status: "active",
        event_count: 42,
        last_event_at: "2026-07-19T02:30:00Z",
        last_tool_name: "exec_command",
      },
    ];
  }
  if (command === "check_hooks_status") return { codex: true };
  if (command === "get_config") return appConfig;
  if (command === "check_pi_installed") return { installed: true };
  if (command === "check_qoder_acp_support") {
    return { installed: true, acp_supported: true, hint: "" };
  }
  if (command === "get_agent_kernel_status") {
    return {
      version: "1",
      loop_model: [],
      roles: [],
      memory_layers: [],
      active_bridges: [],
      next_kernel_step: "",
    };
  }
  if (command === "get_stats") {
    return {
      total_tokens: 1_280_000,
      total_input_tokens: 1_200_000,
      total_output_tokens: 80_000,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      active_agents: 2,
      total_tool_calls: 97,
      unique_tool_names: ["exec_command"],
      total_sessions: 41,
      sessions_by_client: { codex: 41 },
      cost_today_usd: 0,
      cost_7d_usd: 0,
      cost_30d_usd: 0,
      daily_buckets: [],
    };
  }
  if (command === "get_hexa_development_goals") {
    return [
      {
        id: "goal-failed",
        project_key: "humhum",
        title: "恢复主动监控提醒",
        success_criteria: ["未完成目标需要确认时能够提醒用户"],
        status: "waiting",
        attempts: [
          {
            session_id: "hexa-attempt-failed",
            agent_family: "codex",
            surface: "codex_desktop",
            workspace: "/tmp/humhum",
            branch: "codex/hexa-monitoring",
            worktree: "/tmp/humhum",
            result_status: "failed",
            evidence: [],
            linked_at: "2026-07-19T03:00:00Z",
            completed_at: "2026-07-19T03:30:00Z",
          },
        ],
        accepted_attempt_id: null,
        created_at: "2026-07-19T03:00:00Z",
        updated_at: "2026-07-19T03:30:00Z",
      },
    ];
  }
  if (command === "get_hexa_watched_sessions") {
    return [
      {
        session_id: "hexa-attempt-failed",
        agent: "codex",
        name: "Hexa attempt",
        provider: "codex",
        workspace: "/tmp/humhum",
        goal: "恢复主动监控提醒",
        status: "completed",
        current_step: null,
        blocked_reason: null,
        need_user: false,
        confidence: "high",
        started_at: "2026-07-19T03:00:00Z",
        updated_at: "2026-07-19T03:30:00Z",
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
      },
    ];
  }
  if (command === "synthesize_system_speech") return "audio-base64";
  if (
    command === "play_audio" ||
    command === "focus_agent_session" ||
    command === "save_config"
  ) {
    return undefined;
  }
  throw new Error(`Unexpected invoke: ${command}`);
}

async function renderHumiModule(onOpenHexa = vi.fn()): Promise<{
  host: HTMLDivElement;
  root: Root;
}> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(HumiModule, { onOpenHexa }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { host, root };
}

async function dispose(view: { host: HTMLDivElement; root: Root }) {
  await act(async () => view.root.unmount());
  view.host.remove();
}

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

describe("Humi operational controls", () => {
  beforeEach(() => {
    sessionStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(invokeResult(command)),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps sessions, auto confirm, TTS and token stats visible beside chat", async () => {
    const view = await renderHumiModule();

    expect(view.host.textContent).toContain("实时会话");
    expect(view.host.textContent).toContain("HUMHUM");
    expect(view.host.textContent).toContain("自动确认");
    expect(view.host.textContent).toContain("TTS 播报");
    expect(view.host.textContent).toContain("1.3M");
    expect(view.host.textContent).toContain("41 次会话");
    expect(view.host.textContent).toContain("你好，我是 Humi");
    expect(
      view.host.querySelector('textarea[placeholder="和 Humi 聊聊"]'),
    ).not.toBeNull();

    await dispose(view);
  });

  it("shows one compact Hexa attention summary and opens the most urgent goal", async () => {
    const onOpenHexa = vi.fn();
    const view = await renderHumiModule(onOpenHexa);

    expect(view.host.textContent).toContain("1 个开发目标需要注意");
    expect(view.host.textContent).toContain("1 个验证失败");

    const summary = view.host.querySelector<HTMLButtonElement>(".humi-hexa-summary");
    expect(summary).not.toBeNull();

    await act(async () => {
      summary?.click();
      await Promise.resolve();
    });

    expect(onOpenHexa).toHaveBeenCalledWith("goal-failed");

    await dispose(view);
  });

  it("prioritizes failed goals over newer blocked and unverified goals", async () => {
    const failedGoal = (
      invokeResult("get_hexa_development_goals") as Array<Record<string, unknown>>
    )[0];
    const attemptBase = {
      agent_family: "codex",
      surface: "codex_desktop",
      workspace: "/tmp/humhum",
      branch: null,
      worktree: "/tmp/humhum",
      evidence: [],
      linked_at: "2026-07-19T04:00:00Z",
    };
    const goals = [
      failedGoal,
      {
        ...failedGoal,
        id: "goal-waiting",
        updated_at: "2026-07-19T06:00:00Z",
        attempts: [{
          ...attemptBase,
          session_id: "hexa-attempt-waiting",
          result_status: "unverified",
          completed_at: null,
        }],
      },
      {
        ...failedGoal,
        id: "goal-unverified",
        updated_at: "2026-07-19T07:00:00Z",
        attempts: [{
          ...attemptBase,
          session_id: "hexa-attempt-unverified",
          result_status: "unverified",
          completed_at: "2026-07-19T07:00:00Z",
        }],
      },
      {
        ...failedGoal,
        id: "goal-superseded",
        updated_at: "2026-07-19T08:00:00Z",
        attempts: [{
          ...attemptBase,
          session_id: "hexa-attempt-superseded",
          result_status: "superseded",
          completed_at: "2026-07-19T08:00:00Z",
        }],
      },
      {
        ...failedGoal,
        id: "goal-accepted",
        accepted_attempt_id: "hexa-attempt-accepted",
        updated_at: "2026-07-19T09:00:00Z",
        attempts: [{
          ...attemptBase,
          session_id: "hexa-attempt-accepted",
          result_status: "accepted",
          completed_at: "2026-07-19T09:00:00Z",
        }],
      },
    ];
    const waitingSession = {
      ...(invokeResult("get_hexa_watched_sessions") as Array<Record<string, unknown>>)[0],
      session_id: "hexa-attempt-waiting",
      status: "waiting",
      updated_at: "2026-07-19T06:00:00Z",
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hexa_development_goals") return Promise.resolve(goals);
      if (command === "get_hexa_watched_sessions") {
        return Promise.resolve([waitingSession]);
      }
      return Promise.resolve(invokeResult(command));
    });
    const onOpenHexa = vi.fn();
    const view = await renderHumiModule(onOpenHexa);

    expect(view.host.textContent).toContain("4 个开发目标需要注意");
    expect(view.host.textContent).toContain("1 个验证失败");

    await act(async () => {
      view.host.querySelector<HTMLButtonElement>(".humi-hexa-summary")?.click();
      await Promise.resolve();
    });

    expect(onOpenHexa).toHaveBeenCalledWith("goal-failed");

    await dispose(view);
  });

  it("prioritizes older completed-unverified goals over newer all-terminal goals", async () => {
    const baseGoal = (
      invokeResult("get_hexa_development_goals") as Array<Record<string, unknown>>
    )[0];
    const attemptBase = {
      agent_family: "codex",
      surface: "codex_desktop",
      workspace: "/tmp/humhum",
      branch: null,
      worktree: "/tmp/humhum",
      evidence: [],
      linked_at: "2026-07-19T04:00:00Z",
    };
    const goals = [
      {
        ...baseGoal,
        id: "goal-unverified-older",
        updated_at: "2026-07-19T05:00:00Z",
        attempts: [{
          ...attemptBase,
          session_id: "attempt-unverified-older",
          result_status: "unverified",
          completed_at: "2026-07-19T05:00:00Z",
        }],
      },
      {
        ...baseGoal,
        id: "goal-superseded-newer",
        updated_at: "2026-07-19T08:00:00Z",
        attempts: [{
          ...attemptBase,
          session_id: "attempt-superseded-newer",
          result_status: "superseded",
          completed_at: "2026-07-19T08:00:00Z",
        }],
      },
      {
        ...baseGoal,
        id: "goal-verified-newest",
        updated_at: "2026-07-19T09:00:00Z",
        attempts: [{
          ...attemptBase,
          session_id: "attempt-verified-newest",
          result_status: "verified",
          completed_at: "2026-07-19T09:00:00Z",
        }],
      },
    ];
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hexa_development_goals") return Promise.resolve(goals);
      if (command === "get_hexa_watched_sessions") return Promise.resolve([]);
      return Promise.resolve(invokeResult(command));
    });
    const onOpenHexa = vi.fn();
    const view = await renderHumiModule(onOpenHexa);

    await act(async () => {
      view.host.querySelector<HTMLButtonElement>(".humi-hexa-summary")?.click();
      await Promise.resolve();
    });

    expect(onOpenHexa).toHaveBeenCalledWith("goal-unverified-older");

    await dispose(view);
  });

  it("uses successful waiting sessions when the goal snapshot fails", async () => {
    const waitingSession = {
      ...(invokeResult("get_hexa_watched_sessions") as Array<Record<string, unknown>>)[0],
      status: "waiting",
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hexa_development_goals") {
        return Promise.reject(new Error("Goals unavailable"));
      }
      if (command === "get_hexa_watched_sessions") {
        return Promise.resolve([waitingSession]);
      }
      return Promise.resolve(invokeResult(command));
    });
    const onOpenHexa = vi.fn();
    const view = await renderHumiModule(onOpenHexa);

    expect(view.host.textContent).toContain("1 个开发目标需要注意");
    expect(view.host.textContent).toContain("0 个验证失败");

    await act(async () => {
      view.host.querySelector<HTMLButtonElement>(".humi-hexa-summary")?.click();
      await Promise.resolve();
    });

    expect(onOpenHexa).toHaveBeenCalledWith(null);

    await dispose(view);
  });

  it("uses successful failed goals when the watched session snapshot fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_hexa_watched_sessions") {
        return Promise.reject(new Error("Sessions unavailable"));
      }
      return Promise.resolve(invokeResult(command));
    });
    const onOpenHexa = vi.fn();
    const view = await renderHumiModule(onOpenHexa);

    expect(view.host.textContent).toContain("1 个开发目标需要注意");
    expect(view.host.textContent).toContain("1 个验证失败");

    await act(async () => {
      view.host.querySelector<HTMLButtonElement>(".humi-hexa-summary")?.click();
      await Promise.resolve();
    });

    expect(onOpenHexa).toHaveBeenCalledWith("goal-failed");

    await dispose(view);
  });

  it("keeps the original Humi operations usable when Hexa snapshots fail", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (
        command === "get_hexa_development_goals" ||
        command === "get_hexa_watched_sessions"
      ) {
        return Promise.reject(new Error("Hexa unavailable"));
      }
      return Promise.resolve(invokeResult(command));
    });

    const view = await renderHumiModule();

    expect(view.host.textContent).toContain("实时会话");
    expect(view.host.textContent).toContain("自动确认");
    expect(view.host.textContent).toContain("TTS 播报");
    expect(view.host.textContent).toContain("0 个开发目标需要注意");

    await dispose(view);
  });

  it("opens the selected Agent session", async () => {
    const view = await renderHumiModule();

    await act(async () => {
      buttonByLabel(view.host, "打开会话 HUMHUM").click();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("focus_agent_session", {
      sessionId: "codex-live-1",
    });

    await dispose(view);
  });

  it("persists global auto confirm and can preview the configured voice", async () => {
    const view = await renderHumiModule();

    await act(async () => {
      buttonByLabel(view.host, "自动确认所有权限").click();
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({
        newConfig: expect.objectContaining({
          ui: expect.objectContaining({ auto_confirm: true }),
        }),
      }),
    );

    await act(async () => {
      buttonByLabel(view.host, "试听 TTS 播报").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith("synthesize_system_speech", {
      text: "Humi 正在为你播报 Agent 的最新进展。",
      voice: "zh-CN-XiaoxiaoNeural",
      speed: 1,
    });
    expect(invokeMock).toHaveBeenCalledWith("play_audio", {
      base64Data: "audio-base64",
    });

    await dispose(view);
  });
});
