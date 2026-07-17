import { describe, expect, it } from "vitest";
import { normalizeMobileRelayConfig } from "./mobileRelayConfig";

describe("normalizeMobileRelayConfig", () => {
  it("keeps relay disabled without requiring a URL", () => {
    expect(normalizeMobileRelayConfig(false, "  ", "")).toEqual({
      enabled: false,
      base_url: null,
      invite_code: null,
    });
  });

  it("accepts public HTTPS and exact loopback HTTP", () => {
    expect(normalizeMobileRelayConfig(
      true,
      " https://relay.example.com/ ",
      " beta-invite-secret ",
    )).toEqual({
      enabled: true,
      base_url: "https://relay.example.com",
      invite_code: "beta-invite-secret",
    });
    expect(normalizeMobileRelayConfig(
      true,
      "http://127.0.0.1:3005",
      "beta-invite-secret",
    )).toEqual({
      enabled: true,
      base_url: "http://127.0.0.1:3005",
      invite_code: "beta-invite-secret",
    });
  });

  it.each([
    "http://relay.example.com",
    "https://user:secret@relay.example.com",
    "https://relay.example.com/path",
    "https://relay.example.com?token=secret",
  ])("rejects unsafe relay URL %s", (value) => {
    expect(() => normalizeMobileRelayConfig(true, value, "beta-invite-secret")).toThrow();
  });

  it("requires a bounded printable beta invite", () => {
    expect(() => normalizeMobileRelayConfig(true, "https://relay.example.com", "short"))
      .toThrow("邀请码");
    expect(() => normalizeMobileRelayConfig(
      true,
      "https://relay.example.com",
      `valid-prefix-${String.fromCharCode(10)}`,
    )).toThrow("邀请码");
  });
});
