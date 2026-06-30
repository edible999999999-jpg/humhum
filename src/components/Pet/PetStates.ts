/**
 * Pet state machine — defines valid transitions and guards.
 *
 * State flow:
 *   idle → processing → speaking → (needs confirmation?) → waiting/listening → idle
 *                                 → (no confirmation?) → idle
 */

import type { PetState } from "@/types";

export const VALID_TRANSITIONS: Record<PetState, PetState[]> = {
  idle: ["processing", "completed", "error"],
  processing: ["speaking", "waiting", "completed", "error"],
  speaking: ["idle", "listening", "waiting", "completed", "error"],
  listening: ["idle", "processing", "error"],
  waiting: ["idle", "speaking", "error"],
  completed: ["idle", "processing"],
  error: ["idle"],
};

export function canTransition(from: PetState, to: PetState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getTransitionReason(from: PetState, to: PetState): string {
  const reasons: Record<string, string> = {
    "idle->processing": "New event received from Claude Code",
    "processing->speaking": "Summary generated, starting TTS playback",
    "processing->waiting": "Permission request detected",
    "speaking->listening": "Listening for voice command",
    "speaking->waiting": "Confirmation needed",
    "speaking->idle": "Playback completed",
    "listening->idle": "Voice command processed",
    "waiting->idle": "User responded to confirmation",
    "waiting->speaking": "Playing confirmation response",
  };
  return reasons[`${from}->${to}`] ?? `${from} -> ${to}`;
}
