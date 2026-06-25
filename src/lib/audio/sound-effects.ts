type SoundEvent = "taskCompleted" | "attentionRequired" | "processingStarted" | "error";

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
};

export function playSound(event: SoundEvent) {
  try {
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    SOUNDS[event]?.();
  } catch {
    // Audio might not be available
  }
}
