import { describe, expect, it } from "vitest";
import { normalizeMobileRelayConfig } from "./mobileRelayConfig";

describe("normalizeMobileRelayConfig", () => {
  it("keeps relay disabled without requiring a URL", () => {
    expect(normalizeMobileRelayConfig(false, "  ")).toEqual({
      enabled: false,
      base_url: null,
    });
  });

  it("accepts public HTTPS and exact loopback HTTP", () => {
    expect(normalizeMobileRelayConfig(true, " https://relay.example.com/ ")).toEqual({
      enabled: true,
      base_url: "https://relay.example.com",
    });
    expect(normalizeMobileRelayConfig(true, "http://127.0.0.1:3005")).toEqual({
      enabled: true,
      base_url: "http://127.0.0.1:3005",
    });
  });

  it.each([
    "http://relay.example.com",
    "https://user:secret@relay.example.com",
    "https://relay.example.com/path",
    "https://relay.example.com?token=secret",
  ])("rejects unsafe relay URL %s", (value) => {
    expect(() => normalizeMobileRelayConfig(true, value)).toThrow();
  });
});
