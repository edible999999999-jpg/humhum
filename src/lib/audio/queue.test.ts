import { describe, expect, it, vi } from "vitest";
import { AudioQueue } from "./queue";
import type { AudioChunk } from "@/types";

// A sub-100-byte buffer makes AudioPlayer.play short-circuit to onEnded without
// touching the Tauri `invoke` IPC, while playCurrent still fires chunkCallbacks
// first — enough to exercise the subscription contract in isolation.
function tinyChunk(id: string): AudioChunk {
  return { id, buffer: new ArrayBuffer(8), text: id };
}

describe("AudioQueue.onChunkPlay", () => {
  it("notifies every subscriber and stops after unsubscribe", async () => {
    const queue = new AudioQueue();
    const a = vi.fn();
    const b = vi.fn();

    const unsubA = queue.onChunkPlay(a);
    queue.onChunkPlay(b);

    queue.enqueue(tinyChunk("chunk-0"));
    // Let the microtask chain (playCurrent → player.play → onEnded) settle.
    await Promise.resolve();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    // A remount's cleanup must actually detach the stale closure.
    unsubA();
    await queue.clear();
    queue.enqueue(tinyChunk("chunk-1"));
    await Promise.resolve();

    expect(a).toHaveBeenCalledTimes(1); // unchanged — no longer subscribed
    expect(b).toHaveBeenCalledTimes(2);
  });
});
