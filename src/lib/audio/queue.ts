import type { AudioChunk, AudioQueueState } from "@/types";
import { AudioPlayer } from "./player";

export class AudioQueue {
  private queue: AudioChunk[] = [];
  private currentIndex = 0;
  private player: AudioPlayer;
  private state: AudioQueueState = "idle";
  private stateCallback: ((state: AudioQueueState) => void) | null = null;
  private chunkCallback: ((chunk: AudioChunk, index: number) => void) | null =
    null;

  constructor() {
    this.player = new AudioPlayer();
    this.player.setEndedCallback(() => this.playNext());
  }

  onStateChange(cb: (state: AudioQueueState) => void): void {
    this.stateCallback = cb;
  }

  onChunkPlay(cb: (chunk: AudioChunk, index: number) => void): void {
    this.chunkCallback = cb;
  }

  private setState(newState: AudioQueueState): void {
    this.state = newState;
    this.stateCallback?.(newState);
  }

  get length(): number {
    return this.queue.length - this.currentIndex;
  }

  get currentState(): AudioQueueState {
    return this.state;
  }

  enqueue(chunk: AudioChunk): void {
    this.queue.push(chunk);
    if (this.queue.length === 1 && this.state === "idle") {
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
