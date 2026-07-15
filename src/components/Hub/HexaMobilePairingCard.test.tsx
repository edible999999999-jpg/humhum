import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MobileBridgeStatus, MobilePairingInfo } from "../../hooks/useHexaData";
import { HexaMobilePairingCard, startOrRefreshMobilePairing } from "./HexaModule";

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
    expect(html).toContain("同一 Wi-Fi");
    expect(html).toMatch(/剩余 [1-5] 分钟/);
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
