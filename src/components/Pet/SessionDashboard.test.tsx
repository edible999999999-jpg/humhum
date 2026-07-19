import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionDashboard, SessionRow } from "./SessionDashboard";

describe("SessionDashboard", () => {
  it("offers a visible keyboard-accessible Hub entry", () => {
    const html = renderToStaticMarkup(
      <SessionDashboard visible onOpenHub={vi.fn()} />,
    );

    expect(html).toContain("<button");
    expect(html).toContain("aria-label=\"打开 HUMHUM Hub\"");
    expect(html).toContain("Hub");
  });

  it("renders each monitored session as a keyboard-accessible open action", () => {
    const html = renderToStaticMarkup(
      <SessionRow
        session={{
          session_id: "codex-live-1",
          client_type: "codex",
          cwd: "/tmp/humhum",
          project_name: "HUMHUM",
          started_at: "2026-07-19T02:00:00Z",
          last_event_at: "2026-07-19T02:20:00Z",
          event_count: 42,
          status: "active",
          last_hook_message: "正在检查会话监控",
          last_tool_name: "exec_command",
        }}
      />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="打开会话 HUMHUM"');
  });
});
