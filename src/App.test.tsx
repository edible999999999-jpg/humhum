// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(() => {
    throw new Error("Tauri runtime is unavailable");
  }),
  initBootstrap: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));
vi.mock("./lib/bootstrap", () => ({ initBootstrap: mocks.initBootstrap }));
vi.mock("./components/Hub/HubLayout", async () => {
  const { createElement } = await import("react");
  return { HubLayout: () => createElement("div", { "data-testid": "hub-preview" }, "Hub preview") };
});
vi.mock("./components/Pet/PetView", async () => {
  const { createElement } = await import("react");
  return { PetView: () => createElement("div", null, "Pet") };
});
vi.mock("./components/Settings/SettingsPanel", async () => {
  const { createElement } = await import("react");
  return { SettingsPanel: () => createElement("div", null, "Settings") };
});
vi.mock("./components/Intro/IntroPage", async () => {
  const { createElement } = await import("react");
  return { IntroPage: () => createElement("div", null, "Intro") };
});

import App from "./App";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  mocks.getCurrentWindow.mockClear();
  mocks.initBootstrap.mockClear();
});

describe("App browser preview", () => {
  it("renders the Hub without calling Tauri window APIs", async () => {
    window.history.replaceState({}, "", "/");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);

    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="hub-preview"]')).not.toBeNull();
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.initBootstrap).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    host.remove();
  });
});
