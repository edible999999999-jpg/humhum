export interface CustomSoundClip {
  data_base64: string;
  mime_type: string;
  label: string;
}

export async function playConfiguredSound(
  loadClip: () => Promise<CustomSoundClip | null>,
  playClip: (clip: CustomSoundClip) => Promise<void>,
  playFallback: () => void,
) {
  try {
    const clip = await loadClip();
    if (clip) {
      await playClip(clip);
      return;
    }
  } catch {
    // A broken or incomplete pack must not silence important Agent events.
  }
  playFallback();
}
