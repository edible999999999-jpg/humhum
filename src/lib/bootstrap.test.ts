// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

// Mock the Tauri IPC boundary and the heavy provider modules so the test
// exercises initBootstrap's latch/retry control flow, not real audio/network.
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./i18n", () => ({ setLanguage: vi.fn() }));
vi.mock("./tts/edge-tts", () => ({ EdgeTTSProvider: class {} }));
vi.mock("./tts/openai-tts", () => ({ OpenAITTSProvider: class {} }));
vi.mock("./tts/elevenlabs", () => ({ ElevenLabsProvider: class {} }));
vi.mock("./tts", () => ({ registerProvider: vi.fn(), setActiveProvider: vi.fn() }));
vi.mock("./stt/web-speech", () => ({ WebSpeechProvider: class {} }));
vi.mock("./stt/whisper", () => ({ WhisperProvider: class {} }));
vi.mock("./stt", () => ({ registerSTTProvider: vi.fn(), setActiveSTTProvider: vi.fn() }));
vi.mock("./summarizer", () => ({ OpenAISummarizer: class {} }));
vi.mock("./summarizer/sentence-split", () => ({ SentenceSplitter: class {} }));
vi.mock("./audio/queue", () => ({ AudioQueue: class {} }));
vi.mock("./pipeline", () => ({ VoicePipeline: class {} }));

const validConfig = {
  ui: { language: "en" },
  tts: { provider: "edge", edge_bridge_url: "" },
  stt: { provider: "web-speech" },
  api_keys: {},
  summarizer: { api_base: "", model: "", max_tokens: 100 },
};

describe("initBootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not latch a failed run — a transient get_config error can be retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { initBootstrap } = await import("./bootstrap");

    // First attempt rejects (e.g. backend not ready yet).
    mocks.invoke.mockRejectedValueOnce(new Error("backend not ready"));
    await expect(initBootstrap()).rejects.toThrow("backend not ready");

    // A retry must actually re-invoke get_config rather than no-op on a
    // latched flag, and now succeed.
    mocks.invoke.mockResolvedValueOnce(validConfig);
    await expect(initBootstrap()).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("shares one run across concurrent callers and caches success", async () => {
    const { initBootstrap } = await import("./bootstrap");
    mocks.invoke.mockResolvedValue(validConfig);

    // Concurrent callers (e.g. StrictMode double-mount) await the same run.
    await Promise.all([initBootstrap(), initBootstrap()]);
    // A later call no-ops against the cached resolved promise.
    await initBootstrap();

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
