import type { HookEvent, AudioChunk } from "@/types";
import type { OpenAISummarizer } from "./summarizer";
import type { SentenceSplitter } from "./summarizer/sentence-split";
import type { AudioQueue } from "./audio/queue";
import { synthesize } from "./tts";

export type PipelineState = "idle" | "summarizing" | "speaking" | "error";

const BATCH_WINDOW_MS = 2000;

export class VoicePipeline {
  private summarizer: OpenAISummarizer;
  private splitter: SentenceSplitter;
  private audioQueue: AudioQueue;
  private state: PipelineState = "idle";
  private stateCallback: ((state: PipelineState) => void) | null = null;
  private sentenceCallback: ((text: string) => void) | null = null;
  private processing = false;

  private pendingEvents: HookEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    summarizer: OpenAISummarizer,
    splitter: SentenceSplitter,
    audioQueue: AudioQueue
  ) {
    this.summarizer = summarizer;
    this.splitter = splitter;
    this.audioQueue = audioQueue;

    this.audioQueue.onStateChange((queueState) => {
      if (queueState === "ended" && !this.processing) {
        this.setState("idle");
      }
    });
  }

  onStateChange(cb: (state: PipelineState) => void): void {
    this.stateCallback = cb;
  }

  onSentence(cb: (text: string) => void): void {
    this.sentenceCallback = cb;
  }

  private setState(s: PipelineState): void {
    this.state = s;
    this.stateCallback?.(s);
  }

  get currentState(): PipelineState {
    return this.state;
  }

  async processEvent(event: HookEvent): Promise<void> {
    console.log("[VoicePipeline] Event queued:", event.hook_event_name);

    this.pendingEvents.push(event);

    if (this.batchTimer) clearTimeout(this.batchTimer);

    // If already processing, just queue — the current run will pick up pending events when done
    if (this.processing) {
      console.log("[VoicePipeline] Already processing, event batched for later");
      return;
    }

    // Wait briefly to batch rapid-fire events
    await new Promise<void>((resolve) => {
      this.batchTimer = setTimeout(resolve, BATCH_WINDOW_MS);
    });

    this.runBatch();
  }

  private async runBatch(): Promise<void> {
    if (this.processing) return;
    if (this.pendingEvents.length === 0) return;

    const events = this.pendingEvents.splice(0);
    this.processing = true;
    await this.audioQueue.clear();
    this.splitter.reset();
    this.setState("summarizing");

    // Merge multiple events into one summarizer call
    const mergedEvent = events.length === 1 ? events[0]! : mergeEvents(events);

    try {
      let chunkId = 0;
      let tokenCount = 0;

      console.log("[VoicePipeline] Starting summarizer for", events.length, "events...");
      for await (const token of this.summarizer.summarize(mergedEvent)) {
        tokenCount++;
        const sentences = this.splitter.feed(token);

        for (const sentence of sentences) {
          console.log("[VoicePipeline] Sentence:", sentence.text.slice(0, 50));
          this.sentenceCallback?.(sentence.text);
          this.setState("speaking");

          const buffer = await synthesize(sentence.text);
          if (buffer.byteLength >= 100) {
            const chunk: AudioChunk = {
              id: `chunk-${chunkId++}`,
              buffer,
              text: sentence.text,
            };
            this.audioQueue.enqueue(chunk);
          }
        }
      }

      const lastChunk = this.splitter.flush();
      if (lastChunk) {
        this.sentenceCallback?.(lastChunk.text);
        if (this.state !== "speaking") this.setState("speaking");

        const buffer = await synthesize(lastChunk.text);
        if (buffer.byteLength >= 100) {
          const chunk: AudioChunk = {
            id: `chunk-${chunkId++}`,
            buffer,
            text: lastChunk.text,
          };
          this.audioQueue.enqueue(chunk);
        }
      }

      this.processing = false;
      console.log("[VoicePipeline] Done. Chunks:", chunkId);

      if (this.audioQueue.currentState === "ended" || chunkId === 0) {
        this.setState("idle");
      }

      // Check if more events arrived during processing
      if (this.pendingEvents.length > 0) {
        console.log("[VoicePipeline] Processing queued events:", this.pendingEvents.length);
        this.runBatch();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      console.error("[VoicePipeline] Error:", msg);
      this.processing = false;
      this.setState("error");
      setTimeout(() => {
        if (this.state === "error") this.setState("idle");
      }, 5000);
    }
  }

  stop(): void {
    this.processing = false;
    this.pendingEvents = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.audioQueue.clear();
    this.splitter.reset();
    this.setState("idle");
  }
}

function mergeEvents(events: HookEvent[]): HookEvent {
  const types = [...new Set(events.map((e) => e.hook_event_name))];
  const base = events[events.length - 1]!;

  return {
    ...base,
    hook_event_name: types.join("+") as HookEvent["hook_event_name"],
    payload: {
      merged: true,
      count: events.length,
      events: events.map((e) => ({
        type: e.hook_event_name,
        payload: e.payload,
      })),
    },
  };
}
