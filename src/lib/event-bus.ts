import { listen } from "@tauri-apps/api/event";
import type { HookEvent } from "@/types";

type EventCallback = (event: HookEvent) => void;

/**
 * EventBus — singleton wrapper around Tauri's event system.
 * Provides typed event subscription for hook events from the Rust backend.
 */
class EventBus {
  private callbacks: Set<EventCallback> = new Set();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await listen<HookEvent>("humhum://hook-event", (event) => {
      this.callbacks.forEach((cb) => cb(event.payload));
    });
  }

  subscribe(callback: EventCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }
}

export const eventBus = new EventBus();
