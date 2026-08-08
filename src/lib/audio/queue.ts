import type { AudioChunk, AudioQueueState } from "@/types";
import { AudioPlayer } from "./player";

export class AudioQueue {
  private queue: AudioChunk[] = [];
  private currentIndex = 0;
  private player: AudioPlayer;
  private state: AudioQueueState = "idle";
  private stateCallbacks: ((state: AudioQueueState) => void)[] = [];
  private chunkCallback: ((chunk: AudioChunk, index: number) => void) | null =
    null;

  constructor() {
    this.player = new AudioPlayer();
    this.player.setEndedCallback(() => this.playNext());
  }

  // Multiple independent consumers subscribe to state (the VoicePipeline's
  // self-heal at bootstrap, plus useAudioQueue when the pet view mounts).
  // Returns an unsubscribe fn. A single-slot setter let the later subscriber
  // clobber the earlier one, leaving the pipeline stuck in "speaking".
  onStateChange(cb: (state: AudioQueueState) => void): () => void {
    this.stateCallbacks.push(cb);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter((entry) => entry !== cb);
    };
  }

  onChunkPlay(cb: (chunk: AudioChunk, index: number) => void): void {
    this.chunkCallback = cb;
  }

  private setState(newState: AudioQueueState): void {
    this.state = newState;
    for (const cb of this.stateCallbacks) {
      cb(newState);
    }
  }

  get length(): number {
    return this.queue.length - this.currentIndex;
  }

  get currentState(): AudioQueueState {
    return this.state;
  }

  enqueue(chunk: AudioChunk): void {
    this.queue.push(chunk);
    // Restart playback whenever nothing is currently playing and this chunk is
    // the only unplayed one. The queue array only grows (playNext advances
    // currentIndex without trimming), so gate on `length` (unplayed count) and
    // a non-active state — including "ended", which is where playback settles
    // once it drains. Gating on `queue.length === 1 && "idle"` only ever fired
    // right after clear(), stranding chunks enqueued after a drain (notably the
    // flushed final sentence).
    if (this.length === 1 && (this.state === "idle" || this.state === "ended")) {
      this.playCurrent();
    }
  }

  async play(): Promise<void> {
    if (this.state === "paused") {
      this.player.resume();
    } else {
      await this.playCurrent();
    }
  }

  pause(): void {
    this.player.pause();
    this.setState("paused");
  }

  skip(): void {
    this.player.stop();
    this.currentIndex++;
    if (this.currentIndex < this.queue.length) {
      this.playCurrent();
    } else {
      this.setState("ended");
    }
  }

  async clear(): Promise<void> {
    await this.player.stop();
    this.queue = [];
    this.currentIndex = 0;
    this.setState("idle");
  }

  private async playCurrent(): Promise<void> {
    const chunk = this.queue[this.currentIndex];
    if (!chunk) {
      this.setState("ended");
      return;
    }
    this.setState("playing");
    this.chunkCallback?.(chunk, this.currentIndex);
    try {
      await this.player.play(chunk.buffer);
    } catch (e) {
      console.error("[AudioQueue] Playback error:", e);
      this.playNext();
    }
  }

  private playNext(): void {
    this.currentIndex++;
    if (this.currentIndex < this.queue.length) {
      this.playCurrent();
    } else {
      this.setState("ended");
    }
  }
}
