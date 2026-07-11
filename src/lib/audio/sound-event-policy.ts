import type { SoundEvent } from "./sound-effects";

export function failureSoundEvent(message: string): SoundEvent {
  return /(rate|resource|usage|token)\s*limit|quota|context\s*(length|window).*(limit|reach|exceed)|maximum\s+context/i.test(message)
    ? "resourceLimit"
    : "error";
}
