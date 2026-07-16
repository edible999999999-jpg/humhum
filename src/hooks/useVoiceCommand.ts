import { useState, useCallback, useRef } from "react";
import type { VoiceCommand } from "@/types";
import { VOICE_COMMANDS } from "@/lib/voice-command/commands";
import { getActiveSTTProvider } from "@/lib/stt";

interface UseVoiceCommandReturn {
  startListening: () => Promise<void>;
  stopListening: () => void;
  isListening: boolean;
  lastCommand: VoiceCommand | null;
}

export function useVoiceCommand(
  onCommand: (command: VoiceCommand, text: string) => void
): UseVoiceCommandReturn {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const startListening = useCallback(async () => {
    if (isListening) return;

    const provider = getActiveSTTProvider();
    if (!provider || !provider.isAvailable()) {
      console.warn("[VoiceCommand] No STT provider available");
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
    });

    provider.onError((err) => {
      console.error("[VoiceCommand] STT error:", err);
      setIsListening(false);
    });

    setIsListening(true);
    try {
      await provider.startListening({ language: "zh-CN", interimResults: true });
    } catch (error) {
      console.error("[VoiceCommand] Failed to start STT:", error);
      setIsListening(false);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    const provider = getActiveSTTProvider();
    provider?.stopListening();
    setIsListening(false);
  }, []);

  return { startListening, stopListening, isListening, lastCommand };
}

export function matchCommand(text: string): VoiceCommand {
  const normalized = text.toLowerCase().trim();

  for (const def of VOICE_COMMANDS) {
    for (const trigger of def.triggers) {
      if (normalized.includes(trigger.toLowerCase())) {
        return def.command;
      }
    }
  }

  return "unknown";
}
