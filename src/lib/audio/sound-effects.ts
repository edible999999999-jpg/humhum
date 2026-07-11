import { invoke } from "@tauri-apps/api/core";
import { playConfiguredSound, type CustomSoundClip } from "./sound-playback";

export type SoundEvent = "taskCompleted" | "attentionRequired" | "processingStarted" | "error" | "resourceLimit";

export interface SoundPreferences {
  enabled: boolean;
  processing_started: boolean;
  attention_required: boolean;
  task_completed: boolean;
  error: boolean;
  resource_limit: boolean;
}

const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume = 0.15) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playChord(notes: number[], duration: number, type: OscillatorType = "sine", volume = 0.08) {
  notes.forEach((freq) => playTone(freq, duration, type, volume));
}

const SOUNDS: Record<SoundEvent, () => void> = {
  taskCompleted: () => {
    playTone(523, 0.12, "sine", 0.12);
    setTimeout(() => playTone(659, 0.12, "sine", 0.12), 100);
    setTimeout(() => playChord([784, 1047], 0.3, "sine", 0.08), 200);
  },
  attentionRequired: () => {
    playTone(880, 0.15, "triangle", 0.15);
    setTimeout(() => playTone(880, 0.15, "triangle", 0.15), 200);
    setTimeout(() => playTone(1047, 0.2, "triangle", 0.12), 400);
  },
  processingStarted: () => {
    playTone(392, 0.1, "sine", 0.08);
    setTimeout(() => playTone(523, 0.15, "sine", 0.08), 80);
  },
  error: () => {
    playTone(330, 0.2, "square", 0.1);
    setTimeout(() => playTone(262, 0.3, "square", 0.1), 200);
  },
  resourceLimit: () => {
    playTone(440, 0.18, "sawtooth", 0.1);
    setTimeout(() => playTone(349, 0.28, "sawtooth", 0.1), 180);
  },
};

let activeCustomAudio: HTMLAudioElement | null = null;

function preferenceKey(event: SoundEvent): keyof Omit<SoundPreferences, "enabled"> {
  const keys: Record<SoundEvent, keyof Omit<SoundPreferences, "enabled">> = {
    taskCompleted: "task_completed",
    attentionRequired: "attention_required",
    processingStarted: "processing_started",
    error: "error",
    resourceLimit: "resource_limit",
  };
  return keys[event];
}

async function playCustomClip(clip: CustomSoundClip) {
  activeCustomAudio?.pause();
  const audio = new Audio(`data:${clip.mime_type};base64,${clip.data_base64}`);
  activeCustomAudio = audio;
  await audio.play();
}

function playBuiltIn(event: SoundEvent) {
  try {
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    SOUNDS[event]?.();
  } catch {
    // Audio might not be available.
  }
}

export function playSound(event: SoundEvent, preferences?: SoundPreferences, preview = false) {
  if (!preview && preferences && (!preferences.enabled || preferences[preferenceKey(event)] === false)) {
    return;
  }
  void playConfiguredSound(
    () => invoke<CustomSoundClip | null>("get_sound_clip", { event, preview }),
    playCustomClip,
    () => playBuiltIn(event),
  );
}
