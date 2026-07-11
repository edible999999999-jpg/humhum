import { describe, expect, it, vi } from "vitest";
import { playConfiguredSound, type CustomSoundClip } from "./sound-playback";

const clip: CustomSoundClip = {
  data_base64: "YXVkaW8=",
  mime_type: "audio/mpeg",
  label: "Finished",
};

describe("playConfiguredSound", () => {
  it("plays a configured clip without also playing the fallback", async () => {
    const playClip = vi.fn(async () => undefined);
    const fallback = vi.fn();

    await playConfiguredSound(async () => clip, playClip, fallback);

    expect(playClip).toHaveBeenCalledWith(clip);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the built-in sound when the pack has no matching clip", async () => {
    const fallback = vi.fn();

    await playConfiguredSound(async () => null, async () => undefined, fallback);

    expect(fallback).toHaveBeenCalledOnce();
  });

  it("uses the built-in sound when custom playback fails", async () => {
    const fallback = vi.fn();

    await playConfiguredSound(
      async () => clip,
      async () => Promise.reject(new Error("decode failed")),
      fallback,
    );

    expect(fallback).toHaveBeenCalledOnce();
  });
});
