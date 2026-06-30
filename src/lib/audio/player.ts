import { invoke } from "@tauri-apps/api/core";
import type { AudioQueueState } from "@/types";

export class AudioPlayer {
  private playing = false;
  private onStateChange: ((state: AudioQueueState) => void) | null = null;
  private onEnded: (() => void) | null = null;
  private aborted = false;

  setStateCallback(cb: (state: AudioQueueState) => void): void {
    this.onStateChange = cb;
  }

  setEndedCallback(cb: () => void): void {
    this.onEnded = cb;
  }

  async play(buffer: ArrayBuffer): Promise<void> {
    if (buffer.byteLength < 100) {
      this.onEnded?.();
      return;
    }

    this.playing = true;
    this.aborted = false;
    this.onStateChange?.("playing");

    try {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      const base64 = btoa(binary);

      console.log("[AudioPlayer] Playing via afplay,", buffer.byteLength, "bytes");
      await invoke("play_audio", { base64Data: base64 });
      console.log("[AudioPlayer] afplay finished");
    } catch (e) {
      if (!this.aborted) {
        console.error("[AudioPlayer] play_audio error:", e);
      }
    }

    this.playing = false;
    if (!this.aborted) {
      this.onEnded?.();
    }
  }

  pause(): void {
    this.onStateChange?.("paused");
  }

  resume(): void {
    this.onStateChange?.("playing");
  }

  async stop(): Promise<void> {
    this.aborted = true;
    this.playing = false;
    this.onStateChange?.("idle");
    try {
      await invoke("stop_audio");
    } catch {
      // ignore
    }
  }
}
