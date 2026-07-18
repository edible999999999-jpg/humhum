// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  HexaWatchedSession,
  MobileBridgeStatus,
  MobilePairingInfo,
} from "../../hooks/useHexaData";
import * as HexaModuleComponents from "./HexaModule";
import { HexaMobilePairingCard, startOrRefreshMobilePairing } from "./HexaModule";
import { HexaActiveMonitor } from "./hexa/HexaActiveMonitor";

declare global {
  // React uses this opt-in flag to verify state updates stay inside act().
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type BindingPanelExports = {
  HexaRemoteAccessPanel?: ComponentType<Record<string, unknown>>;
  HexaMobileAccessPanel?: ComponentType<Record<string, unknown>>;
  HexaWatchCommandPanel?: ComponentType;
};

const bindingPanels = HexaModuleComponents as unknown as BindingPanelExports;

const hexaModuleSource = readFileSync(
  resolve(process.cwd(), "src/components/Hub/HexaModule.tsx"),
  "utf8",
);
const hexaRoomStyles = readFileSync(
  resolve(process.cwd(), "src/styles/hub-character-rooms.css"),
  "utf8",
);

const enabledBridge: MobileBridgeStatus = {
  enabled: true,
  url: "https://192.168.1.20:31276",
  lan_url: "https://192.168.1.20:31276",
  tailnet_url: null,
  certificate_fingerprint: "AABBCC",
  pairing_active: true,
  paired_devices: 0,
  devices: [],
  relay_status: "disabled",
  relay_url: null,
};

const activePairing: MobilePairingInfo = {
  code: "ABCD1234",
  expires_at: Math.floor(Date.now() / 1000) + 300,
  url: "https://192.168.1.20:31276",
  certificate_fingerprint: "AABBCC",
  scope: "read",
  network: "lan",
  android_setup: JSON.stringify({ version: 1, code: "ABCD1234" }),
};

function watchedSession(
  sessionId: string,
  updatedAt: string,
): HexaWatchedSession {
  return {
    session_id: sessionId,
    agent: "codex",
    name: `会话 ${sessionId}`,
    provider: "Codex",
    workspace: "/tmp/hexa-room",
    goal: `目标 ${sessionId}`,
    status: "working",
    current_step: `当前步骤 ${sessionId}`,
    blocked_reason: null,
    need_user: false,
    confidence: "reported",
    started_at: updatedAt,
    updated_at: updatedAt,
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
  };
}

describe("HexaMobilePairingCard", () => {
  it("renders the default state as a compact accessible affordance with real Lucide icons", () => {
    const html = renderToStaticMarkup(
      <HexaMobilePairingCard
        state={{ ...enabledBridge, pairing_active: false }}
        pairing={null}
        onEnable={vi.fn()}
        onPair={vi.fn()}
      />,
    );

    expect(html).toContain('class="hexa-mobile-affordance"');
    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('aria-label="Hexa 手机连接"');
    expect(html).toContain("lucide-smartphone");
    expect(html).toContain("lucide-qr-code");
    expect(html).not.toContain("hexa-mobile-quick-card");
  });

  it("keeps phone pairing visible in the Hexa header before a QR exists", () => {
    const html = renderToStaticMarkup(
      <HexaMobilePairingCard
        state={{ ...enabledBridge, pairing_active: false }}
        pairing={null}
        onEnable={vi.fn()}
        onPair={vi.fn()}
      />,
    );

    expect(html).toContain("在手机查看 Hexa");
    expect(html).toContain('aria-label="生成配对二维码"');
    expect(html).toContain("默认只读");
  });

  it("shows the active QR, expiry and an explicit refresh action", () => {
    const html = renderToStaticMarkup(
      <HexaMobilePairingCard
        state={enabledBridge}
        pairing={activePairing}
        onEnable={vi.fn()}
        onPair={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Hexa 手机配对二维码"');
    expect(html).toContain('aria-label="刷新配对二维码"');
    expect(html).toContain('class="hexa-mobile-pairing-panel"');
    expect(html).toContain('data-expanded="true"');
    expect(html).toContain("同一 Wi-Fi");
    expect(html).toMatch(/剩余 [1-5] 分钟/);
  });

  it("does not expand when pairing is active but no QR payload is available", () => {
    const html = renderToStaticMarkup(
      <HexaMobilePairingCard
        state={enabledBridge}
        pairing={{ ...activePairing, android_setup: "" }}
        onEnable={vi.fn()}
        onPair={vi.fn()}
      />,
    );

    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('class="hexa-mobile-affordance"');
    expect(html).not.toContain("hexa-mobile-pairing-panel");
  });

  it("enables mobile access before generating the first read-only LAN QR", async () => {
    const onEnable = vi.fn(async () => enabledBridge);
    const onPair = vi.fn(async () => activePairing);

    await startOrRefreshMobilePairing(
      { ...enabledBridge, enabled: false, pairing_active: false },
      null,
      onEnable,
      onPair,
    );

    expect(onEnable).toHaveBeenCalledOnce();
    expect(onPair).toHaveBeenCalledWith("read", "lan");
    expect(onEnable.mock.invocationCallOrder[0]).toBeLessThan(onPair.mock.invocationCallOrder[0]!);
  });

  it("preserves scope and network when manually refreshing a QR", async () => {
    const onEnable = vi.fn(async () => enabledBridge);
    const onPair = vi.fn(async () => activePairing);

    await startOrRefreshMobilePairing(
      enabledBridge,
      { ...activePairing, scope: "control", network: "tailnet" },
      onEnable,
      onPair,
    );

    expect(onEnable).not.toHaveBeenCalled();
    expect(onPair).toHaveBeenCalledWith("control", "tailnet");
  });
});

describe("Hexa supervision room presentation", () => {
  it("renders binding panels with responsive layout classes and no white inline text", () => {
    const RemotePanel = bindingPanels.HexaRemoteAccessPanel;
    const MobilePanel = bindingPanels.HexaMobileAccessPanel;
    const WatchPanel = bindingPanels.HexaWatchCommandPanel;

    expect(RemotePanel).toBeTypeOf("function");
    expect(MobilePanel).toBeTypeOf("function");
    expect(WatchPanel).toBeTypeOf("function");
    if (!RemotePanel || !MobilePanel || !WatchPanel) {
      throw new Error("Missing Hexa binding panel exports");
    }

    const remoteHtml = renderToStaticMarkup(
      <RemotePanel
        state={{
          status: "disabled",
          server_name: "HumHum",
          installation_id: "install",
          environment_id: null,
          message: "等待启用",
        }}
        pairing={null}
        onEnable={vi.fn()}
        onDisable={vi.fn()}
        onPair={vi.fn()}
      />,
    );
    const mobileHtml = renderToStaticMarkup(
      <MobilePanel
        state={{ ...enabledBridge, enabled: false, pairing_active: false }}
        pairing={null}
        relayConfig={{ enabled: false, base_url: null, invite_code: null }}
        onEnable={vi.fn()}
        onDisable={vi.fn()}
        onPair={vi.fn()}
        onRevoke={vi.fn()}
        onRevokeDevice={vi.fn()}
        onConfigureRelay={vi.fn()}
      />,
    );
    const watchHtml = renderToStaticMarkup(<WatchPanel />);

    expect(remoteHtml).toContain("hexa-binding-section hexa-remote-access");
    expect(mobileHtml).toContain("hexa-binding-section hexa-mobile-access");
    expect(mobileHtml).toContain("hexa-mobile-relay-form");
    expect(watchHtml).toContain("hexa-binding-section hexa-watch-command");
    expect(`${remoteHtml}${mobileHtml}${watchHtml}`).not.toMatch(
      /color:\s*rgba\(255,\s*255,\s*255/i,
    );
    expect(hexaModuleSource).toContain('className="hexa-binding-stack"');
    expect(hexaModuleSource).not.toMatch(
      /color:\s*"rgba\(255,\s*255,\s*255/i,
    );
  });

  it("transitions selection and resolves the latest session when the selected run disappears", async () => {
    const now = Date.now();
    const older = watchedSession("older", new Date(now - 60_000).toISOString());
    const latest = watchedSession("latest", new Date(now - 20_000).toISOString());
    const replacement = watchedSession("replacement", new Date(now - 5_000).toISOString());
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const renderMonitor = async (sessions: HexaWatchedSession[]) => {
      await act(async () => {
        root.render(
          <HexaActiveMonitor
            sessions={sessions}
            supervisorBySessionId={new Map()}
            dataState="ready"
            entryPanel={null}
            onRetry={vi.fn(async () => undefined)}
            onFocus={vi.fn(async () => ({
              strategy: "generic_terminal" as const,
              application: null,
              exact: false,
            }))}
            onDelete={vi.fn(async () => undefined)}
            onMutate={vi.fn(async () => null)}
          />,
        );
      });
    };
    const selectedName = () =>
      host.querySelector<HTMLButtonElement>('.hexa-session-nav-item[aria-current="true"]')
        ?.querySelector("strong")?.textContent;

    try {
      await renderMonitor([older, latest]);
      expect(selectedName()).toBe("会话 latest");
      expect(host.querySelector(".hexa-report")?.getAttribute("aria-label")).toContain("会话 latest");

      const olderButton = Array.from(
        host.querySelectorAll<HTMLButtonElement>(".hexa-session-nav-item"),
      ).find((button) => button.textContent?.includes("会话 older"));
      expect(olderButton).toBeDefined();
      await act(async () => olderButton!.click());
      expect(selectedName()).toBe("会话 older");

      await renderMonitor([latest, replacement]);
      expect(selectedName()).toBe("会话 replacement");
      expect(host.querySelector(".hexa-report")?.getAttribute("aria-label")).toContain("会话 replacement");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("uses one separator summary and keeps the shared room shell outside the module", () => {
    expect(hexaModuleSource).toContain('className="hexa-metric-summary"');
    expect(hexaModuleSource).not.toContain("function MetricCard");
    expect(hexaModuleSource).not.toContain("<HubRoom");
    expect(hexaModuleSource).not.toMatch(/mascot/i);
  });

  it("defines responsive and reduced-motion contracts for the dense workbench", () => {
    expect(hexaRoomStyles).toContain(".hexa-room-module");
    expect(hexaRoomStyles).toMatch(/@media \(max-width: 1100px\)/);
    expect(hexaRoomStyles).toMatch(/@media \(max-width: 900px\)/);
    expect(hexaRoomStyles).toMatch(/@media \(max-width: 820px\)/);
    expect(hexaRoomStyles).toMatch(/@media \(max-width: 760px\)/);
    expect(hexaRoomStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(hexaRoomStyles).toContain(".hexa-room-module {\n    animation: none !important;");
  });
});
