import { useEffect } from "react";

interface ShortcutHandlers {
  onConfirm?: () => void;
  onReject?: () => void;
  onTogglePlayback?: () => void;
  enabled: boolean;
}

export function useKeyboardShortcuts({
  onConfirm,
  onReject,
  onTogglePlayback,
  enabled,
}: ShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case "y":
        case "Y":
        case "Enter":
          e.preventDefault();
          onConfirm?.();
          break;
        case "n":
        case "N":
        case "Escape":
          e.preventDefault();
          onReject?.();
          break;
        case " ":
          e.preventDefault();
          onTogglePlayback?.();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onConfirm, onReject, onTogglePlayback]);
}
