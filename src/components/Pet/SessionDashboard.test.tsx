import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionDashboard } from "./SessionDashboard";

describe("SessionDashboard", () => {
  it("offers a visible keyboard-accessible Hub entry", () => {
    const html = renderToStaticMarkup(
      <SessionDashboard visible onOpenHub={vi.fn()} />,
    );

    expect(html).toContain("<button");
    expect(html).toContain("aria-label=\"打开 HUMHUM Hub\"");
    expect(html).toContain("Hub");
  });
});
