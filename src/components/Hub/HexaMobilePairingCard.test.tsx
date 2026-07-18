import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MobileBridgeStatus, MobilePairingInfo } from "../../hooks/useHexaData";
import { HexaMobilePairingCard, startOrRefreshMobilePairing } from "./HexaModule";

const hexaModuleSource = readFileSync(new URL("./HexaModule.tsx", import.meta.url), "utf8");
const hexaRoomStyles = readFileSync(
  new URL("../../styles/hub-character-rooms.css", import.meta.url),
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
