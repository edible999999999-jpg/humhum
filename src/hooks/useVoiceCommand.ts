import { useState, useCallback, useRef } from "react";
import type { VoiceCommand } from "@/types";
import { matchCommand } from "@/lib/voice-command/handler";
import { getActiveSTTProvider } from "@/lib/stt";

/** How the microphone is doing right now, so the UI can tell the user. */
export type VoiceStatus =
  | "idle"
  | "listening"
  | "unavailable"
  | "error";

interface UseVoiceCommandReturn {
  startListening: () => Promise<void>;
  stopListening: () => void;
  isListening: boolean;
  lastCommand: VoiceCommand | null;
  /** Coarse status for surfacing microphone state to the user. */
  voiceStatus: VoiceStatus;
}

export function useVoiceCommand(
  onCommand: (command: VoiceCommand, text: string) => void
): UseVoiceCommandReturn {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const startListening = useCallback(async () => {
    if (isListening) return;

    const provider = getActiveSTTProvider();
    if (!provider || !provider.isAvailable()) {
      // Surface this instead of failing silently — the user needs to know the
      // mic is not listening so they fall back to buttons/keyboard.
      console.warn("[VoiceCommand] No STT provider available");
      setVoiceStatus("unavailable");
      return;
    }

    provider.onResult((text, isFinal) => {
      if (!isFinal) return;
      const command = matchCommand(text);
      setLastCommand(command);
      onCommandRef.current(command, text);
    });

    provider.onEnd(() => {
      setIsListening(false);
      setVoiceStatus((prev) => (prev === "error" ? prev : "idle"));
    });

    provider.onError((err) => {
      console.error("[VoiceCommand] STT error:", err);
      setIsListening(false);
      setVoiceStatus("error");
    });

    setIsListening(true);
    setVoiceStatus("listening");
    try {
      await provider.startListening({ language: "zh-CN", interimResults: true });
    } catch (error) {
      console.error("[VoiceCommand] Failed to start STT:", error);
      setIsListening(false);
      setVoiceStatus("error");
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    const provider = getActiveSTTProvider();
    provider?.stopListening();
    setIsListening(false);
    setVoiceStatus((prev) => (prev === "error" || prev === "unavailable" ? prev : "idle"));
  }, []);

  return { startListening, stopListening, isListening, lastCommand, voiceStatus };
}
