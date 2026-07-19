// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./HumiModule", async () => {
  const { createElement } = await import("react");
  return {
    HumiModule: ({
      onOpenHexa,
    }: {
      onOpenHexa: (goalId: string | null) => void;
    }) => createElement(
      "button",
      {
        type: "button",
        className: "humi-hexa-summary",
        onClick: () => onOpenHexa("goal-critical"),
      },
      "1 个开发目标需要注意",
    ),
  };
});

vi.mock("./HexaModule", async () => {
  const { createElement } = await import("react");
  return {
    HexaModule: ({ focusGoalId }: { focusGoalId?: string | null }) =>
      createElement("div", { "data-focus-goal-id": focusGoalId ?? "" }, "Hexa 主动监控"),
  };
});

vi.mock("./KnowledgeModule", async () => {
  const { createElement } = await import("react");
  return { KnowledgeModule: () => createElement("div", null, "Hype") };
});

vi.mock("./HushModule", async () => {
  const { createElement } = await import("react");
  return { HushModule: () => createElement("div", null, "Hush") };
});

import { HubLayout } from "./HubLayout";

const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as {
  app: {
    windows: Array<Record<string, unknown> & { label?: string }>;
  };
};
const hubLayoutSource = readFileSync(
  resolve(process.cwd(), "src/components/Hub/HubLayout.tsx"),
  "utf8",
);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function renderHubLayout(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(HubLayout));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { host, root };
}

async function dispose(view: { host: HTMLDivElement; root: Root }) {
  await act(async () => view.root.unmount());
  view.host.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Hub macOS window chrome", () => {
  it("uses the native overlay title bar and traffic lights", () => {
    const hubWindow = tauriConfig.app.windows.find(
      (window) => window.label === "hub",
    );

    expect(hubWindow).toMatchObject({
      decorations: true,
      titleBarStyle: "Overlay",
      hiddenTitle: true,
      trafficLightPosition: { x: 14, y: 14 },
    });
  });

  it("does not render duplicate web-based window controls", () => {
    expect(hubLayoutSource).toContain("data-tauri-drag-region");
    expect(hubLayoutSource).not.toContain("HubWindowControls");
    expect(hubLayoutSource).not.toContain("hub-window-actions");
    expect(hubLayoutSource).not.toContain("hub-minimize");
    expect(hubLayoutSource).not.toContain("hub-close");
  });
});

describe("Hub Hexa goal routing", () => {
  it("keeps Humi as the default room and opens Hexa at the selected goal", async () => {
    const view = await renderHubLayout();

    expect(view.host.querySelector('[data-room="humi"]')).not.toBeNull();
    const summary = view.host.querySelector<HTMLButtonElement>(".humi-hexa-summary");
    expect(summary).not.toBeNull();

    await act(async () => {
      summary?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.host.querySelector('[data-room="hexa"]')).not.toBeNull();
    expect(
      view.host.querySelector('[data-focus-goal-id="goal-critical"]'),
    ).not.toBeNull();

    await dispose(view);
  });
});
