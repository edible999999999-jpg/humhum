import type { HookEvent, AudioChunk } from "@/types";
import type { OpenAISummarizer } from "./summarizer";
import type { SentenceSplitter } from "./summarizer/sentence-split";
import type { AudioQueue } from "./audio/queue";
import { synthesize } from "./tts";

export type PipelineState = "idle" | "summarizing" | "speaking" | "error";

export class VoicePipeline {
  private summarizer: OpenAISummarizer;
  private splitter: SentenceSplitter;
  private audioQueue: AudioQueue;
  private state: PipelineState = "idle";
  private stateCallback: ((state: PipelineState) => void) | null = null;
  private sentenceCallback: ((text: string) => void) | null = null;
  private processing = false;

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
    if (this.processing) {
      this.stop();
    }

    this.processing = true;
    this.audioQueue.clear();
    this.splitter.reset();
    this.setState("summarizing");

    try {
      let chunkId = 0;

      for await (const token of this.summarizer.summarize(event)) {
        const sentences = this.splitter.feed(token);

        for (const sentence of sentences) {
          this.sentenceCallback?.(sentence.text);
          this.setState("speaking");

          const buffer = await synthesize(sentence.text);
          const chunk: AudioChunk = {
            id: `chunk-${chunkId++}`,
            buffer,
            text: sentence.text,
          };
          this.audioQueue.enqueue(chunk);
        }
      }

      const lastChunk = this.splitter.flush();
      if (lastChunk) {
        this.sentenceCallback?.(lastChunk.text);
        if (this.state !== "speaking") this.setState("speaking");

        const buffer = await synthesize(lastChunk.text);
        const chunk: AudioChunk = {
          id: `chunk-${chunkId++}`,
          buffer,
          text: lastChunk.text,
        };
        this.audioQueue.enqueue(chunk);
      }

      this.processing = false;
      if (this.audioQueue.currentState === "ended" || chunkId === 0) {
        this.setState("idle");
      }
    } catch (e) {
      console.error("[VoicePipeline] Error:", e);
      this.processing = false;
      this.setState("error");
      setTimeout(() => {
        if (this.state === "error") this.setState("idle");
      }, 5000);
    }
  }

  stop(): void {
    this.processing = false;
    this.audioQueue.clear();
    this.splitter.reset();
    this.setState("idle");
  }
}
