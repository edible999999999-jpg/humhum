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

      console.log("[AudioPlayer] Playing via native audio,", buffer.byteLength, "bytes");
      await invoke("play_audio", { base64Data: base64 });
      console.log("[AudioPlayer] Native audio finished");
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
    if (!this.playing) return;
    this.onStateChange?.("paused");
    // Actually silence the native player. The pending play_audio promise stays
    // unresolved (afplay is stopped, not exited), so the queue does not advance
    // until we resume-to-completion or stop. Fire-and-forget: a failed pause
    // must not throw into the keyboard handler.
    invoke("pause_audio").catch((e) => {
      console.error("[AudioPlayer] pause_audio error:", e);
    });
  }

  resume(): void {
    if (!this.playing) return;
    this.onStateChange?.("playing");
    invoke("resume_audio").catch((e) => {
      console.error("[AudioPlayer] resume_audio error:", e);
    });
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
