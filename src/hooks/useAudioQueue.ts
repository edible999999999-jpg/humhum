import { useState, useEffect, useCallback } from "react";
import type { AudioChunk, AudioQueueState } from "@/types";
import { getAudioQueue } from "@/lib/bootstrap";

export function useAudioQueue() {
  const [state, setState] = useState<AudioQueueState>("idle");
  const [currentChunk, setCurrentChunk] = useState<AudioChunk | null>(null);

  useEffect(() => {
    const queue = getAudioQueue();
    queue.onStateChange(setState);
    queue.onChunkPlay((chunk) => setCurrentChunk(chunk));
  }, []);

  const play = useCallback(() => getAudioQueue().play(), []);
  const pause = useCallback(() => getAudioQueue().pause(), []);
  const skip = useCallback(() => getAudioQueue().skip(), []);
  const clear = useCallback(() => getAudioQueue().clear(), []);

  return {
    state,
    currentChunk,
    remaining: getAudioQueue().length,
    play,
    pause,
    skip,
    clear,
  };
}
