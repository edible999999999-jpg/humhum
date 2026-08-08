import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Tauri IPC before importing the player so its `invoke` binds to the mock.
const invokeMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { AudioPlayer } from "./player";

describe("AudioPlayer pause/resume", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("does nothing when nothing is playing", () => {
    const player = new AudioPlayer();
    player.pause();
    player.resume();
    // No IPC without an active clip — pause/resume must be a no-op when idle.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes pause_audio / resume_audio while a clip is playing", async () => {
    const player = new AudioPlayer();
    // A >=100-byte buffer takes the real play path; the mocked invoke resolves
    // immediately, but play sets `playing=true` synchronously before awaiting.
    const buffer = new ArrayBuffer(200);
    const playing = player.play(buffer);

    // Synchronously after calling play(), the player is marked playing.
    player.pause();
    player.resume();

    await playing;

    const commands = invokeMock.mock.calls.map((c) => c[0]);
    expect(commands).toContain("play_audio");
    expect(commands).toContain("pause_audio");
    expect(commands).toContain("resume_audio");
  });
});
