import { useState, useEffect, useRef } from "react";
import type { HookEvent } from "@/types";

interface UseEventBusReturn {
  events: HookEvent[];
  latestEvent: HookEvent | null;
  clearEvents: () => void;
}

/**
 * Listens for Tauri events from the Rust hook server.
 * Maintains a list of received events and exposes the latest one.
 */
export function useEventBus(): UseEventBusReturn {
  const [events, setEvents] = useState<HookEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<HookEvent | null>(null);
  const listenerSetup = useRef(false);

  useEffect(() => {
    if (listenerSetup.current) return;
    listenerSetup.current = true;

    let unlistenFn: (() => void) | null = null;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenFn = (await listen<HookEvent>(
          "humhum://hook-event",
          (event) => {
            console.log("[EventBus] Received:", event.payload);
            setEvents((prev) => [...prev, event.payload]);
            setLatestEvent(event.payload);
          }
        )) as () => void;
      } catch (e) {
        console.error("[EventBus] Failed to set up listener:", e);
      }
    })();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const clearEvents = () => {
    setEvents([]);
    setLatestEvent(null);
  };

  return { events, latestEvent, clearEvents };
}
